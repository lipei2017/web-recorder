// Popup 页面逻辑

document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const viewSessionsBtn = document.getElementById('viewSessionsBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const sessionInfo = document.getElementById('sessionInfo');
  const requestCount = document.getElementById('requestCount');
  const timer = document.getElementById('timer');
  const recentSection = document.getElementById('recentSection');
  const recentList = document.getElementById('recentList');
  const helpLink = document.getElementById('helpLink');
  const stopPlaybackBtn = document.getElementById('stopPlaybackBtn');
  const domainSection = document.getElementById('domainSection');
  const domainStatus = document.getElementById('domainStatus');
  const domainBadge = document.getElementById('domainBadge');
  const domainText = document.getElementById('domainText');
  const domainInfo = document.getElementById('domainInfo');
  const domainMatch = document.getElementById('domainMatch');
  const domainMode = document.getElementById('domainMode');

  let recordingStartTime = null;
  let timerInterval = null;
  let statusCheckInterval = null;

  // 初始化
  await checkStatus();
  await checkPlaybackStatus();
  await loadRecentSessions();
  await loadPlaybackSessions();
  await checkDomainStatus();

  // 开始录制
  startBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tab: {
          id: tab.id,
          url: tab.url,
          title: tab.title
        }
      });

      if (response.success) {
        updateUIForRecording(true);
        startTimer();
        startStatusCheck();
      } else {
        showError(response.error || '开始录制失败');
      }
    } catch (error) {
      console.error('开始录制失败:', error);
      showError('开始录制失败');
    }
  });

  // 停止录制
  stopBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STOP_RECORDING'
      });

      if (response.success) {
        updateUIForRecording(false);
        stopTimer();
        stopStatusCheck();
        await loadRecentSessions();
      } else {
        showError(response.error || '停止录制失败');
      }
    } catch (error) {
      console.error('停止录制失败:', error);
      showError('停止录制失败');
    }
  });

  // 查看记录
  viewSessionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 打开设置
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 帮助链接
  helpLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
      url: 'https://github.com/your-repo/web-recorder#readme'
    });
  });

  // 停止回放按钮
  stopPlaybackBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        type: 'STOP_PLAYBACK',
        tabId: tab.id
      });

      if (response.success) {
        showNotification('回放已停止', 'success');
        stopPlaybackBtn.style.display = 'none';
      } else {
        showError(response.error || '停止回放失败');
      }
    } catch (error) {
      console.error('停止回放失败:', error);
      showError('停止回放失败');
    }
  });

  // 检查是否正在回放
  async function checkPlaybackStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 检查标签页是否可访问（不能是 chrome://, edge://, file:// 等）
      if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || 
          tab.url.startsWith('edge://') || tab.url.startsWith('about:') ||
          tab.url.startsWith('file://')) {
        stopPlaybackBtn.style.display = 'none';
        return;
      }
      
      // 检查当前标签页的 sessionStorage 中是否有回放标记
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const playbackData = sessionStorage.getItem('webrecorder_playback');
          if (playbackData) {
            const { timestamp } = JSON.parse(playbackData);
            // 检查是否在5分钟内
            if (Date.now() - timestamp < 5 * 60 * 1000) {
              return true;
            }
          }
          return false;
        }
      });
      
      const isPlayingBack = result && result[0] && result[0].result ? true : false;
      if (isPlayingBack) {
        stopPlaybackBtn.style.display = 'block';
      } else {
        stopPlaybackBtn.style.display = 'none';
      }
    } catch (error) {
      // 静默处理错误（某些页面不允许执行脚本）
      stopPlaybackBtn.style.display = 'none';
    }
  }

  // 检查录制状态
  async function checkStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_STATUS'
      });

      if (response.isRecording) {
        updateUIForRecording(true);
        // 从 storage 获取录制开始时间
        const result = await chrome.storage.local.get(['recordingState']);
        if (result.recordingState && result.recordingState.startTime) {
          recordingStartTime = result.recordingState.startTime;
          console.log('[WebRecorder] 恢复录制开始时间:', new Date(recordingStartTime).toLocaleString());
          startTimer(true); // true 表示是恢复模式，不重置开始时间
        } else {
          startTimer();
        }
        startStatusCheck();
      } else {
        updateUIForRecording(false);
      }
    } catch (error) {
      console.error('检查状态失败:', error);
    }
  }

  // 更新 UI 状态
  function updateUIForRecording(recording) {
    if (recording) {
      statusDot.classList.add('recording');
      statusText.textContent = '正在录制...';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      sessionInfo.style.display = 'flex';
    } else {
      statusDot.classList.remove('recording');
      statusText.textContent = '准备就绪';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      sessionInfo.style.display = 'none';
      requestCount.textContent = '0 个请求';
      timer.textContent = '00:00';
    }
  }

  // 启动计时器
  // @param {boolean} isRestore - 是否是恢复模式（页面刷新后恢复）
  function startTimer(isRestore = false) {
    if (!isRestore) {
      recordingStartTime = Date.now();
    }
    // 立即更新一次计时器显示
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
  }

  // 停止计时器
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    recordingStartTime = null;
  }

  // 更新计时器显示
  function updateTimer() {
    if (!recordingStartTime) return;
    
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    timer.textContent = `${minutes}:${seconds}`;
  }

  // 开始状态检查
  function startStatusCheck() {
    statusCheckInterval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_STATUS'
        });

        if (!response.isRecording) {
          updateUIForRecording(false);
          stopTimer();
          stopStatusCheck();
        }
      } catch (error) {
        console.error('状态检查失败:', error);
      }
    }, 1000);
  }

  // 停止状态检查
  function stopStatusCheck() {
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
  }

  // 加载最近记录
  async function loadRecentSessions() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SESSIONS'
      });

      if (response.success && response.sessions.length > 0) {
        recentSection.style.display = 'block';
        renderRecentSessions(response.sessions.slice(0, 3));
      } else {
        recentSection.style.display = 'none';
      }
    } catch (error) {
      console.error('加载记录失败:', error);
    }
  }

  // 加载可用于回放的记录列表
  async function loadPlaybackSessions() {
    const playbackSection = document.getElementById('playbackSection');
    const playbackList = document.getElementById('playbackList');
    const playbackEmpty = document.getElementById('playbackEmpty');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SESSIONS'
      });

      if (response.success && response.sessions.length > 0) {
        // 筛选有请求数据的记录
        const playableSessions = response.sessions.filter(s => 
          s.requestCount > 0 || (s.requests && s.requests.length > 0)
        );

        if (playableSessions.length > 0) {
          playbackList.style.display = 'flex';
          playbackEmpty.style.display = 'none';
          renderPlaybackSessions(playableSessions.slice(0, 5));
        } else {
          playbackList.style.display = 'none';
          playbackEmpty.style.display = 'block';
        }
      } else {
        playbackList.style.display = 'none';
        playbackEmpty.style.display = 'block';
      }
    } catch (error) {
      console.error('加载回放记录失败:', error);
      playbackList.style.display = 'none';
      playbackEmpty.style.display = 'block';
    }
  }

  // 渲染回放记录列表
  function renderPlaybackSessions(sessions) {
    const playbackList = document.getElementById('playbackList');
    playbackList.innerHTML = '';

    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'playback-item';
      item.dataset.sessionId = session.id;

      const date = new Date(session.startTime);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString();
      const title = session.title || '未命名';
      const requestCount = session.requestCount || 0;

      item.innerHTML = `
        <div class="playback-item-info">
          <div class="playback-item-title" title="${title}">${title}</div>
          <div class="playback-item-meta">
            ${dateStr} ${timeStr} · ${requestCount} 请求
          </div>
        </div>
        <div class="playback-item-actions">
          <button class="btn-playback" data-session-id="${session.id}">
            回放
          </button>
        </div>
      `;

      // 点击回放按钮
      const playbackBtn = item.querySelector('.btn-playback');
      playbackBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await startPlayback(session.id);
      });

      playbackList.appendChild(item);
    });
  }

  // 开始回放
  async function startPlayback(sessionId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 先检查域名配置
      const domainResponse = await chrome.runtime.sendMessage({
        type: 'GET_DOMAIN_STATUS',
        tabId: tab.id
      });
      
      if (!domainResponse.success || !domainResponse.matched) {
        showError('当前域名未配置，无法回放');
        return;
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'START_PLAYBACK',
        sessionId: sessionId,
        tabId: tab.id
      });

      if (response.success) {
        showNotification('回放已启动！刷新页面查看效果', 'success');
        // 关闭 popup
        setTimeout(() => window.close(), 1500);
      } else {
        showError(response.error || '启动回放失败');
      }
    } catch (error) {
      console.error('启动回放失败:', error);
      showError('启动回放失败');
    }
  }

  // 渲染最近记录
  function renderRecentSessions(sessions) {
    recentList.innerHTML = '';

    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      
      const date = new Date(session.startTime);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString();
      
      item.innerHTML = `
        <div class="recent-item-title" title="${session.title || session.url}">
          ${session.title || session.url}
        </div>
        <div class="recent-item-meta">
          <span>${dateStr} ${timeStr}</span>
          <span>${session.requestCount || 0} 请求</span>
        </div>
      `;

      item.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });

      recentList.appendChild(item);
    });
  }

  // 显示通知
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const bgColor = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#667eea';
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: ${bgColor};
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
      white-space: nowrap;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  // 显示错误（兼容旧代码）
  function showError(message) {
    showNotification(message, 'error');
  }

  // 检查域名状态
  async function checkDomainStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.runtime.sendMessage({
        type: 'GET_DOMAIN_STATUS',
        tabId: tab.id
      });

      if (response.success) {
        updateDomainUI(response);
      }
    } catch (error) {
      console.error('检查域名状态失败:', error);
    }
  }

  // 更新域名状态UI
  function updateDomainUI(status) {
    domainSection.style.display = 'block';
    
    if (status.matched) {
      // 域名已配置
      domainBadge.className = 'domain-badge enabled';
      domainBadge.textContent = '已配置';
      domainText.textContent = '当前域名可录制/回放';
      domainInfo.style.display = 'block';
      domainMatch.textContent = `匹配规则: ${status.match}`;
      domainMode.textContent = `模式: ${status.config?.mode === 'record' ? '录制' : status.config?.mode === 'playback' ? '回放' : '全部'}`;
      
      // 启用按钮
      startBtn.disabled = false;
      startBtn.title = '';
      
      // 显示回话列表（如果有的话）
      const playbackSection = document.getElementById('playbackSection');
      if (playbackSection) {
        playbackSection.style.opacity = '1';
        playbackSection.style.pointerEvents = 'auto';
      }
    } else {
      // 域名未配置
      domainBadge.className = 'domain-badge disabled';
      domainBadge.textContent = '未配置';
      domainText.textContent = '当前域名未配置，无法使用';
      domainInfo.style.display = 'none';
      
      // 禁用按钮
      startBtn.disabled = true;
      startBtn.title = '当前域名未在配置中，请在设置中添加';
      
      // 禁用回话列表
      const playbackSection = document.getElementById('playbackSection');
      if (playbackSection) {
        playbackSection.style.opacity = '0.5';
        playbackSection.style.pointerEvents = 'none';
      }
    }
  }
});
