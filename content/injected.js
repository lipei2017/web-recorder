// 网络请求拦截器 - 注入到页面的脚本
(function() {
  'use strict';

  // 回放统计数组大小限制
  const PLAYBACK_STATS_LIMIT = 100;

  // 标记脚本已加载
  window.__webrecorder_injected_loaded = true;

  // ==================== 保存真正的原始 API（必须在重写之前）====================
  const RealXMLHttpRequest = window.XMLHttpRequest;
  const RealFetch = window.fetch;
  const RealWebSocket = window.WebSocket;
  
  const playbackOriginalXHR = RealXMLHttpRequest;
  const playbackOriginalFetch = RealFetch;
  
  // ==================== 回放状态变量（必须在任何拦截器之前定义）====================
  let isPlayingBack = false;
  let playbackSession = null;
  let requestMap = new Map();
  // 等待回放数据模式（当数据太大时，需要等待 content script 发送完整数据）
  let isWaitingForPlaybackData = false;
  // 缓存等待期间的请求
  let pendingXHRRequests = [];
  let pendingFetchRequests = [];
  // 回放拦截统计
  let playbackStats = {
    intercepted: [],
    passed: [],
    filtered: []
  };
  
  // WebSocket 回放管理器
  const WebSocketPlaybackManager = {
    messagesByUrl: new Map(),
    
    initPlayback(session) {
      this.messagesByUrl.clear();
      
      if (session.requests) {
        const messagesByUrl = new Map();
        
        session.requests.forEach(req => {
          if (req.type === 'websocket' && req.direction === 'incoming') {
            if (!messagesByUrl.has(req.url)) {
              messagesByUrl.set(req.url, []);
            }
            messagesByUrl.get(req.url).push(req);
          }
        });
        
        messagesByUrl.forEach((messages, url) => {
          messages.sort((a, b) => a.timestamp - b.timestamp);
          const limitedMessages = messages.slice(-5);
          this.messagesByUrl.set(url, limitedMessages);
        });
      }
    },
    getAllMessages(url) {
      let messages = null;
      
      // 1. 精确匹配（完整 URL）
      if (this.messagesByUrl.has(url)) {
        messages = this.messagesByUrl.get(url);
      }
      
      // 2. 路径匹配（忽略查询参数）
      if (!messages) {
        try {
          const urlObj = new URL(url);
          const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
          
          for (const [recordedUrl, msgs] of this.messagesByUrl.entries()) {
            try {
              const recordedUrlObj = new URL(recordedUrl);
              const recordedBaseUrl = `${recordedUrlObj.protocol}//${recordedUrlObj.host}${recordedUrlObj.pathname}`;
              
              if (baseUrl === recordedBaseUrl) {
                messages = msgs;
                break;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
      
      // 3. 如果只有一个录制URL，直接使用
      if (!messages && this.messagesByUrl.size === 1) {
        const [recordedUrl, msgs] = Array.from(this.messagesByUrl.entries())[0];
        messages = msgs;
      }
      
      // 返回消息数组的深拷贝，确保每个连接都有独立的副本
      if (messages && messages.length > 0) {
        return messages.map(msg => ({...msg}));
      }
      
      return null;
    }
  };
  
  // 创建 Mock WebSocket
  function createMockWebSocket(url, protocols, messages) {
    const eventTarget = new EventTarget();
    let readyState = WebSocket.CONNECTING;
    let messageIndex = 0;
    
    const pushNextMessage = () => {
      if (messageIndex < messages.length && readyState === WebSocket.OPEN) {
        const msg = messages[messageIndex];
        messageIndex++;
        const messageData = typeof msg.responseBody === 'string' 
          ? msg.responseBody 
          : JSON.stringify(msg.responseBody);
        eventTarget.dispatchEvent(new MessageEvent('message', {
          data: messageData,
          origin: new URL(url).origin
        }));
        if (messageIndex < messages.length) {
          const nextDelay = messages[messageIndex].timestamp - msg.timestamp;
          const delay = Math.min(Math.max(nextDelay, 100), 2000);
          setTimeout(pushNextMessage, delay);
        }
      }
    };
    
    const mockWs = {
      url: url,
      protocol: protocols?.[0] || '',
      readyState: readyState,
      bufferedAmount: 0,
      extensions: '',
      binaryType: 'blob',
      set onopen(h) { eventTarget.addEventListener('open', h); },
      set onmessage(h) { eventTarget.addEventListener('message', h); },
      set onclose(h) { eventTarget.addEventListener('close', h); },
      set onerror(h) { eventTarget.addEventListener('error', h); },
      send(data) {
        if (readyState === WebSocket.OPEN) {
          setTimeout(pushNextMessage, 100);
        }
      },
      close(code, reason) {
        readyState = WebSocket.CLOSED;
        this.readyState = readyState;
        eventTarget.dispatchEvent(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
      },
      addEventListener(t, l, o) { eventTarget.addEventListener(t, l, o); },
      removeEventListener(t, l, o) { eventTarget.removeEventListener(t, l, o); },
      dispatchEvent(e) { return eventTarget.dispatchEvent(e); }
    };
    
    setTimeout(() => {
      if (mockWs.readyState !== WebSocket.CLOSED) {
        readyState = WebSocket.OPEN;
        mockWs.readyState = readyState;
        eventTarget.dispatchEvent(new Event('open'));
        // 连接成功后自动开始推送消息
        setTimeout(pushNextMessage, 100);
      }
    }, 100);
    
    return mockWs;
  }
  
  // ==================== 页面加载时立即检查回放状态（必须在劫持 WebSocket 之前）====================
  (function checkAndRestorePlaybackOnLoad() {
    try {
      const playbackData = sessionStorage.getItem('webrecorder_playback');
      
      if (playbackData) {
        const parsed = JSON.parse(playbackData);
        const { timestamp, sessionData, sessionId } = parsed;
        
        if (Date.now() - timestamp < 5 * 60 * 1000) {
            if (sessionData) {
              // 有完整数据，立即启动回放
              playbackSession = sessionData;
              isPlayingBack = true;
              WebSocketPlaybackManager.initPlayback(sessionData);
              window.__webrecorder_needs_playback_init = true;
            } else if (sessionId) {
              // 只有 sessionId，数据太大没保存，需要等待 content script 发送
              isWaitingForPlaybackData = true;
              
              // 设置超时，如果 5 秒内没收到数据，取消等待
              setTimeout(() => {
                if (isWaitingForPlaybackData) {
                  isWaitingForPlaybackData = false;
                  // 处理缓存的请求
                  processPendingRequests();
                }
              }, 5000);
            }
        } else {
          sessionStorage.removeItem('webrecorder_playback');
        }
      }
    } catch (error) {
      console.error('[WebRecorder] 检查回放状态失败:', error);
    }
  })();
  
  // 处理等待期间缓存的请求
  function processPendingRequests() {
    // 处理缓存的 XHR 请求
    pendingXHRRequests.forEach(req => {
      if (isPlayingBack && playbackSession) {
        processCachedXHR(req);
      } else {
        // 不处于回放模式，执行真实请求
        const xhr = new RealXMLHttpRequest();
        xhr.open(req.method, req.url);
        Object.entries(req.headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        if (req.callbacks.onload) xhr.onload = req.callbacks.onload;
        if (req.callbacks.onerror) xhr.onerror = req.callbacks.onerror;
        if (req.callbacks.onreadystatechange) xhr.onreadystatechange = req.callbacks.onreadystatechange;
        xhr.send(req.body);
      }
    });
    pendingXHRRequests = [];
    
    // 处理缓存的 Fetch 请求
    pendingFetchRequests.forEach(req => {
      if (isPlayingBack && playbackSession) {
        processCachedFetch(req);
      } else {
        // 不处于回放模式，执行真实请求
        playbackOriginalFetch(req.resource, req.init)
          .then(response => req.resolve(response))
          .catch(error => req.reject(error));
      }
    });
    pendingFetchRequests = [];
  }
  
  // ==================== 立即劫持 WebSocket 构造函数 ====================
  const OriginalWebSocket = RealWebSocket;
  window.WebSocket = function(url, protocols) {
    // 如果不在录制状态且不在回放状态，直接返回真实 WebSocket，不做任何劫持
    if (!isCapturing && !isPlayingBack) {
      // 检查是否需要等待回放数据
      if (isWaitingForPlaybackData) {
        // 处于等待回放数据模式，需要特殊处理
        // 继续执行下方的回放检查逻辑
      } else {
        return new OriginalWebSocket(url, protocols);
      }
    }
    
    let shouldUsePlayback = isPlayingBack;
    
    // 如果还没设置，从 sessionStorage 检查
    if (!shouldUsePlayback) {
      try {
        const playbackData = sessionStorage.getItem('webrecorder_playback');
        if (playbackData) {
          const parsed = JSON.parse(playbackData);
          const { timestamp, sessionData } = parsed;
          
          if (Date.now() - timestamp < 5 * 60 * 1000 && sessionData) {
            shouldUsePlayback = true;
            if (!isPlayingBack) {
              playbackSession = sessionData;
              isPlayingBack = true;
              WebSocketPlaybackManager.initPlayback(sessionData);
            }
          }
        }
      } catch (e) {}
    }
    
    // 回放模式：检查是否有录制数据
    if (shouldUsePlayback) {
      const messages = WebSocketPlaybackManager.getAllMessages(url);
      if (messages && messages.length > 0) {
        return createHijackedWebSocket(url, protocols, messages);
      }
    }
    
    // 如果不在录制状态，返回原始 WebSocket（已检查过 isWaitingForPlaybackData）
    if (!isCapturing) {
      return new OriginalWebSocket(url, protocols);
    }
    
    // 创建真实 WebSocket
    const ws = new OriginalWebSocket(url, protocols);
    
    // 录制功能：劫持 send 和 message 事件
    const wsUrl = url;
    const originalSend = ws.send.bind(ws);
    
    ws.send = async function(data) {
      if (isCapturing) {
        try {
          await captureRequest({
            type: 'websocket',
            method: 'SEND',
            url: wsUrl,
            headers: {},
            requestBody: parseBody(data),
            status: null,
            responseHeaders: {},
            responseBody: null,
            direction: 'outgoing',
            timestamp: Date.now()
          });
        } catch (e) {}
      }
      return originalSend(data);
    };

    ws.addEventListener('message', async (event) => {
      if (isCapturing) {
        try {
          await captureRequest({
            type: 'websocket',
            method: 'RECEIVE',
            url: wsUrl,
            headers: {},
            requestBody: null,
            status: null,
            responseHeaders: {},
            responseBody: parseResponse(event.data),
            direction: 'incoming',
            timestamp: Date.now()
          });
        } catch (e) {}
      }
    });

    WebSocketTracker.add(ws);
    ws.addEventListener('close', () => {
      WebSocketTracker.instances.delete(ws);
    });

    return ws;
  };
  
  // 复制 WebSocket 常量
  Object.keys(OriginalWebSocket).forEach(key => {
    try {
      window.WebSocket[key] = OriginalWebSocket[key];
    } catch (e) {}
  });
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  
  // WebSocket 实例追踪器和回放数据
  const WebSocketTracker = {
    instances: new Set(),
    add(ws) { this.instances.add(ws); },
    getAll() { return Array.from(this.instances); }
  };
  const wsPlaybackData = new Map();

  let isCapturing = false;
  let hasCaptureStarted = false;
  let pendingRequests = [];

  // 检查是否已经在 Web Worker 或其他环境中运行
  if (typeof window === 'undefined') {
    return;
  }

  // 页面加载时显示回放指示器和劫持已存在的 WebSocket
  (function setupPlaybackUI() {
    try {
      const playbackData = sessionStorage.getItem('webrecorder_playback');
      if (playbackData) {
        const parsed = JSON.parse(playbackData);
        const { timestamp, sessionData } = parsed;
        if (Date.now() - timestamp < 5 * 60 * 1000 && sessionData) {
          if (window.__webrecorder_needs_playback_init) {
            buildRequestMap();
            injectPlaybackInterceptors();
            delete window.__webrecorder_needs_playback_init;
          }
          
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showPlaybackIndicator, { once: true });
          } else {
            showPlaybackIndicator();
          }
          
          hijackWithDelay();
        }
      }
    } catch (error) {}
  })();

  // 页面加载时检查录制状态
  (function checkAndRestoreRecordingOnLoad() {
    try {
      const recordingData = sessionStorage.getItem('webrecorder_recording');
      if (recordingData) {
        const { sessionId, timestamp } = JSON.parse(recordingData);
        // 修复：如果正在回放或等待回放数据，不恢复录制状态
        if (Date.now() - timestamp < 5 * 60 * 1000 && !isPlayingBack && !isWaitingForPlaybackData) {
          isCapturing = true;
          hasCaptureStarted = true;
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showRecordingIndicator, { once: true });
          } else {
            showRecordingIndicator();
          }
        } else {
          sessionStorage.removeItem('webrecorder_recording');
        }
      }
    } catch (error) {
      try {
        sessionStorage.removeItem('webrecorder_recording');
      } catch (e) {}
    }
  })();

  // 监听来自 content script 的消息
  window.addEventListener('message', (event) => {
    // 只处理来自 content script 的消息
    if (event.data?.source !== 'WEBRECORDER_CONTENT_SCRIPT') return;
    if (!event.data?.type) return;


    if (event.data.type === 'WEBRECORDER_START_CAPTURE') {
      isCapturing = true;
      hasCaptureStarted = true;
      // 处理缓存的早期请求
      processPendingRequests();
      // 显示录制指示器
      showRecordingIndicator();
    }

    if (event.data.type === 'WEBRECORDER_STOP_CAPTURE') {
      isCapturing = false;
      hasCaptureStarted = false;
      pendingRequests = []; // 清空缓存
      
      // 清理 sessionStorage 中的录制数据
      try {
        sessionStorage.removeItem('webrecorder_recording');
      } catch (e) {}
      
      // 隐藏录制指示器
      hideRecordingIndicator();
    }

    if (event.data.type === 'WEBRECORDER_START_PLAYBACK') {
      // 回放逻辑由后面的代码处理
    }
  });

  // 拦截 XMLHttpRequest
  function interceptXHR() {

    window.XMLHttpRequest = function() {
      // 如果不在录制状态且不在回放状态，直接返回真实 XHR 实例，不做任何拦截
      if (!isCapturing && !isPlayingBack) {
        return new RealXMLHttpRequest();
      }
      
      // 如果正在回放，直接返回真实 XHR 实例，让回放拦截器处理
      if (isPlayingBack) {
        return new RealXMLHttpRequest();
      }
      
      const xhrInstance = new RealXMLHttpRequest();
      const realOpen = xhrInstance.open.bind(xhrInstance);
      const realSend = xhrInstance.send.bind(xhrInstance);
      const realSetRequestHeader = xhrInstance.setRequestHeader.bind(xhrInstance);

      let method = 'GET';
      let url = '';
      let requestHeaders = {};
      let requestBody = null;
      let startTime = 0;

      xhrInstance.open = function(m, u, ...args) {
        method = m;
        url = u;
        return realOpen(m, u, ...args);
      };

      xhrInstance.setRequestHeader = function(header, value) {
        requestHeaders[header] = value;
        return realSetRequestHeader(header, value);
      };

      xhrInstance.send = function(body) {
        requestBody = body;
        startTime = performance.now();

        // 监听响应
        const onLoad = async () => {
          const duration = performance.now() - startTime;
          await captureRequest({
            type: 'xhr',
            method: method,
            url: url,
            headers: requestHeaders,
            requestBody: parseBody(requestBody),
            status: xhrInstance.status,
            responseHeaders: parseResponseHeaders(xhrInstance.getAllResponseHeaders()),
            responseBody: parseResponse(xhrInstance.response),
            duration: Math.round(duration),
            timestamp: Date.now()
          });
        };

        const onError = async () => {
          const duration = performance.now() - startTime;
          await captureRequest({
            type: 'xhr',
            method: method,
            url: url,
            headers: requestHeaders,
            requestBody: parseBody(requestBody),
            status: 0,
            responseHeaders: {},
            responseBody: null,
            error: 'Network Error',
            duration: Math.round(duration),
            timestamp: Date.now()
          });
        };

        xhrInstance.addEventListener('load', onLoad);
        xhrInstance.addEventListener('error', onError);
        xhrInstance.addEventListener('abort', onError);

        return realSend(body);
      };

      return xhrInstance;
    };

  }

  // 拦截 Fetch API
  function interceptFetch() {

    window.fetch = function(resource, init = {}) {

      if (!isCapturing) {
        return RealFetch.apply(this, arguments);
      }

      const startTime = performance.now();
      let url, method, headers, body;

      if (resource instanceof Request) {
        url = resource.url;
        method = resource.method || 'GET';
        headers = {};
        resource.headers.forEach((value, key) => {
          headers[key] = value;
        });
        body = resource.body;
      } else {
        url = resource;
        method = init.method || 'GET';
        headers = init.headers || {};
        body = init.body;
      }


      return RealFetch.apply(this, arguments)
        .then(response => {
          const duration = performance.now() - startTime;
          const clonedResponse = response.clone();

          clonedResponse.text().then(async text => {
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key] = value;
            });

            await captureRequest({
              type: 'fetch',
              method: method,
              url: url,
              headers: headers,
              requestBody: parseBody(body),
              status: response.status,
              responseHeaders: responseHeaders,
              responseBody: parseResponse(text),
              duration: Math.round(duration),
              timestamp: Date.now()
            });
          }).catch(err => {
          });

          return response;
        })
        .catch(async error => {
          const duration = performance.now() - startTime;
          await captureRequest({
            type: 'fetch',
            method: method,
            url: url,
            headers: headers,
            requestBody: parseBody(body),
            status: 0,
            responseHeaders: {},
            responseBody: null,
            error: error.message,
            duration: Math.round(duration),
            timestamp: Date.now()
          });
          throw error;
        });
    };

    // 复制原始属性
    Object.keys(RealFetch).forEach(key => {
      try {
        window.fetch[key] = RealFetch[key];
      } catch (e) {}
    });

  }

  // WebSocket 拦截已整合到脚本开头的主 WebSocket 构造函数劫持中

  // 解析请求/响应体
  function parseBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    if (body instanceof FormData) {
      const data = {};
      body.forEach((value, key) => {
        data[key] = value;
      });
      return data;
    }
    if (body instanceof URLSearchParams) {
      const data = {};
      body.forEach((value, key) => {
        data[key] = value;
      });
      return data;
    }
    return body.toString();
  }

  // 解析响应体
  function parseResponse(response) {
    if (!response) return null;
    if (typeof response === 'string') {
      try {
        return JSON.parse(response);
      } catch {
        return response;
      }
    }
    return response;
  }

  // 解析响应头
  function parseResponseHeaders(headerStr) {
    const headers = {};
    if (!headerStr) return headers;
    
    headerStr.split('\r\n').forEach(line => {
      const parts = line.split(': ');
      if (parts.length === 2) {
        headers[parts[0]] = parts[1];
      }
    });
    return headers;
  }

  // URL 过滤规则缓存
  let cachedUrlFilters = null;
  let filtersPromise = null;

  // 从 content script 加载 URL 过滤规则
  async function loadUrlFilters() {
    // 如果已经有缓存，直接返回
    if (cachedUrlFilters !== null) {
      return cachedUrlFilters;
    }
    
    // 如果正在加载中，返回同一个 Promise
    if (filtersPromise) {
      return filtersPromise;
    }
    
    // 创建新的加载 Promise
    filtersPromise = new Promise((resolve) => {
      try {
        // 向 content script 请求过滤规则
        window.postMessage({
          source: 'WEBRECORDER_INJECTED_SCRIPT',
          type: 'WEBRECORDER_REQUEST_URL_FILTERS'
        }, '*');
        
        // 设置超时
        const timeout = setTimeout(() => {
          cachedUrlFilters = [];
          resolve([]);
        }, 1000);
        
        // 监听响应
        const handler = (event) => {
          if (event.source !== window) return;
          if (event.data?.source === 'WEBRECORDER_CONTENT_SCRIPT' && 
              event.data?.type === 'WEBRECORDER_URL_FILTERS_RESPONSE') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            cachedUrlFilters = event.data.filters || [];
            resolve(cachedUrlFilters);
          }
        };
        
        window.addEventListener('message', handler);
      } catch (error) {
        cachedUrlFilters = [];
        resolve([]);
      }
    });
    
    return filtersPromise;
  }

  // 检查 URL 是否匹配过滤规则
  function shouldFilterUrl(url, filters) {
    if (!filters || filters.length === 0) {
      return false;
    }
    
    
    for (const pattern of filters) {
      try {
        // 将通配符转换为正则表达式
        const regexPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
          .replace(/\*/g, '.*'); // 将 * 转换为 .*
        
        const regex = new RegExp(regexPattern);
        if (regex.test(url)) {
          return true;
        }
      } catch (e) {
      }
    }
    return false;
  }

  // 发送捕获的请求数据
  async function captureRequest(data) {
    // 如果录制尚未开始，缓存请求
    if (!isCapturing && !hasCaptureStarted) {
      pendingRequests.push(data);
      return;
    }
    
    if (!isCapturing) {
      return;
    }

    try {
      // 检查 URL 过滤规则
      const filters = await loadUrlFilters();
      if (shouldFilterUrl(data.url, filters)) {
        return;
      }
    } catch (error) {
      // 出错时继续捕获，不过滤
    }

    window.postMessage({
      type: 'WEBRECORDER_NETWORK_REQUEST',
      data: data
    }, '*');

  }

  // 处理缓存的请求
  function processPendingRequests() {
    if (pendingRequests.length === 0) return;
    
    const requests = pendingRequests.splice(0); // 取出所有缓存的请求
    
    requests.forEach(data => {
      if (isCapturing) {
        window.postMessage({
          type: 'WEBRECORDER_NETWORK_REQUEST',
          data: data
        }, '*');
      }
    });
  }

  // 初始化拦截器
  interceptXHR();
  interceptFetch();
  // WebSocket 拦截已在脚本开头完成，不需要再次调用

  // 注意：WebSocket 回放只在点击回放按钮后生效
  // 页面加载时不需要预注入拦截器，因为：
  // 1. 录制时的 WebSocket 可能和回放时的不是同一个
  // 2. 回放启动后会通过 startPlayback() 注入拦截器

  // 页面卸载时打印统计（只打印拦截到的，避免日志刷屏）
  window.addEventListener('beforeunload', () => {
    if (isPlayingBack && playbackStats.intercepted.length > 0) {
    }
  });

  // 监听回放消息
  window.addEventListener('message', (event) => {
    // 只处理来自 content script 的消息
    if (event.data?.source !== 'WEBRECORDER_CONTENT_SCRIPT') {
      return;
    }
    if (!event.data?.type) {
      return;
    }

    if (event.data.type === 'WEBRECORDER_START_PLAYBACK') {
      startPlayback(event.data.session);
    }

    if (event.data.type === 'WEBRECORDER_STOP_PLAYBACK') {
      stopPlayback();
    }
  });

  // 开始回放
  function startPlayback(session) {
    if (isPlayingBack) {
      return;
    }

    playbackSession = session;
    isPlayingBack = true;
    
    // 构建请求映射表（按 URL 和方法）
    buildRequestMap();
    
    // 初始化 WebSocket 回放管理器
    WebSocketPlaybackManager.initPlayback(session);

    // 注入拦截器
    injectPlaybackInterceptors();
    
    // 劫持已存在的 WebSocket 实例（延迟等待页面设置监听器）
    hijackWithDelay();

    // 恢复存储数据
    restoreStorage();

    // 显示回放状态指示器
    try {
      showPlaybackIndicator();
    } catch (e) {
      console.error('[回放启动] 显示指示器失败:', e);
    }
    
    // 处理等待期间缓存的请求
    if (isWaitingForPlaybackData) {
      isWaitingForPlaybackData = false;
      processPendingRequests();
    }
  }

  // 提取路径模式（将ID等动态部分替换为占位符）
  function extractPathPattern(pathname) {
    // 将路径中的数字、UUID、长ID等替换为占位符
    return pathname
      .replace(/\/Page_\d+/g, '/:pageId')  // Page_数字
      .replace(/\/[A-Za-z]+_\d+/g, '/:prefixId')  // 其他前缀+数字
      .replace(/\/\d+/g, '/:id')  // 纯数字ID
      .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/:uuid')  // UUID
      .replace(/\/[a-f0-9]{24,}/gi, '/:hash');  // 长哈希值
  }

  // 构建请求映射
  function buildRequestMap() {
    requestMap.clear();
    
    if (!playbackSession.requests || playbackSession.requests.length === 0) {
      return;
    }
    
    playbackSession.requests.forEach(req => {
      // 只处理 XHR 和 Fetch 请求
      if (req.type !== 'xhr' && req.type !== 'fetch') {
        return;
      }

      try {
        const urlObj = new URL(req.url, window.location.origin);
        const pathname = urlObj.pathname;
        
        // 使用路径模式作为键（忽略域名和动态ID）
        const pattern = extractPathPattern(pathname);
        const key = `${req.method}|${pattern}`;
        
        if (!requestMap.has(key)) {
          requestMap.set(key, []);
        }
        requestMap.get(key).push(req);
      } catch (e) {
        // URL 解析失败，使用完整 URL
        const key = `${req.method}|${req.url}`;
        if (!requestMap.has(key)) {
          requestMap.set(key, []);
        }
        requestMap.get(key).push(req);
      }
    });
  }
  function processCachedXHR(cachedRequest) {
    const { method, url, headers, body, callbacks } = cachedRequest;
    
    
    // 检查 URL 是否被过滤
    const filters = getPlaybackFilters();
    if (shouldFilterUrl(url, filters)) {
      playbackStats.filtered.push({ type: 'xhr', method, url, reason: 'url_filtered' });
      if (playbackStats.filtered.length > PLAYBACK_STATS_LIMIT) {
        playbackStats.filtered.shift();
      }
      // 执行真实请求
      const xhr = new RealXMLHttpRequest();
      xhr.open(method, url);
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      if (callbacks.onload) xhr.onload = callbacks.onload;
      if (callbacks.onerror) xhr.onerror = callbacks.onerror;
      if (callbacks.onreadystatechange) xhr.onreadystatechange = callbacks.onreadystatechange;
      xhr.send(body);
      return;
    }
    
    // 提取 pathname 进行匹配
    const pathname = getPathname(url);
    const key = `${method}|${pathname}`;
    const requests = requestMap.get(key);
    
    if (requests && requests.length > 0) {
      const matched = requests[0];
      
      // 模拟响应
      setTimeout(() => {
        // 创建模拟的 XHR 对象
        const mockXhr = {
          readyState: 4,
          status: matched.status,
          statusText: matched.status >= 200 && matched.status < 300 ? 'OK' : 'Error',
          responseText: typeof matched.responseBody === 'string' ? matched.responseBody : JSON.stringify(matched.responseBody || ''),
          response: typeof matched.responseBody === 'string' ? matched.responseBody : JSON.stringify(matched.responseBody || ''),
          responseURL: matched.url,
          getResponseHeader: (header) => {
            return matched.responseHeaders?.[header] || null;
          },
          getAllResponseHeaders: () => {
            return Object.entries(matched.responseHeaders || {})
              .map(([k, v]) => `${k}: ${v}`)
              .join('\r\n');
          }
        };
        
        // 触发回调
        if (callbacks.onreadystatechange) {
          callbacks.onreadystatechange.call(mockXhr);
        }
        if (callbacks.onload) {
          callbacks.onload.call(mockXhr);
        }
        
        // 记录统计
        playbackStats.intercepted.push({
          type: 'xhr',
          method,
          url,
          pathname,
          key,
          status: matched.status,
          timestamp: Date.now(),
          cached: true
        });
        if (playbackStats.intercepted.length > PLAYBACK_STATS_LIMIT) {
          playbackStats.intercepted.shift();
        }
      }, matched.duration || 0);
    } else {
      // 限制 passed 数组大小，避免内存泄漏
      playbackStats.passed.push({ type: 'xhr', method, url, pathname: key, reason: 'no_match', cached: true });
      if (playbackStats.passed.length > PLAYBACK_STATS_LIMIT) {
        playbackStats.passed.shift();
      }
      
      // 执行真实请求
      const xhr = new RealXMLHttpRequest();
      xhr.open(method, url);
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      if (callbacks.onload) xhr.onload = callbacks.onload;
      if (callbacks.onerror) xhr.onerror = callbacks.onerror;
      if (callbacks.onreadystatechange) xhr.onreadystatechange = callbacks.onreadystatechange;
      xhr.send(body);
    }
  }

  // 处理缓存的 Fetch 请求
  function processCachedFetch(cachedRequest) {
    const { resource, init, url, method, resolve, reject } = cachedRequest;
    
    
    // 检查 URL 是否被过滤
    const filters = getPlaybackFilters();
    if (shouldFilterUrl(url, filters)) {
      playbackStats.filtered.push({ type: 'fetch', method, url, reason: 'url_filtered' });
      if (playbackStats.filtered.length > PLAYBACK_STATS_LIMIT) {
        playbackStats.filtered.shift();
      }
      // 执行真实请求并 resolve 缓存的 promise
      playbackOriginalFetch(resource, init)
        .then(response => resolve(response))
        .catch(error => reject(error));
      return;
    }
    
    // 提取 pathname 进行匹配
    const pathname = getPathname(url);
    const key = `${method}|${pathname}`;
    const requests = requestMap.get(key);
    
    if (requests && requests.length > 0) {
      const matched = requests[0];
      
      // 创建模拟响应
      let responseBody;
      if (matched.responseBody === null || matched.responseBody === undefined) {
        responseBody = '';
      } else {
        responseBody = typeof matched.responseBody === 'string' 
          ? matched.responseBody 
          : JSON.stringify(matched.responseBody);
      }

      const responseHeaders = new Headers();
      if (matched.responseHeaders) {
        Object.entries(matched.responseHeaders).forEach(([key, value]) => {
          responseHeaders.set(key, value);
        });
      }

      const responseInit = {
        status: matched.status,
        statusText: matched.status >= 200 && matched.status < 300 ? 'OK' : 'Error',
        headers: responseHeaders
      };

      // 延迟返回并使用缓存的 promise resolve
      setTimeout(() => {
        const response = new Response(responseBody, responseInit);
        resolve(response);
        
        // 记录统计
        playbackStats.intercepted.push({
          type: 'fetch',
          method,
          url,
          pathname,
          key,
          status: matched.status,
          timestamp: Date.now(),
          cached: true
        });
        if (playbackStats.intercepted.length > PLAYBACK_STATS_LIMIT) {
          playbackStats.intercepted.shift();
        }
      }, matched.duration || 0);
    } else {
      // 限制 passed 数组大小，避免内存泄漏
      playbackStats.passed.push({ type: 'fetch', method, url, pathname: key, reason: 'no_match', cached: true });
      if (playbackStats.passed.length > PLAYBACK_STATS_LIMIT) {
        playbackStats.passed.shift();
      }
      // 执行真实请求并 resolve 缓存的 promise
      playbackOriginalFetch(resource, init)
        .then(response => resolve(response))
        .catch(error => reject(error));
    }
  }

  // 停止回放
  function stopPlayback() {
    if (!isPlayingBack) {
      return;
    }
    
    // 重置回放状态
    isPlayingBack = false;
    playbackSession = null;
    requestMap.clear();
    
    // 清理 WebSocket 回放数据
    wsPlaybackData.clear();
    hijackedWebSockets.clear();
    WebSocketPlaybackManager.messagesByUrl.clear();
    
    // 清理 sessionStorage 中的回放数据
    try {
      sessionStorage.removeItem('webrecorder_playback');
    } catch (e) {}
    
    // 重置回放统计
    playbackStats = {
      intercepted: [],
      passed: [],
      filtered: []
    };

    // 隐藏回放状态指示器
    hidePlaybackIndicator();
  }

  // 显示回放状态指示器
  function showPlaybackIndicator() {
    // 检查 document.body 是否存在
    if (!document.body) {
      // 等待 DOM 加载完成
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showPlaybackIndicator, { once: true });
      } else {
        // 如果 DOM 已经加载但 body 还是不存在，延迟重试
        setTimeout(showPlaybackIndicator, 100);
      }
      return;
    }

    // 移除已存在的回放指示器和录制指示器
    hidePlaybackIndicator();
    hideRecordingIndicator();

    const indicator = document.createElement('div');
    indicator.id = 'webrecorder-playback-indicator';
    indicator.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 999999;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease;
      ">
        <span style="
          width: 8px;
          height: 8px;
          background: #4ade80;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        "></span>
        <span>🎬 正在回放中</span>
        <button id="webrecorder-stop-playback" style="
          margin-left: 8px;
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: white;
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
        ">停止</button>
      </div>
      <style>
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        #webrecorder-stop-playback:hover {
          background: rgba(255, 255, 255, 0.3) !important;
        }
      </style>
    `;

    document.body.appendChild(indicator);

    // 绑定停止按钮事件
    const stopBtn = indicator.querySelector('#webrecorder-stop-playback');
    stopBtn.addEventListener('click', () => {
      // 清除 sessionStorage 以防止刷新后自动恢复回放
      try {
        sessionStorage.removeItem('webrecorder_playback');
      } catch (e) {
        console.error('[回放停止] 清除 sessionStorage 失败:', e);
      }
      stopPlayback();
    });

  }

  // 隐藏回放状态指示器
  function hidePlaybackIndicator() {
    const existing = document.getElementById('webrecorder-playback-indicator');
    if (existing) {
      existing.remove();
    }
  }

  // 显示录制状态指示器
  function showRecordingIndicator() {
    // 检查 document.body 是否存在
    if (!document.body) {
      // 等待 DOM 加载完成
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showRecordingIndicator, { once: true });
      } else {
        // 如果 DOM 已经加载但 body 还是不存在，延迟重试
        setTimeout(showRecordingIndicator, 100);
      }
      return;
    }

    // 移除已存在的指示器
    hideRecordingIndicator();

    const indicator = document.createElement('div');
    indicator.id = 'webrecorder-recording-indicator';
    indicator.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 999999;
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(240, 147, 251, 0.4);
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease;
      ">
        <span style="
          width: 8px;
          height: 8px;
          background: #ff4757;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        "></span>
        <span>🔴 正在录制中</span>
        <button id="webrecorder-stop-recording" style="
          margin-left: 10px;
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: white;
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
        ">停止</button>
      </div>
      <style>
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        #webrecorder-stop-recording:hover {
          background: rgba(255, 255, 255, 0.3) !important;
        }
      </style>
    `;

    document.body.appendChild(indicator);

    // 绑定停止按钮事件
    const stopBtn = indicator.querySelector('#webrecorder-stop-recording');
    stopBtn.addEventListener('click', () => {
      // 发送消息给 content script 停止录制
      window.postMessage({
        source: 'WEBRECORDER_INJECTED_SCRIPT',
        type: 'WEBRECORDER_STOP_RECORDING'
      }, '*');
    });
  }

  // 隐藏录制状态指示器
  function hideRecordingIndicator() {
    const existing = document.getElementById('webrecorder-recording-indicator');
    if (existing) {
      existing.remove();
    }
  }

  // 辅助函数：获取路径模式
  function getPathname(url) {
    try {
      const urlObj = new URL(url, window.location.origin);
      const pathname = urlObj.pathname;
      // 使用相同的模式提取逻辑
      return extractPathPattern(pathname);
    } catch (e) {
      return url;
    }
  }

  // 恢复存储数据
  function restoreStorage() {
    if (!playbackSession.snapshots || playbackSession.snapshots.length === 0) {
      return;
    }

    // 使用最后一个快照
    const lastSnapshot = playbackSession.snapshots[playbackSession.snapshots.length - 1];

    // 获取 localStorage key 过滤规则
    let localStorageFilters = [];
    try {
      const filtersData = sessionStorage.getItem('webrecorder_localstorage_filters');
      if (filtersData) {
        localStorageFilters = JSON.parse(filtersData);
      }
    } catch (e) {}

    // 检查 key 是否被过滤
    function isKeyFiltered(key) {
      return localStorageFilters.some(filter => {
        if (filter.includes('*')) {
          // 通配符匹配
          const regexPattern = filter.replace(/\*/g, '.*');
          const regex = new RegExp(regexPattern);
          return regex.test(key);
        }
        return key === filter;
      });
    }

    // 恢复 localStorage
    if (lastSnapshot.localStorage) {
      Object.keys(lastSnapshot.localStorage).forEach(key => {
        if (isKeyFiltered(key)) {
          return;
        }
        try {
          window.localStorage.setItem(key, lastSnapshot.localStorage[key]);
        } catch (e) {}
      });
    }

    // 恢复 sessionStorage
    if (lastSnapshot.sessionStorage) {
      Object.keys(lastSnapshot.sessionStorage).forEach(key => {
        if (isKeyFiltered(key)) {
          return;
        }
        try {
          window.sessionStorage.setItem(key, lastSnapshot.sessionStorage[key]);
        } catch (e) {}
      });
    }
  }

  // 注入回放拦截器
  function injectPlaybackInterceptors() {
    injectPlaybackXHR();
    injectPlaybackFetch();
    injectGlobalWebSocketInterceptor();
    // WebSocket 劫持已在脚本最开始完成
  }
  
  // 注入全局 WebSocket 消息拦截器
  function injectGlobalWebSocketInterceptor() {
    // 1. 劫持 WebSocket 原型的 addEventListener
    const originalAddEventListener = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function(type, listener, options) {
      if (type === 'message' && isPlayingBack && hijackedWebSockets.has(this)) {
        // 不调用原始方法，直接存储到我们的列表
        if (!this._hijackedMessageListeners) {
          this._hijackedMessageListeners = [];
        }
        this._hijackedMessageListeners.push(listener);
        return;
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
    
    // 2. 劫持 WebSocket 原型的 dispatchEvent
    const originalDispatchEvent = WebSocket.prototype.dispatchEvent;
    WebSocket.prototype.dispatchEvent = function(event) {
      if (event.type === 'message' && isPlayingBack && hijackedWebSockets.has(this)) {
        return false; // 完全阻止事件分发
      }
      return originalDispatchEvent.call(this, event);
    };
    
    // 3. 劫持 EventTarget 的 dispatchEvent（更底层）
    const originalEventTargetDispatchEvent = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function(event) {
      if (this instanceof WebSocket && event.type === 'message' && isPlayingBack && hijackedWebSockets.has(this)) {
        return false;
      }
      return originalEventTargetDispatchEvent.call(this, event);
    };
  }

  // 回放拦截器中使用的过滤规则缓存
  let playbackFilters = null;
  
  // 加载回放过滤规则（同步版本，使用已缓存的规则）
  function getPlaybackFilters() {
    if (playbackFilters !== null) {
      return playbackFilters;
    }
    // 尝试从 sessionStorage 读取
    try {
      const filtersData = sessionStorage.getItem('webrecorder_url_filters');
      if (filtersData) {
        playbackFilters = JSON.parse(filtersData);
        return playbackFilters;
      }
    } catch (e) {
    }
    playbackFilters = [];
    return playbackFilters;
  }

  // 创建等待回放数据时的 XHR 代理
  function createWaitingXHRProxy(realXhr) {
    let cachedRequest = {
      method: 'GET',
      url: '',
      headers: {},
      body: null,
      callbacks: {}
    };
    
    const overriddenMethods = {};
    
    const proxy = new Proxy(realXhr, {
      get(target, prop) {
        if (overriddenMethods[prop]) {
          return overriddenMethods[prop];
        }
        
        const value = target[prop];
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    });
    
    // 重写 open 方法
    overriddenMethods.open = function(method, url, ...args) {
      cachedRequest.method = method;
      cachedRequest.url = url;
    };
    
    // 重写 setRequestHeader
    overriddenMethods.setRequestHeader = function(header, value) {
      cachedRequest.headers[header] = value;
    };
    
    // 重写 send
    overriddenMethods.send = function(body) {
      cachedRequest.body = body;
      // 将请求加入待处理队列
      pendingXHRRequests.push(cachedRequest);
    };
    
    // 重写 addEventListener
    overriddenMethods.addEventListener = function(type, listener, options) {
      if (!cachedRequest.callbacks[type]) {
        cachedRequest.callbacks[type] = [];
      }
      cachedRequest.callbacks[type].push(listener);
    };
    
    return proxy;
  }

  // 拦截 XMLHttpRequest（回放模式）
  function injectPlaybackXHR() {

    
    const OriginalXHR = playbackOriginalXHR;
    
    window.XMLHttpRequest = function() {
      // 计数器
      window.XMLHttpRequest._creationCount = (window.XMLHttpRequest._creationCount || 0) + 1;
      const instanceId = window.XMLHttpRequest._creationCount;
      
      // 创建真正的 XHR 实例
      const realXhr = new OriginalXHR();
      
      // 如果正在等待回放数据，需要特殊处理
      if (isWaitingForPlaybackData) {
        return createWaitingXHRProxy(realXhr);
      }
      
      // 如果不在回放模式，返回真实 XHR
      if (!isPlayingBack) {
        return realXhr;
      }

      // 用于存储请求信息
      let requestInfo = {
        method: 'GET',
        url: '',
        matched: null
      };

      // 存储事件监听器
      const eventListeners = {};
      
      // 创建代理对象
      const overriddenMethods = {};
      
      const proxy = new Proxy(realXhr, {
        get(target, prop) {
          // 检查是否有覆盖的方法
          if (overriddenMethods[prop]) {
            return overriddenMethods[prop];
          }
          
          // 如果已匹配到录制请求，拦截特定属性
          if (requestInfo.matched) {
            switch (prop) {
              case 'readyState':
                return 4;
              case 'status':
                return requestInfo.matched.status;
              case 'statusText':
                return requestInfo.matched.status >= 200 && requestInfo.matched.status < 300 ? 'OK' : 'Error';
              case 'responseText':
              case 'response':
                const body = requestInfo.matched.responseBody;
                if (body === null || body === undefined) {
                  return '';
                }
                const result = typeof body === 'string' ? body : JSON.stringify(body);
                return result;
              case 'responseURL':
                return requestInfo.matched.url;
            }
          }
          
          // 获取目标值
          const value = target[prop];
          
          // 如果是函数，绑定到 target
          if (typeof value === 'function') {
            return value.bind(target);
          }
          
          // 返回其他值（包括回调属性）
          return value;
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        }
      });
      
      // 重写 addEventListener - 直接委托给 realXhr
      overriddenMethods.addEventListener = function(type, listener, options) {
        return realXhr.addEventListener(type, listener, options);
      };
      
      // 重写 removeEventListener - 直接委托给 realXhr
      overriddenMethods.removeEventListener = function(type, listener, options) {
        return realXhr.removeEventListener(type, listener, options);
      };
      
      // 重写 open 方法
      overriddenMethods.open = function(method, url, ...args) {
        requestInfo.method = method;
        requestInfo.url = url;
        
        // 检查 URL 是否被过滤
        const filters = getPlaybackFilters();
        if (shouldFilterUrl(url, filters)) {
          playbackStats.filtered.push({ type: 'xhr', method, url, reason: 'url_filtered' });
          if (playbackStats.filtered.length > PLAYBACK_STATS_LIMIT) {
            playbackStats.filtered.shift();
          }
          return realXhr.open(method, url, ...args);
        }
        
        // 提取 pathname 进行匹配
        const pathname = getPathname(url);
        const key = `${method}|${pathname}`;
        const requests = requestMap.get(key);
        
        if (requests && requests.length > 0) {
          // 使用第一个匹配项，不移除，允许多次匹配（页面刷新后）
          requestInfo.matched = requests[0];
          
          // 记录拦截统计
          playbackStats.intercepted.push({
            type: 'xhr',
            method,
            url,
            pathname,
            key,
            status: requestInfo.matched.status,
            timestamp: Date.now()
          });
          if (playbackStats.intercepted.length > PLAYBACK_STATS_LIMIT) {
            playbackStats.intercepted.shift();
          }
          
          // 调用 realXhr.open() 来设置正确的状态，避免 setRequestHeader 报错
          try {
            realXhr.open(method, 'data:text/plain,');
          } catch (e) {}
          return;
        }
        
        // 限制 passed 数组大小，避免内存泄漏
        playbackStats.passed.push({ type: 'xhr', method, url, pathname: key, reason: 'no_match' });
        if (playbackStats.passed.length > PLAYBACK_STATS_LIMIT) {
          playbackStats.passed.shift();
        }
        return realXhr.open(method, url, ...args);
      };

      // 重写 send 方法
      overriddenMethods.send = function(body) {
        if (requestInfo.matched) {
          const responseBody = requestInfo.matched.responseBody;
          const responseText = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
          
          // 使用 data URL 触发真实的 XHR 流程
          // 这样 Axios 等库的事件监听器能正常工作
          try {
            realXhr.open(requestInfo.method, 'data:application/json,' + encodeURIComponent(responseText));
          } catch (e) {
          }
          
          return realXhr.send();
        }

        // 未匹配到，执行真实请求
        return realXhr.send(body);
      };
      
      // 重写 setRequestHeader 方法，避免在拦截时调用真实方法导致错误
      overriddenMethods.setRequestHeader = function(header, value) {
        if (requestInfo.matched) {
          // 请求被拦截，不需要设置请求头
          return;
        }
        return realXhr.setRequestHeader(header, value);
      };

      return proxy;
    };

    Object.keys(playbackOriginalXHR).forEach(key => {
      try {
        window.XMLHttpRequest[key] = playbackOriginalXHR[key];
      } catch (e) {}
    });
    window.XMLHttpRequest.prototype = playbackOriginalXHR.prototype;

  }

  // 拦截 Fetch API（回放模式）
  function injectPlaybackFetch() {
    
    window.fetch = function(resource, init = {}) {
      // 解析 URL 和方法
      let url, method;
      if (resource instanceof Request) {
        url = resource.url;
        method = resource.method || 'GET';
      } else {
        url = resource;
        method = (init && init.method) || 'GET';
      }
      
      // 如果正在等待回放数据，缓存请求
      if (isWaitingForPlaybackData) {
        return new Promise((resolve, reject) => {
          pendingFetchRequests.push({
            resource,
            init,
            url,
            method,
            resolve,
            reject
          });
        });
      }
      
      // 如果不在回放模式，执行真实请求
      if (!isPlayingBack) {
        return playbackOriginalFetch.apply(this, arguments);
      }

      let requestInit;

      if (resource instanceof Request) {
        requestInit = init;
      } else {
        requestInit = init || {};
      }

      // 检查 URL 是否被过滤
      const filters = getPlaybackFilters();
      if (shouldFilterUrl(url, filters)) {
        playbackStats.filtered.push({ type: 'fetch', method, url, reason: 'url_filtered' });
        if (playbackStats.filtered.length > PLAYBACK_STATS_LIMIT) {
          playbackStats.filtered.shift();
        }
        return playbackOriginalFetch.apply(this, arguments);
      }

      // 提取 pathname 进行匹配
      const pathname = getPathname(url);
      const key = `${method}|${pathname}`;
      const requests = requestMap.get(key);
      let matchedRequest = null;

      if (requests && requests.length > 0) {
        // 使用第一个匹配项，不移除，允许多次匹配（页面刷新后）
        matchedRequest = requests[0];
        
        // 记录拦截统计
        playbackStats.intercepted.push({
          type: 'fetch',
          method,
          url,
          pathname,
          key,
          status: matchedRequest.status,
          timestamp: Date.now()
        });
        if (playbackStats.intercepted.length > PLAYBACK_STATS_LIMIT) {
          playbackStats.intercepted.shift();
        }
      } else {
        // 限制 passed 数组大小，避免内存泄漏
        playbackStats.passed.push({ type: 'fetch', method, url, pathname: key, reason: 'no_match' });
        if (playbackStats.passed.length > PLAYBACK_STATS_LIMIT) {
          playbackStats.passed.shift();
        }
      }

      if (matchedRequest) {
        // 创建模拟响应
        let responseBody;
        if (matchedRequest.responseBody === null || matchedRequest.responseBody === undefined) {
          responseBody = '';
        } else {
          responseBody = typeof matchedRequest.responseBody === 'string' 
            ? matchedRequest.responseBody 
            : JSON.stringify(matchedRequest.responseBody);
        }

        const responseHeaders = new Headers();
        if (matchedRequest.responseHeaders) {
          Object.entries(matchedRequest.responseHeaders).forEach(([key, value]) => {
            responseHeaders.set(key, value);
          });
        }

        const responseInit = {
          status: matchedRequest.status,
          statusText: matchedRequest.status >= 200 && matchedRequest.status < 300 ? 'OK' : 'Error',
          headers: responseHeaders
        };

        // 延迟返回（模拟网络延迟）
        const duration = matchedRequest.duration || 0;
        return new Promise((resolve) => {
          setTimeout(() => {
            const response = new Response(responseBody, responseInit);
            resolve(response);
          }, duration);
        });
      }

      // 未匹配到，执行真实请求
      return playbackOriginalFetch.apply(this, arguments);
    };

    Object.keys(playbackOriginalFetch).forEach(key => {
      try {
        window.fetch[key] = playbackOriginalFetch[key];
      } catch (e) {}
    });

  }


  
  // 劫持已存在的 WebSocket 实例
  function hijackExistingWebSockets() {
    let hijackedCount = 0;
    
    // 遍历 window 对象查找 WebSocket 实例
    for (const key in window) {
      try {
        const obj = window[key];
        if (obj && obj instanceof WebSocket) {
          const messages = WebSocketPlaybackManager.getAllMessages(obj.url);
          if (messages && messages.length > 0) {
            hijackExistingWebSocketInstance(obj, messages);
            hijackedCount++;
          }
        }
      } catch (e) {}
    }
    
    // 检查 WebSocketTracker 中的实例
    if (typeof WebSocketTracker !== 'undefined' && WebSocketTracker.instances) {
      WebSocketTracker.instances.forEach(ws => {
        try {
          if (ws && ws instanceof WebSocket) {
            const messages = WebSocketPlaybackManager.getAllMessages(ws.url);
            if (messages && messages.length > 0 && !hijackedWebSockets.has(ws)) {
              hijackExistingWebSocketInstance(ws, messages);
              hijackedCount++;
            }
          }
        } catch (e) {}
      });
    }
  }
  
  // 劫持已存在的 WebSocket 实例
  function hijackExistingWebSocketInstance(ws, messages) {
    if (hijackedWebSockets.has(ws)) return;
    
    hijackedWebSockets.set(ws, { messages, messageIndex: 0 });
    
    // 阻止真实消息
    const blockRealMessages = (event) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      return false;
    };
    ws.addEventListener('message', blockRealMessages, { capture: true });
    
    // 劫持 onmessage
    const originalOnMessage = ws.onmessage;
    let hijackedOnMessage = originalOnMessage;
    
    Object.defineProperty(ws, 'onmessage', {
      get() { return hijackedOnMessage; },
      set(handler) {
        hijackedOnMessage = handler;
        setTimeout(() => pushRecordedMessages(ws), 100);
      },
      configurable: true
    });
    
    // 劫持 addEventListener
    const originalAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = function(type, listener, options) {
      if (type === 'message') {
        if (!this._hijackedMessageListeners) {
          this._hijackedMessageListeners = [];
        }
        this._hijackedMessageListeners.push(listener);
        setTimeout(() => pushRecordedMessages(this), 100);
      } else {
        return originalAddEventListener(type, listener, options);
      }
    };
    
    if (hijackedOnMessage) {
      setTimeout(() => pushRecordedMessages(ws), 100);
    }
  }
  
  // 推送录制消息到已劫持的 WebSocket
  function pushRecordedMessages(ws) {
    const hijackData = hijackedWebSockets.get(ws);
    if (!hijackData) return;
    
    const { messages, messageIndex } = hijackData;
    
    // 循环播放
    if (messageIndex >= messages.length) {
      hijackData.messageIndex = 0;
    }
    
    if (ws.readyState !== WebSocket.OPEN) {
      setTimeout(() => pushRecordedMessages(ws), 200);
      return;
    }
    
    const msg = messages[hijackData.messageIndex];
    hijackData.messageIndex++;
    
    const messageData = typeof msg.responseBody === 'string' 
      ? msg.responseBody 
      : JSON.stringify(msg.responseBody);
    
    const event = new MessageEvent('message', {
      data: messageData,
      origin: new URL(ws.url).origin
    });
    
    // 调用 onmessage
    const hijackedOnMessage = ws.onmessage;
    if (hijackedOnMessage) {
      try {
        hijackedOnMessage.call(ws, event);
      } catch (e) {}
    }
    
    // 调用劫持的监听器
    if (ws._hijackedMessageListeners) {
      ws._hijackedMessageListeners.forEach((listener) => {
        try {
          if (typeof listener === 'function') {
            listener.call(ws, event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
        } catch (e) {}
      });
    }
    
    // 继续推送
    const nextIndex = hijackData.messageIndex % messages.length;
    const currentIndex = (hijackData.messageIndex - 1 + messages.length) % messages.length;
    let delay = 1000;
    
    if (messages[nextIndex] && messages[currentIndex]) {
      const timeDiff = messages[nextIndex].timestamp - messages[currentIndex].timestamp;
      delay = Math.min(Math.max(timeDiff, 100), 3000);
    }
    
    setTimeout(() => pushRecordedMessages(ws), delay);
  }
  
  // 延迟劫持函数
  function hijackWithDelay() {
    setTimeout(() => {
      hijackExistingWebSockets();
    }, 1000);
    
    if (document.readyState === 'complete') {
      hijackExistingWebSockets();
    } else {
      window.addEventListener('load', () => {
        setTimeout(hijackExistingWebSockets, 500);
      });
    }
  }
  
  // 存储劫持的 WebSocket 实例
  const hijackedWebSockets = new Map();
  
  // 创建劫持的 WebSocket 代理
  function createHijackedWebSocket(url, protocols, messages) {
    const realWs = new OriginalWebSocket(url, protocols);
    
    // 阻止真实消息
    const blockAllMessages = (event) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      return false;
    };
    realWs.addEventListener('message', blockAllMessages, { capture: true });
    
    // 创建代理对象
    const proxy = {
      // 基本属性
      url: url,
      protocol: protocols?.[0] || '',
      readyState: WebSocket.CONNECTING,
      bufferedAmount: 0,
      extensions: '',
      binaryType: 'blob',
      
      // 劫持的处理器存储
      _hijackedOnMessage: null,
      _hijackedMessageListeners: [],
      _hijackedOnOpen: null,
      _hijackedOnClose: null,
      _hijackedOnError: null,
      
      // onmessage 属性
      get onmessage() {
        return this._hijackedOnMessage;
      },
      set onmessage(handler) {
        this._hijackedOnMessage = handler;
        if (this.readyState === WebSocket.OPEN) {
          setTimeout(() => this._startPushingMessages(), 50);
        }
      },
      
      // onopen 属性
      get onopen() {
        return this._hijackedOnOpen;
      },
      set onopen(handler) {
        this._hijackedOnOpen = handler;
      },
      
      // onclose 属性  
      get onclose() {
        return this._hijackedOnClose;
      },
      set onclose(handler) {
        this._hijackedOnClose = handler;
      },
      
      // onerror 属性
      get onerror() {
        return this._hijackedOnError;
      },
      set onerror(handler) {
        this._hijackedOnError = handler;
      },
      
      // addEventListener 方法
      addEventListener(type, listener, options) {
        if (type === 'message') {
          this._hijackedMessageListeners.push(listener);
          if (this.readyState === WebSocket.OPEN) {
            setTimeout(() => this._startPushingMessages(), 50);
          }
        } else {
          // 其他事件转发到真实 WebSocket
          realWs.addEventListener(type, listener, options);
        }
      },
      
      // removeEventListener 方法
      removeEventListener(type, listener, options) {
        if (type === 'message') {
          const index = this._hijackedMessageListeners.indexOf(listener);
          if (index > -1) {
            this._hijackedMessageListeners.splice(index, 1);
          }
        } else {
          realWs.removeEventListener(type, listener, options);
        }
      },
      
      // send 方法
      send(data) {
        // 检查代理状态
        if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) {
          throw new Error('WebSocket is already in CLOSING or CLOSED state');
        }
        
        // 等待真实 WebSocket 连接
        if (realWs.readyState === WebSocket.OPEN) {
          return realWs.send(data);
        } else if (realWs.readyState === WebSocket.CONNECTING) {
          // 延迟发送，直到连接建立
          const sendWhenReady = () => {
            if (realWs.readyState === WebSocket.OPEN) {
              try {
                realWs.send(data);
              } catch (e) {
                console.error('[WebSocket代理] 发送消息失败:', e);
              }
            } else if (realWs.readyState === WebSocket.CONNECTING) {
              setTimeout(sendWhenReady, 50);
            }
          };
          setTimeout(sendWhenReady, 50);
        }
      },
      
      // close 方法
      close(code, reason) {
        return realWs.close(code, reason);
      },
      
      // dispatchEvent 方法
      dispatchEvent(event) {
        if (event.type === 'message') {
          return false;
        }
        return realWs.dispatchEvent(event);
      },
      
      // 开始推送录制消息
      _startPushingMessages() {
        if (!this._messagesPushing) {
          this._messagesPushing = true;
          this._messageIndex = 0;
          this._pushNextMessage();
        }
      },
      
      // 推送下一条消息（循环播放）
      _pushNextMessage() {
        if (this._messageIndex >= messages.length) {
          this._messageIndex = 0;
        }
        
        if (this.readyState !== WebSocket.OPEN) {
          setTimeout(() => this._pushNextMessage(), 200);
          return;
        }
        
        const msg = messages[this._messageIndex++];
        const messageData = typeof msg.responseBody === 'string' 
          ? msg.responseBody 
          : JSON.stringify(msg.responseBody);
        
        const event = new MessageEvent('message', {
          data: messageData,
          origin: new URL(url).origin
        });
        
        if (this._hijackedOnMessage) {
          try {
            this._hijackedOnMessage.call(this, event);
          } catch (e) {}
        }
        
        this._hijackedMessageListeners.forEach((listener) => {
          try {
            if (typeof listener === 'function') {
              listener.call(this, event);
            } else if (listener && typeof listener.handleEvent === 'function') {
              listener.handleEvent(event);
            }
          } catch (e) {}
        });
        
        const nextIndex = this._messageIndex % messages.length;
        const currentIndex = (this._messageIndex - 1 + messages.length) % messages.length;
        let delay = 1000;
        
        if (messages[nextIndex] && messages[currentIndex]) {
          const timeDiff = messages[nextIndex].timestamp - messages[currentIndex].timestamp;
          delay = Math.min(Math.max(timeDiff, 100), 3000);
        }
        
        setTimeout(() => this._pushNextMessage(), delay);
      }
    };
    
    realWs.onopen = function(event) {
      // 确保真实 WebSocket 已打开
      if (realWs.readyState === WebSocket.OPEN) {
        proxy.readyState = WebSocket.OPEN;
        if (proxy._hijackedOnOpen) {
          try {
            proxy._hijackedOnOpen.call(proxy, event);
          } catch (e) {
            console.error('[WebSocket代理] onopen 回调执行失败:', e);
          }
        }
        proxy._startPushingMessages();
      } else {
        // 如果还没打开，等待一下再试
        setTimeout(() => realWs.onopen(event), 10);
      }
    };
    
    realWs.onclose = function(event) {
      proxy.readyState = WebSocket.CLOSED;
      if (proxy._hijackedOnClose) {
        proxy._hijackedOnClose.call(proxy, event);
      }
    };
    
    realWs.onerror = function(event) {
      if (proxy._hijackedOnError) {
        proxy._hijackedOnError.call(proxy, event);
      }
    };
    
    // 存储到劫持列表
    hijackedWebSockets.set(proxy, { messages, messageIndex: 0 });
    
    return proxy;
  }

  // 劫持单个 WebSocket 实例
  function hijackWebSocketInstance(ws, messages) {
    // 检查是否已经劫持过
    if (hijackedWebSockets.has(ws)) {
      return;
    }
    
    // 标记为已劫持
    hijackedWebSockets.set(ws, { messages, messageIndex: 0 });
    
    // 关键：阻止真实 WebSocket 接收消息
    // 方法：替换所有可能接收消息的方法
    
    // 1. 阻止真实消息 - 通过重写所有可能触发 message 的方法
    // 保存原始 onmessage（如果已设置）
    const originalOnMessage = ws.onmessage;
    
    // 2. 完全重写 addEventListener，对于 message 类型，只存储不注册到真实 WebSocket
    const originalAddEventListener = ws.addEventListener;
    ws.addEventListener = function(type, listener, options) {
      if (type === 'message') {
        if (!ws._hijackedMessageListeners) {
          ws._hijackedMessageListeners = [];
        }
        ws._hijackedMessageListeners.push(listener);
        
        // 立即开始推送录制消息
        setTimeout(() => pushMessageToInstance(ws), 100);
        return; // 重要：不调用原始的 addEventListener
      } else {
        // 其他事件类型（open, close, error）正常注册
        return originalAddEventListener.call(this, type, listener, options);
      }
    };
    
    // 3. 劫持 onmessage setter
    let hijackedOnMessage = originalOnMessage;
    Object.defineProperty(ws, 'onmessage', {
      get: function() {
        return hijackedOnMessage;
      },
      set: function(handler) {
        hijackedOnMessage = handler;
        setTimeout(() => pushMessageToInstance(ws), 100);
      },
      configurable: true
    });
    
    // 4. 关键：移除所有已注册的真实 message 监听器
    // 方法：用一个无操作函数替换原生的事件处理
    try {
      // 创建一个不可见的拦截层
      const noop = function() {};
      
      // 清除所有可能的内部监听器
      // 通过多次调用 removeEventListener 尝试清除（虽然不知道具体的监听器函数）
      // 但这不是可靠的方法
      
      // 更可靠的方法：监听 message 事件并立即阻止其传播
      ws.addEventListener('message', function blockRealMessages(event) {
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
        return false;
      }, true); // 使用 capture 阶段
      
    } catch (e) {
    }
    
    // 5. 用 MutationObserver 或定时器持续清除真实监听器
    // 这是一个后备方案，确保真实消息不会到达页面
    const cleanupInterval = setInterval(() => {
      if (ws.readyState === WebSocket.CLOSED) {
        clearInterval(cleanupInterval);
        return;
      }
      // 这里可以尝试移除真实监听器，但实现复杂
    }, 1000);
    
    // 存储清理函数
    ws._cleanupInterval = cleanupInterval;
    
    // 如果已经有监听器，立即开始推送
    if (hijackedOnMessage || (ws._hijackedMessageListeners && ws._hijackedMessageListeners.length > 0)) {
      setTimeout(() => pushMessageToInstance(ws), 100);
    }
  }
  
  // 推送消息到指定 WebSocket 实例
  function pushMessageToInstance(ws) {
    const hijackData = hijackedWebSockets.get(ws);
    if (!hijackData) {
      return;
    }
    
    const { messages, messageIndex } = hijackData;
    
    // 循环播放：所有消息推送完毕后重置索引
    if (messageIndex >= messages.length) {
      hijackData.messageIndex = 0;
    }
    
    // 检查 WebSocket 状态
    if (ws.readyState !== WebSocket.OPEN) {
      // 等待连接打开后再推送
      setTimeout(() => pushMessageToInstance(ws), 200);
      return;
    }
    
    const msg = messages[messageIndex];
    hijackData.messageIndex++;
    
    const messageData = typeof msg.responseBody === 'string' 
      ? msg.responseBody 
      : JSON.stringify(msg.responseBody);
    
    // 创建真实的 MessageEvent
    const event = new MessageEvent('message', {
      data: messageData,
      origin: new URL(ws.url).origin,
      lastEventId: '',
      source: null,
      ports: []
    });
    
    // 调用劫持的 onmessage 处理器
    const hijackedOnMessage = ws.onmessage; // 这会调用我们的 getter
    if (hijackedOnMessage) {
      try {
        hijackedOnMessage.call(ws, event);
      } catch (e) {
      }
    }
    
    // 调用所有劫持的 addEventListener 监听器
    if (ws._hijackedMessageListeners && ws._hijackedMessageListeners.length > 0) {
      ws._hijackedMessageListeners.forEach((listener) => {
        try {
          if (typeof listener === 'function') {
            listener.call(ws, event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
        } catch (e) {
        }
      });
    }
    
    // 继续推送下一条消息（循环播放）
    let delay = 1000; // 默认 1 秒
    
    if (hijackData.messageIndex < messages.length) {
      // 还有下一条消息
      const nextMsg = messages[hijackData.messageIndex];
      const currentMsg = messages[hijackData.messageIndex - 1];
      
      // 计算延迟时间（基于录制时的时间间隔）
      if (nextMsg && currentMsg) {
        const timeDiff = nextMsg.timestamp - currentMsg.timestamp;
        delay = Math.min(Math.max(timeDiff, 100), 3000); // 限制在 100ms - 3s 之间
      }
    } else {
      // 所有消息已推送完毕，重置索引循环播放
      hijackData.messageIndex = 0;
      delay = 2000; // 循环间隔 2 秒
    }
    
    setTimeout(() => pushMessageToInstance(ws), delay);
  }
  


  
})();
