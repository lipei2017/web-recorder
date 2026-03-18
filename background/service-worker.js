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
});

chrome.runtime.onInstalled.addListener(async () => {
  await db.init();
});

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
        16: 'icons/icon-recording16.png',
        48: 'icons/icon-recording48.png',
        128: 'icons/icon-recording128.png'
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
      filename = `web-recorder-${sessionId}.json`;
      mimeType = 'application/json';
    } else if (format === 'har') {
      exportData = convertToHAR(session);
      filename = `web-recorder-${sessionId}.har`;
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

// 转换为 HAR 格式
function convertToHAR(session) {
  const har = {
    log: {
      version: '1.2',
      creator: {
        name: 'WebRecorder',
        version: '1.0.0'
      },
      pages: [{
        startedDateTime: new Date(session.startTime).toISOString(),
        id: session.id,
        title: session.title,
        pageTimings: {
          onContentLoad: -1,
          onLoad: -1
        }
      }],
      entries: session.requests.map(req => ({
        startedDateTime: new Date(req.timestamp).toISOString(),
        time: req.duration || 0,
        request: {
          method: req.method,
          url: req.url,
          httpVersion: 'HTTP/1.1',
          headers: Object.entries(req.headers || {}).map(([name, value]) => ({
            name,
            value: String(value)
          })),
          queryString: [],
          postData: req.requestBody ? {
            mimeType: 'application/json',
            text: typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody)
          } : undefined,
          headersSize: -1,
          bodySize: -1
        },
        response: {
          status: req.status || 200,
          statusText: 'OK',
          httpVersion: 'HTTP/1.1',
          headers: Object.entries(req.responseHeaders || {}).map(([name, value]) => ({
            name,
            value: String(value)
          })),
          content: {
            size: -1,
            mimeType: 'application/json',
            text: typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody)
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1
        },
        cache: {},
        timings: {
          send: 0,
          wait: req.duration || 0,
          receive: 0
        }
      }))
    }
  };

  return JSON.stringify(har, null, 2);
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
