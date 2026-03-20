import { db } from '../storage/indexeddb.js';
import { domainManager } from './domain-config.js';

// 状态管理
let isRecording = false;
let currentSessionId = null;
let recordingTabId = null;

// 域名自动运行状态
let domainAutoStates = new Map(); // tabId -> { type: 'record'|'playback', config: {} }

// 初始化数据库
chrome.runtime.onStartup.addListener(async () => {
  await db.init();
  setupAutoCleanupAlarm();
  await runAutoCleanup();
});

chrome.runtime.onInstalled.addListener(async () => {
  await db.init();
  setupAutoCleanupAlarm();
  await runAutoCleanup();
});

// 设置自动清理定时器
function setupAutoCleanupAlarm() {
  // 每天检查一次
  chrome.alarms.create('autoCleanup', {
    periodInMinutes: 24 * 60 // 24小时
  });
}

// 监听 alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoCleanup') {
    console.log('[Service Worker] 执行自动清理检查');
    await runAutoCleanup();
  }
});

// 自动清理函数 - 删除3天前的记录
async function runAutoCleanup() {
  try {
    // 检查是否启用了自动清理
    const result = await chrome.storage.local.get(['autoCleanup']);
    if (!result.autoCleanup) {
      console.log('[Service Worker] 自动清理未启用，跳过');
      return;
    }

    await db.init();
    const sessions = await db.getSessions();
    
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000; // 3天的毫秒数
    const cutoffTime = now - threeDays;
    
    let deletedCount = 0;
    
    for (const session of sessions) {
      if (session.startTime < cutoffTime) {
        await db.deleteSession(session.id);
        deletedCount++;
        console.log(`[Service Worker] 自动清理: 删除会话 ${session.id} (${session.title || '未命名'})`);
      }
    }
    
    if (deletedCount > 0) {
      console.log(`[Service Worker] 自动清理完成: 删除了 ${deletedCount} 条旧记录`);
    } else {
      console.log('[Service Worker] 自动清理: 没有需要删除的旧记录');
    }
  } catch (error) {
    console.error('[Service Worker] 自动清理失败:', error);
  }
}

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Service Worker] 收到消息:', message.type);

  switch (message.type) {
    case 'START_RECORDING':
      handleStartRecording(message.tab, sendResponse);
      return true;

    case 'STOP_RECORDING':
      handleStopRecording(sendResponse);
      return true;

    case 'GET_STATUS':
      sendResponse({
        isRecording,
        sessionId: currentSessionId,
        tabId: recordingTabId
      });
      return true;

    case 'CAPTURE_REQUEST':
      handleCaptureRequest(message.data, sendResponse);
      return true;

    case 'CAPTURE_STORAGE':
      handleCaptureStorage(message.data, sendResponse);
      return true;

    case 'GET_SESSIONS':
      handleGetSessions(sendResponse);
      return true;

    case 'GET_SESSION':
      handleGetSession(message.sessionId, sendResponse);
      return true;

    case 'DELETE_SESSION':
      handleDeleteSession(message.sessionId, sendResponse);
      return true;

    case 'EXPORT_SESSION':
      handleExportSession(message.sessionId, message.format, sendResponse);
      return true;

    case 'START_PLAYBACK':
      // 优先使用消息中传来的 tabId，否则使用 sender.tab.id
      const targetTabId = message.tabId || sender.tab.id;
      handleStartPlayback(message.sessionId, targetTabId, sendResponse);
      return true;

    case 'STOP_PLAYBACK':
      const stopPlaybackTabId = message.tabId || sender.tab?.id;
      handleStopPlayback(stopPlaybackTabId, sendResponse);
      return true;

    case 'GET_DOMAIN_CONFIGS':
      handleGetDomainConfigs(sendResponse);
      return true;

    case 'SAVE_DOMAIN_CONFIG':
      handleSaveDomainConfig(message.config, sendResponse);
      return true;

    case 'DELETE_DOMAIN_CONFIG':
      handleDeleteDomainConfig(message.domainId, sendResponse);
      return true;

    case 'GET_DOMAIN_STATUS':
      handleGetDomainStatus(message.tabId, sendResponse);
      return true;

    case 'IMPORT_SESSION':
      handleImportSession(message.session, sendResponse);
      return true;
  }
});

// 开始录制
async function handleStartRecording(tab, sendResponse) {
  try {
    if (isRecording) {
      sendResponse({ success: false, error: '已经在录制中' });
      return;
    }

    // 检查域名是否在配置中
    const domainMatch = await domainManager.matchDomain(tab.url);
    if (!domainMatch) {
      sendResponse({ success: false, error: '当前域名未在配置中，无法录制' });
      return;
    }

    await db.init();

    const session = await db.createSession({
      url: tab.url,
      title: tab.title
    });

    isRecording = true;
    currentSessionId = session.id;
    recordingTabId = tab.id;

    // 保存录制状态到 storage，以便页面刷新时恢复
    await chrome.storage.local.set({
      recordingState: {
        isRecording: true,
        sessionId: session.id,
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        timestamp: Date.now(),
        startTime: Date.now() // 录制开始时间，用于计算总录制时长
      }
    });

    // 通知 content script 开始捕获
    // 注意：content.js 和 injected.js 已经通过 manifest 自动注入
    chrome.tabs.sendMessage(tab.id, {
      type: 'START_CAPTURE',
      sessionId: session.id
    }).catch(err => {
    });

    // 更新图标
    chrome.action.setIcon({
      path: {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
      },
      tabId: tab.id
    });

    sendResponse({ success: true, sessionId: session.id });

  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 停止录制
async function handleStopRecording(sendResponse) {
  try {
    if (!isRecording) {
      sendResponse({ success: false, error: '当前未在录制' });
      return;
    }

    await db.endSession(currentSessionId);

    // 停止捕获
    if (recordingTabId) {
      chrome.tabs.sendMessage(recordingTabId, {
        type: 'STOP_CAPTURE'
      }).catch(() => {
        // 标签页可能已关闭
      });

      // 恢复图标
      chrome.action.setIcon({
        path: {
          16: 'icons/icon16.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png'
        },
        tabId: recordingTabId
      });
    }

    isRecording = false;
    currentSessionId = null;
    recordingTabId = null;

    // 清除 storage 中的录制状态
    await chrome.storage.local.remove('recordingState');

    sendResponse({ success: true });

  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 捕获网络请求
async function handleCaptureRequest(data, sendResponse) {
  try {
    if (!currentSessionId || !isRecording) {
      sendResponse({ success: false });
      return;
    }

    await db.saveRequest(currentSessionId, data);
    
    // 如果是 WebSocket 入站消息，清理旧消息（只保留最新5条）
    if (data.type === 'websocket' && data.direction === 'incoming') {
      await db.cleanupWebSocketMessages(currentSessionId, data.url);
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('保存请求失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 捕获存储数据
async function handleCaptureStorage(data, sendResponse) {
  try {
    if (!currentSessionId || !isRecording) {
      sendResponse({ success: false });
      return;
    }

    await db.saveSnapshot(currentSessionId, data);
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 获取会话列表
async function handleGetSessions(sendResponse) {
  try {
    await db.init();
    const sessions = await db.getSessions();
    sendResponse({ success: true, sessions });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 获取单个会话
async function handleGetSession(sessionId, sendResponse) {
  try {
    await db.init();
    const session = await db.getSession(sessionId);
    sendResponse({ success: true, session });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 删除会话
async function handleDeleteSession(sessionId, sendResponse) {
  try {
    await db.deleteSession(sessionId);
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 导出会话
async function handleExportSession(sessionId, format, sendResponse) {
  try {
    await db.init();
    const session = await db.getSession(sessionId);

    let exportData;
    let filename;
    let mimeType;

    if (format === 'json') {
      exportData = JSON.stringify(session, null, 2);
      const date = new Date(session.startTime).toISOString().split('T')[0];
      filename = `${session.title || '未命名会话'}_${date}.json`
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_');
      mimeType = 'application/json';
    } else if (format === 'har') {
      exportData = convertToHAR(session);
      const date = new Date(session.startTime).toISOString().split('T')[0];
      filename = `${session.title || '未命名会话'}_${date}.har`
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_');
      mimeType = 'application/har+json';
    } else {
      throw new Error('不支持的导出格式');
    }

    // 创建 Blob 和下载链接
    const blob = new Blob([exportData], { type: mimeType });
    const reader = new FileReader();
    
    reader.onloadend = () => {
      const dataUrl = reader.result;
      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
    };

    reader.readAsDataURL(blob);

  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// HTTP 状态码映射表
const HTTP_STATUS_TEXTS = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  414: 'Request-URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Requested Range Not Satisfiable',
  417: 'Expectation Failed',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported'
};

function getStatusText(statusCode) {
  return HTTP_STATUS_TEXTS[statusCode] || 'Unknown';
}

function calculateHeadersSize(headers, statusLine = '') {
  let size = statusLine ? statusLine.length + 2 : 0;
  for (const header of headers) {
    size += `${header.name}: ${header.value}\r\n`.length;
  }
  size += 2;
  return size;
}

function parseUrl(url) {
  try {
    const urlObj = new URL(url);
    return {
      protocol: urlObj.protocol.replace(':', ''),
      host: urlObj.host,
      pathname: urlObj.pathname,
      search: urlObj.search,
      hash: urlObj.hash
    };
  } catch (e) {
    return {
      protocol: 'http',
      host: '',
      pathname: url,
      search: '',
      hash: ''
    };
  }
}

function parseQueryString(url) {
  try {
    const urlObj = new URL(url);
    const queryString = [];
    urlObj.searchParams.forEach((value, name) => {
      queryString.push({ name, value });
    });
    return queryString;
  } catch (e) {
    return [];
  }
}

function inferContentType(body, headers) {
  if (headers && headers['content-type']) {
    const ct = headers['content-type'];
    if (ct.includes('json')) return 'application/json';
    if (ct.includes('xml')) return 'text/xml';
    if (ct.includes('html')) return 'text/html';
    if (ct.includes('text')) return 'text/plain';
    if (ct.includes('form')) return 'application/x-www-form-urlencoded';
    return ct.split(';')[0];
  }
  
  if (typeof body === 'string') {
    try {
      JSON.parse(body);
      return 'application/json';
    } catch (e) {
      return 'text/plain';
    }
  }
  
  if (body && typeof body === 'object') {
    return 'application/json';
  }
  
  return 'application/octet-stream';
}

// 转换为 HAR 格式
function convertToHAR(session) {
  // 过滤只保留 xhr 和 fetch 请求（HAR 1.2 只支持 HTTP）
  const httpRequests = (session.requests || []).filter(req => 
    req.type === 'xhr' || req.type === 'fetch'
  );

  const har = {
    log: createHARLog(session, httpRequests)
  };

  return JSON.stringify(har, null, 2);
}

/**
 * 创建 HAR 日志对象
 * @param {Object} session - 会话数据
 * @param {Array} httpRequests - HTTP 请求列表
 * @returns {Object} HAR 日志对象
 */
function createHARLog(session, httpRequests) {
  return {
    version: '1.2',
    creator: {
      name: 'WebRecorder',
      version: '1.0.0',
      comment: 'Generated by WebRecorder Chrome Extension'
    },
    browser: {
      name: 'Chrome',
      version: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || 'unknown'
    },
    pages: [createHARPage(session)],
    entries: httpRequests.map(req => convertRequestToHAREntry(req, session.id))
  };
}

/**
 * 创建 HAR 页面对象
 * @param {Object} session - 会话数据
 * @returns {Object} HAR 页面对象
 */
function createHARPage(session) {
  return {
    startedDateTime: new Date(session.startTime).toISOString(),
    id: session.id,
    title: session.title || '未命名会话',
    pageTimings: {
      onContentLoad: -1,
      onLoad: -1
    }
  };
}

/**
 * 将请求转换为 HAR Entry
 * @param {Object} req - 请求数据
 * @param {string} sessionId - 会话ID
 * @returns {Object} HAR Entry 对象
 */
function convertRequestToHAREntry(req, sessionId) {
  const urlInfo = parseUrl(req.url);
  const requestHeaders = convertHeaders(req.headers);
  const responseHeaders = convertHeaders(req.responseHeaders);
  const queryString = parseQueryString(req.url);
  const postData = buildPostData(req.requestBody, req.headers);
  const responseBody = buildResponseBody(req.responseBody);
  const responseContentType = inferContentType(req.responseBody, req.responseHeaders);
  
  const statusCode = req.status || 0;
  const statusText = getStatusText(statusCode);
  const duration = req.duration || 0;
  
  // 计算大小
  const requestHeadersSize = calculateHeadersSize(
    requestHeaders, 
    `${req.method} ${urlInfo.pathname}${urlInfo.search} HTTP/1.1`
  );
  const requestBodySize = postData?.text 
    ? new Blob([postData.text]).size 
    : 0;
  const responseHeadersSize = calculateHeadersSize(
    responseHeaders,
    `HTTP/1.1 ${statusCode} ${statusText}`
  );
  const responseBodySize = responseBody 
    ? new Blob([responseBody]).size 
    : 0;

  return {
    pageref: sessionId,
    startedDateTime: new Date(req.timestamp).toISOString(),
    time: duration,
    request: buildHARRequest(req, requestHeaders, queryString, postData, requestHeadersSize, requestBodySize),
    response: buildHARResponse(statusCode, statusText, responseHeaders, responseBody, responseContentType, responseHeadersSize, responseBodySize, req),
    cache: {},
    timings: buildHARTimings(duration),
    serverIPAddress: '',
    connection: '',
    comment: `Original type: ${req.type}`
  };
}

/**
 * 转换请求头为 HAR 格式
 * @param {Object} headers - 请求头对象
 * @returns {Array} HAR 格式的请求头数组
 */
function convertHeaders(headers) {
  return Object.entries(headers || {}).map(([name, value]) => ({
    name,
    value: String(value)
  }));
}

/**
 * 构建 HAR Post Data
 * @param {*} requestBody - 请求体
 * @param {Object} headers - 请求头
 * @returns {Object|undefined} HAR Post Data 对象
 */
function buildPostData(requestBody, headers) {
  if (!requestBody) return undefined;
  
  const contentType = inferContentType(requestBody, headers);
  return {
    mimeType: contentType,
    text: typeof requestBody === 'string' 
      ? requestBody 
      : JSON.stringify(requestBody)
  };
}

/**
 * 构建响应体字符串
 * @param {*} responseBody - 响应体
 * @returns {string} 响应体字符串
 */
function buildResponseBody(responseBody) {
  if (responseBody === undefined || responseBody === null) return '';
  
  return typeof responseBody === 'string' 
    ? responseBody 
    : JSON.stringify(responseBody);
}

/**
 * 构建 HAR Request 对象
 * @param {Object} req - 请求数据
 * @param {Array} headers - 请求头数组
 * @param {Array} queryString - 查询字符串数组
 * @param {Object} postData - Post Data 对象
 * @param {number} headersSize - 请求头大小
 * @param {number} bodySize - 请求体大小
 * @returns {Object} HAR Request 对象
 */
function buildHARRequest(req, headers, queryString, postData, headersSize, bodySize) {
  return {
    method: req.method,
    url: req.url,
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: headers,
    queryString: queryString,
    postData: postData,
    headersSize: headersSize,
    bodySize: bodySize,
    comment: `Request type: ${req.type || 'unknown'}`
  };
}

/**
 * 构建 HAR Response 对象
 * @param {number} statusCode - 状态码
 * @param {string} statusText - 状态文本
 * @param {Array} headers - 响应头数组
 * @param {string} body - 响应体
 * @param {string} contentType - 内容类型
 * @param {number} headersSize - 响应头大小
 * @param {number} bodySize - 响应体大小
 * @param {Object} req - 原始请求对象
 * @returns {Object} HAR Response 对象
 */
function buildHARResponse(statusCode, statusText, headers, body, contentType, headersSize, bodySize, req) {
  return {
    status: statusCode,
    statusText: statusText,
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: headers,
    content: {
      size: bodySize,
      compression: undefined,
      mimeType: contentType,
      text: body || undefined
    },
    redirectURL: req.responseHeaders?.location || req.responseHeaders?.Location || '',
    headersSize: headersSize,
    bodySize: bodySize
  };
}

/**
 * 构建 HAR Timings 对象
 * @param {number} duration - 持续时间
 * @returns {Object} HAR Timings 对象
 */
function buildHARTimings(duration) {
  return {
    blocked: -1,
    dns: -1,
    connect: -1,
    send: 0,
    wait: duration,
    receive: 0,
    ssl: -1,
    comment: 'Timings are approximated as full network timing data is not available'
  };
}

// 开始回放
async function handleStartPlayback(sessionId, tabId, sendResponse) {
  try {
    // 获取标签页URL并检查域名配置
    const tab = await chrome.tabs.get(tabId);
    const domainMatch = await domainManager.matchDomain(tab.url);
    if (!domainMatch) {
      sendResponse({ success: false, error: '当前域名未在配置中，无法回放' });
      return;
    }

    await db.init();
    const session = await db.getSession(sessionId);

    // 通知 content script 开始回放
    // 注意：回放逻辑已包含在 injected.js 中，通过 postMessage 触发
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'START_PLAYBACK',
        session: session
      });
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: '页面未准备好，请刷新页面后重试' });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 停止回放
async function handleStopPlayback(tabId, sendResponse) {
  try {
    if (tabId) {
      // 发送停止回放消息到指定标签页
      await chrome.tabs.sendMessage(tabId, {
        type: 'STOP_PLAYBACK'
      });
      
      // 等待一小段时间确保消息被处理，然后验证 sessionStorage 是否被清除
      await new Promise(resolve => setTimeout(resolve, 200));
      
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            const data = sessionStorage.getItem('webrecorder_playback');
            sessionStorage.removeItem('webrecorder_playback');
            return { cleared: !data, hadData: !!data };
          }
        });
      } catch (e) {
      }
    }
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 监听标签页关闭
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId && isRecording) {
    handleStopRecording(() => {});
  }
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === recordingTabId && changeInfo.status === 'loading') {
    // 页面刷新时，content script 会自动重新注入（根据 manifest.json 配置）
    // content script 会在加载时自动检查 recordingState 并恢复录制
    // 这里不需要额外操作，只需要确保 recordingState 仍然有效
  }
});

// ==================== 域名配置管理 ====================

// 获取域名配置
async function handleGetDomainConfigs(sendResponse) {
  try {
    const configs = await domainManager.getConfigs();
    sendResponse({ success: true, configs });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 保存域名配置
async function handleSaveDomainConfig(config, sendResponse) {
  try {
    const domains = await domainManager.addConfig(config);
    sendResponse({ success: true, domains });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 删除域名配置
async function handleDeleteDomainConfig(domainId, sendResponse) {
  try {
    const domains = await domainManager.removeConfig(domainId);
    sendResponse({ success: true, domains });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 获取当前标签页的域名状态
async function handleGetDomainStatus(tabId, sendResponse) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const match = await domainManager.matchDomain(tab.url);
    const autoState = domainAutoStates.get(tabId);
    
    sendResponse({
      success: true,
      url: tab.url,
      matched: !!match,
      match: match ? match.match : null,
      autoRunning: !!autoState,
      autoType: autoState ? autoState.type : null,
      config: match ? match.config : null
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 导入会话
async function handleImportSession(sessionData, sendResponse) {
  try {
    await db.init();

    // 准备会话数据
    const session = {
      id: sessionData.id,
      title: sessionData.title,
      url: sessionData.url,
      startTime: sessionData.startTime,
      endTime: sessionData.endTime,
      importedAt: sessionData.importedAt || Date.now(),
      requestCount: sessionData.requestCount || 0,
      snapshotCount: sessionData.snapshotCount || 0,
      source: 'imported'
    };

    // 保存会话到 sessions 表
    await new Promise((resolve, reject) => {
      const transaction = db.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.add(session);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // 保存请求到 requests 表
    if (sessionData.requests && sessionData.requests.length > 0) {
      await new Promise((resolve, reject) => {
        const transaction = db.db.transaction(['requests'], 'readwrite');
        const store = transaction.objectStore('requests');
        
        let completed = 0;
        const total = sessionData.requests.length;
        
        sessionData.requests.forEach((reqData) => {
          const request = {
            id: reqData.id || db.generateId(),
            sessionId: session.id,
            ...reqData,
            timestamp: reqData.timestamp || Date.now()
          };
          
          const req = store.add(request);
          req.onsuccess = () => {
            completed++;
            if (completed === total) resolve();
          };
          req.onerror = () => reject(req.error);
        });
        
        if (total === 0) resolve();
      });
    }

    // 保存快照到 snapshots 表
    if (sessionData.snapshots && sessionData.snapshots.length > 0) {
      await new Promise((resolve, reject) => {
        const transaction = db.db.transaction(['snapshots'], 'readwrite');
        const store = transaction.objectStore('snapshots');
        
        let completed = 0;
        const total = sessionData.snapshots.length;
        
        sessionData.snapshots.forEach((snapshotData) => {
          const snapshot = {
            id: snapshotData.id || db.generateId(),
            sessionId: session.id,
            ...snapshotData,
            timestamp: snapshotData.timestamp || Date.now()
          };
          
          const req = store.add(snapshot);
          req.onsuccess = () => {
            completed++;
            if (completed === total) resolve();
          };
          req.onerror = () => reject(req.error);
        });
        
        if (total === 0) resolve();
      });
    }

    console.log(`[Service Worker] 会话导入成功: ${session.id}`);
    sendResponse({ success: true, sessionId: session.id });
  } catch (error) {
    console.error('[Service Worker] 会话导入失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}
