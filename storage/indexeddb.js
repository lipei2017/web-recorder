// IndexedDB 数据库封装
const DB_NAME = 'WebRecorderDB';
const DB_VERSION = 1;

class WebRecorderDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 录制会话表
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('url', 'url', { unique: false });
          sessionStore.createIndex('startTime', 'startTime', { unique: false });
        }

        // 网络请求表
        if (!db.objectStoreNames.contains('requests')) {
          const requestStore = db.createObjectStore('requests', { keyPath: 'id' });
          requestStore.createIndex('sessionId', 'sessionId', { unique: false });
          requestStore.createIndex('timestamp', 'timestamp', { unique: false });
          requestStore.createIndex('type', 'type', { unique: false });
        }

        // 存储快照表
        if (!db.objectStoreNames.contains('snapshots')) {
          const snapshotStore = db.createObjectStore('snapshots', { keyPath: 'id' });
          snapshotStore.createIndex('sessionId', 'sessionId', { unique: false });
          snapshotStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  // 创建新会话
  async createSession(sessionData) {
    const session = {
      id: this.generateId(),
      url: sessionData.url,
      title: sessionData.title,
      startTime: Date.now(),
      endTime: null,
      requestCount: 0,
      snapshotCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.add(session);

      request.onsuccess = () => resolve(session);
      request.onerror = () => reject(request.error);
    });
  }

  // 结束会话
  async endSession(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.get(sessionId);

      request.onsuccess = () => {
        const session = request.result;
        if (session) {
          session.endTime = Date.now();
          store.put(session);
          resolve(session);
        } else {
          reject(new Error('Session not found'));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 保存网络请求
  async saveRequest(sessionId, requestData) {
    const request = {
      id: this.generateId(),
      sessionId,
      ...requestData,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['requests'], 'readwrite');
      const store = transaction.objectStore('requests');
      const req = store.add(request);

      req.onsuccess = () => resolve(request);
      req.onerror = () => reject(req.error);
    });
  }

  // 清理 WebSocket 消息，只保留每个 URL 最新的 5 条
  async cleanupWebSocketMessages(sessionId, url) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['requests'], 'readwrite');
      const store = transaction.objectStore('requests');
      const index = store.index('sessionId');
      
      const messages = [];
      const request = index.openCursor(sessionId);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const req = cursor.value;
          // 只收集当前 URL 的 WebSocket 入站消息
          if (req.type === 'websocket' && req.direction === 'incoming' && req.url === url) {
            messages.push({ id: cursor.primaryKey, timestamp: req.timestamp });
          }
          cursor.continue();
        } else {
          // 如果消息超过 5 条，删除最旧的
          if (messages.length > 5) {
            // 按时间排序
            messages.sort((a, b) => a.timestamp - b.timestamp);
            // 删除多余的（保留最新的 5 条）
            const toDelete = messages.slice(0, messages.length - 5);
            toDelete.forEach(msg => {
              store.delete(msg.id);
            });
            console.log(`[DB] 清理 ${url} 的旧消息: 删除 ${toDelete.length} 条, 保留 5 条`);
          }
          resolve();
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // 保存存储快照
  async saveSnapshot(sessionId, snapshotData) {
    const snapshot = {
      id: this.generateId(),
      sessionId,
      ...snapshotData,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['snapshots'], 'readwrite');
      const store = transaction.objectStore('snapshots');
      const req = store.add(snapshot);

      req.onsuccess = () => resolve(snapshot);
      req.onerror = () => reject(req.error);
    });
  }

  // 获取会话列表（包含实时计数）
  async getSessions() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions', 'requests', 'snapshots'], 'readonly');
      const sessionStore = transaction.objectStore('sessions');
      const requestStore = transaction.objectStore('requests');
      const snapshotStore = transaction.objectStore('snapshots');

      const request = sessionStore.getAll();

      request.onsuccess = async () => {
        const sessions = request.result.reverse();
        
        // 为每个会话计算请求数和快照数
        const sessionsWithCounts = await Promise.all(
          sessions.map(session => {
            return new Promise((resolveSession) => {
              // 统计请求数
              const requestIndex = requestStore.index('sessionId');
              const requestCountQuery = requestIndex.count(session.id);
              
              // 统计快照数
              const snapshotIndex = snapshotStore.index('sessionId');
              const snapshotCountQuery = snapshotIndex.count(session.id);
              
              Promise.all([
                new Promise(r => { requestCountQuery.onsuccess = () => r(requestCountQuery.result); }),
                new Promise(r => { snapshotCountQuery.onsuccess = () => r(snapshotCountQuery.result); })
              ]).then(([requestCount, snapshotCount]) => {
                resolveSession({
                  ...session,
                  requestCount,
                  snapshotCount
                });
              });
            });
          })
        );
        
        resolve(sessionsWithCounts);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // 获取会话详情
  async getSession(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions', 'requests', 'snapshots'], 'readonly');
      
      const sessionStore = transaction.objectStore('sessions');
      const requestStore = transaction.objectStore('requests');
      const snapshotStore = transaction.objectStore('snapshots');

      const sessionReq = sessionStore.get(sessionId);
      
      sessionReq.onsuccess = () => {
        const session = sessionReq.result;
        if (!session) {
          reject(new Error('Session not found'));
          return;
        }

        // 获取请求
        const requestIndex = requestStore.index('sessionId');
        const requestQuery = requestIndex.getAll(sessionId);

        // 获取快照
        const snapshotIndex = snapshotStore.index('sessionId');
        const snapshotQuery = snapshotIndex.getAll(sessionId);

        Promise.all([
          new Promise((r) => { requestQuery.onsuccess = () => r(requestQuery.result); }),
          new Promise((r) => { snapshotQuery.onsuccess = () => r(snapshotQuery.result); })
        ]).then(([requests, snapshots]) => {
          resolve({
            ...session,
            requests,
            snapshots
          });
        });
      };

      sessionReq.onerror = () => reject(sessionReq.error);
    });
  }

  // 删除会话
  async deleteSession(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions', 'requests', 'snapshots'], 'readwrite');
      
      const sessionStore = transaction.objectStore('sessions');
      const requestStore = transaction.objectStore('requests');
      const snapshotStore = transaction.objectStore('snapshots');

      // 删除会话
      sessionStore.delete(sessionId);

      // 删除相关请求
      const requestIndex = requestStore.index('sessionId');
      const requestQuery = requestIndex.openCursor(sessionId);
      requestQuery.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          requestStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      // 删除相关快照
      const snapshotIndex = snapshotStore.index('sessionId');
      const snapshotQuery = snapshotIndex.openCursor(sessionId);
      snapshotQuery.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          snapshotStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 生成唯一 ID
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出数据库实例
export const db = new WebRecorderDB();
