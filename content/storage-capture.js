// 存储数据捕获脚本 - 注入到页面的脚本
(function() {
  'use strict';

  let isCapturing = false;
  let captureInterval = null;
  const CAPTURE_INTERVAL_MS = 5000; // 每 5 秒捕获一次

  // 监听来自 content script 的消息
  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'WEBRECORDER_CONTENT_SCRIPT') return;
    if (!event.data?.type) return;

    console.log('[WebRecorder] Storage 收到控制消息:', event.data.type);

    if (event.data.type === 'WEBRECORDER_START_CAPTURE') {
      startStorageCapture();
    }

    if (event.data.type === 'WEBRECORDER_STOP_CAPTURE') {
      stopStorageCapture();
    }
  });

  // 开始捕获存储数据
  function startStorageCapture() {
    if (isCapturing) {
      console.log('[WebRecorder] 存储捕获已在运行中');
      return;
    }
    
    isCapturing = true;
    console.log('[WebRecorder] 存储捕获已启动，localStorage 条目数:', window.localStorage.length, 'sessionStorage 条目数:', window.sessionStorage.length);

    // 立即捕获一次
    captureAllStorage();

    // 定时捕获
    captureInterval = setInterval(captureAllStorage, CAPTURE_INTERVAL_MS);

    // 监听存储变化（如果可能）
    setupStorageListeners();
  }

  // 停止捕获存储数据
  function stopStorageCapture() {
    if (!isCapturing) return;

    isCapturing = false;
    console.log('[WebRecorder] 存储捕获已停止');

    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
  }

  // 捕获所有存储数据
  function captureAllStorage() {
    try {
      const localStorageData = captureLocalStorage();
      const sessionStorageData = captureSessionStorage();
      const cookiesData = captureCookies();

      const snapshot = {
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
        cookies: cookiesData
      };

      console.log('[WebRecorder] 捕获存储快照:', {
        localStorageKeys: Object.keys(localStorageData).length,
        sessionStorageKeys: Object.keys(sessionStorageData).length,
        cookiesCount: cookiesData.length
      });

      window.postMessage({
        type: 'WEBRECORDER_STORAGE_SNAPSHOT',
        data: snapshot
      }, '*');

    } catch (error) {
      console.error('[WebRecorder] 捕获存储数据失败:', error);
    }
  }

  // 捕获 LocalStorage
  function captureLocalStorage() {
    const data = {};
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          data[key] = window.localStorage.getItem(key);
        }
      }
    } catch (error) {
      console.error('[WebRecorder] 捕获 localStorage 失败:', error);
    }
    return data;
  }

  // 捕获 SessionStorage
  function captureSessionStorage() {
    const data = {};
    try {
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key) {
          data[key] = window.sessionStorage.getItem(key);
        }
      }
    } catch (error) {
      console.error('[WebRecorder] 捕获 sessionStorage 失败:', error);
    }
    return data;
  }

  // 捕获 Cookies
  function captureCookies() {
    const cookies = [];
    try {
      const cookieString = document.cookie;
      if (cookieString) {
        cookieString.split(';').forEach(cookie => {
          const parts = cookie.trim().split('=');
          if (parts.length >= 1) {
            cookies.push({
              name: parts[0].trim(),
              value: parts[1] ? parts[1].trim() : ''
            });
          }
        });
      }
    } catch (error) {
      console.error('[WebRecorder] 捕获 cookies 失败:', error);
    }
    return cookies;
  }

  // 设置存储监听器
  function setupStorageListeners() {
    // 监听 storage 事件（跨标签页）
    window.addEventListener('storage', (event) => {
      if (!isCapturing) return;

      // 立即捕获一次
      captureAllStorage();
    });

    // 代理 localStorage 和 sessionStorage 方法以监听同页面变化
    proxyStorageMethods();
  }

  // 代理存储方法
  function proxyStorageMethods() {
    const originalLocalSetItem = window.localStorage.setItem;
    const originalLocalRemoveItem = window.localStorage.removeItem;
    const originalLocalClear = window.localStorage.clear;

    const originalSessionSetItem = window.sessionStorage.setItem;
    const originalSessionRemoveItem = window.sessionStorage.removeItem;
    const originalSessionClear = window.sessionStorage.clear;

    // 代理 localStorage
    window.localStorage.setItem = function(key, value) {
      originalLocalSetItem.apply(this, arguments);
      if (isCapturing) {
        captureStorageWithDelay();
      }
    };

    window.localStorage.removeItem = function(key) {
      originalLocalRemoveItem.apply(this, arguments);
      if (isCapturing) {
        captureStorageWithDelay();
      }
    };

    window.localStorage.clear = function() {
      originalLocalClear.apply(this, arguments);
      if (isCapturing) {
        captureStorageWithDelay();
      }
    };

    // 代理 sessionStorage
    window.sessionStorage.setItem = function(key, value) {
      originalSessionSetItem.apply(this, arguments);
      if (isCapturing) {
        captureStorageWithDelay();
      }
    };

    window.sessionStorage.removeItem = function(key) {
      originalSessionRemoveItem.apply(this, arguments);
      if (isCapturing) {
        captureStorageWithDelay();
      }
    };

    window.sessionStorage.clear = function() {
      originalSessionClear.apply(this, arguments);
      if (isCapturing) {
        captureStorageWithDelay();
      }
    };
  }

  // 延迟捕获（防止频繁更新）
  let captureTimeout = null;
  function captureStorageWithDelay() {
    if (captureTimeout) {
      clearTimeout(captureTimeout);
    }
    captureTimeout = setTimeout(() => {
      captureAllStorage();
      captureTimeout = null;
    }, 100);
  }

  console.log('[WebRecorder] 存储捕获器已注入');
})();
