// 内容脚本入口 - 协调网络请求和存储捕获

let isCapturing = false;
let sessionId = null;
let isScriptInjected = false;

// 检查是否需要恢复回放状态
function checkAndRestorePlayback() {
  console.log('[Content] 检查回放状态恢复...');
  try {
    const playbackData = sessionStorage.getItem('webrecorder_playback');
    console.log('[Content] playbackData:', playbackData ? '存在' : '不存在');
    if (!playbackData) return;
    
    const parsed = JSON.parse(playbackData);
    console.log('[Content] 解析数据:', { hasSessionData: !!parsed.sessionData, sessionId: parsed.sessionId });
    
    // 如果数据包含完整 sessionData，说明 injected.js 会自动恢复，不需要 content script 干预
    if (parsed.sessionData) {
      console.log('[Content] 检测到完整回放数据，injected.js 会自动恢复，跳过');
      return;
    }
    
    // 只有 sessionId，需要从 background 获取完整数据
    const { sessionId: savedSessionId, timestamp } = parsed;
    console.log('[Content] 找到回放状态, sessionId:', savedSessionId);
    
    // 检查是否在5分钟内（避免过期的回放状态）
    if (Date.now() - timestamp >= 5 * 60 * 1000) {
      console.log('[Content] 回放状态已过期');
      sessionStorage.removeItem('webrecorder_playback');
      return;
    }
    
    console.log('[Content] 回放状态未过期，从 background 获取会话...');
    // 从 background 获取会话数据
    chrome.runtime.sendMessage({
      type: 'GET_SESSION',
      sessionId: savedSessionId
    }, async (response) => {
      console.log('[Content] GET_SESSION 响应:', response);
      if (response.success && response.session) {
        console.log('[Content] 获取会话成功，等待脚本注入...');
        // 确保脚本已注入
        if (!isScriptInjected) {
          console.log('[Content] 脚本未注入，先注入脚本...');
          await injectScript();
        }
        console.log('[Content] 脚本注入完成，启动回放...');
        startPlayback(response.session, false);
      } else {
        console.log('[Content] 获取会话失败，清除回放状态');
        sessionStorage.removeItem('webrecorder_playback');
      }
    });
  } catch (error) {
    console.error('[Content] 检查回放状态失败:', error);
  }
}

// 检查是否需要恢复录制状态
async function checkAndRestoreRecording() {
  try {
    // 首先检查是否在回放模式
    const playbackData = sessionStorage.getItem('webrecorder_playback');
    if (playbackData) {
      // 如果在回放模式，不恢复录制状态
      try {
        sessionStorage.removeItem('webrecorder_recording');
      } catch (e) {}
      return false;
    }
    
    const result = await chrome.storage.local.get(['recordingState']);
    
    if (result.recordingState && result.recordingState.isRecording) {
      const { sessionId: savedSessionId, timestamp, tabId } = result.recordingState;
      
      // 检查是否未过期（5分钟内）
      if (Date.now() - timestamp < 5 * 60 * 1000) {
        // 更新全局变量
        sessionId = savedSessionId;
        isCapturing = true;
        
        // 保存录制标记到 sessionStorage
        try {
          sessionStorage.setItem('webrecorder_recording', JSON.stringify({
            sessionId: savedSessionId,
            timestamp: Date.now()
          }));
        } catch (error) {
          console.warn('[Content] 无法写入 sessionStorage:', error);
        }
        
        // 确保脚本已注入
        if (!isScriptInjected) {
          await injectScript();
        }
        
        // 通知 injected script 开始捕获
        window.postMessage({
          source: 'WEBRECORDER_CONTENT_SCRIPT',
          type: 'WEBRECORDER_START_CAPTURE',
          sessionId: sessionId
        }, '*');
        
        return true;
      } else {
        // 过期了，清理状态
        await chrome.storage.local.remove('recordingState');
        try {
          sessionStorage.removeItem('webrecorder_recording');
        } catch (e) {}
      }
    } else {
      // 没有在录制，清除 sessionStorage 中的标记
      try {
        sessionStorage.removeItem('webrecorder_recording');
      } catch (e) {
        console.warn('[Content] 无法清除录制标记:', e);
      }
    }
  } catch (error) {
    console.error('[Content] 检查录制状态失败:', error);
  }
  return false;
}

// 注入脚本
function injectScript() {
  if (isScriptInjected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    try {
      // 注入网络拦截器
      const networkScript = document.createElement('script');
      networkScript.src = chrome.runtime.getURL('content/injected.js');
      
      // 注入存储捕获器
      const storageScript = document.createElement('script');
      storageScript.src = chrome.runtime.getURL('content/storage-capture.js');
      
      let networkLoaded = false;
      let storageLoaded = false;
      
      function checkComplete() {
        if (networkLoaded && storageLoaded) {
          isScriptInjected = true;
          resolve();
        }
      }
      
      networkScript.onload = function() {
        this.remove();
        networkLoaded = true;
        checkComplete();
      };
      networkScript.onerror = function(e) {
        reject(e);
      };

      storageScript.onload = function() {
        this.remove();
        storageLoaded = true;
        checkComplete();
      };
      storageScript.onerror = function(e) {
        reject(e);
      };

      // 尝试注入到 head 或 documentElement
      const parent = document.head || document.documentElement;
      if (parent) {
        parent.appendChild(networkScript);
        parent.appendChild(storageScript);
      } else {
        // 等待 DOM 准备就绪
        window.addEventListener('DOMContentLoaded', () => {
          injectScript().then(resolve).catch(reject);
        }, { once: true });
      }
    } catch (error) {
      reject(error);
    }
  });
}

// 立即尝试注入（不等待 DOMContentLoaded，确保能拦截早期请求）
(function immediateInject() {
  if (document.documentElement) {
    // documentElement 已存在，立即注入
    injectScript();
  } else {
    // 使用 MutationObserver 监视 documentElement 的出现
    const observer = new MutationObserver((mutations, obs) => {
      if (document.documentElement) {
        obs.disconnect();
        injectScript();
      }
    });
    
    // 监视 document 的变化
    observer.observe(document, { childList: true });
    
    // 备用方案：最多等待 100ms 后强制注入
    setTimeout(() => {
      observer.disconnect();
      if (!isScriptInjected) {
        injectScript();
      }
    }, 100);
  }
})();

// 立即检查是否需要恢复状态（不等待脚本加载完成）
// 因为在页面刷新时，sessionStorage 中的回放标记仍然存在
// 这样 injected.js 加载后能立即读取到回放状态
setTimeout(async () => {
  // 优先检查录制状态，如果没有再进行回放状态检查
  const isRecordingRestored = await checkAndRestoreRecording();
  if (!isRecordingRestored) {
    checkAndRestorePlayback();
  }
}, 100);

// 监听来自 Service Worker 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_CAPTURE':
      startCapture(message.sessionId);
      sendResponse({ success: true });
      break;

    case 'STOP_CAPTURE':
      stopCapture();
      sendResponse({ success: true });
      break;

    case 'START_PLAYBACK':
      if (message.session) {
        startPlayback(message.session);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '缺少会话数据' });
      }
      break;

    case 'STOP_PLAYBACK':
      stopPlayback();
      sendResponse({ success: true });
      break;
  }
});

async function startCapture(id) {
  sessionId = id;
  isCapturing = true;

  // 保存录制标记到 sessionStorage，用于页面刷新时识别正在录制
  try {
    sessionStorage.setItem('webrecorder_recording', JSON.stringify({
      sessionId: id,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.warn('[Content] 无法保存录制标记:', error);
  }

  // 如果脚本尚未注入，尝试再次注入
  if (!isScriptInjected) {
    await injectScript();
  }

  // 延迟通知注入的脚本，确保脚本已加载
  setTimeout(() => {
    window.postMessage({
      source: 'WEBRECORDER_CONTENT_SCRIPT',
      type: 'WEBRECORDER_START_CAPTURE',
      sessionId: sessionId
    }, '*');
  }, 100);
}

function stopCapture() {
  isCapturing = false;
  
  // 清除录制标记
  try {
    sessionStorage.removeItem('webrecorder_recording');
  } catch (error) {
    console.warn('[Content] 无法清除录制标记:', error);
  }

  window.postMessage({
    source: 'WEBRECORDER_CONTENT_SCRIPT',
    type: 'WEBRECORDER_STOP_CAPTURE'
  }, '*');
}

async function startPlayback(session, saveToStorage = true) {
  console.log('[Content] startPlayback 被调用, session.id:', session?.id, 'saveToStorage:', saveToStorage);
  
  // 关键修复：确保清除录制状态，避免刷新后错误恢复录制
  try {
    await chrome.storage.local.remove('recordingState');
    sessionStorage.removeItem('webrecorder_recording');
    console.log('[Content] 已清除录制状态');
  } catch (e) {
    console.warn('[Content] 清除录制状态失败:', e);
  }
  
  if (!isScriptInjected) {
    console.log('[Content] 脚本未注入，先注入脚本...');
    await injectScript();
    console.log('[Content] 脚本注入完成');
  } else {
    console.log('[Content] 脚本已注入');
  }

  // 保存回放状态到 sessionStorage（如果需要）
  if (saveToStorage) {
    console.log('[Content] 保存回放状态到 sessionStorage...');
    try {
      // 检查数据大小
      const sessionDataStr = JSON.stringify(session);
      const dataSize = new Blob([sessionDataStr]).size;
      
      // 如果数据太大，只保存 sessionId 而不保存完整数据
      if (dataSize > 4 * 1024 * 1024) { // 4MB 限制
        sessionStorage.setItem('webrecorder_playback', JSON.stringify({
          sessionId: session.id,
          timestamp: Date.now()
          // 不保存 sessionData，刷新后从 background 重新获取
        }));
      } else {
        // 保存会话数据以便页面刷新时直接使用
        const dataToSave = {
          sessionId: session.id,
          timestamp: Date.now(),
          sessionData: session // 保存完整会话数据
        };
        sessionStorage.setItem('webrecorder_playback', JSON.stringify(dataToSave));
      }
      
      // 同时保存过滤规则
      chrome.storage.local.get(['urlFilters', 'localStorageFilters'], (result) => {
        const filters = result.urlFilters || [];
        sessionStorage.setItem('webrecorder_url_filters', JSON.stringify(filters));
        
        // 保存 localStorage key 过滤规则
        const localStorageFilters = result.localStorageFilters || [];
        sessionStorage.setItem('webrecorder_localstorage_filters', JSON.stringify(localStorageFilters));
      });
      console.log('[Content] 回放状态已保存');
    } catch (error) {
      console.error('[Content] 保存回放状态失败:', error);
      // 如果保存失败（可能是数据太大），至少保存 sessionId
      try {
        sessionStorage.setItem('webrecorder_playback', JSON.stringify({
          sessionId: session.id,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.error('[Content] 无法保存回放状态（sessionId）:', e);
      }
    }
  }

  console.log('[Content] 发送 WEBRECORDER_START_PLAYBACK 消息到 injected.js');
  setTimeout(() => {
    window.postMessage({
      source: 'WEBRECORDER_CONTENT_SCRIPT',
      type: 'WEBRECORDER_START_PLAYBACK',
      session: session
    }, '*');
    console.log('[Content] 消息已发送');
  }, 100);
}

function stopPlayback() {
  
  // 清除回放状态
  try {
    const hadData = sessionStorage.getItem('webrecorder_playback');
    sessionStorage.removeItem('webrecorder_playback');
  } catch (error) {
    console.warn('[Content] 无法清除回放状态:', error);
  }

  window.postMessage({
    source: 'WEBRECORDER_CONTENT_SCRIPT',
    type: 'WEBRECORDER_STOP_PLAYBACK'
  }, '*');
}

// 监听来自注入脚本的消息
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const { type, data } = event.data;

  if (type === 'WEBRECORDER_NETWORK_REQUEST') {
    // 转发网络请求到 Service Worker
    chrome.runtime.sendMessage({
      type: 'CAPTURE_REQUEST',
      data: data
    });
  }

  if (type === 'WEBRECORDER_STORAGE_SNAPSHOT') {
    // 转发存储快照到 Service Worker
    chrome.runtime.sendMessage({
      type: 'CAPTURE_STORAGE',
      data: data
    });
  }

  // 处理从页面停止录制
  if (type === 'WEBRECORDER_STOP_RECORDING') {
    // 发送消息给 background 停止录制
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
      if (response && response.success) {
        // 通知 injected script
        window.postMessage({
          source: 'WEBRECORDER_CONTENT_SCRIPT',
          type: 'WEBRECORDER_STOP_CAPTURE'
        }, '*');
      }
    });
  }

  // 处理 injected script 请求回放数据
  if (type === 'WEBRECORDER_REQUEST_PLAYBACK_DATA') {
    chrome.runtime.sendMessage({
      type: 'GET_SESSION',
      sessionId: data.sessionId
    }, (response) => {
      if (response.success && response.session) {
        window.postMessage({
          source: 'WEBRECORDER_CONTENT_SCRIPT',
          type: 'WEBRECORDER_START_PLAYBACK',
          session: response.session
        }, '*');
      }
    });
  }

  // 处理 injected script 请求 URL 过滤规则
  if (type === 'WEBRECORDER_REQUEST_URL_FILTERS') {
    chrome.storage.local.get(['urlFilters'], (result) => {
      const filters = result.urlFilters || [];
      window.postMessage({
        source: 'WEBRECORDER_CONTENT_SCRIPT',
        type: 'WEBRECORDER_URL_FILTERS_RESPONSE',
        filters: filters
      }, '*');
    });
  }
});
