// Popup 页面逻辑

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const stopPlaybackBtn = document.getElementById('stopPlaybackBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusDetail = document.getElementById('statusDetail');
  const requestCount = document.getElementById('requestCount');
  const timer = document.getElementById('timer');
  const helpLink = document.getElementById('helpLink');
  const domainBadge = document.getElementById('domainBadge');
  const domainText = document.getElementById('domainText');
  
  // 会话列表相关
  const sessionsList = document.getElementById('sessionsList');
  const emptyState = document.getElementById('emptyState');
  const searchInput = document.getElementById('searchInput');
  const filterTabs = document.getElementById('filterTabs');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');
  const viewAllBtn = document.getElementById('viewAllBtn');
  const goRecordBtn = document.getElementById('goRecordBtn');

  let recordingStartTime = null;
  let timerInterval = null;
  let statusCheckInterval = null;
  let currentFilter = 'all';
  let allSessions = [];

  // 初始化
  await checkStatus();
  await checkDomainStatus();
  await checkPlaybackStatus();  // 回放检查放在最后，确保能覆盖域名配置的状态
  await loadSessions();

  // ============ 录制控制 ============
  
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
        await loadSessions();
      } else {
        showError(response.error || '停止录制失败');
      }
    } catch (error) {
      console.error('停止录制失败:', error);
      showError('停止录制失败');
    }
  });

  // 停止回放
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
        // 恢复录制按钮
        startBtn.style.display = 'inline-flex';
        stopBtn.style.display = 'none';
        statusDot.classList.remove('recording');
        statusDot.classList.remove('playback');
        statusText.textContent = '就绪';
        statusDetail.style.display = 'none';
      } else {
        showError(response.error || '停止回放失败');
      }
    } catch (error) {
      console.error('停止回放失败:', error);
      showError('停止回放失败');
    }
  });

  // ============ 会话列表 ============

  // 标签筛选
  if (filterTabs) {
    filterTabs.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-btn')) {
        // 更新激活状态
        filterTabs.querySelectorAll('.tab-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        e.target.classList.add('active');
        
        // 更新筛选条件
        currentFilter = e.target.dataset.filter;
        renderSessions();
      }
    });
  }

  // 搜索
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      renderSessions();
    }, 300));
  }

  // 导入
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      importFileInput.click();
    });
  }

  if (importFileInput) {
    importFileInput.addEventListener('change', handleImport);
  }

  // 查看全部
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // 开始录制按钮（空状态）
  if (goRecordBtn) {
    goRecordBtn.addEventListener('click', () => {
      startBtn.click();
    });
  }

  // 设置按钮
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 帮助链接 - 打开帮助页面
  helpLink.addEventListener('click', (e) => {
    e.preventDefault();
    const optionsUrl = chrome.runtime.getURL('options/options.html?tab=help');
    chrome.tabs.create({ url: optionsUrl });
  });

  // ============ 功能函数 ============

  // 加载会话列表
  async function loadSessions() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SESSIONS'
      });

      if (response.success) {
        allSessions = response.sessions || [];
        renderSessions();
      } else {
        showEmptyState();
      }
    } catch (error) {
      console.error('加载会话失败:', error);
      showEmptyState();
    }
  }

  // 渲染会话列表
  function renderSessions() {
    const searchTerm = (searchInput?.value || '').toLowerCase();
    
    // 筛选会话
    let filteredSessions = allSessions.filter(session => {
      // 按类型筛选
      if (currentFilter === 'recorded' && session.source === 'imported') {
        return false;
      }
      if (currentFilter === 'imported' && session.source !== 'imported') {
        return false;
      }
      
      // 按搜索词筛选
      if (searchTerm) {
        const title = (session.title || '').toLowerCase();
        const url = (session.url || '').toLowerCase();
        return title.includes(searchTerm) || url.includes(searchTerm);
      }
      
      return true;
    });

    // 按时间倒序排序（导入的数据按导入时间，录制的数据按录制时间）
    filteredSessions.sort((a, b) => {
      const timeA = a.source === 'imported' && a.importedAt ? a.importedAt : a.startTime;
      const timeB = b.source === 'imported' && b.importedAt ? b.importedAt : b.startTime;
      return timeB - timeA;
    });

    // 最多显示 8 条
    const displaySessions = filteredSessions.slice(0, 8);
    const hasMore = filteredSessions.length > 8;

    if (displaySessions.length === 0) {
      showEmptyState();
      return;
    }

    // 隐藏空状态
    emptyState.style.display = 'none';
    sessionsList.style.display = 'block';

    // 渲染列表
    sessionsList.innerHTML = displaySessions.map(session => {
      const isImported = session.source === 'imported';
      const sourceIcon = isImported ? '📥' : '📹';
      const sourceLabel = isImported ? '导入' : '录制';
      
      // 导入的数据显示导入时间，录制的数据显示录制时间
      const displayTime = isImported && session.importedAt 
        ? session.importedAt 
        : session.startTime;
      const displayDate = new Date(displayTime);
      const dateStr = formatDate(displayDate);
      const timeStr = formatTime(displayDate);
      
      return `
        <div class="session-item" data-session-id="${session.id}">
          <div class="session-icon" title="${sourceLabel}">${sourceIcon}</div>
          <div class="session-content">
            <div class="session-title" title="${session.title || session.url}">
              ${session.title || '未命名'}
            </div>
            <div class="session-meta">
              <span>${dateStr} ${timeStr}</span>
              <span class="session-stats">${session.requestCount || 0} 请求</span>
            </div>
          </div>
          <div class="session-actions">
            ${session.requestCount > 0 ? `
              <button class="btn-icon-action btn-play" data-session-id="${session.id}" title="回放">▶️</button>
            ` : ''}
            <button class="btn-icon-action btn-view" data-session-id="${session.id}" title="查看">👁️</button>
          </div>
        </div>
      `;
    }).join('');

    // 显示/隐藏查看更多
    const viewMore = document.getElementById('viewMore');
    if (viewMore) {
      viewMore.style.display = hasMore ? 'block' : 'none';
    }

    // 绑定事件
    bindSessionEvents();
  }

  // 绑定会话项事件
  function bindSessionEvents() {
    // 点击会话项打开详情
    sessionsList.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 如果点击的是按钮，不执行
        if (e.target.closest('.btn-icon-action')) return;
        
        const sessionId = item.dataset.sessionId;
        const optionsUrl = chrome.runtime.getURL(`options/options.html?sessionId=${sessionId}`);
        chrome.tabs.create({ url: optionsUrl });
      });
    });

    // 回放按钮
    sessionsList.querySelectorAll('.btn-play').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        await startPlayback(sessionId);
      });
    });

    // 查看按钮
    sessionsList.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        const optionsUrl = chrome.runtime.getURL(`options/options.html?sessionId=${sessionId}`);
        chrome.tabs.create({ url: optionsUrl });
      });
    });
  }

  // 显示空状态
  function showEmptyState() {
    sessionsList.style.display = 'none';
    emptyState.style.display = 'flex';
    const viewMore = document.getElementById('viewMore');
    if (viewMore) {
      viewMore.style.display = 'none';
    }
  }

  // 处理导入
  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const fileName = file.name.replace(/\.(json|har)$/i, '');

      let session;
      let requests = [];
      let snapshots = [];

      // 判断是 HAR 格式还是 JSON 格式
      if (data.log && data.log.entries) {
        // HAR 格式
        const har = data;
        const entries = har.log.entries || [];
        
        // 提取页面信息
        const page = har.log.pages?.[0] || {};
        const pageStarted = page.startedDateTime ? new Date(page.startedDateTime).getTime() : Date.now();
        
        // 转换 HAR entries 为内部请求格式
        requests = entries.map((entry, index) => {
          const startTime = entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : pageStarted + index * 100;
          const duration = entry.time || 0;
          
          // 转换 headers
          const headers = {};
          (entry.request?.headers || []).forEach(h => {
            headers[h.name] = h.value;
          });
          
          const responseHeaders = {};
          (entry.response?.headers || []).forEach(h => {
            responseHeaders[h.name] = h.value;
          });

          return {
            id: `req_${Date.now()}_${index}`,
            type: 'xhr', // HAR 主要记录 HTTP 请求
            method: entry.request?.method || 'GET',
            url: entry.request?.url || '',
            headers: headers,
            requestBody: entry.request?.postData?.text || null,
            status: entry.response?.status || 0,
            statusText: entry.response?.statusText || '',
            responseHeaders: responseHeaders,
            responseBody: entry.response?.content?.text || null,
            timestamp: startTime,
            duration: duration
          };
        });

        session = {
          id: `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: fileName,
          url: page.title || entries[0]?.request?.url || '',
          startTime: pageStarted,
          endTime: pageStarted + (requests.length > 0 ? requests[requests.length - 1].timestamp + requests[requests.length - 1].duration : 0),
          importedAt: Date.now(),
          requestCount: requests.length,
          snapshotCount: 0,
          source: 'imported',
          requests: requests,
          snapshots: []
        };
      } else if (data.requests && Array.isArray(data.requests)) {
        // JSON 格式（WebRecorder 原生格式）
        requests = data.requests || [];
        snapshots = data.snapshots || [];

        session = {
          id: `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: fileName,
          url: data.url || '',
          startTime: data.startTime || Date.now(),
          endTime: data.endTime || Date.now(),
          importedAt: Date.now(),
          requestCount: requests.length,
          snapshotCount: snapshots.length,
          source: 'imported',
          requests: requests,
          snapshots: snapshots
        };
      } else {
        showError('无效的会话文件格式，仅支持 JSON 和 HAR 格式');
        return;
      }

      // 保存到数据库
      await chrome.runtime.sendMessage({
        type: 'IMPORT_SESSION',
        session: session
      });

      showNotification(`导入成功！共导入 ${requests.length} 个请求`, 'success');
      
      // 导入后重置筛选为"全部"，确保导入的数据显示
      currentFilter = 'all';
      filterTabs.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === 'all') {
          btn.classList.add('active');
        }
      });
      
      await loadSessions();
    } catch (error) {
      console.error('导入失败:', error);
      showError('导入失败：' + error.message);
    }

    // 清空 input 以便重复选择同一文件
    e.target.value = '';
  }

  // ============ 其他功能 ============

  // 检查录制状态
  async function checkStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_STATUS'
      });

      if (response.isRecording) {
        updateUIForRecording(true);
        const result = await chrome.storage.local.get(['recordingState']);
        if (result.recordingState && result.recordingState.startTime) {
          recordingStartTime = result.recordingState.startTime;
          startTimer(true);
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

  // 检查回放状态
  async function checkPlaybackStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || 
          tab.url.startsWith('edge://') || tab.url.startsWith('about:') ||
          tab.url.startsWith('file://')) {
        return;
      }
      
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const playbackData = sessionStorage.getItem('webrecorder_playback');
          if (playbackData) {
            const { timestamp } = JSON.parse(playbackData);
            if (Date.now() - timestamp < 5 * 60 * 1000) {
              return true;
            }
          }
          return false;
        }
      });
      
      const isPlayingBack = result && result[0] && result[0].result;
      if (isPlayingBack) {
        // 隐藏录制和停止按钮，显示停止回放按钮
        startBtn.style.display = 'none';
        stopBtn.style.display = 'none';
        stopPlaybackBtn.style.display = 'inline-flex';
        
        statusDot.classList.add('playback');
        statusText.textContent = '回放中';
        statusDetail.style.display = 'inline';
      }
    } catch (error) {
      // 静默处理
    }
  }

  // 更新 UI 状态
  function updateUIForRecording(recording) {
    if (recording) {
      statusDot.classList.add('recording');
      statusText.textContent = '录制中';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      stopBtn.style.display = 'inline-flex';
      startBtn.style.display = 'none';
      statusDetail.style.display = 'inline';
    } else {
      statusDot.classList.remove('recording');
      statusText.textContent = '就绪';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      startBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';
      statusDetail.style.display = 'none';
      requestCount.textContent = '0';
      timer.textContent = '00:00';
    }
  }

  // 计时器
  function startTimer(isRestore = false) {
    if (!isRestore) {
      recordingStartTime = Date.now();
    }
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    recordingStartTime = null;
  }

  function updateTimer() {
    if (!recordingStartTime) return;
    
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    timer.textContent = `${minutes}:${seconds}`;
  }

  // 状态检查
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
          await loadSessions();
        }
      } catch (error) {
        console.error('状态检查失败:', error);
      }
    }, 1000);
  }

  function stopStatusCheck() {
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
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

  // 更新域名状态 UI
  function updateDomainUI(status) {
    const tabUrl = status.url || '';
    const isExtensionPage = tabUrl.startsWith('chrome-extension://');
    const sessionsSection = document.getElementById('sessionsSection');
    const mode = status.config?.mode || 'both';
    
    if (status.matched || isExtensionPage) {
      domainBadge.className = 'domain-badge-mini enabled';
      domainBadge.textContent = '●';
      
      // chrome-extension 页面只显示会话列表，不显示录制/回放控制
      if (isExtensionPage) {
        domainText.textContent = '扩展页面';
        startBtn.style.display = 'none';
        stopBtn.style.display = 'none';
        if (sessionsSection) {
          sessionsSection.style.display = 'block';
          sessionsSection.style.opacity = '1';
          sessionsSection.style.pointerEvents = 'auto';
        }
      } else if (mode === 'record') {
        domainText.textContent = '录制';
        startBtn.style.display = 'inline-flex';
        stopBtn.style.display = 'none';
        if (sessionsSection) {
          sessionsSection.style.display = 'block';
          sessionsSection.style.opacity = '1';
          sessionsSection.style.pointerEvents = 'auto';
          const importBtn = document.getElementById('importBtn');
          if (importBtn) importBtn.style.display = 'none';
        }
      } else if (mode === 'playback') {
        domainText.textContent = '回放';
        startBtn.style.display = 'none';
        stopBtn.style.display = 'none';
        if (sessionsSection) {
          sessionsSection.style.display = 'block';
          sessionsSection.style.opacity = '1';
          sessionsSection.style.pointerEvents = 'auto';
        }
      } else {
        domainText.textContent = '全部';
        startBtn.style.display = 'inline-flex';
        stopBtn.style.display = 'none';
        if (sessionsSection) {
          sessionsSection.style.display = 'block';
          sessionsSection.style.opacity = '1';
          sessionsSection.style.pointerEvents = 'auto';
        }
      }
    } else {
      domainBadge.className = 'domain-badge-mini disabled';
      domainBadge.textContent = '●';
      domainText.textContent = '未配置';
      
      if (sessionsSection) {
        sessionsSection.style.display = 'block';
        sessionsSection.style.opacity = '0.5';
        sessionsSection.style.pointerEvents = 'none';
      }
    }
  }

  // 开始回放
  async function startPlayback(sessionId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
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
        setTimeout(() => window.close(), 1500);
      } else {
        showError(response.error || '启动回放失败');
      }
    } catch (error) {
      console.error('启动回放失败:', error);
      showError('启动回放失败');
    }
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
      z-index: 10000;
      white-space: nowrap;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 2000);
  }

  // 显示错误
  function showError(message) {
    showNotification(message, 'error');
  }

  // 防抖函数
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // 格式化日期
  function formatDate(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (dateOnly.getTime() === today.getTime()) {
      return '今天';
    } else if (dateOnly.getTime() === yesterday.getTime()) {
      return '昨天';
    } else {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
  }

  // 格式化时间
  function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  // 页面卸载时清理资源（P1优化）
  window.addEventListener('beforeunload', () => {
    // 清理计时器
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    // 清理状态检查
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
    console.log('[WebRecorder Popup] 资源已清理');
  });
});
