/**
 * 全局暗色模式管理工具
 * 统一处理所有页面的暗色模式切换和初始化
 */

document.addEventListener('DOMContentLoaded', () => {
  // 初始化暗色模式
  initDarkMode();
});

/**
 * 初始化暗色模式
 * 检查存储的主题设置，应用相应的模式
 */
function initDarkMode() {
  // 查找页面中的暗色模式切换按钮
  const toggleDarkModeBtn = document.getElementById('toggleDarkMode');
  if (!toggleDarkModeBtn) return;

  // 检查保存的主题偏好或尊重操作系统偏好
  const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  
  // 统一使用 'theme' 作为存储键
  const storedTheme = localStorage.getItem('theme');
  const isDark = storedTheme === 'dark' || (!storedTheme && prefersDarkScheme.matches);
  
  // 应用主题
  if (isDark) {
    document.body.classList.add('dark');
    updateToggleButton(toggleDarkModeBtn, true);
  } else {
    document.body.classList.remove('dark');
    updateToggleButton(toggleDarkModeBtn, false);
  }
  
  // 添加点击事件
  toggleDarkModeBtn.addEventListener('click', toggleDarkMode);
  
  // 删除旧的localStorage键
  if (localStorage.getItem('darkMode')) {
    localStorage.removeItem('darkMode');
  }
}

/**
 * 切换暗色模式
 */
function toggleDarkMode() {
  const toggleDarkModeBtn = document.getElementById('toggleDarkMode');
  if (!toggleDarkModeBtn) return;
  
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  
  // 保存用户偏好
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  
  // 更新按钮文本和图标
  updateToggleButton(toggleDarkModeBtn, isDark);
}

/**
 * 更新切换按钮的显示
 * @param {HTMLElement} button - 切换按钮元素
 * @param {boolean} isDark - 是否为暗色模式
 */
function updateToggleButton(button, isDark) {
  if (isDark) {
    button.innerHTML = '明亮模式 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  } else {
    button.innerHTML = '暗色模式 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
  }
}

// 导出函数以便其他脚本使用
window.darkMode = {
  init: initDarkMode,
  toggle: toggleDarkMode
}; 