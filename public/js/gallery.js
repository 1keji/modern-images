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
                <div class="toast-title">${type === 'success' ? '成功' : type === 'info' ? '提示' : '错误'}</div>
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

    // 分页相关变量
    let currentPage = 1;
    let totalPages = 1;
    let imagesPerPage = parseInt(localStorage.getItem('galleryImagesPerPage')) || 50;
    let currentStorageFilter = ''; // 当前存储类型过滤器

    // 初始化全局图片数组
    window.galleryImages = [];

    // 加载状态锁，防止重复请求
    let isLoading = false;

    // 动图自动播放设置
    let animatedAutoplaySettings = { gif: true, webp: true, avif: true };

    // 懒加载管理变量，防止竞态条件
    let lazyLoadRetryTimer = null;
    let lazyLoadObserver = null;

    // DOM 元素引用
    const perPageSelect = document.getElementById('perPageLimit');
    const storageFilter = document.getElementById('storageFilter');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const prevPageBtnBottom = document.getElementById('prevPageBtnBottom');
    const nextPageBtnBottom = document.getElementById('nextPageBtnBottom');
    const pageInfo = document.getElementById('pageInfo');
    const paginationInfo = document.getElementById('paginationInfo');
    const gridViewBtn = document.getElementById('gridViewBtn');
    const listViewBtn = document.getElementById('listViewBtn');
    const deleteImagesBtn = document.getElementById('deleteImagesBtn');
    const deleteImagesBtnBottom = document.getElementById('deleteImagesBtnBottom');
  
  // 设置初始视图状态
  const gallery = document.getElementById('gallery');
  if (gridViewBtn && listViewBtn && gallery) {
    // 从 localStorage 获取用户偏好的视图类型
    const savedView = localStorage.getItem('galleryView') || 'grid';
    
    // 保存当前的class列表，包括可能的gallery-mosaic类
    const currentClasses = Array.from(gallery.classList);
    const hasMosaic = currentClasses.includes('gallery-mosaic');
    
    if (savedView === 'grid') {
      gallery.className = 'gallery-grid';
      gridViewBtn.classList.add('active');
    } else {
      gallery.className = 'gallery-list';
      listViewBtn.classList.add('active');
    }
    
    // 恢复马赛克状态
    if (hasMosaic) {
      gallery.classList.add('gallery-mosaic');
    }
    
    // 添加视图切换事件监听
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
      gridViewBtn.classList.add('active');
      listViewBtn.classList.remove('active');
      loadGalleryPaged();
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
      listViewBtn.classList.add('active');
      gridViewBtn.classList.remove('active');
      loadGalleryPaged();
    });
  }
  
  // 设置每页图片数量的下拉选择框
  if (perPageSelect) {
    // 设置初始选定值
    perPageSelect.value = imagesPerPage;
    
    // 监听变更事件
    perPageSelect.addEventListener('change', () => {
      imagesPerPage = parseInt(perPageSelect.value);
      localStorage.setItem('galleryImagesPerPage', imagesPerPage);
      currentPage = 1; // 重置为第一页
      loadGalleryPaged();
    });
  }

  // 设置存储类型过滤器
  if (storageFilter) {
    // 监听变更事件
    storageFilter.addEventListener('change', () => {
      currentStorageFilter = storageFilter.value;
      currentPage = 1; // 重置为第一页
      loadGalleryPaged();
    });
    
    // 加载存储统计信息并更新选项显示
    loadStorageStats();
  }
  
  // 上一页按钮
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadGalleryPaged();
      }
    });
  }
  
  // 底部上一页按钮
  if (prevPageBtnBottom) {
    prevPageBtnBottom.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadGalleryPaged();
      }
    });
  }
  
  // 下一页按钮
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        loadGalleryPaged();
      }
    });
  }
  
  // 底部下一页按钮
  if (nextPageBtnBottom) {
    nextPageBtnBottom.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        loadGalleryPaged();
      }
    });
  }
  
  // 删除按钮事件
  if (deleteImagesBtn) {
    deleteImagesBtn.addEventListener('click', () => {
      handleBatchDelete();
    });
  }
  
  // 底部删除按钮事件
  if (deleteImagesBtnBottom) {
    deleteImagesBtnBottom.addEventListener('click', () => {
      handleBatchDelete();
    });
  }
  
  // 生成分页页码，直接使用全局的 currentPage 用来判断当前激活的页码
  function generatePaginationNumbers(totalPages) {
    const pageNumbersContainer = document.getElementById('pageNumbers');
    const pageNumbersBottomContainer = document.getElementById('pageNumbersBottom');
    if (!pageNumbersContainer && !pageNumbersBottomContainer) return;
    
    // 生成上方分页导航
    if (pageNumbersContainer) {
      generatePaginationForContainer(pageNumbersContainer);
    }
    
    // 生成底部分页导航
    if (pageNumbersBottomContainer) {
      generatePaginationForContainer(pageNumbersBottomContainer);
    }
    
    // 为指定容器生成分页页码
    function generatePaginationForContainer(container) {
      container.innerHTML = '';
      
      // 最多显示的页码数量
      const maxPageButtons = 5;
      
      // 如果总页数小于等于最大显示数，直接显示所有页码
      if (totalPages <= maxPageButtons) {
        for (let i = 1; i <= totalPages; i++) {
          addPageNumber(i, container);
        }
      } else {
        // 总页数大于最大显示数，显示部分页码
        
        // 始终显示第一页
        addPageNumber(1, container);
        
        // 计算中间部分应该显示的页码
        let startPage = Math.max(2, currentPage - Math.floor((maxPageButtons - 2) / 2));
        let endPage = Math.min(totalPages - 1, startPage + maxPageButtons - 3);
        
        // 调整起始页码，确保显示足够数量的页码
        if (endPage - startPage < maxPageButtons - 3) {
          startPage = Math.max(2, endPage - (maxPageButtons - 3));
        }
        
        // 如果当前页接近第一页，不显示前省略号
        if (startPage > 2) {
          addEllipsis(container);
        }
        
        // 显示中间页码
        for (let i = startPage; i <= endPage; i++) {
          addPageNumber(i, container);
        }
        
        // 如果当前页接近最后一页，不显示后省略号
        if (endPage < totalPages - 1) {
          addEllipsis(container);
        }
        
        // 始终显示最后一页
        addPageNumber(totalPages, container);
      }
    }
    
    // 添加页码按钮的辅助函数
    function addPageNumber(pageNum, container) {
      const pageButton = document.createElement('div');
      pageButton.classList.add('page-number');
      if (pageNum === currentPage) {
        pageButton.classList.add('active');
      }
      pageButton.textContent = pageNum;
      pageButton.addEventListener('click', (e) => {
        // 阻止默认行为及事件传播
        e.preventDefault();
        e.stopPropagation();
        
        if (pageNum !== currentPage) {
          currentPage = pageNum;
          loadGalleryPaged();
        }
      });
      container.appendChild(pageButton);
    }
    
    // 添加省略号的辅助函数
    function addEllipsis(container) {
      const ellipsis = document.createElement('div');
      ellipsis.classList.add('page-number', 'page-ellipsis');
      ellipsis.textContent = '...';
      container.appendChild(ellipsis);
    }
  }
  
  // 带超时的 fetch 请求
  async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请检查网络连接');
      }
      throw error;
    }
  }

  // 加载分页图片库 - 保持视图类型不变
  async function loadGalleryPaged() {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;

    // 防止重复加载
    if (isLoading) {
      console.log('正在加载中，跳过重复请求');
      return;
    }

    isLoading = true;

    // 清理旧的懒加载状态
    cleanupLazyLoading();

    // 保存当前的class列表，包括可能的gallery-mosaic类
    const currentClasses = Array.from(gallery.classList);
    const hasMosaic = currentClasses.includes('gallery-mosaic');

    // 显示加载状态
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

    try {
      // 构建查询参数，包含存储类型过滤
      let queryParams = `page=${currentPage}&limit=${imagesPerPage}`;
      if (currentStorageFilter) {
        queryParams += `&storage=${currentStorageFilter}`;
      }

      const res = await fetchWithTimeout(`/images/paged?${queryParams}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const result = await res.json();

      if (result.success && result.images && result.pagination) {
        // 更新分页信息
        const { pagination } = result;
        totalPages = pagination.totalPages;

        // 更新分页控件状态，并同步全局 currentPage（与服务器返回一致）
        updatePaginationControls(pagination);

        // 恢复原来的视图类型
        const savedView = localStorage.getItem('galleryView') || 'grid';
        gallery.className = savedView === 'grid' ? 'gallery-grid' : 'gallery-list';

        // 如果之前有马赛克类，重新添加
        if (hasMosaic) {
          gallery.classList.add('gallery-mosaic');
        }

        // 渲染图片 - 统一使用全局 galleryImages 变量
        window.galleryImages = result.images; // 设置全局变量用于模态框
        renderGallery(result.images);

        if (result.images.length === 0) {
          gallery.innerHTML = '<div class="empty-gallery">暂无图片，请先上传</div>';
        }
      } else {
        throw new Error(result.message || '服务器返回数据格式错误');
      }
    } catch (err) {
      console.error('加载图片失败:', err);
      showToast(err.message || '获取图片列表时发生错误', 'error');

      // 恢复视图类型以便显示错误信息
      const savedView = localStorage.getItem('galleryView') || 'grid';
      gallery.className = savedView === 'grid' ? 'gallery-grid' : 'gallery-list';

      gallery.innerHTML = `
        <div class="error-message">
          <p>加载图片失败</p>
          <p style="font-size: 0.9em; color: #999; margin-top: 8px;">${err.message || '请刷新页面重试'}</p>
          <button onclick="location.reload()" style="margin-top: 16px; padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">刷新页面</button>
        </div>
      `;
    } finally {
      // 释放加载锁
      isLoading = false;
    }
  }
  
  // 更新分页控件状态
  function updatePaginationControls(pagination) {
    const { total, page, limit, totalPages } = pagination;
    
    // 同步全局 currentPage 与服务器返回的页码
    currentPage = page;
    
    // 生成页码
    generatePaginationNumbers(totalPages);
    
    // 更新分页详情
    if (paginationInfo) {
      const startItem = total > 0 ? (page - 1) * limit + 1 : 0;
      const endItem = Math.min(page * limit, total);
      paginationInfo.textContent = `显示 ${startItem}-${endItem}，共 ${total} 张图片`;
    }
    
    // 更新按钮状态
    if (prevPageBtn) {
      prevPageBtn.disabled = page <= 1;
    }
    
    if (nextPageBtn) {
      nextPageBtn.disabled = page >= totalPages;
    }
    
    // 更新底部按钮状态
    if (prevPageBtnBottom) {
      prevPageBtnBottom.disabled = page <= 1;
    }
    
    if (nextPageBtnBottom) {
      nextPageBtnBottom.disabled = page >= totalPages;
    }
  }
  
  // 以下是图片库选择、右键菜单及拖拽排序相关代码
  
  // 直接使用window.galleryImages，不再定义局部变量
  let currentImageIndex = -1;
  let selectedIndices = [];
  let lastSelectedIndex = null;
  
  // 用于缓存已加载图片的对象
  const imageCache = {};
  
  // 辅助函数：清除所有选中的图片
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
  
  // 渲染图片库并增强 UI
  function renderGallery(images) {
    const gallery = document.getElementById('gallery');
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
    if (hasMosaic) {
      gallery.classList.add('gallery-mosaic');
    }
    
    images.forEach((img, index) => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.dataset.index = index;
      item.dataset.format = img.format || '';
      item.dataset.animated = isImageAnimated(img) ? 'true' : 'false';

      // 确保设置图片的ID，用于删除操作
      if (img._id) {
        item.dataset.id = img._id;
      }

      const animatedBadge = isImageAnimated(img) ? `<div class="animated-badge">${img.format === 'gif' ? 'GIF' : '动图'}</div>` : '';

      if (isGridView) {
        item.classList.add('gallery-item-grid');
        item.innerHTML = `
          <div class="gallery-img-container">
            <div class="loading-placeholder"></div>
            <img class="gallery-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E"
                 data-src="${img.url}" alt="${img.filename}" loading="lazy" />
            ${animatedBadge}
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
        item.innerHTML = `
          <div class="gallery-img-container">
            <div class="loading-placeholder"></div>
            <img class="gallery-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E"
                 data-src="${img.url}" alt="${img.filename}" loading="lazy" />
            ${animatedBadge}
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
              ${formatBytes(img.fileSize)} · ${img.format}${isImageAnimated(img) ? ' · 动图' : ''} · ${img.storage === 'local' ? '本地存储' : '远程存储'}
            </div>
            <div class="file-time">${img.uploadTime}</div>
          </div>
        `;
      }
      
      // 修复：改进点击事件处理，处理冒泡问题以修复Ctrl+点击选择
      const handleGalleryItemClick = (e) => {
        if (e.button !== 0) return; // 仅处理左键点击
        
        // 阻止事件冒泡
        e.stopPropagation();
        
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
          showImageModal(img);
        }
      };
      
      // 直接绑定到整个item元素，确保点击任何区域都能被捕获
      item.addEventListener('click', handleGalleryItemClick);
      
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
          selectedItems = selectedIndices.map(i => window.galleryImages[i]);
        } else {
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

    // 使用改进的方式确保 DOM 完全渲染后再初始化懒加载
    // 添加重试机制以处理 DOM 渲染延迟的情况
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
        console.log(`未找到需要懒加载的图片,${50}ms后重试 (${retryCount + 1}/${maxRetries})`);
        lazyLoadRetryTimer = setTimeout(() => {
          initLazyLoadingWithRetry(retryCount + 1, maxRetries);
        }, 50);
      } else {
        console.warn('多次重试后仍未找到需要懒加载的图片');
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

    console.log(`开始初始化懒加载, 找到 ${lazyImages.length} 张图片`);

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
              console.warn('图片缺少 data-src 属性');
              observer.unobserve(img);
              return;
            }

            img.onload = function() {
              const container = img.closest('.gallery-img-container');
              if (container) {
                const placeholder = container.querySelector('.loading-placeholder');
                if (placeholder) {
                  placeholder.style.display = 'none';
                }
              }

              // 检查是否需要静态显示（关闭自动播放的动图）
              const galleryItem = img.closest('.gallery-item');
              if (galleryItem && galleryItem.dataset.animated === 'true') {
                const imgIndex = parseInt(galleryItem.dataset.index);
                const imgData = window.galleryImages && window.galleryImages[imgIndex];
                if (imgData && shouldShowStatic(imgData)) {
                  const didCapture = tryMakeStaticFrame(img, container, imgData);
                  if (didCapture) return;
                }
              }

              img.classList.add('loaded');
            };

            img.onerror = function() {
              console.error('图片加载失败:', src);
              const container = img.closest('.gallery-img-container');
              if (container) {
                const placeholder = container.querySelector('.loading-placeholder');
                if (placeholder) {
                  placeholder.style.display = 'none';
                  placeholder.innerHTML = '<p style="color: #999; font-size: 12px;">加载失败</p>';
                }
              }
              img.classList.add('error');
            };

            img.setAttribute('src', src);
            img.removeAttribute('data-src');
            observer.unobserve(img);
          }
        });
      }, {
        rootMargin: '50px', // 提前50px开始加载
        threshold: 0.01
      });

      lazyImages.forEach(img => {
        lazyLoadObserver.observe(img);
      });
    } else {
      // 不支持 IntersectionObserver 的浏览器直接加载所有图片
      lazyImages.forEach(img => {
        const src = img.getAttribute('data-src');
        if (src) {
          img.setAttribute('src', src);
          img.removeAttribute('data-src');
        }
      });
    }
  }
  
  // 上下文菜单相关功能
  
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

    // 判断是否显示动图标记选项（仅对单张 webp/avif 图片且有ID时显示）
    const singleImg = !hasMultiple && imagesSelected.length === 1 ? imagesSelected[0] : null;
    const canMarkAnimated = singleImg && singleImg._id && (singleImg.format === 'webp' || singleImg.format === 'avif');
    const isCurrentlyAnimated = singleImg && singleImg.isAnimated;
    const animatedMenuHtml = canMarkAnimated ? `
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" id="toggleAnimated">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px">
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
        </svg>
        ${isCurrentlyAnimated ? '取消动图标记' : '标记为动图'}
      </div>
    ` : '';

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
      ${animatedMenuHtml}
    `;

    // 添加复制功能
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
        window.open(imagesSelected[0].url, '_blank');
      }
      menu.style.display = 'none';
    });

    // 动图标记
    if (canMarkAnimated) {
      document.getElementById('toggleAnimated').addEventListener('click', async () => {
        menu.style.display = 'none';
        const newValue = !isCurrentlyAnimated;
        try {
          const res = await fetch(`/api/images/${singleImg._id}/animated`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isAnimated: newValue })
          });
          const data = await res.json();
          if (data.success) {
            showToast(newValue ? '已标记为动图' : '已取消动图标记', 'success');
            // 更新内存中的数据
            singleImg.isAnimated = newValue;
            // 重新加载当前页以刷新显示
            loadGalleryPaged();
          } else {
            showToast('操作失败', 'error');
          }
        } catch (e) {
          showToast('操作失败: ' + e.message, 'error');
        }
      });
    }

    // 点击其他地方关闭菜单
    const hideMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', hideMenu);
      }
    };

    requestAnimationFrame(() => {
      document.addEventListener('click', hideMenu);
    });
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
          <div class="mobile-copy-menu-title">图片操作</div>
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
          <div class="mobile-copy-menu-divider"></div>
          <div class="mobile-copy-menu-item mobile-copy-menu-item-danger" data-action="deleteImage">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
            </svg>
            <span>删除图片</span>
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
      item.addEventListener('click', async () => {
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
          case 'deleteImage':
            // 处理单张图片删除
            await handleSingleImageDelete(img, index);
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
  
  // 辅助剪贴板函数
  function copyToClipboard(text, successMessage) {
    if (!text) {
      showToast('没有可复制的内容', 'error');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast(successMessage))
        .catch((err) => {
          console.error('复制失败:', err);
          fallbackCopy(text, successMessage);
        });
    } else {
      fallbackCopy(text, successMessage);
    }
  }
  
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
  
  // 图片模态框功能
  function showImageModal(img) {
    if (!imageModal) {
      imageModal = document.createElement('div');
      imageModal.id = 'imageModal';
      imageModal.className = 'modal-backdrop';
      document.body.appendChild(imageModal);
      
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
      
      const closeBtn = imageModal.querySelector('.modal-close');
      const prevBtn = imageModal.querySelector('.nav-prev');
      const nextBtn = imageModal.querySelector('.nav-next');
      
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (prevBtn) prevBtn.addEventListener('click', navigatePrev);
      if (nextBtn) nextBtn.addEventListener('click', navigateNext);
      
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
      
      // 预加载相邻图片
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
      if (keyNavigationListener) {
        document.removeEventListener('keydown', keyNavigationListener);
        keyNavigationListener = null;
      }
    }
  }
  
  function preloadAdjacentImages(index) {
    if (!window.galleryImages || window.galleryImages.length <= 1) return;
    
    const prevIndex = (index - 1 + window.galleryImages.length) % window.galleryImages.length;
    const nextIndex = (index + 1) % window.galleryImages.length;
    
    preloadImage(window.galleryImages[prevIndex].url);
    preloadImage(window.galleryImages[nextIndex].url);
  }
  
  function preloadImage(url) {
    if (!imageCache[url]) {
      const img = new Image();
      img.onload = () => {
        imageCache[url] = true;
      };
      img.src = url;
    }
  }
  
  function navigatePrev() {
    if (!window.galleryImages || window.galleryImages.length <= 1) return;
    
    const prevIndex = (currentImageIndex - 1 + window.galleryImages.length) % window.galleryImages.length;
    currentImageIndex = prevIndex;
    showImageModal(window.galleryImages[prevIndex]);
    const preprevIndex = (prevIndex - 1 + window.galleryImages.length) % window.galleryImages.length;
    preloadImage(window.galleryImages[preprevIndex].url);
  }
  
  function navigateNext() {
    if (!window.galleryImages || window.galleryImages.length <= 1) return;
    
    const nextIndex = (currentImageIndex + 1) % window.galleryImages.length;
    currentImageIndex = nextIndex;
    showImageModal(window.galleryImages[nextIndex]);
    const nextnextIndex = (nextIndex + 1) % window.galleryImages.length;
    preloadImage(window.galleryImages[nextnextIndex].url);
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
  
  // 点击页面空白部分时隐藏上下文菜单并取消已选中的图片
  document.addEventListener('click', (e) => {
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu && contextMenu.style.display === 'block') {
      contextMenu.style.display = 'none';
    }
    if (!e.target.closest('.gallery-item') && !e.target.closest('.context-menu')) {
      clearAllSelections();
    }
  });
  
  // 修改：去掉Delete键删除功能，只提示使用删除按钮
  document.addEventListener('keydown', (e) => {
    // 如果当前焦点在输入框等表单元素中，则不处理
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    // 若模态框处于显示状态，也不处理（以免影响模态框内部导航）
    if (imageModal && imageModal.classList.contains('show')) return;
    
    if (e.key === 'Delete') {
      if (selectedIndices.length > 0) {
        // 只提示用户使用删除按钮
        showToast('请使用删除按钮删除图片', 'info');
      }
    }
  });
  
  // 加载存储统计信息并更新下拉选项
  async function loadStorageStats() {
    try {
      const res = await fetchWithTimeout('/api/storage-stats', {}, 5000);

      if (!res.ok) {
        console.warn('加载存储统计失败:', res.status, res.statusText);
        return;
      }

      const result = await res.json();

      if (result.success && result.stats && storageFilter) {
        const stats = result.stats;
        const options = storageFilter.querySelectorAll('option');

        // 更新选项显示数量
        options.forEach(option => {
          const value = option.value;
          if (value === '') {
            option.textContent = `所有图片 (${stats.total})`;
          } else if (value === 'local') {
            option.textContent = `本地存储 (${stats.local})`;
          } else if (value === 'r2') {
            option.textContent = `R2存储 (${stats.r2})`;
          }
        });
      }
    } catch (error) {
      console.error('加载存储统计失败:', error);
      // 统计信息加载失败不影响主要功能，只记录错误
    }
  }

  // 加载动图自动播放设置
  async function loadAnimatedAutoplaySettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success && data.animatedAutoplay) {
        animatedAutoplaySettings = {
          gif: data.animatedAutoplay.gif !== false,
          webp: data.animatedAutoplay.webp !== false,
          avif: data.animatedAutoplay.avif !== false
        };
      }
    } catch (e) {
      console.warn('加载动图设置失败，使用默认值:', e);
    }
  }

  // 判断图片是否为动图
  function isImageAnimated(img) {
    if (img.format === 'gif') return true;
    if ((img.format === 'webp' || img.format === 'avif') && img.isAnimated) return true;
    return false;
  }

  // 判断是否需要静态显示（关闭自动播放）
  function shouldShowStatic(img) {
    if (!isImageAnimated(img)) return false;
    if (img.format === 'gif') return !animatedAutoplaySettings.gif;
    if (img.format === 'webp') return !animatedAutoplaySettings.webp;
    if (img.format === 'avif') return !animatedAutoplaySettings.avif;
    return false;
  }

  // 尝试将图片转为静态首帧（canvas方式）
  function tryMakeStaticFrame(imgEl, container, img) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth || 200;
      canvas.height = imgEl.naturalHeight || 200;
      canvas.className = 'gallery-img loaded static-frame';
      canvas.style.objectFit = 'cover';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0);

      imgEl.parentNode.insertBefore(canvas, imgEl);
      imgEl.style.display = 'none';

      // 添加播放图标覆盖层
      const playOverlay = document.createElement('div');
      playOverlay.className = 'animated-play-overlay';
      playOverlay.innerHTML = '<div class="animated-play-btn">▶</div>';
      container.appendChild(playOverlay);

      // 点击播放覆盖层时切换为动图
      playOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        canvas.style.display = 'none';
        imgEl.style.display = '';
        imgEl.classList.add('loaded');
        playOverlay.remove();
        // 更新动图标记为播放中
        const badge = container.querySelector('.animated-badge');
        if (badge) badge.classList.add('playing');
      });

      return true;
    } catch (e) {
      // 跨域或其他错误，正常显示
      return false;
    }
  }

  // 页面加载时初始化图片库
  loadAnimatedAutoplaySettings().then(() => loadGalleryPaged());

  // 全局变量用于图片模态框事件处理
  let imageModal = null;
  let keyNavigationListener = null;
  
  // 处理批量删除操作
  async function handleBatchDelete() {
    const selectedImages = Array.from(document.querySelectorAll('.gallery-item.selected'));
    
    if (selectedImages.length === 0) {
      showToast('请先选择要删除的图片', 'info');
      return;
    }
    
    if (!confirm(`确定要删除选中的 ${selectedImages.length} 张图片吗？此操作不可恢复。`)) {
      return;
    }
    
    try {
      // 准备待删除的图片数据
      const selectedImageIndices = selectedImages.map(item => parseInt(item.dataset.index));
      
      // 确保window.galleryImages存在且有效
      if (!window.galleryImages || !Array.isArray(window.galleryImages)) {
        showToast('图片数据无效，请刷新页面', 'error');
        return;
      }
      
      // 获取图片对象
      const imagesToDelete = selectedImageIndices
        .map(index => window.galleryImages[index])
        .filter(img => img && img.storage && img.path); // 确保图片有必要的属性
      
      if (imagesToDelete.length === 0) {
        showToast('选中的图片无法删除', 'error');
        return;
      }
      
      console.log('准备删除图片:', imagesToDelete);
      
      // 发送正确的删除请求
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ images: imagesToDelete })
      });
      
      const result = await res.json();
      
      if (result.success) {
        showToast('图片删除成功', 'success');
        loadGalleryPaged(); // 重新加载当前页
        clearAllSelections(); // 清除选择
        // 重新加载存储统计
        loadStorageStats();
      } else {
        showToast('删除图片失败：' + (result.message || '未知错误'), 'error');
      }
    } catch (err) {
      console.error('删除图片时出错：', err);
      showToast('删除图片时发生错误', 'error');
    }
  }

  // 处理单张图片删除操作
  async function handleSingleImageDelete(img, index) {
    if (!img || !img.storage || !img.path) {
      showToast('图片信息无效，无法删除', 'error');
      return;
    }
    
    // 确认删除
    if (!confirm(`确定要删除图片 "${img.filename}" 吗？此操作不可恢复。`)) {
      return;
    }
    
    try {
      console.log('准备删除单张图片:', img);
      
      // 发送删除请求
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ images: [img] })
      });
      
      const result = await res.json();
      
      if (result.success) {
        showToast('图片删除成功', 'success');
        loadGalleryPaged(); // 重新加载当前页
        // 重新加载存储统计
        loadStorageStats();
      } else {
        showToast('删除图片失败：' + (result.message || '未知错误'), 'error');
      }
    } catch (err) {
      console.error('删除图片时出错：', err);
      showToast('删除图片时发生错误', 'error');
    }
  }
});