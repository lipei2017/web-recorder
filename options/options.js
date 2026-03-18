// Options 页面逻辑

document.addEventListener('DOMContentLoaded', async () => {
  // Tab 切换
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      tabContents.forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`${tab}-tab`).classList.add('active');
    });
  });

  // 加载记录列表
  await loadSessions();

  // 搜索和过滤
  const searchInput = document.getElementById('searchInput');
  const filterSelect = document.getElementById('filterSelect');

  searchInput.addEventListener('input', debounce(() => {
    loadSessions();
  }, 300));

  filterSelect.addEventListener('change', () => {
    loadSessions();
  });

  // 设置页面事件
  setupSettings();

  // 域名配置
  await setupDomainConfig();

  // 模态框事件
  setupModal();

  // 导出模态框事件
  setupExportModal();
});

// 加载记录列表
async function loadSessions() {
  const sessionsList = document.getElementById('sessionsList');
  const searchInput = document.getElementById('searchInput');
  const filterSelect = document.getElementById('filterSelect');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_SESSIONS'
    });

    if (!response.success || !response.sessions || response.sessions.length === 0) {
      sessionsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>暂无录制记录</p>
          <button class="btn btn-primary" id="goRecordBtn">开始录制</button>
        </div>
      `;
      document.getElementById('goRecordBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/' });
      });
      return;
    }

    let sessions = response.sessions;

    // 应用过滤器
    const filter = filterSelect.value;
    if (filter !== 'all') {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      
      switch (filter) {
        case 'today':
          sessions = sessions.filter(s => now - s.startTime < oneDay);
          break;
        case 'week':
          sessions = sessions.filter(s => now - s.startTime < 7 * oneDay);
          break;
        case 'month':
          sessions = sessions.filter(s => now - s.startTime < 30 * oneDay);
          break;
      }
    }

    // 应用搜索
    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm) {
      sessions = sessions.filter(s => 
        (s.title && s.title.toLowerCase().includes(searchTerm)) ||
        (s.url && s.url.toLowerCase().includes(searchTerm))
      );
    }

    if (sessions.length === 0) {
      sessionsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>没有找到匹配的记录</p>
        </div>
      `;
      return;
    }

    // 渲染记录列表
    sessionsList.innerHTML = sessions.map(session => {
      const date = new Date(session.startTime);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString();
      const duration = session.endTime 
        ? Math.round((session.endTime - session.startTime) / 1000)
        : 0;
      const durationStr = duration > 0 
        ? `${Math.floor(duration / 60)}分${duration % 60}秒`
        : '进行中';

      return `
        <div class="session-card" data-session-id="${session.id}">
          <div class="session-info">
            <div class="session-title" title="${session.title || '未命名'}">
              ${session.title || '未命名'}
            </div>
            <div class="session-url" title="${session.url}">
              ${session.url}
            </div>
            <div class="session-meta">
              <span>📅 ${dateStr} ${timeStr}</span>
              <span>⏱️ ${durationStr}</span>
              <span>📊 ${session.requestCount || 0} 请求</span>
              <span>💾 ${session.snapshotCount || 0} 快照</span>
            </div>
          </div>
          <div class="session-actions">
            <button class="btn btn-secondary btn-small view-btn" data-session-id="${session.id}">
              查看
            </button>
            <button class="btn btn-danger btn-small delete-btn" data-session-id="${session.id}">
              删除
            </button>
          </div>
        </div>
      `;
    }).join('');

    // 绑定事件
    document.querySelectorAll('.session-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('btn')) {
          const sessionId = card.dataset.sessionId;
          showSessionDetail(sessionId);
        }
      });
    });

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        showSessionDetail(sessionId);
      });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        if (confirm('确定要删除这条记录吗？此操作不可撤销。')) {
          await deleteSession(sessionId);
        }
      });
    });

  } catch (error) {
    console.error('加载记录失败:', error);
    sessionsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>加载失败，请刷新重试</p>
      </div>
    `;
  }
}

// 显示记录详情
let currentSessionDetail = null;

// 格式化消息预览
function formatMessagePreview(data) {
  if (!data) return '(空)';
  
  let text;
  if (typeof data === 'string') {
    text = data;
  } else {
    try {
      text = JSON.stringify(data);
    } catch (e) {
      text = String(data);
    }
  }
  
  // 限制长度
  if (text.length > 100) {
    text = text.substring(0, 100) + '...';
  }
  
  // HTML 转义
  return escapeHtml(text);
}

// 显示 WebSocket 消息详情
function showWebSocketDetail(requestId) {
  if (!currentSessionDetail || !currentSessionDetail.requests) return;
  
  const message = currentSessionDetail.requests.find(r => r.id === requestId);
  if (!message) return;
  
  const data = message.direction === 'outgoing' ? message.requestBody : message.responseBody;
  
  // 创建消息详情模态框
  const detailModal = document.createElement('div');
  detailModal.className = 'modal websocket-detail-modal';
  detailModal.innerHTML = `
    <div class="modal-content" style="max-width: 700px;">
      <div class="modal-header">
        <h2>WebSocket 消息详情</h2>
        <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
        <div class="websocket-detail-content">
          <div class="detail-group">
            <h4>基本信息</h4>
            <p><strong>URL:</strong> ${message.url}</p>
            <p><strong>方向:</strong> ${message.direction === 'outgoing' ? '➡️ 发送 (Client → Server)' : '⬅️ 接收 (Server → Client)'}</p>
            <p><strong>时间:</strong> ${new Date(message.timestamp).toLocaleString()}</p>
          </div>
          
          <div class="detail-group">
            <h4>消息内容</h4>
            <pre style="background: ${message.direction === 'outgoing' ? '#e3f2fd' : '#f3e5f5'}; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; max-height: 400px; overflow-y: auto; border: 1px solid ${message.direction === 'outgoing' ? '#bbdefb' : '#e1bee7'};">${formatMessageContent(data)}</pre>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // 添加样式
  detailModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2000;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
  `;
  
  document.body.appendChild(detailModal);
  
  // 点击背景关闭
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) {
      detailModal.remove();
    }
  });
}

// 格式化消息内容
function formatMessageContent(data) {
  if (!data) return '(空消息)';
  
  if (typeof data === 'string') {
    // 尝试解析为 JSON 并美化
    try {
      const parsed = JSON.parse(data);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      return data;
    }
  }
  
  // 对象类型，直接 JSON 序列化
  return JSON.stringify(data, null, 2);
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 显示单个请求详情
function showRequestDetail(requestId) {
  if (!currentSessionDetail || !currentSessionDetail.requests) return;
  
  const request = currentSessionDetail.requests.find(r => r.id === requestId);
  if (!request) return;
  
  // 创建请求详情模态框
  const detailModal = document.createElement('div');
  detailModal.className = 'modal request-detail-modal';
  detailModal.innerHTML = `
    <div class="modal-content" style="max-width: 700px;">
      <div class="modal-header">
        <h2>请求详情</h2>
        <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
        <div class="request-detail-content">
          <div class="detail-group">
            <h4>基本信息</h4>
            <p><strong>URL:</strong> ${request.url}</p>
            <p><strong>Method:</strong> ${request.method}</p>
            <p><strong>Status:</strong> ${request.status || 'N/A'}</p>
            <p><strong>Duration:</strong> ${request.duration || 0}ms</p>
            <p><strong>Time:</strong> ${new Date(request.timestamp).toLocaleString()}</p>
          </div>
          
          ${request.headers && Object.keys(request.headers).length > 0 ? `
          <div class="detail-group">
            <h4>请求头</h4>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px;">${JSON.stringify(request.headers, null, 2)}</pre>
          </div>
          ` : ''}
          
          ${request.requestBody ? `
          <div class="detail-group">
            <h4>请求体</h4>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; max-height: 200px; overflow-y: auto;">${typeof request.requestBody === 'string' ? request.requestBody : JSON.stringify(request.requestBody, null, 2)}</pre>
          </div>
          ` : ''}
          
          ${request.responseHeaders && Object.keys(request.responseHeaders).length > 0 ? `
          <div class="detail-group">
            <h4>响应头</h4>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px;">${JSON.stringify(request.responseHeaders, null, 2)}</pre>
          </div>
          ` : ''}
          
          ${request.responseBody !== null && request.responseBody !== undefined ? `
          <div class="detail-group">
            <h4>响应体</h4>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; max-height: 300px; overflow-y: auto;">${typeof request.responseBody === 'string' ? request.responseBody : JSON.stringify(request.responseBody, null, 2)}</pre>
          </div>
          ` : ''}
          
          ${request.error ? `
          <div class="detail-group">
            <h4 style="color: #dc3545;">错误</h4>
            <p style="color: #dc3545;">${request.error}</p>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  // 添加样式
  detailModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2000;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
  `;
  
  document.body.appendChild(detailModal);
  
  // 点击背景关闭
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) {
      detailModal.remove();
    }
  });
}

async function showSessionDetail(sessionId) {
  const modal = document.getElementById('detailModal');
  const modalBody = document.getElementById('modalBody');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportHarBtn = document.getElementById('exportHarBtn');
  const playbackBtn = document.getElementById('playbackBtn');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_SESSION',
      sessionId: sessionId
    });

    if (!response.success) {
      alert('加载详情失败');
      return;
    }

    currentSessionDetail = response.session;

    // 渲染详情
    const date = new Date(response.session.startTime);
    const dateStr = date.toLocaleString();
    
    // 分离不同类型的请求
    const httpRequests = response.session.requests?.filter(req => req.type === 'xhr' || req.type === 'fetch') || [];
    const wsMessages = response.session.requests?.filter(req => req.type === 'websocket') || [];
    
    // 按 URL 分组 WebSocket 消息
    const wsGroups = {};
    wsMessages.forEach(msg => {
      if (!wsGroups[msg.url]) {
        wsGroups[msg.url] = [];
      }
      wsGroups[msg.url].push(msg);
    });
    
    modalBody.innerHTML = `
      <div class="session-detail">
        <div class="detail-section">
          <h4>基本信息</h4>
          <p><strong>标题:</strong> ${response.session.title || '未命名'}</p>
          <p><strong>URL:</strong> ${response.session.url}</p>
          <p><strong>时间:</strong> ${dateStr}</p>
          <p><strong>HTTP 请求数:</strong> ${httpRequests.length}</p>
          <p><strong>WebSocket 消息数:</strong> ${wsMessages.length}</p>
          <p><strong>快照数:</strong> ${response.session.snapshots?.length || 0}</p>
        </div>

        <div class="detail-section">
          <h4>网络请求 (${httpRequests.length})</h4>
          <div class="request-list-container" style="max-height: 300px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 6px; padding: 8px;">
            <div class="request-list">
              ${httpRequests.length > 0 ? httpRequests.map(req => `
                <div class="request-item" style="cursor: pointer;" onclick="showRequestDetail('${req.id}')">
                  <span class="request-method ${req.method.toLowerCase()}">${req.method}</span>
                  <span class="request-url" title="${req.url}">${req.url}</span>
                  <span class="request-status ${req.status >= 200 && req.status < 300 ? 'success' : 'error'}">
                    ${req.status || 'N/A'}
                  </span>
                  <span class="request-time">${req.duration || 0}ms</span>
                </div>
              `).join('') : '<p class="empty-text">暂无 HTTP 请求</p>'}
            </div>
          </div>
        </div>
        
        <div class="detail-section">
          <h4>WebSocket 消息 (${wsMessages.length})</h4>
          ${Object.keys(wsGroups).length > 0 ? Object.entries(wsGroups).map(([url, messages]) => `
            <div class="websocket-group" style="margin-bottom: 16px; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
              <div class="websocket-header" style="background: #f5f5f5; padding: 10px 12px; font-weight: 600; font-size: 13px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${url}">${url}</span>
                <span style="font-size: 12px; color: #666; font-weight: normal;">${messages.length} 条消息</span>
              </div>
              <div class="websocket-messages" style="max-height: 200px; overflow-y: auto; padding: 8px;">
                ${messages.map(msg => `
                  <div class="websocket-message ${msg.direction}" style="padding: 8px; margin-bottom: 6px; border-radius: 4px; font-size: 12px; cursor: pointer; ${msg.direction === 'outgoing' ? 'background: #e3f2fd; margin-left: 20px;' : 'background: #f3e5f5; margin-right: 20px;'}" onclick="showWebSocketDetail('${msg.id}')">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                      <span style="font-weight: 600; ${msg.direction === 'outgoing' ? 'color: #1976d2;' : 'color: #7b1fa2;'}">
                        ${msg.direction === 'outgoing' ? '➡️ 发送' : '⬅️ 接收'}
                      </span>
                      <span style="color: #999; font-size: 11px;">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div class="websocket-preview" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333; font-family: monospace;">
                      ${formatMessagePreview(msg.direction === 'outgoing' ? msg.requestBody : msg.responseBody)}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('') : '<p class="empty-text">暂无 WebSocket 消息</p>'}
        </div>
      </div>
    `;

    modal.classList.add('active');

    // 绑定导出按钮
    exportJsonBtn.onclick = () => showExportModal(sessionId, response.session);
    exportHarBtn.onclick = () => exportSession(sessionId, 'har');
    playbackBtn.onclick = () => startPlayback(sessionId);

  } catch (error) {
    console.error('加载详情失败:', error);
    alert('加载详情失败');
  }
}

// 删除记录
async function deleteSession(sessionId) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DELETE_SESSION',
      sessionId: sessionId
    });

    if (response.success) {
      await loadSessions();
    } else {
      alert('删除失败: ' + (response.error || '未知错误'));
    }
  } catch (error) {
    console.error('删除记录失败:', error);
    alert('删除失败');
  }
}

// 导出记录
async function exportSession(sessionId, format) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'EXPORT_SESSION',
      sessionId: sessionId,
      format: format
    });

    if (response.success) {
      alert('导出成功！');
    } else {
      alert('导出失败: ' + (response.error || '未知错误'));
    }
  } catch (error) {
    console.error('导出失败:', error);
    alert('导出失败');
  }
}

// 开始回放
async function startPlayback(sessionId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const response = await chrome.runtime.sendMessage({
      type: 'START_PLAYBACK',
      sessionId: sessionId
    });

    if (response.success) {
      alert('回放已启动！请刷新页面查看效果。');
      document.getElementById('detailModal').classList.remove('active');
    } else {
      alert('启动回放失败: ' + (response.error || '未知错误'));
    }
  } catch (error) {
    console.error('启动回放失败:', error);
    alert('启动回放失败');
  }
}

// 导出配置模态框
let currentExportSession = null;
let currentExportSessionId = null;

function showExportModal(sessionId, session) {
  currentExportSession = session;
  currentExportSessionId = sessionId;
  
  const modal = document.getElementById('exportModal');
  const exportFilename = document.getElementById('exportFilename');
  
  // 设置默认文件名
  const date = new Date(session.startTime);
  const dateStr = date.toISOString().split('T')[0];
  const safeTitle = (session.title || 'export').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 30);
  exportFilename.value = `web-recorder-${safeTitle}-${dateStr}`;
  
  // 显示模态框
  modal.classList.add('active');
  
  // 更新预览
  updateExportPreview();
}

function updateExportPreview() {
  if (!currentExportSession) return;
  
  const exportRequests = document.getElementById('exportRequests').checked;
  const exportSnapshots = document.getElementById('exportSnapshots').checked;
  const exportSessionInfo = document.getElementById('exportSessionInfo').checked;
  const formatCompact = document.querySelector('input[name="jsonFormat"]:checked').value === 'compact';
  const requestFilter = document.getElementById('requestFilter').value;
  
  // 构建导出数据
  const exportData = {};
  
  if (exportSessionInfo) {
    exportData.id = currentExportSession.id;
    exportData.url = currentExportSession.url;
    exportData.title = currentExportSession.title;
    exportData.startTime = currentExportSession.startTime;
    exportData.endTime = currentExportSession.endTime;
  }
  
  if (exportRequests && currentExportSession.requests) {
    let requests = currentExportSession.requests;
    
    // 应用过滤器
    if (requestFilter !== 'all') {
      if (requestFilter === 'success') {
        requests = requests.filter(r => r.status >= 200 && r.status < 300);
      } else if (requestFilter === 'error') {
        requests = requests.filter(r => r.status === 0 || r.status >= 400);
      } else {
        requests = requests.filter(r => r.type === requestFilter);
      }
    }
    
    exportData.requests = requests;
    exportData.requestCount = requests.length;
  }
  
  if (exportSnapshots && currentExportSession.snapshots) {
    exportData.snapshots = currentExportSession.snapshots;
    exportData.snapshotCount = currentExportSession.snapshots.length;
  }
  
  // 生成预览（只显示前 500 个字符）
  let preview = JSON.stringify(exportData, null, formatCompact ? 0 : 2);
  if (preview.length > 500) {
    preview = preview.substring(0, 500) + '\n... (共 ' + preview.length + ' 字符)';
  }
  
  document.getElementById('exportPreview').textContent = preview;
}

// 导出 JSON（带配置）
async function exportJSONWithConfig() {
  if (!currentExportSession) return;
  
  const exportRequests = document.getElementById('exportRequests').checked;
  const exportSnapshots = document.getElementById('exportSnapshots').checked;
  const exportSessionInfo = document.getElementById('exportSessionInfo').checked;
  const formatCompact = document.querySelector('input[name="jsonFormat"]:checked').value === 'compact';
  const requestFilter = document.getElementById('requestFilter').value;
  let filename = document.getElementById('exportFilename').value.trim();
  
  if (!filename) {
    const date = new Date(currentExportSession.startTime);
    const dateStr = date.toISOString().split('T')[0];
    const safeTitle = (currentExportSession.title || 'export').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 30);
    filename = `web-recorder-${safeTitle}-${dateStr}`;
  }
  
  // 确保文件名有 .json 后缀
  if (!filename.endsWith('.json')) {
    filename += '.json';
  }
  
  try {
    // 构建导出数据
    const exportData = {};
    
    if (exportSessionInfo) {
      exportData.id = currentExportSession.id;
      exportData.url = currentExportSession.url;
      exportData.title = currentExportSession.title;
      exportData.startTime = currentExportSession.startTime;
      exportData.endTime = currentExportSession.endTime;
    }
    
    if (exportRequests && currentExportSession.requests) {
      let requests = [...currentExportSession.requests];
      
      // 应用过滤器
      if (requestFilter !== 'all') {
        if (requestFilter === 'success') {
          requests = requests.filter(r => r.status >= 200 && r.status < 300);
        } else if (requestFilter === 'error') {
          requests = requests.filter(r => r.status === 0 || r.status >= 400);
        } else {
          requests = requests.filter(r => r.type === requestFilter);
        }
      }
      
      exportData.requests = requests;
      exportData.requestCount = requests.length;
    }
    
    if (exportSnapshots && currentExportSession.snapshots) {
      exportData.snapshots = currentExportSession.snapshots;
      exportData.snapshotCount = currentExportSession.snapshots.length;
    }
    
    const jsonString = JSON.stringify(exportData, null, formatCompact ? 0 : 2);
    
    // 创建 Blob 并下载
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    
    // 关闭模态框
    document.getElementById('exportModal').classList.remove('active');
    
    alert('导出成功！');
  } catch (error) {
    console.error('导出失败:', error);
    alert('导出失败: ' + error.message);
  }
}

// 复制 JSON 到剪贴板
async function copyJSONToClipboard() {
  if (!currentExportSession) return;
  
  const exportRequests = document.getElementById('exportRequests').checked;
  const exportSnapshots = document.getElementById('exportSnapshots').checked;
  const exportSessionInfo = document.getElementById('exportSessionInfo').checked;
  const formatCompact = document.querySelector('input[name="jsonFormat"]:checked').value === 'compact';
  const requestFilter = document.getElementById('requestFilter').value;
  
  try {
    // 构建导出数据
    const exportData = {};
    
    if (exportSessionInfo) {
      exportData.id = currentExportSession.id;
      exportData.url = currentExportSession.url;
      exportData.title = currentExportSession.title;
      exportData.startTime = currentExportSession.startTime;
      exportData.endTime = currentExportSession.endTime;
    }
    
    if (exportRequests && currentExportSession.requests) {
      let requests = [...currentExportSession.requests];
      
      // 应用过滤器
      if (requestFilter !== 'all') {
        if (requestFilter === 'success') {
          requests = requests.filter(r => r.status >= 200 && r.status < 300);
        } else if (requestFilter === 'error') {
          requests = requests.filter(r => r.status === 0 || r.status >= 400);
        } else {
          requests = requests.filter(r => r.type === requestFilter);
        }
      }
      
      exportData.requests = requests;
      exportData.requestCount = requests.length;
    }
    
    if (exportSnapshots && currentExportSession.snapshots) {
      exportData.snapshots = currentExportSession.snapshots;
      exportData.snapshotCount = currentExportSession.snapshots.length;
    }
    
    const jsonString = JSON.stringify(exportData, null, formatCompact ? 0 : 2);
    
    await navigator.clipboard.writeText(jsonString);
    alert('JSON 已复制到剪贴板！');
  } catch (error) {
    console.error('复制失败:', error);
    alert('复制失败: ' + error.message);
  }
}

// 设置导出模态框事件
function setupExportModal() {
  const modal = document.getElementById('exportModal');
  const closeBtn = document.getElementById('exportModalClose');
  const exportFilename = document.getElementById('exportFilename');
  const exportRequests = document.getElementById('exportRequests');
  const exportSnapshots = document.getElementById('exportSnapshots');
  const exportSessionInfo = document.getElementById('exportSessionInfo');
  const requestFilter = document.getElementById('requestFilter');
  const jsonFormatRadios = document.querySelectorAll('input[name="jsonFormat"]');
  
  // 关闭按钮
  closeBtn.onclick = () => {
    modal.classList.remove('active');
  };
  
  // 点击背景关闭
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  };
  
  // 实时更新预览
  const updatePreview = () => updateExportPreview();
  
  exportRequests.addEventListener('change', updatePreview);
  exportSnapshots.addEventListener('change', updatePreview);
  exportSessionInfo.addEventListener('change', updatePreview);
  requestFilter.addEventListener('change', updatePreview);
  jsonFormatRadios.forEach(radio => radio.addEventListener('change', updatePreview));
  
  // 导出按钮
  document.getElementById('confirmExportBtn').onclick = exportJSONWithConfig;
  document.getElementById('copyJsonBtn').onclick = copyJSONToClipboard;
}

// 设置页面
function setupSettings() {
  // 清除所有记录
  document.getElementById('clearAllBtn').addEventListener('click', async () => {
    if (confirm('确定要清除所有记录吗？此操作不可撤销。')) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_SESSIONS'
        });

        if (response.success && response.sessions) {
          for (const session of response.sessions) {
            await chrome.runtime.sendMessage({
              type: 'DELETE_SESSION',
              sessionId: session.id
            });
          }
          await loadSessions();
          alert('已清除所有记录');
        }
      } catch (error) {
        console.error('清除记录失败:', error);
        alert('清除失败');
      }
    }
  });

  // URL 过滤规则管理
  setupUrlFilters();

  // LocalStorage 过滤规则管理
  setupLocalStorageFilters();
}

// 设置 URL 过滤规则
function setupUrlFilters() {
  const filterList = document.getElementById('urlFilterList');
  const newFilterInput = document.getElementById('newFilterPattern');
  const addFilterBtn = document.getElementById('addFilterBtn');

  // 加载已保存的过滤规则
  loadUrlFilters();

  // 添加新规则
  addFilterBtn.addEventListener('click', () => {
    const pattern = newFilterInput.value.trim();
    if (pattern) {
      addUrlFilter(pattern);
      newFilterInput.value = '';
    }
  });

  // 回车添加
  newFilterInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const pattern = newFilterInput.value.trim();
      if (pattern) {
        addUrlFilter(pattern);
        newFilterInput.value = '';
      }
    }
  });

  // 加载过滤规则
  async function loadUrlFilters() {
    try {
      const result = await chrome.storage.local.get(['urlFilters']);
      const filters = result.urlFilters || [];
      renderFilterList(filters);
    } catch (error) {
      console.error('加载过滤规则失败:', error);
    }
  }

  // 渲染过滤规则列表
  function renderFilterList(filters) {
    filterList.innerHTML = '';
    
    if (filters.length === 0) {
      filterList.innerHTML = '<p style="color: #999; font-size: 13px;">暂无过滤规则</p>';
      return;
    }

    filters.forEach((filter, index) => {
      const item = document.createElement('div');
      item.className = 'filter-item';
      item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #f8f9fa; border-radius: 4px; margin-bottom: 8px;';
      item.innerHTML = `
        <code style="font-size: 13px; color: #333;">${escapeHtml(filter)}</code>
        <button class="btn-remove-filter" data-index="${index}" style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;">删除</button>
      `;
      filterList.appendChild(item);
    });

    // 绑定删除按钮
    document.querySelectorAll('.btn-remove-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        removeUrlFilter(index);
      });
    });
  }

  // 添加过滤规则
  async function addUrlFilter(pattern) {
    try {
      const result = await chrome.storage.local.get(['urlFilters']);
      const filters = result.urlFilters || [];
      
      // 检查是否已存在
      if (filters.includes(pattern)) {
        alert('该规则已存在');
        return;
      }

      filters.push(pattern);
      await chrome.storage.local.set({ urlFilters: filters });
      renderFilterList(filters);
    } catch (error) {
      console.error('添加过滤规则失败:', error);
    }
  }

  // 删除过滤规则
  async function removeUrlFilter(index) {
    try {
      const result = await chrome.storage.local.get(['urlFilters']);
      const filters = result.urlFilters || [];
      filters.splice(index, 1);
      await chrome.storage.local.set({ urlFilters: filters });
      renderFilterList(filters);
    } catch (error) {
      console.error('删除过滤规则失败:', error);
    }
  }

  // HTML 转义
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// LocalStorage 过滤器设置
function setupLocalStorageFilters() {
  const filterList = document.getElementById('localStorageFilterList');
  const newFilterInput = document.getElementById('newLocalStorageFilter');
  const addFilterBtn = document.getElementById('addLocalStorageFilterBtn');

  if (!filterList || !newFilterInput || !addFilterBtn) return;

  // 添加按钮事件
  addFilterBtn.addEventListener('click', () => {
    const pattern = newFilterInput.value.trim();
    if (pattern) {
      addLocalStorageFilter(pattern);
      newFilterInput.value = '';
    }
  });

  // 输入框回车事件
  newFilterInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const pattern = newFilterInput.value.trim();
      if (pattern) {
        addLocalStorageFilter(pattern);
        newFilterInput.value = '';
      }
    }
  });

  // 加载过滤规则
  async function loadLocalStorageFilters() {
    try {
      const result = await chrome.storage.local.get(['localStorageFilters']);
      const filters = result.localStorageFilters || [];
      renderFilterList(filters);
    } catch (error) {
      console.error('加载 localStorage 过滤规则失败:', error);
    }
  }

  // 渲染过滤规则列表
  function renderFilterList(filters) {
    filterList.innerHTML = '';

    if (filters.length === 0) {
      filterList.innerHTML = '<p style="color: #999; font-size: 13px;">暂无过滤规则</p>';
      return;
    }

    filters.forEach((filter, index) => {
      const item = document.createElement('div');
      item.className = 'filter-item';
      item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #f8f9fa; border-radius: 4px; margin-bottom: 8px;';
      item.innerHTML = `
        <code style="font-size: 13px; color: #333;">${escapeHtml(filter)}</code>
        <button class="btn-remove-ls-filter" data-index="${index}" style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;">删除</button>
      `;
      filterList.appendChild(item);
    });

    // 绑定删除按钮
    document.querySelectorAll('.btn-remove-ls-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        removeLocalStorageFilter(index);
      });
    });
  }

  // 添加过滤规则
  async function addLocalStorageFilter(pattern) {
    try {
      const result = await chrome.storage.local.get(['localStorageFilters']);
      const filters = result.localStorageFilters || [];

      // 检查是否已存在
      if (filters.includes(pattern)) {
        alert('该规则已存在');
        return;
      }

      filters.push(pattern);
      await chrome.storage.local.set({ localStorageFilters: filters });
      renderFilterList(filters);
    } catch (error) {
      console.error('添加 localStorage 过滤规则失败:', error);
    }
  }

  // 删除过滤规则
  async function removeLocalStorageFilter(index) {
    try {
      const result = await chrome.storage.local.get(['localStorageFilters']);
      const filters = result.localStorageFilters || [];
      filters.splice(index, 1);
      await chrome.storage.local.set({ localStorageFilters: filters });
      renderFilterList(filters);
    } catch (error) {
      console.error('删除 localStorage 过滤规则失败:', error);
    }
  }

  // HTML 转义
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 加载初始数据
  loadLocalStorageFilters();
}

// 模态框事件
function setupModal() {
  const modal = document.getElementById('detailModal');
  const closeBtn = document.getElementById('modalClose');

  if (!closeBtn) {
    console.error('关闭按钮未找到');
    return;
  }

  // 使用 onclick 确保事件绑定成功
  closeBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    modal.classList.remove('active');
    console.log('[WebRecorder] 关闭模态框');
    return false;
  };

  // 点击背景关闭
  modal.onclick = function(e) {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  };

  // ESC 键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal.classList.contains('active')) {
        modal.classList.remove('active');
      }
      const exportModal = document.getElementById('exportModal');
      if (exportModal.classList.contains('active')) {
        exportModal.classList.remove('active');
      }
    }
  });
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

// ==================== 域名配置管理 ====================

async function setupDomainConfig() {
  const domainList = document.getElementById('domainList');
  const addDomainBtn = document.getElementById('addDomainBtn');
  const newDomainPattern = document.getElementById('newDomainPattern');
  const newDomainDesc = document.getElementById('newDomainDesc');

  // 加载现有配置
  await loadDomainConfigs();

  // 添加域名按钮事件
  addDomainBtn.addEventListener('click', async () => {
    const pattern = newDomainPattern.value.trim();
    const desc = newDomainDesc.value.trim();
    const mode = document.querySelector('input[name="domainMode"]:checked').value;

    if (!pattern) {
      showNotification('请输入域名模式', 'error');
      return;
    }

    // 验证域名模式格式
    if (!isValidDomainPattern(pattern)) {
      showNotification('域名格式不正确', 'error');
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_DOMAIN_CONFIG',
        config: {
          domain: pattern,
          description: desc,
          mode: mode
        }
      });

      if (response.success) {
        showNotification('域名配置已保存', 'success');
        newDomainPattern.value = '';
        newDomainDesc.value = '';
        await loadDomainConfigs();
      } else {
        showNotification(response.error || '保存失败', 'error');
      }
    } catch (error) {
      console.error('保存域名配置失败:', error);
      showNotification('保存失败', 'error');
    }
  });
}

// 加载域名配置列表
async function loadDomainConfigs() {
  const domainList = document.getElementById('domainList');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_DOMAIN_CONFIGS'
    });

    if (!response.success) {
      domainList.innerHTML = '<p style="color: #999; padding: 20px;">加载域名配置失败</p>';
      return;
    }

    const domains = response.configs.domains || [];

    if (domains.length === 0) {
      domainList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #999;">
          <div style="font-size: 32px; margin-bottom: 8px;">🌐</div>
          <p>暂无域名配置</p>
          <p style="font-size: 12px; margin-top: 8px;">添加域名后才能使用录制/回放功能</p>
        </div>
      `;
      return;
    }

    // 渲染域名列表
    domainList.innerHTML = domains.map(domain => `
      <div style="background: #f8f9fa; border-radius: 8px; padding: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">
            ${domain.domain}
            <span style="font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; ${getModeStyle(domain.mode)}">
              ${getModeText(domain.mode)}
            </span>
          </div>
          ${domain.description ? `<div style="font-size: 12px; color: #666;">${domain.description}</div>` : ''}
        </div>
        <button class="btn btn-danger" data-domain-id="${domain.id}" style="padding: 6px 12px; font-size: 12px;">
          删除
        </button>
      </div>
    `).join('');

    // 绑定删除按钮事件
    domainList.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const domainId = btn.dataset.domainId;
        if (confirm('确定要删除这个域名配置吗？')) {
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'DELETE_DOMAIN_CONFIG',
              domainId: domainId
            });

            if (response.success) {
              showNotification('域名配置已删除', 'success');
              await loadDomainConfigs();
            } else {
              showNotification(response.error || '删除失败', 'error');
            }
          } catch (error) {
            console.error('删除域名配置失败:', error);
            showNotification('删除失败', 'error');
          }
        }
      });
    });

  } catch (error) {
    console.error('加载域名配置失败:', error);
    domainList.innerHTML = '<p style="color: #999; padding: 20px;">加载失败，请刷新页面重试</p>';
  }
}

// 验证域名模式
function isValidDomainPattern(pattern) {
  // 简单验证：不能包含空格，可以包含字母数字、点、星号、问号、横线
  return /^[a-zA-Z0-9.*\-?]+$/.test(pattern) && pattern.length > 0;
}

// 获取模式显示文本
function getModeText(mode) {
  const modeMap = {
    'both': '全部',
    'record': '仅录制',
    'playback': '仅回放'
  };
  return modeMap[mode] || mode;
}

// 获取模式样式
function getModeStyle(mode) {
  const styleMap = {
    'both': 'background: #667eea; color: white;',
    'record': 'background: #dc3545; color: white;',
    'playback': 'background: #28a745; color: white;'
  };
  return styleMap[mode] || '';
}

// 显示通知
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  const bgColor = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#667eea';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}
