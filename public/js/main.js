document.addEventListener('DOMContentLoaded', () => {
  // 提示消息系统
  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = type === 'success' 
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    
    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <div class="toast-title">${type === 'success' ? '成功' : '错误'}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close">&times;</button>
    `;
    
    toastContainer.appendChild(toast);
    
    // 触发重排以启用CSS过渡
    toast.offsetHeight;
    toast.classList.add('show');
    
    const removeToast = () => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    };
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', removeToast);
    
    setTimeout(removeToast, duration);
  }

  // 文件上传处理
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('fileInput');
  const previewArea = document.getElementById('previewArea');
  const uploadForm = document.getElementById('uploadForm');
  
  // 图片模态框引用
  let imageModal = null;
  let keyNavigationListener = null;
  
  // 维护一个文件队列数组
  let fileQueue = [];
  
  // 定义一个可外部访问的updatePreview函数
  window.updatePreviewFunc = null;

  if (dropArea && fileInput) {
    // 修改后的上传区域布局：移除背景图标，仅保留中央上传按钮，调整文字位置
    dropArea.innerHTML = `
    <div class="drop-area-content">
      <!-- 背景上传图标已移除 -->
      <p class="drop-area-subtext" style="margin-top: 170px;">支持 JPG、PNG、GIF、WebP 和 AVIF等 格式</p>
    </div>
    <div class="upload-icon-center" id="uploadIconCenter" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
    </div>
    `;
    
    // 中央上传图标点击处理
    const uploadIconCenter = document.getElementById('uploadIconCenter');
    if (uploadIconCenter) {
      uploadIconCenter.addEventListener('click', (e) => {
        e.stopPropagation(); // 防止点击事件冒泡到dropArea
        if (fileQueue.length > 0) {
          submitUploadForm();
        } else {
          fileInput.click();
        }
      });
    }

    dropArea.addEventListener('click', () => {
      fileInput.click();
    });

    dropArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropArea.classList.add('hover');
    });

    dropArea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropArea.classList.remove('hover');
    });

    dropArea.addEventListener('drop', (e) => {
      e.preventDefault();
      dropArea.classList.remove('hover');
      const files = e.dataTransfer.files;
      if (files.length) {
        addFilesToQueue(files);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        addFilesToQueue(fileInput.files);
      }
    });

    // 添加文件到队列并更新预览
    function addFilesToQueue(files) {
      Array.from(files).forEach(file => {
        if (file.type.startsWith('image/')) {
          // 为每个文件生成唯一ID
          const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          fileQueue.push({
            id: fileId,
            file: file
          });
        }
      });
      
      updatePreview();
    }

    // 增强的预览功能 - 修改为网格布局，不显示文件名
    function updatePreview() {
      previewArea.innerHTML = '';
      
      if (!fileQueue.length) {
        previewArea.innerHTML = '<div class="empty-preview">预览区域为空，请添加图片</div>';
        document.getElementById('uploadBtn').disabled = true;
        return;
      }
      
      document.getElementById('uploadBtn').disabled = false;
      
      const previewHeader = document.createElement('div');
      previewHeader.className = 'preview-header';
      previewHeader.innerHTML = `
        <div class="preview-title">上传队列（${fileQueue.length}张图片）</div>
        <div class="preview-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="clearAllBtn">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            清空队列
          </button>
        </div>
      `;
      previewArea.appendChild(previewHeader);
      
      const previewList = document.createElement('div');
      previewList.className = 'preview-list';
      previewList.id = 'previewList';
      previewArea.appendChild(previewList);
      
      // 添加拖拽排序说明
      const dragHint = document.createElement('div');
      dragHint.className = 'drag-hint';
      dragHint.innerHTML = '提示：拖动图片可调整上传顺序';
      previewArea.appendChild(dragHint);
      
      fileQueue.forEach((fileObj, index) => {
        createPreviewItem(fileObj, index, previewList);
      });
      
      // 清空按钮事件
      document.getElementById('clearAllBtn').addEventListener('click', () => {
        fileQueue = [];
        updatePreview();
      });
      
      // 初始化拖拽排序功能
      initDragSort();
    }
    
    // 创建单个预览项目 - 修改为只显示图片，不显示文件名
    function createPreviewItem(fileObj, index, container) {
      const { id, file } = fileObj;
      
      const previewItem = document.createElement('div');
      previewItem.className = 'preview-item';
      previewItem.setAttribute('data-file-id', id);
      previewItem.setAttribute('data-index', index);
      previewItem.title = file.name; // 使用title属性显示文件名作为提示
      
      // 创建预览项目的布局 - 更简洁，只显示图片
      previewItem.innerHTML = `
        <div class="preview-img-container">
          <div class="loading-spinner">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
              <line x1="12" y1="2" x2="12" y2="6"></line>
              <line x1="12" y1="18" x2="12" y2="22"></line>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
              <line x1="2" y1="12" x2="6" y2="12"></line>
              <line x1="18" y1="12" x2="22" y2="12"></line>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
              <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
            </svg>
          </div>
          <img class="preview-img" src="#" alt="${file.name}">
        </div>
        <button type="button" class="preview-delete-btn" data-file-id="${id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"></path>
            <path d="M6 6l12 12"></path>
          </svg>
        </button>
      `;
      
      // 加载图片预览
      const img = previewItem.querySelector('.preview-img');
      const loadingSpinner = previewItem.querySelector('.loading-spinner');
      
      const fileReader = new FileReader();
      fileReader.onload = (e) => {
        img.src = e.target.result;
        
        // 图片加载完成后隐藏加载动画
        img.onload = () => {
          loadingSpinner.style.display = 'none';
        };
      };
      fileReader.readAsDataURL(file);
      
      // 删除按钮事件
      const deleteBtn = previewItem.querySelector('.preview-delete-btn');
      deleteBtn.addEventListener('click', () => {
        fileQueue = fileQueue.filter(item => item.id !== id);
        updatePreview();
      });
      
      container.appendChild(previewItem);
      
      return previewItem;
    }
    
    // 全新优化的拖拽排序功能，使用鼠标事件代替原生拖放API
    function initDragSort() {
      const previewList = document.getElementById('previewList');
      if (!previewList) return;
      
      // 创建一个放置指示器元素，用于显示放置位置
      const dropIndicator = document.createElement('div');
      dropIndicator.className = 'drop-indicator';
      dropIndicator.style.display = 'none';
      dropIndicator.style.position = 'absolute';
      dropIndicator.style.width = '100%';
      dropIndicator.style.height = '3px';
      dropIndicator.style.backgroundColor = '#3498db';
      dropIndicator.style.zIndex = '1000';
      dropIndicator.style.pointerEvents = 'none';
      dropIndicator.style.boxShadow = '0 0 6px rgba(52, 152, 219, 0.7)';
      previewList.appendChild(dropIndicator);
      
      let draggedItem = null;
      let draggedItemRect = null;
      let initialX = 0;
      let initialY = 0;
      
      // 添加鼠标事件监听
      previewList.addEventListener('mousedown', handleDragStart);
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      
      // 处理拖动开始事件
      function handleDragStart(e) {
        const item = e.target.closest('.preview-item');
        if (!item) return;
        
        // 只处理左键点击，并且不在删除按钮上
        if (e.button !== 0 || e.target.closest('.preview-delete-btn')) return;
        
        e.preventDefault();
        
        draggedItem = item;
        draggedItemRect = item.getBoundingClientRect();
        
        // 存储初始光标位置
        initialX = e.clientX;
        initialY = e.clientY;
        
        // 延迟添加拖动类，以允许点击事件
        setTimeout(() => {
          if (draggedItem) {
            draggedItem.classList.add('dragging');
            draggedItem.style.cursor = 'grabbing';
            createDragGhost(e);
          }
        }, 50);
      }
      
      // 创建拖动时的"幽灵"元素
      function createDragGhost(e) {
        // 移除任何已存在的幽灵元素
        const existingGhost = document.getElementById('dragGhost');
        if (existingGhost) {
          document.body.removeChild(existingGhost);
        }
        
        const ghost = draggedItem.cloneNode(true);
        ghost.id = 'dragGhost';
        ghost.style.position = 'fixed';
        ghost.style.top = `${draggedItemRect.top}px`;
        ghost.style.left = `${draggedItemRect.left}px`;
        ghost.style.width = `${draggedItemRect.width}px`;
        ghost.style.height = `${draggedItemRect.height}px`;
        ghost.style.opacity = '0.8';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '10000';
        ghost.style.transform = 'scale(0.95)';
        ghost.style.transition = 'none'; // 移除任何过渡效果
        ghost.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';
        
        document.body.appendChild(ghost);
        
        // 使原始元素半透明
        draggedItem.style.opacity = '0.4';
      }
      
      // 处理拖动移动事件
      function handleDragMove(e) {
        if (!draggedItem) return;
        
        // 移动幽灵元素
        const ghost = document.getElementById('dragGhost');
        if (ghost) {
          // 计算新位置
          const offsetX = e.clientX - initialX;
          const offsetY = e.clientY - initialY;
          
          ghost.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(0.95)`;
        }
        
        // 找出放置位置
        updateDropPosition(e.clientY);
      }
      
      // 更新放置位置并显示指示器
      function updateDropPosition(clientY) {
        const previewListRect = previewList.getBoundingClientRect();
        const scrollTop = previewList.scrollTop;
        const relativeY = clientY - previewListRect.top + scrollTop;
        
        // 找出鼠标下方的元素
        const items = [...previewList.querySelectorAll('.preview-item:not(.dragging)')];
        
        let closestItem = null;
        let closestOffset = Number.NEGATIVE_INFINITY;
        let beforeOrAfter = 'after'; // 默认放在后面
        
        items.forEach(item => {
          const rect = item.getBoundingClientRect();
          const center = rect.top + rect.height / 2;
          const offset = clientY - center;
          
          // 找到最接近的项目
          if (offset < 0 && offset > closestOffset) {
            closestOffset = offset;
            closestItem = item;
            beforeOrAfter = 'before';
          } else if (offset >= 0 && closestItem === null) {
            closestItem = item;
            beforeOrAfter = 'after';
          }
        });
        
        // 显示和定位放置指示器
        if (closestItem === null) {
          // 追加到末尾
          if (items.length > 0) {
            const lastItem = items[items.length - 1];
            const rect = lastItem.getBoundingClientRect();
            dropIndicator.style.top = `${rect.bottom - previewListRect.top + scrollTop}px`;
          } else {
            dropIndicator.style.top = '0px';
          }
          
          // 将拖动项放在列表末尾
          if (draggedItem && draggedItem.parentNode === previewList) {
            previewList.appendChild(draggedItem);
          }
        } else {
          const rect = closestItem.getBoundingClientRect();
          const indicatorPos = beforeOrAfter === 'before' ? rect.top : rect.bottom;
          dropIndicator.style.top = `${indicatorPos - previewListRect.top + scrollTop}px`;
          
          // 重新定位DOM中的元素
          if (draggedItem && draggedItem.parentNode === previewList) {
            if (beforeOrAfter === 'before') {
              previewList.insertBefore(draggedItem, closestItem);
            } else {
              previewList.insertBefore(draggedItem, closestItem.nextSibling);
            }
          }
        }
        
        dropIndicator.style.display = 'block';
      }
      
      // 处理拖动结束事件
      function handleDragEnd() {
        if (!draggedItem) return;
        
        // 移除幽灵元素
        const ghost = document.getElementById('dragGhost');
        if (ghost) {
          document.body.removeChild(ghost);
        }
        
        // 重置样式和状态
        draggedItem.classList.remove('dragging');
        draggedItem.style.opacity = '';
        draggedItem.style.cursor = '';
        draggedItem = null;
        
        // 隐藏放置指示器
        dropIndicator.style.display = 'none';
        
        // 更新文件队列顺序以匹配DOM顺序
        updateFileQueueOrder();
      }
    }
    
    // 更新文件队列顺序以匹配 DOM 顺序
    function updateFileQueueOrder() {
      const items = document.querySelectorAll('.preview-item');
      const newQueue = [];
      
      items.forEach(item => {
        const fileId = item.getAttribute('data-file-id');
        const fileObj = fileQueue.find(f => f.id === fileId);
        if (fileObj) {
          newQueue.push(fileObj);
        }
      });
      
      fileQueue = newQueue;
    }
    
    // 存储函数引用供外部使用
    window.updatePreviewFunc = updatePreview;
  }

  // 确保单选按钮正常工作 - 修改这部分代码
  const radioButtons = document.querySelectorAll('.radio-item input[type="radio"]');
  
  // 只有当页面上存在单选按钮时才执行下面的代码
  if (radioButtons && radioButtons.length > 0) {
    radioButtons.forEach(radio => {
      radio.addEventListener('change', function() {
        const name = this.name;
        document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
          const parent = r.closest('.radio-item');
          if (parent) { // 确保父元素存在
            if (r.checked) {
              parent.classList.add('active');
            } else {
              parent.classList.remove('active');
            }
          }
        });
      });
      
      // 初始化状态 - 确保页面加载时正确设置选中项
      if (radio.checked) {
        const parent = radio.closest('.radio-item');
        if (parent) { // 确保父元素存在
          parent.classList.add('active');
          // 触发一次 change 事件，确保样式应用
          radio.dispatchEvent(new Event('change'));
        }
      }
    });
  }

  // Ctrl+V粘贴上传功能 - 修改为默认使用WebP格式
  document.addEventListener('paste', async (e) => {
    // 检查是否在文本输入区域
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return; // 不处理输入框内的粘贴
    }
    
    const items = e.clipboardData.items;
    let imageFile = null;
    
    // 查找剪贴板中的图片数据
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        imageFile = items[i].getAsFile();
        break;
      }
    }
    
    if (!imageFile) {
      return; // 没有找到图片数据
    }
    
    showToast('正在上传粘贴的图片...');
    
    // 创建FormData对象准备上传
    const formData = new FormData();
    
    // 默认使用本地存储
    let selectedStorage = 'local';
    formData.append('storage', selectedStorage);
    
    // 对于粘贴上传，默认转为WebP
    let selectedFormat = 'webp'; // 修改这里，强制使用WebP格式
    
    formData.append('storage', selectedStorage);
    formData.append('format', selectedFormat);
    formData.append('images', imageFile);
    
    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();

      if (result.success) {
        showToast('粘贴的图片上传成功（已转为WebP格式）');

        // 如果配置为不显示历史图片,将本次上传的图片信息存储到sessionStorage
        try {
          const settingsRes = await fetch('/api/settings');
          const settingsResult = await settingsRes.json();
          const showRecentUploads = settingsResult.success && settingsResult.displaySettings
            ? settingsResult.displaySettings.showRecentUploads
            : true;

          if (!showRecentUploads && result.images) {
            // 获取现有的sessionStorage中的图片(如果有)
            let existingImages = [];
            const existingStr = sessionStorage.getItem('recentUploadedImages');
            if (existingStr) {
              try {
                existingImages = JSON.parse(existingStr);
              } catch (e) {
                existingImages = [];
              }
            }

            // 粘贴上传是单张图片,不需要反转
            // 将新上传的图片添加到开头
            const updatedImages = [...result.images, ...existingImages];
            sessionStorage.setItem('recentUploadedImages', JSON.stringify(updatedImages));
          }
        } catch (error) {
          console.error('处理上传后的图片存储失败:', error);
        }

        loadGallery(); // 刷新图片库
      } else {
        showToast(`上传失败: ${result.error}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('上传过程中发生错误', 'error');
    }
  });

  // 表单提交和改进的反馈
  if (uploadForm) {
    uploadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitUploadForm();
    });
    
    // 改进上传按钮样式，使其更显眼
    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) {
      uploadBtn.classList.add('btn-pulsate');
    }
  }
  
  // 修改 submitUploadForm 函数，删除远程存储相关代码
  async function submitUploadForm() {
    const uploadBtn = document.getElementById('uploadBtn');
    
    if (!fileQueue.length) {
      showToast('请先选择图片', 'error');
      return;
    }
    
    // 使用FormData对象准备上传数据
    const formData = new FormData();
    
    // 仅使用本地存储
    formData.append('storage', 'local');
    
    // 手动获取图片格式
    const formatRadios = document.getElementsByName('format');
    let selectedFormat = 'original';  // 默认值
    for (const radio of formatRadios) {
      if (radio.checked) {
        selectedFormat = radio.value;
        break;
      }
    }
    formData.append('format', selectedFormat);
    
    // 按照队列顺序从后往前添加文件（保持显示顺序与本地一致）
    for (let i = fileQueue.length - 1; i >= 0; i--) {
      formData.append('images', fileQueue[i].file);
    }
    
    // 显示加载状态和进度条
    uploadBtn.disabled = true;

    // 创建进度条容器
    const progressContainer = document.createElement('div');
    progressContainer.id = 'uploadProgressContainer';
    progressContainer.style.cssText = 'margin-top: 15px; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);';
    progressContainer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
          <line x1="12" y1="2" x2="12" y2="6"></line>
          <line x1="12" y1="18" x2="12" y2="22"></line>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
          <line x1="2" y1="12" x2="6" y2="12"></line>
          <line x1="18" y1="12" x2="22" y2="12"></line>
          <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
          <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
        </svg>
        <span id="uploadProgressText" style="color: #ffffff; font-weight: 500; font-size: 14px;">正在上传 ${fileQueue.length} 张图片... 0%</span>
      </div>
      <div style="width: 100%; height: 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; overflow: hidden;">
        <div id="uploadProgressBar" style="width: 0%; height: 100%; background: #ffffff; border-radius: 4px; transition: width 0.2s ease; box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);"></div>
      </div>
      <div id="uploadProgressDetail" style="color: rgba(255, 255, 255, 0.8); font-size: 12px; margin-top: 8px; text-align: center;">准备上传...</div>
    `;
    // 插入到表单后面，更明显的位置
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
      uploadForm.parentElement.insertBefore(progressContainer, uploadForm.nextSibling);
    } else {
      uploadBtn.parentElement.insertBefore(progressContainer, uploadBtn.nextSibling);
    }

    uploadBtn.innerHTML = `正在准备上传...`;

    try {
      // 使用XMLHttpRequest以支持上传进度
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        // 监听上传进度
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            const progressBar = document.getElementById('uploadProgressBar');
            const progressText = document.getElementById('uploadProgressText');
            const progressDetail = document.getElementById('uploadProgressDetail');

            if (progressBar) {
              progressBar.style.width = percentComplete + '%';
            }
            if (progressText) {
              progressText.textContent = `正在上传 ${fileQueue.length} 张图片... ${percentComplete}%`;
            }
            if (progressDetail) {
              const loaded = (e.loaded / 1024 / 1024).toFixed(2);
              const total = (e.total / 1024 / 1024).toFixed(2);
              progressDetail.textContent = `已上传 ${loaded} MB / ${total} MB`;
            }
          }
        });

        // 监听上传完成
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch (e) {
              reject(new Error('解析响应失败'));
            }
          } else {
            reject(new Error(`上传失败: ${xhr.status}`));
          }
        });

        // 监听错误
        xhr.addEventListener('error', () => reject(new Error('网络错误')));
        xhr.addEventListener('abort', () => reject(new Error('上传已取消')));

        // 发送请求
        xhr.open('POST', '/upload');
        xhr.send(formData);
      });

      if (result.success) {
        showToast(`成功上传 ${fileQueue.length} 张图片`);
        fileInput.value = ''; // 仅清空文件输入，保留其他选项
        fileQueue = []; // 清空文件队列
        updatePreview();

        // 如果配置为不显示历史图片,将本次上传的图片信息存储到sessionStorage
        try {
          const settingsRes = await fetch('/api/settings');
          const settingsResult = await settingsRes.json();
          const showRecentUploads = settingsResult.success && settingsResult.displaySettings
            ? settingsResult.displaySettings.showRecentUploads
            : true;

          if (!showRecentUploads && result.images) {
            // 获取现有的sessionStorage中的图片(如果有)
            let existingImages = [];
            const existingStr = sessionStorage.getItem('recentUploadedImages');
            if (existingStr) {
              try {
                existingImages = JSON.parse(existingStr);
              } catch (e) {
                existingImages = [];
              }
            }

            // 反转服务器返回的图片数组,使其与用户上传的顺序一致
            // 因为前端是从后往前添加文件到FormData,服务器返回的顺序需要反转
            const reversedImages = [...result.images].reverse();

            // 将新上传的图片添加到开头
            const updatedImages = [...reversedImages, ...existingImages];
            sessionStorage.setItem('recentUploadedImages', JSON.stringify(updatedImages));
          }
        } catch (error) {
          console.error('处理上传后的图片存储失败:', error);
        }

        loadGallery(); // 刷新图片库
      } else {
        showToast(`上传失败: ${result.error}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('上传过程中发生错误', 'error');
    } finally {
      // 清除进度条
      const progressContainer = document.getElementById('uploadProgressContainer');
      if (progressContainer) {
        progressContainer.remove();
      }

      // 重置按钮状态
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '上传图片';
    }
  }

  // 首页最近图片显示数量选择
  const recentImagesLimit = document.getElementById('recentImagesLimit');
  if (recentImagesLimit) {
    // 从本地存储恢复设置
    const savedLimit = localStorage.getItem('recentImagesLimit') || '30';
    recentImagesLimit.value = savedLimit;
    
    recentImagesLimit.addEventListener('change', () => {
      const limit = recentImagesLimit.value;
      localStorage.setItem('recentImagesLimit', limit);
      loadGallery();
    });
  }

  // 图片库视图切换
  const gallery = document.getElementById('gallery');
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');

  if (gallery && gridViewBtn && listViewBtn) {
    // 使用本地存储记住视图偏好
    const savedView = localStorage.getItem('galleryView') || 'grid';
    
    // 保存当前的class列表，包括可能的gallery-mosaic类
    const currentClasses = Array.from(gallery.classList);
    const hasMosaic = currentClasses.includes('gallery-mosaic');
    
    if (savedView === 'grid') {
      gallery.className = 'gallery-grid';
      gridViewBtn.classList.add('btn-primary');
      gridViewBtn.classList.remove('btn-secondary');
      listViewBtn.classList.remove('btn-primary');
      listViewBtn.classList.add('btn-secondary');
    } else {
      gallery.className = 'gallery-list';
      listViewBtn.classList.add('btn-primary');
      listViewBtn.classList.remove('btn-secondary');
      gridViewBtn.classList.remove('btn-primary');
      gridViewBtn.classList.add('btn-secondary');
    }
    
    // 恢复马赛克状态
    if (hasMosaic) {
      gallery.classList.add('gallery-mosaic');
    }
    
    gridViewBtn.addEventListener('click', () => {
      // 保存当前的马赛克状态
      const hasMosaic = gallery.classList.contains('gallery-mosaic');
      
      // 更新视图类型
      gallery.className = 'gallery-grid';
      
      // 如果之前是马赛克状态，重新添加马赛克类
      if (hasMosaic) {
        gallery.classList.add('gallery-mosaic');
      }
      
      localStorage.setItem('galleryView', 'grid');
      gridViewBtn.classList.add('btn-primary');
      gridViewBtn.classList.remove('btn-secondary');
      listViewBtn.classList.remove('btn-primary');
      listViewBtn.classList.add('btn-secondary');
      loadGallery();
    });
    
    listViewBtn.addEventListener('click', () => {
      // 保存当前的马赛克状态
      const hasMosaic = gallery.classList.contains('gallery-mosaic');
      
      // 更新视图类型
      gallery.className = 'gallery-list';
      
      // 如果之前是马赛克状态，重新添加马赛克类
      if (hasMosaic) {
        gallery.classList.add('gallery-mosaic');
      }
      
      localStorage.setItem('galleryView', 'list');
      listViewBtn.classList.add('btn-primary');
      listViewBtn.classList.remove('btn-secondary');
      gridViewBtn.classList.remove('btn-primary');
      gridViewBtn.classList.add('btn-secondary');
      loadGallery();
    });
    
    // 添加显示/隐藏图片功能
    const toggleGalleryBtn = document.getElementById('toggleGalleryBtn');
    if (toggleGalleryBtn) {
      // 从本地存储恢复显示偏好
      const galleryVisible = localStorage.getItem('galleryVisible') !== 'false'; // 默认显示
      
      // 设置初始状态
      if (!galleryVisible) {
        gallery.classList.add('gallery-mosaic');
        toggleGalleryBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        `;
        toggleGalleryBtn.title = "显示图片";
      } else {
        toggleGalleryBtn.title = "隐藏图片";
      }
      
      // 添加点击事件
      toggleGalleryBtn.addEventListener('click', () => {
        const isMosaic = gallery.classList.contains('gallery-mosaic');
        
        if (!isMosaic) {
          gallery.classList.add('gallery-mosaic');
          toggleGalleryBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          `;
          toggleGalleryBtn.title = "显示图片";
          localStorage.setItem('galleryVisible', 'false');
        } else {
          gallery.classList.remove('gallery-mosaic');
          toggleGalleryBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          `;
          toggleGalleryBtn.title = "隐藏图片";
          localStorage.setItem('galleryVisible', 'true');
        }
      });
    }
  }

  // 图片库管理的全局变量
  let galleryImages = [];
  let currentImageIndex = -1;
  let selectedIndices = [];
  let lastSelectedIndex = null;

  // 用于缓存已加载图片的对象
  const imageCache = {};

  // 标记是否是页面首次加载
  let isFirstLoad = true;

  // 懒加载管理变量，防止竞态条件
  let lazyLoadRetryTimer = null;
  let lazyLoadObserver = null;

  // 点击空白区域取消选择的事件监听器 - 移到这里优先执行
  document.addEventListener('click', (e) => {
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu && contextMenu.style.display === 'block') {
      contextMenu.style.display = 'none';
    }
    
    // 检查点击的是否为空白区域（不是图片项或上下文菜单）
    if (!e.target.closest('.gallery-item') && !e.target.closest('.context-menu')) {
      clearAllSelections();
    }
  });

  // 增强的图片库功能
  async function loadGallery() {
    // 清理旧的懒加载状态
    cleanupLazyLoading();

    // 显示加载状态
    if (gallery) {
      gallery.innerHTML = `
        <div class="loading-container">
          <div class="loading-spinner">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
              <line x1="12" y1="2" x2="12" y2="6"></line>
              <line x1="12" y1="18" x2="12" y2="22"></line>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
              <line x1="2" y1="12" x2="6" y2="12"></line>
              <line x1="18" y1="12" x2="22" y2="12"></line>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
              <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
            </svg>
          </div>
          <p>正在加载图片...</p>
        </div>
      `;
    }

    try {
      // 首先获取显示设置
      const settingsRes = await fetch('/api/settings');
      const settingsResult = await settingsRes.json();
      const showRecentUploads = settingsResult.success && settingsResult.displaySettings
        ? settingsResult.displaySettings.showRecentUploads
        : true; // 默认显示历史图片

      let imagesToDisplay = [];

      if (showRecentUploads) {
        // 显示历史图片:从后端API获取
        let limit = 30; // 默认值
        const recentImagesLimit = document.getElementById('recentImagesLimit');
        if (recentImagesLimit) {
          limit = parseInt(recentImagesLimit.value);
        }

        const res = await fetch(`/images?limit=${limit}`);
        const result = await res.json();

        if (result.success) {
          imagesToDisplay = result.images;
        } else {
          showToast('获取图片列表失败', 'error');
          imagesToDisplay = [];
        }
      } else {
        // 不显示历史图片:只显示本次上传的图片(从sessionStorage读取)
        if (isFirstLoad) {
          // 首次加载:清空sessionStorage,确保不显示历史图片
          sessionStorage.removeItem('recentUploadedImages');
          imagesToDisplay = [];
        } else {
          // 后续加载(上传后刷新):读取并显示本次上传的图片
          const recentUploadedStr = sessionStorage.getItem('recentUploadedImages');
          if (recentUploadedStr) {
            try {
              imagesToDisplay = JSON.parse(recentUploadedStr);
            } catch (e) {
              console.error('解析sessionStorage中的图片数据失败:', e);
              imagesToDisplay = [];
            }
          } else {
            imagesToDisplay = [];
          }
        }
      }

      // 标记首次加载已完成
      isFirstLoad = false;

      galleryImages = imagesToDisplay;

      // 获取并应用存储的展示状态（在渲染前获取）
      const galleryVisible = localStorage.getItem('galleryVisible') !== 'false'; // 默认显示

      renderGallery(imagesToDisplay);

      // 如果设置为隐藏，应用马赛克效果
      if (!galleryVisible && gallery) {
        gallery.classList.add('gallery-mosaic');
      }

      if (imagesToDisplay.length === 0 && gallery) {
        if (showRecentUploads) {
          gallery.innerHTML = '<div class="empty-gallery">暂无图片，请先上传</div>';
        } else {
          gallery.innerHTML = '<div class="empty-gallery">本次会话暂无上传图片</div>';
        }
      }
    } catch (err) {
      console.error(err);
      showToast('获取图片列表时发生错误', 'error');
      if (gallery) {
        gallery.innerHTML = '<div class="error-message">加载图片失败，请刷新页面重试</div>';
      }
    }
  }

  // 选择状态的辅助函数
  function clearAllSelections() {
    selectedIndices = [];
    const items = document.querySelectorAll('.gallery-item');
    items.forEach(item => item.classList.remove('selected'));
  }

  function selectItem(index) {
    selectedIndices.push(index);
    const items = document.querySelectorAll('.gallery-item');
    if (items[index]) {
      items[index].classList.add('selected');
    }
  }

  function toggleSelection(index) {
    const items = document.querySelectorAll('.gallery-item');
    if (selectedIndices.includes(index)) {
      selectedIndices = selectedIndices.filter(i => i !== index);
      if (items[index]) items[index].classList.remove('selected');
    } else {
      selectedIndices.push(index);
      if (items[index]) items[index].classList.add('selected');
    }
  }

  // 渲染图片库并增强UI
  function renderGallery(images) {
    if (!gallery) return;
    
    // 保存当前的class列表，包括可能的gallery-mosaic类
    const currentClasses = Array.from(gallery.classList);
    const hasMosaic = currentClasses.includes('gallery-mosaic');
    
    gallery.innerHTML = '';
    
    // 判断当前视图类型
    const savedView = localStorage.getItem('galleryView') || 'grid';
    const isGridView = savedView === 'grid';
    
    // 重新设置基本类名
    gallery.className = isGridView ? 'gallery-grid' : 'gallery-list';
    
    // 如果之前有马赛克类，重新添加
    if (hasMosaic || localStorage.getItem('galleryVisible') === 'false') {
      gallery.classList.add('gallery-mosaic');
    }
    
    images.forEach((img, index) => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.dataset.index = index;
      
      if (isGridView) {
        item.classList.add('gallery-item-grid');
        
        // 优化：使用空白图片占位，然后懒加载，添加手机端复制按钮
        item.innerHTML = `
          <div class="gallery-img-container">
            <div class="loading-placeholder"></div>
            <img class="gallery-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" 
                 data-src="${img.url}" alt="${img.filename}" loading="lazy" />
            <div class="filename">${img.filename}</div>
            <!-- 手机端复制按钮 -->
            <button class="mobile-copy-btn" data-index="${index}" title="复制链接">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        `;
      } else {
        item.classList.add('gallery-item-list');
        
        // 优化：使用空白图片占位，然后懒加载，添加手机端复制按钮
        item.innerHTML = `
          <div class="gallery-img-container">
            <div class="loading-placeholder"></div>
            <img class="gallery-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" 
                 data-src="${img.url}" alt="${img.filename}" loading="lazy" />
            <!-- 手机端复制按钮 -->
            <button class="mobile-copy-btn" data-index="${index}" title="复制链接">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <div class="gallery-details">
            <div class="filename">${img.filename}</div>
            <div class="file-info">
              ${formatBytes(img.fileSize)} · ${img.format} · ${img.storage === 'local' ? '本地存储' : '远程存储'}
            </div>
            <div class="file-time">${img.uploadTime}</div>
          </div>
        `;
      }
      
      // 左键点击处理
      item.addEventListener('click', (e) => {
        if (e.button !== 0) return; // 仅处理左键点击
        
        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd + 点击：切换选中状态
          toggleSelection(index);
          lastSelectedIndex = index;
        } else if (e.shiftKey) {
          // Shift + 点击：选择连续范围
          if (lastSelectedIndex === null) lastSelectedIndex = index;
          clearAllSelections();
          const start = Math.min(lastSelectedIndex, index);
          const end = Math.max(lastSelectedIndex, index);
          for (let i = start; i <= end; i++) {
            selectItem(i);
          }
        } else {
          // 普通点击：清除其他选择并打开图片
          clearAllSelections();
          selectItem(index);
          lastSelectedIndex = index;
          currentImageIndex = index;
          
          // 简化体验：在模态框中仅显示图片
          showImageModal(img);
        }
      });
      
      // 手机端复制按钮点击事件
      const mobileCopyBtn = item.querySelector('.mobile-copy-btn');
      if (mobileCopyBtn) {
        mobileCopyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // 显示手机端复制菜单
          showMobileCopyMenu(e, img, index);
        });
      }
      
      // 右键点击处理：显示上下文菜单
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        let selectedItems = [];
        if (selectedIndices.length > 0 && selectedIndices.includes(index)) {
          // 如果点击已选中的项目，使用所有选中的项目
          selectedItems = selectedIndices.map(i => galleryImages[i]);
        } else {
          // 否则，清除选择并只选择此项目
          clearAllSelections();
          selectItem(index);
          selectedItems = [img];
        }
        
        currentImageIndex = index;
        showContextMenu(e, selectedItems);
      });
      
      gallery.appendChild(item);
    });

    // 清理旧的懒加载状态，防止竞态条件
    cleanupLazyLoading();

    // 使用改进的方式初始化懒加载,添加重试机制
    initLazyLoadingWithRetry();
  }

  // 清理懒加载相关资源
  function cleanupLazyLoading() {
    // 清除重试计时器
    if (lazyLoadRetryTimer) {
      clearTimeout(lazyLoadRetryTimer);
      lazyLoadRetryTimer = null;
    }

    // 断开并清除旧的观察器
    if (lazyLoadObserver) {
      lazyLoadObserver.disconnect();
      lazyLoadObserver = null;
    }
  }

  // 实现图片懒加载(带重试机制)
  function initLazyLoadingWithRetry(retryCount = 0, maxRetries = 3) {
    // 先清除之前的计时器
    if (lazyLoadRetryTimer) {
      clearTimeout(lazyLoadRetryTimer);
      lazyLoadRetryTimer = null;
    }

    const lazyImages = document.querySelectorAll('.gallery-img[data-src]');

    if (lazyImages.length === 0) {
      // 如果没有找到图片且还有重试次数,则延迟后重试
      if (retryCount < maxRetries) {
        lazyLoadRetryTimer = setTimeout(() => {
          initLazyLoadingWithRetry(retryCount + 1, maxRetries);
        }, 50);
      }
      return;
    }

    // 找到图片后,立即初始化懒加载
    initLazyLoading(lazyImages);
  }

  // 实现图片懒加载
  function initLazyLoading(lazyImages) {
    if (!lazyImages || lazyImages.length === 0) {
      return;
    }

    // 先断开旧的观察器
    if (lazyLoadObserver) {
      lazyLoadObserver.disconnect();
      lazyLoadObserver = null;
    }

    if ('IntersectionObserver' in window) {
      // 创建新的观察器并保存到全局变量
      lazyLoadObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.getAttribute('data-src');

            if (!src) {
              observer.unobserve(img);
              return;
            }

            img.onload = function() {
              // 图片加载完成后移除占位符
              const container = img.closest('.gallery-img-container');
              const placeholder = container ? container.querySelector('.loading-placeholder') : null;
              if (placeholder) {
                placeholder.style.display = 'none';
              }

              // 移除占位符类
              img.classList.add('loaded');
            };

            img.onerror = function() {
              console.error('图片加载失败:', src);
              const container = img.closest('.gallery-img-container');
              const placeholder = container ? container.querySelector('.loading-placeholder') : null;
              if (placeholder) {
                placeholder.style.display = 'none';
              }
              img.classList.add('error');
            };

            img.setAttribute('src', src);
            img.removeAttribute('data-src');
            observer.unobserve(img);
          }
        });
      }, {
        rootMargin: '50px',
        threshold: 0.01
      });

      lazyImages.forEach(img => {
        lazyLoadObserver.observe(img);
      });
    } else {
      // 降级处理：如果不支持 IntersectionObserver，直接加载所有图片
      lazyImages.forEach(img => {
        const src = img.getAttribute('data-src');
        if (src) {
          img.setAttribute('src', src);
          img.removeAttribute('data-src');
        }
      });
    }
  }

  // 增强的上下文菜单
  function createContextMenu() {
    let menuDiv = document.getElementById('contextMenu');
    
    if (!menuDiv) {
      menuDiv = document.createElement('div');
      menuDiv.id = 'contextMenu';
      menuDiv.className = 'context-menu';
      document.body.appendChild(menuDiv);
    }
    
    return menuDiv;
  }

  function showContextMenu(event, imagesSelected) {
    const menu = createContextMenu();
    
    menu.style.top = `${event.pageY}px`;
    menu.style.left = `${event.pageX}px`;
    menu.style.display = 'block';
    
    const hasMultiple = imagesSelected.length > 1;
    
    menu.innerHTML = `
      <div class="context-menu-item" id="copyUrl">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        复制${hasMultiple ? '所有' : ''}图片链接
      </div>
      <div class="context-menu-item" id="copyHTML">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
        复制 HTML 代码
      </div>
      <div class="context-menu-item" id="copyMarkdown">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
        </svg>
        复制 Markdown 代码
      </div>
      <div class="context-menu-item" id="copyForum">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
        复制论坛格式
      </div>
      <div class="context-menu-item" id="openInTab">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        在新标签页打开
      </div>
    `;
    
    // 修复复制功能
    document.getElementById('copyUrl').addEventListener('click', () => {
      const text = imagesSelected.map(img => img.url).join('\n');
      copyToClipboard(text, hasMultiple ? '所有图片链接已复制' : '图片链接已复制');
      menu.style.display = 'none';
    });
    
    document.getElementById('copyHTML').addEventListener('click', () => {
      const text = imagesSelected.map(img => `<img src="${img.url}" alt="${img.filename}" />`).join('\n');
      copyToClipboard(text, 'HTML代码已复制');
      menu.style.display = 'none';
    });
    
    document.getElementById('copyMarkdown').addEventListener('click', () => {
      const text = imagesSelected.map(img => `![${img.filename}](${img.url})`).join('\n');
      copyToClipboard(text, 'Markdown代码已复制');
      menu.style.display = 'none';
    });
    
    document.getElementById('copyForum').addEventListener('click', () => {
      const text = imagesSelected.map(img => `[img]${img.url}[/img]`).join('\n');
      copyToClipboard(text, '论坛格式代码已复制');
      menu.style.display = 'none';
    });
    
    // 新增：在新标签页打开图片
    document.getElementById('openInTab').addEventListener('click', () => {
      if (imagesSelected.length > 0) {
        // 只打开第一张选中的图片
        window.open(imagesSelected[0].url, '_blank');
      }
      menu.style.display = 'none';
    });
  }

  // 增强的剪贴板操作函数
  function copyToClipboard(text, successMessage) {
    if (!text) {
      showToast('没有可复制的内容', 'error');
      return;
    }
    
    // 使用现代剪贴板API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast(successMessage))
        .catch((err) => {
          console.error('复制失败:', err);
          fallbackCopy(text, successMessage);
        });
    } else {
      // 兼容性处理，使用备用方法
      fallbackCopy(text, successMessage);
    }
  }
  
  // 备用复制方法
  function fallbackCopy(text, successMessage) {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      if (successful) {
        showToast(successMessage);
      } else {
        showToast('复制失败，请手动复制', 'error');
      }
      
      document.body.removeChild(textArea);
    } catch (err) {
      console.error('备用复制方法失败:', err);
      showToast('复制失败，请手动复制', 'error');
    }
  }

  // 手机端复制菜单
  function showMobileCopyMenu(event, img, index) {
    // 移除已存在的手机端菜单
    const existingMenu = document.getElementById('mobileCopyMenu');
    if (existingMenu) {
      existingMenu.remove();
    }
    
    // 创建手机端复制菜单
    const menu = document.createElement('div');
    menu.id = 'mobileCopyMenu';
    menu.className = 'mobile-copy-menu';
    
    menu.innerHTML = `
      <div class="mobile-copy-menu-backdrop"></div>
      <div class="mobile-copy-menu-content">
        <div class="mobile-copy-menu-header">
          <div class="mobile-copy-menu-title">复制图片链接</div>
          <button class="mobile-copy-menu-close">&times;</button>
        </div>
        <div class="mobile-copy-menu-body">
          <div class="mobile-copy-menu-item" data-action="copyUrl">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>复制图片链接</span>
          </div>
          <div class="mobile-copy-menu-item" data-action="copyHTML">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <span>复制 HTML 代码</span>
          </div>
          <div class="mobile-copy-menu-item" data-action="copyMarkdown">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
            </svg>
            <span>复制 Markdown 代码</span>
          </div>
          <div class="mobile-copy-menu-item" data-action="copyForum">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <span>复制论坛格式</span>
          </div>
          <div class="mobile-copy-menu-item" data-action="openInTab">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            <span>在新标签页打开</span>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(menu);
    
    // 添加事件监听器
    const closeBtn = menu.querySelector('.mobile-copy-menu-close');
    const backdrop = menu.querySelector('.mobile-copy-menu-backdrop');
    const menuItems = menu.querySelectorAll('.mobile-copy-menu-item');
    
    // 关闭菜单函数
    const closeMenu = () => {
      menu.classList.add('closing');
      setTimeout(() => {
        menu.remove();
      }, 300);
    };
    
    // 关闭按钮和背景点击事件
    closeBtn.addEventListener('click', closeMenu);
    backdrop.addEventListener('click', closeMenu);
    
    // 菜单项点击事件
    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        
        switch (action) {
          case 'copyUrl':
            copyToClipboard(img.url, '图片链接已复制');
            break;
          case 'copyHTML':
            copyToClipboard(`<img src="${img.url}" alt="${img.filename}" />`, 'HTML代码已复制');
            break;
          case 'copyMarkdown':
            copyToClipboard(`![${img.filename}](${img.url})`, 'Markdown代码已复制');
            break;
          case 'copyForum':
            copyToClipboard(`[img]${img.url}[/img]`, '论坛格式代码已复制');
            break;
          case 'openInTab':
            window.open(img.url, '_blank');
            showToast('已在新标签页打开图片');
            break;
        }
        
        closeMenu();
      });
    });
    
    // 显示菜单动画
    requestAnimationFrame(() => {
      menu.classList.add('show');
    });
  }

  // 优化的图片模态框，只显示图片和导航，性能优化
  function showImageModal(img) {
    // 重用现有模态框或创建一个新的
    if (!imageModal) {
      imageModal = document.createElement('div');
      imageModal.id = 'imageModal';
      imageModal.className = 'modal-backdrop';
      document.body.appendChild(imageModal);
      
      // 点击外部关闭
      imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal) {
          closeModal();
        }
      });
    }
    
    // 先隐藏模态框，等尺寸计算完成后再显示
    imageModal.classList.remove('show');
    
    // 创建临时图片对象预加载并计算尺寸
    const tempImg = new Image();
    
    tempImg.onload = () => {
      // 获取图片尺寸
      const imgWidth = tempImg.width;
      const imgHeight = tempImg.height;
      
      // 计算最佳容器尺寸
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const imgRatio = imgWidth / imgHeight;
      const maxModalWidth = viewportWidth * 0.9;
      const maxModalHeight = viewportHeight * 0.85;
      
      let containerWidth, containerHeight;
      
      if (imgRatio > 1) {
        // 横向图片
        containerWidth = Math.min(maxModalWidth, imgWidth);
        containerHeight = containerWidth / imgRatio;
        
        if (containerHeight > maxModalHeight) {
          containerHeight = maxModalHeight;
          containerWidth = containerHeight * imgRatio;
        }
      } else {
        // 竖向图片
        containerHeight = Math.min(maxModalHeight, imgHeight);
        containerWidth = containerHeight * imgRatio;
        
        if (containerWidth > maxModalWidth) {
          containerWidth = maxModalWidth;
          containerHeight = containerWidth / imgRatio;
        }
      }
      
      // 设置最小宽度
      containerWidth = Math.max(containerWidth, 300);
      
      // 现在创建模态框内容，并应用计算好的尺寸
      imageModal.innerHTML = `
        <div class="modal-container modal-image-only" style="width: ${Math.round(containerWidth)}px; max-width: ${Math.round(containerWidth)}px;">
          <div class="modal-header">
            <div class="modal-title">${img.filename}</div>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="image-info">
              <span class="image-size">${formatBytes(img.fileSize)}</span>
              <span class="image-time">${img.uploadTime}</span>
            </div>
            <div class="image-preview">
              <div class="image-loading">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
                  <line x1="12" y1="2" x2="12" y2="6"></line>
                  <line x1="12" y1="18" x2="12" y2="22"></line>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                  <line x1="2" y1="12" x2="6" y2="12"></line>
                  <line x1="18" y1="12" x2="22" y2="12"></line>
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
              </div>
              <img src="${img.url}" alt="${img.filename}" class="modal-image" loading="lazy" decoding="async" style="display: none;">
            </div>
          </div>
          <div class="modal-navigation">
            <button class="nav-prev" title="上一张">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button class="nav-next" title="下一张">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>
      `;
      
      // 现在显示模态框
      imageModal.classList.add('show');
      
      // 添加事件监听器
      const closeBtn = imageModal.querySelector('.modal-close');
      const prevBtn = imageModal.querySelector('.nav-prev');
      const nextBtn = imageModal.querySelector('.nav-next');
      
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (prevBtn) prevBtn.addEventListener('click', navigatePrev);
      if (nextBtn) nextBtn.addEventListener('click', navigateNext);
      
      // 优化键盘导航
      if (keyNavigationListener) {
        document.removeEventListener('keydown', keyNavigationListener);
      }
      
      keyNavigationListener = (e) => {
        if (e.key === 'Escape') {
          closeModal();
        } else if (e.key === 'ArrowLeft') {
          navigatePrev();
        } else if (e.key === 'ArrowRight') {
          navigateNext();
        }
      };
      
      document.addEventListener('keydown', keyNavigationListener);
      
      const modalContainer = imageModal.querySelector('.modal-container');
      const modalImg = imageModal.querySelector('.modal-image');
      const loadingElement = imageModal.querySelector('.image-loading');
      
      // 存储当前图片信息，用于窗口大小变化时重新计算
      let currentImgWidth = imgWidth;
      let currentImgHeight = imgHeight;
      
      // 窗口大小变化时重新调整图片尺寸
      const resizeHandler = () => {
        if (currentImgWidth && currentImgHeight) {
          adjustImageSize(currentImgWidth, currentImgHeight);
        }
      };
      
      // 添加窗口大小变化监听
      window.addEventListener('resize', resizeHandler);
      
      // 调整图片尺寸的函数
      const adjustImageSize = (imgWidth, imgHeight) => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // 计算图片比例
        const imgRatio = imgWidth / imgHeight;
        
        // 计算最佳显示尺寸
        const maxModalWidth = viewportWidth * 0.9;
        const maxModalHeight = viewportHeight * 0.85;
        
        // 计算理想容器尺寸，保持图片比例
        let containerWidth, containerHeight;
        
        // 根据图片比例和视口大小计算最佳容器尺寸
        if (imgRatio > 1) {
          // 横向图片
          containerWidth = Math.min(maxModalWidth, imgWidth);
          containerHeight = containerWidth / imgRatio;
          
          if (containerHeight > maxModalHeight) {
            containerHeight = maxModalHeight;
            containerWidth = containerHeight * imgRatio;
          }
        } else {
          // 竖向图片
          containerHeight = Math.min(maxModalHeight, imgHeight);
          containerWidth = containerHeight * imgRatio;
          
          if (containerWidth > maxModalWidth) {
            containerWidth = maxModalWidth;
            containerHeight = containerWidth / imgRatio;
          }
        }
        
        // 设置最小宽度
        containerWidth = Math.max(containerWidth, 300);
        
        // 应用计算后的尺寸
        modalContainer.style.maxWidth = `${Math.round(containerWidth)}px`;
        modalContainer.style.width = `${Math.round(containerWidth)}px`;
      };
      
      // 显示图片
      modalImg.onload = () => {
        modalImg.style.display = 'block';
        loadingElement.style.display = 'none';
        imageCache[img.url] = true;
      };
      
      // 图片加载失败处理
      modalImg.onerror = () => {
        loadingElement.innerHTML = '<p>图片加载失败</p>';
      };
      
      // 在关闭模态框时移除窗口大小变化监听
      const originalCloseModal = closeModal;
      closeModal = function() {
        window.removeEventListener('resize', resizeHandler);
        originalCloseModal();
      };
      
      // 预加载相邻图片以实现更平滑的导航
      preloadAdjacentImages(currentImageIndex);
    };
    
    // 图片加载失败处理
    tempImg.onerror = () => {
      // 创建一个基本的模态框，显示加载失败信息
      imageModal.innerHTML = `
        <div class="modal-container modal-image-only">
          <div class="modal-header">
            <div class="modal-title">${img.filename}</div>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="image-preview">
              <p>图片加载失败</p>
            </div>
          </div>
        </div>
      `;
      
      imageModal.classList.add('show');
      
      const closeBtn = imageModal.querySelector('.modal-close');
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
    };
    
    // 开始加载图片
    tempImg.src = img.url;
  }

  function closeModal() {
    if (imageModal) {
      imageModal.classList.remove('show');
      
      // 移除键盘监听器
      if (keyNavigationListener) {
        document.removeEventListener('keydown', keyNavigationListener);
        keyNavigationListener = null;
      }
    }
  }

  // 预加载相邻图片函数
  function preloadAdjacentImages(index) {
    if (galleryImages.length <= 1) return;
    
    const prevIndex = (index - 1 + galleryImages.length) % galleryImages.length;
    const nextIndex = (index + 1) % galleryImages.length;
    
    // 预加载前一张和后一张
    preloadImage(galleryImages[prevIndex].url);
    preloadImage(galleryImages[nextIndex].url);
  }

  // 辅助函数，在后台预加载图片
  function preloadImage(url) {
    if (!imageCache[url]) {
      const img = new Image();
      img.onload = () => {
        imageCache[url] = true;
      };
      img.src = url;
    }
  }

  // 优化的导航函数
  function navigatePrev() {
    if (galleryImages.length <= 1) return;
    
    const prevIndex = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
    currentImageIndex = prevIndex;
    showImageModal(galleryImages[prevIndex]);
    
    // 预加载额外的前一张图片以实现更平滑的导航
    const preprevIndex = (prevIndex - 1 + galleryImages.length) % galleryImages.length;
    preloadImage(galleryImages[preprevIndex].url);
  }

  function navigateNext() {
    if (galleryImages.length <= 1) return;
    
    const nextIndex = (currentImageIndex + 1) % galleryImages.length;
    currentImageIndex = nextIndex;
    showImageModal(galleryImages[nextIndex]);
    
    // 预加载额外的下一张图片以实现更平滑的导航
    const nextnextIndex = (nextIndex + 1) % galleryImages.length;
    preloadImage(galleryImages[nextnextIndex].url);
  }

  // 格式化文件大小辅助函数
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // 页面加载时初始化图片库
  if (gallery) {
    loadGallery();
  }

  // 将renderGallery函数暴露为全局函数，供gallery.js使用
  window.renderGallery = renderGallery;
  window.showToast = showToast;
});