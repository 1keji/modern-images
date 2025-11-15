// 通用认证状态检查脚本
async function checkAuthStatus() {
  try {
    const response = await fetch('/api/auth-status');
    const data = await response.json();
    
    // 如果系统未配置，跳转到设置页面
    if (!data.isConfigured) {
      window.location.href = '/setup';
      return;
    }
    
    // 如果用户未认证，跳转到登录页面
    if (!data.isAuthenticated) {
      window.location.href = '/login';
      return;
    }

    // 用户已认证，检查数据库状态
    checkDatabaseStatus();
  } catch (error) {
    console.error('检查认证状态失败:', error);
    // 如果检查失败，也跳转到登录页面
    window.location.href = '/login';
  }
}

// 数据库状态检查函数
async function checkDatabaseStatus() {
  try {
    const response = await fetch('/api/database-status');
    const data = await response.json();
    
    if (data.success && data.database) {
      const dbStatus = data.database;
      showDatabaseStatus(dbStatus);
    }
  } catch (error) {
    console.error('检查数据库状态失败:', error);
  }
}

// 显示数据库状态
function showDatabaseStatus(dbStatus) {
  // 如果数据库已连接且没有重连中，不显示状态条
  if (dbStatus.isConnected && !dbStatus.reconnecting) {
    hideDatabaseStatusBar();
    return;
  }
  
  // 创建或获取状态条
  let statusBar = document.getElementById('dbStatusBar');
  if (!statusBar) {
    statusBar = document.createElement('div');
    statusBar.id = 'dbStatusBar';
    statusBar.className = 'db-status-bar';
    document.body.insertBefore(statusBar, document.body.firstChild);
  }
  
  // 根据状态设置样式和消息
  let statusClass = '';
  let statusIcon = '';
  let statusMessage = '';
  
  if (!dbStatus.isConnected) {
    if (dbStatus.reconnecting) {
      statusClass = 'reconnecting';
      statusIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinner"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>';
      statusMessage = `数据库连接已断开，正在重新连接中 (第 ${dbStatus.reconnectAttempts} 次尝试)`;
    } else {
      statusClass = 'disconnected';
      statusIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
      statusMessage = `数据库连接已断开: ${dbStatus.lastConnectionError || '连接失败'}`;
    }
  } else if (dbStatus.reconnecting) {
    statusClass = 'reconnecting';
    statusIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinner"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>';
    statusMessage = '数据库连接已恢复，正在完成重连';
  }
  
  // 更新状态条内容
  statusBar.className = `db-status-bar ${statusClass}`;
  statusBar.innerHTML = `
    <div class="status-icon">${statusIcon}</div>
    <div class="status-message">${statusMessage}</div>
    ${!dbStatus.isConnected && !dbStatus.reconnecting ? 
      '<button class="reconnect-btn" onclick="forceDatabaseReconnect()">手动重连</button>' : ''}
    <button class="close-btn" onclick="hideDatabaseStatusBar()">&times;</button>
  `;
  
  // 显示状态条
  setTimeout(() => {
    statusBar.classList.add('show');
    document.body.classList.add('db-status-active');
  }, 100);
  
  // 每30秒检查一次数据库状态
  if (!window.dbStatusInterval) {
    window.dbStatusInterval = setInterval(checkDatabaseStatus, 30000);
  }
}

// 隐藏数据库状态条
function hideDatabaseStatusBar() {
  const statusBar = document.getElementById('dbStatusBar');
  if (statusBar) {
    statusBar.classList.remove('show');
    setTimeout(() => {
      document.body.classList.remove('db-status-active');
    }, 300);
  }
}

// 强制数据库重连
async function forceDatabaseReconnect() {
  try {
    const response = await fetch('/api/force-reconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    if (data.success) {
      checkDatabaseStatus();
    } else {
      console.error('强制重连失败:', data.message);
    }
  } catch (error) {
    console.error('强制重连失败:', error);
  }
}

// 页面加载时检查状态
document.addEventListener('DOMContentLoaded', checkAuthStatus); 