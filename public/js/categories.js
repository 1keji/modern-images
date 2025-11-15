document.addEventListener('DOMContentLoaded', () => {
  const categoryListEl = document.getElementById('categoryList');
  const subcategoryNavEl = document.getElementById('subcategoryNav');
  const imagesSection = document.getElementById('imagesSection');
  const imagesGallery = document.getElementById('imagesGallery');
  const imagesSectionTitle = document.getElementById('imagesSectionTitle');
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');
  const deleteImagesBtn = document.getElementById('deleteImagesBtn');
  const deleteImagesBtnBottom = document.getElementById('deleteImagesBtnBottom');
  
  // 分页相关DOM元素
  const perPageSelect = document.getElementById('perPageLimit');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const prevPageBtnBottom = document.getElementById('prevPageBtnBottom');
  const nextPageBtnBottom = document.getElementById('nextPageBtnBottom');
  const pageNumbers = document.getElementById('pageNumbers');
  const pageNumbersBottom = document.getElementById('pageNumbersBottom');
  const paginationInfo = document.getElementById('paginationInfo');

  let categories = [];
  let currentCategoryId = null;
  let currentParentCategoryId = null; // 当前父分类ID
  let currentCategoryPath = []; // 保存当前分类路径
  let currentImages = []; // 保存当前图片数组供其他函数使用
  
  // 分页相关变量
  let currentPage = 1;
  let totalPages = 1;
  let imagesPerPage = parseInt(localStorage.getItem('categoriesImagesPerPage')) || 50;
  
  // 视图类型
  let currentView = localStorage.getItem('categoriesView') || 'grid';

  // 选择功能变量
  let selectedIndices = [];
  let lastSelectedIndex = null;
  
  // 图片模态框变量
  let imageModal = null;
  let keyNavigationListener = null;
  let currentImageIndex = -1;
  const imageCache = {}; // 缓存已加载的图片

  // 初始化
  loadCategories();
  initViewType();
  initPagination();
  initDeleteButtons();

  // 初始化视图类型
  function initViewType() {
    if (!imagesGallery) return;
    
    // 设置初始视图状态
    if (currentView === 'grid') {
      imagesGallery.className = 'gallery-grid';
      gridViewBtn.classList.add('active');
      listViewBtn.classList.remove('active');
    } else {
      imagesGallery.className = 'gallery-list';
      listViewBtn.classList.add('active');
      gridViewBtn.classList.remove('active');
    }

    // 添加视图切换事件监听
    gridViewBtn.addEventListener('click', () => {
      imagesGallery.className = 'gallery-grid';
      localStorage.setItem('categoriesView', 'grid');
      currentView = 'grid';
      gridViewBtn.classList.add('active');
      listViewBtn.classList.remove('active');
      renderImages(currentImages);
    });
    
    listViewBtn.addEventListener('click', () => {
      imagesGallery.className = 'gallery-list';
      localStorage.setItem('categoriesView', 'list');
      currentView = 'list';
      listViewBtn.classList.add('active');
      gridViewBtn.classList.remove('active');
      renderImages(currentImages);
    });
  }
  
  // 初始化分页控件
  function initPagination() {
    // 设置每页图片数量
    if (perPageSelect) {
      perPageSelect.value = imagesPerPage;
      
      perPageSelect.addEventListener('change', () => {
        imagesPerPage = parseInt(perPageSelect.value);
        localStorage.setItem('categoriesImagesPerPage', imagesPerPage);
        currentPage = 1; // 重置为第一页
        loadCategoryImages(currentCategoryId); // 重新加载当前分类图片
      });
    }
    
    // 上一页按钮
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          loadCategoryImages(currentCategoryId);
        }
      });
    }
    
    // 底部上一页按钮
    if (prevPageBtnBottom) {
      prevPageBtnBottom.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          loadCategoryImages(currentCategoryId);
        }
      });
    }
    
    // 下一页按钮
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;
          loadCategoryImages(currentCategoryId);
        }
      });
    }
    
    // 底部下一页按钮
    if (nextPageBtnBottom) {
      nextPageBtnBottom.addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;
          loadCategoryImages(currentCategoryId);
        }
      });
    }
  }
  
  // 初始化删除按钮
  function initDeleteButtons() {
    if (deleteImagesBtn) {
      deleteImagesBtn.addEventListener('click', () => {
        handleBatchDelete();
      });
    }
    
    if (deleteImagesBtnBottom) {
      deleteImagesBtnBottom.addEventListener('click', () => {
        handleBatchDelete();
      });
    }
    
    // 添加键盘事件监听器，用于处理Delete键删除操作
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
      } else if (e.key === 'Escape') {
        // 按ESC清除所有选择
        clearAllSelections();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        // 按Ctrl+A或Cmd+A全选当前页面图片
        e.preventDefault();
        selectAllImages();
      }
    });
    
    // 点击页面空白部分时，取消选中的图片
    document.addEventListener('click', (e) => {
      const contextMenu = document.getElementById('contextMenu');
      if (contextMenu && contextMenu.style.display === 'block') {
        contextMenu.style.display = 'none';
      }
      
      if (!e.target.closest('.gallery-item') && !e.target.closest('.context-menu')) {
        clearAllSelections();
      }
    });
  }
  
  // 全选当前页面的图片
  function selectAllImages() {
    clearAllSelections();
    if (currentImages && currentImages.length > 0) {
      const imageItems = document.querySelectorAll('.gallery-item');
      imageItems.forEach((item, index) => {
        selectItem(index);
      });
      
      if (selectedIndices.length > 0) {
        lastSelectedIndex = selectedIndices[selectedIndices.length - 1];
        showToast(`已选择 ${selectedIndices.length} 张图片`, 'info');
      }
    }
  }
  
  // 生成分页页码
  function generatePaginationNumbers(totalPages) {
    if (!pageNumbers && !pageNumbersBottom) return;
    
    // 生成上方分页导航
    if (pageNumbers) {
      generatePaginationForContainer(pageNumbers);
    }
    
    // 生成底部分页导航
    if (pageNumbersBottom) {
      generatePaginationForContainer(pageNumbersBottom);
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
      pageButton.addEventListener('click', () => {
        if (pageNum !== currentPage) {
          currentPage = pageNum;
          loadCategoryImages(currentCategoryId);
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
  
  // 辅助函数：清除所有选中的图片
  function clearAllSelections() {
    selectedIndices = [];
    const items = document.querySelectorAll('.gallery-item');
    items.forEach(item => item.classList.remove('selected'));
  }
  
  // 选择指定索引的图片
  function selectItem(index) {
    selectedIndices.push(index);
    const items = document.querySelectorAll('.gallery-item');
    if (items[index]) {
      items[index].classList.add('selected');
    }
  }
  
  // 切换图片选中状态
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

  // 右键分类菜单
  function createCtxMenu() {
    let menu = document.getElementById('catContextMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'catContextMenu';
      menu.className = 'context-menu';
      document.body.appendChild(menu);
    }
    return menu;
  }

  function showCatContextMenu(e, targetIndices) {
    e.preventDefault();
    if (targetIndices.length === 0) return;

    const menu = createCtxMenu();
    menu.style.top = `${e.pageY}px`;
    menu.style.left = `${e.pageX}px`;
    menu.style.display = 'block';

    // 获取选中的图片
    const selectedImages = targetIndices.map(idx => currentImages[idx]);
    const isMultiple = selectedImages.length > 1;

    // 构造菜单内容 - 与图片库保持一致，不包含删除选项
    let html = `
      <div class="context-menu-item" id="copyUrl">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        复制${isMultiple ? '所有' : ''}图片链接
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
      <div class="context-menu-divider"></div>
    `;
    
    // 添加分类相关菜单项
    html += `<div class="context-menu-header">修改分类</div>`;

    // 判断当前是否在分类中查看图片
    if (currentCategoryId !== 'uncategorized') {
      // 使用一个特殊的固定值，确保不会被解释为其他值
      html += '<div class="context-menu-item category-item remove-category" data-catid="remove">移除分类</div>';
      html += '<div class="context-menu-divider"></div>';
    }

    // 检查当前所在分类的上下文
    let contextParentId = null;
    
    // 确定是否应该显示一级分类而不是二级分类
    let shouldShowTopLevelCategories = false;
    
    // 如果当前在全部图片或未分类，应该显示一级分类
    if (currentCategoryId === 'all' || currentCategoryId === 'uncategorized') {
      shouldShowTopLevelCategories = true;
    }
    
    // 首先，基于当前查看的分类来判断上下文
    if (currentCategoryId && !shouldShowTopLevelCategories) {
      // 如果当前是一级分类下的"未分类"
      if (currentCategoryId.toString().endsWith('-uncategorized')) {
        contextParentId = currentCategoryId.toString().replace('-uncategorized', '');
      }
      // 如果当前是一级分类
      else {
        const currentCategory = categories.find(cat => 
          cat.id && cat.id.toString() === currentCategoryId.toString()
        );
        if (currentCategory && !currentCategory.parent_id) {
          contextParentId = currentCategory.id;
        }
        // 如果当前是二级分类，获取其父分类
        else if (currentCategory && currentCategory.parent_id) {
          contextParentId = currentCategory.parent_id;
        }
      }
    }

    // 如果没有从当前分类确定上下文，检查选中图片所属的分类
    if (!contextParentId && selectedImages.length > 0) {
      // 检查第一个选中图片的分类
      const firstImage = selectedImages[0];
      if (firstImage.categoryId) {
        // 检查图片是在哪个分类
        if (typeof firstImage.categoryId === 'string' && firstImage.categoryId.endsWith('-uncategorized')) {
          // 是一级分类下的未分类
          contextParentId = firstImage.categoryId.replace('-uncategorized', '');
        } else {
          // 检查是否是二级分类
          const imageCategory = categories.find(cat => 
            cat.id && cat.id.toString() === firstImage.categoryId.toString()
          );
          if (imageCategory && imageCategory.parent_id) {
            // 如果是二级分类，获取其父分类
            contextParentId = imageCategory.parent_id;
          } else if (imageCategory) {
            // 如果是一级分类，直接使用
            contextParentId = imageCategory.id;
          }
        }
      }
    }

    // 如果有上下文父分类ID，显示该分类下的二级分类
    if (contextParentId) {
      // 获取一级分类信息
      const parentCategory = categories.find(cat => 
        cat.id && cat.id.toString() === contextParentId.toString()
      );

      if (parentCategory) {
        // 获取该一级分类下的所有二级分类
        const subCategories = categories.filter(cat => 
          isNormalCategory(cat.id) && 
          cat.parent_id && 
          cat.parent_id.toString() === parentCategory.id.toString()
        );

        // 添加一级分类标题
        html += `<div class="context-menu-header">${parentCategory.name}</div>`;
        
        // 不再显示未分类选项，因为功能与"移除分类"重复
        // html += `<div class="context-menu-item category-item" data-catid="${parentCategory.id}-uncategorized">
        //        未分类
        //        </div>`;

        // 添加该一级分类下的所有二级分类
        subCategories.forEach(subCat => {
          html += `<div class="context-menu-item category-item subcategory-item" data-catid="${subCat.id}">
                   ${subCat.name}
                   </div>`;
        });

        // 如果没有二级分类，添加提示信息
        if (subCategories.length === 0) {
          html += `<div class="context-menu-item no-click">暂无二级分类</div>`;
        }
      }
    } else {
      // 添加顶级分类标题
      html += `<div class="context-menu-header">一级分类</div>`;

      // 获取所有顶级分类（不包括虚拟分类）
      const topCategories = categories.filter(cat => isNormalCategory(cat.id) && !cat.parent_id);
      
      // 添加顶级分类
      topCategories.forEach(topCat => {
        html += `<div class="context-menu-item category-item" data-catid="${topCat.id}">
                  ${topCat.name}
                 </div>`;
      });
    }
    
    menu.innerHTML = html;
    
    // 添加复制功能点击事件
    document.getElementById('copyUrl').addEventListener('click', () => {
      const text = selectedImages.map(img => img.url).join('\n');
      copyToClipboard(text, isMultiple ? '所有图片链接已复制' : '图片链接已复制');
      menu.style.display = 'none';
    });
    
    document.getElementById('copyHTML').addEventListener('click', () => {
      const text = selectedImages.map(img => `<img src="${img.url}" alt="${img.filename}" />`).join('\n');
      copyToClipboard(text, 'HTML代码已复制');
      menu.style.display = 'none';
    });
    
    document.getElementById('copyMarkdown').addEventListener('click', () => {
      const text = selectedImages.map(img => `![${img.filename}](${img.url})`).join('\n');
      copyToClipboard(text, 'Markdown代码已复制');
      menu.style.display = 'none';
    });
    
    document.getElementById('copyForum').addEventListener('click', () => {
      const text = selectedImages.map(img => `[img]${img.url}[/img]`).join('\n');
      copyToClipboard(text, '论坛格式代码已复制');
      menu.style.display = 'none';
    });
    
    document.getElementById('openInTab').addEventListener('click', () => {
      if (selectedImages.length > 0) {
        window.open(selectedImages[0].url, '_blank');
      }
      menu.style.display = 'none';
    });

    // 点击分类菜单项 - 设置分类
    menu.querySelectorAll('.category-item').forEach(item => {
      if (item.classList.contains('no-click')) return;
      
      item.addEventListener('click', async () => {
        let catId = item.getAttribute('data-catid');
        
        try {
          // 处理catId，确保是数字或null
          if (catId === 'null' || catId === '' || catId === 'remove') {
            console.log('用户选择移除分类，设置catId为null');
            catId = null;
          } else if (catId) {
            // 确保分类ID是数字，除非是特殊的"未分类"格式
            if (!catId.toString().endsWith('-uncategorized')) {
              catId = parseInt(catId, 10);
              console.log('用户选择设置分类，catId解析为:', catId);
              if (isNaN(catId)) {
                throw new Error('无效的分类ID');
              }
            } else {
              console.log('用户选择设置为一级分类的未分类状态:', catId);
            }
          }
          
          // 显示加载中提示
          showToast('正在更新分类...', 'info');
          // 确保传递正确的索引数组和分类ID
          console.log('准备批量更新，传递catId:', catId, '类型:', typeof catId);
          await batchUpdateCategory(targetIndices, catId);
          // 操作成功后关闭菜单
          menu.style.display = 'none';
        } catch (error) {
          console.error('更新分类失败:', error);
          showToast('更新分类失败: ' + (error.message || '未知错误'), 'error');
          // 即使失败也关闭菜单
          menu.style.display = 'none';
        }
      });
    });

    // 点击外部隐藏
    const hide = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', hide);
      }
    };
    requestAnimationFrame(() => document.addEventListener('click', hide));
  }

  async function batchUpdateCategory(indices, catId) {
    if (!indices || indices.length === 0) return;
    
    console.log('batchUpdateCategory接收到参数:', { indices, catId, 类型: typeof catId });
    
    // 再次确认catId是正确的类型(数字或null)
    // 对于null、空字符串、'null'字符串、'undefined'字符串以及'remove'特殊值，都将其设为null
    let categoryId = null;
    if (catId === undefined || catId === '' || catId === 'null' || catId === 'undefined' || catId === 'remove' || catId === null) {
      categoryId = null;
      console.log('batchUpdateCategory: 分类ID设置为null');
    } else {
      // 确保是数字
      categoryId = typeof catId === 'number' ? catId : parseInt(catId, 10);
      console.log('batchUpdateCategory: 分类ID解析为数字:', categoryId);
      
      // 检查分类ID有效性
      if (isNaN(categoryId)) {
        console.error('batchUpdateCategory: 无效的分类ID:', catId);
        showToast('无效的分类ID', 'error');
        return;
      }
      
      // 验证分类是否存在
      const targetCategory = categories.find(cat => cat.id && cat.id.toString() === categoryId.toString());
      if (!targetCategory) {
        console.error('batchUpdateCategory: 指定的分类不存在:', categoryId);
        showToast('选择的分类不存在', 'error');
        return;
      }

      // 检查是否是一级分类，如果是，设置为未分类状态
      if (!targetCategory.parent_id) {
        // 不修改categoryId，而是后续使用特殊处理逻辑
        console.log('batchUpdateCategory: 选择的是一级分类，图片将设置为未分类状态');
      }
    }
    
    const promises = [];
    indices.forEach(i => {
      const img = currentImages[i];
      if (!img || !img._id) return; // 跳过无id
      
      // 如果目标分类是一级分类，则移动到该分类的"未分类"中
      if (categoryId !== null) {
        const targetCategory = categories.find(cat => cat.id && cat.id.toString() === categoryId.toString());
        if (targetCategory) {
          // 检查目标分类所属的一级分类
          let targetParentId = null;
          if (targetCategory.parent_id) {
            // 如果是二级分类，获取其父分类ID
            targetParentId = targetCategory.parent_id;
          } else {
            // 如果是一级分类，直接使用其ID
            targetParentId = targetCategory.id;
          }
          
          // 检查当前图片所属的分类
          let currentParentId = null;
          if (img.categoryId) {
            // 查找当前图片的分类信息
            const currentCategory = categories.find(cat => 
              cat.id && cat.id.toString() === img.categoryId.toString()
            );
            
            // 如果当前分类存在且有父分类，获取父分类ID
            if (currentCategory && currentCategory.parent_id) {
              currentParentId = currentCategory.parent_id;
            } else if (currentCategory) {
              currentParentId = currentCategory.id;
            }
          }
          
          // 检查是否在同一个一级分类下移动
          if (currentParentId && targetParentId && 
              currentParentId.toString() !== targetParentId.toString()) {
            console.error(`图片${img._id}当前属于一级分类${currentParentId}，不能移动到其他一级分类${targetParentId}下的分类`);
            showToast('不能跨一级分类移动图片', 'error');
            return;
          }
          
          // 检查是一级分类还是二级分类
          if (!targetCategory.parent_id) {
            // 一级分类：设置未分类状态，但不直接修改服务器中的分类ID
            // 而是设置特殊的状态字段
            console.log(`准备更新图片 ${img._id} 到一级分类 ${categoryId} 的未分类状态`);
            promises.push(updateImageCategory(img._id, `${categoryId}-uncategorized`));
            // 更新本地 state
            img.categoryId = `${categoryId}-uncategorized`;
            return;
          } else {
            // 二级分类：直接设置分类ID
            console.log(`准备更新图片 ${img._id} 到二级分类 ${categoryId}`);
            promises.push(updateImageCategory(img._id, categoryId));
            // 更新本地 state
            img.categoryId = categoryId;
            return;
          }
        }
      } else {
        // 处理移除分类的情况
        // 检查当前图片是否在二级分类中
        if (img.categoryId) {
          const currentCategory = categories.find(cat => 
            cat.id && cat.id.toString() === img.categoryId.toString()
          );
          
          // 如果当前分类存在并且是二级分类(有parent_id)
          if (currentCategory && currentCategory.parent_id) {
            // 获取父分类ID
            const parentId = currentCategory.parent_id;
            console.log(`图片 ${img._id} 从二级分类移除，将移动到父分类 ${parentId} 的未分类状态`);
            
            // 移动到父分类的未分类中
            promises.push(updateImageCategory(img._id, `${parentId}-uncategorized`));
            // 更新本地 state
            img.categoryId = `${parentId}-uncategorized`;
            return;
          }
        }
      }
      
      // 正常情况：直接设置分类ID（如从顶级未分类或一级分类的未分类中移除）
      console.log(`准备更新图片 ${img._id} 的分类为:`, categoryId);
      promises.push(updateImageCategory(img._id, categoryId));
      // 更新本地 state
      img.categoryId = categoryId;
    });
    
    if (promises.length === 0) return;
    
    try {
      await Promise.all(promises);
      
      // 获取目标分类信息用于提示
      let categoryName = '无分类';
      if (categoryId !== null) {
        const targetCat = categories.find(cat => cat.id && cat.id.toString() === categoryId.toString());
        if (targetCat) {
          if (!targetCat.parent_id) {
            // 如果是一级分类，添加"未分类"标记
            categoryName = `${targetCat.name} > 未分类`;
          } else {
            // 如果是子分类，显示完整路径
            const parentCat = categories.find(cat => cat.id && cat.id.toString() === targetCat.parent_id.toString());
            if (parentCat) {
              categoryName = `${parentCat.name} > ${targetCat.name}`;
            } else {
              categoryName = targetCat.name;
            }
          }
        }
      }
      
      const imageCount = promises.length;
      const pluralSuffix = imageCount > 1 ? '张图片' : '张图片';
      showToast(`已将${imageCount}${pluralSuffix}移动到 "${categoryName}"`);
      
      // 刷新当前视图以反映最新状态
      if (currentCategoryId) {
        // 保存当前分类ID和信息
        const savedCatId = currentCategoryId;
        let savedCatName = '';
        let savedParentId = null;
        
        // 获取当前分类的信息
        if (savedCatId === 'all') {
          savedCatName = '全部图片';
        } else if (savedCatId === 'uncategorized') {
          savedCatName = '未分类';
        } else if (savedCatId.toString().endsWith('-uncategorized')) {
          savedCatName = '未分类';
          savedParentId = savedCatId.toString().replace('-uncategorized', '');
        } else {
          const currentCat = categories.find(c => c.id && c.id.toString() === savedCatId.toString());
          if (currentCat) {
            savedCatName = currentCat.name;
            savedParentId = currentCat.parent_id;
          }
        }
        
        console.log('刷新当前视图:', { savedCatId, savedCatName, savedParentId });
        
        // 重新加载当前分类的图片
        await viewCategory(savedCatId, savedCatName, savedParentId);
      }
    } catch (err) {
      console.error('批量更新失败:', err);
      showToast('部分更新失败: ' + (err.message || '未知错误'), 'error');
    }
  }

  // 加载分类列表
  async function loadCategories() {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      if (data.success) {
        categories = data.categories;
        
        // 确保所有分类ID都被正确处理为字符串
        categories.forEach(cat => {
          if (cat.id) {
            cat.id = cat.id.toString();
          }
          if (cat.parent_id) {
            cat.parent_id = cat.parent_id.toString();
          }
        });
        
        console.log('分类列表加载完成:', categories);
        renderSpecialItems();
        renderCategoryList();
        
        // 加载完分类后，加载默认分类设置
        await loadDefaultCategorySetting();
        
        // 如果当前有选中的分类，刷新其状态以确保导航正确
        if (currentCategoryId) {
          // 获取当前分类的名称
          let catName = '未知分类';
          let parentId = null;
          
          if (currentCategoryId === 'all') {
            catName = '全部图片';
          } else if (currentCategoryId === 'uncategorized') {
            catName = '未分类';
          } else if (currentCategoryId.toString().endsWith('-uncategorized')) {
            catName = '未分类';
            // 重新获取父分类ID
            parentId = currentCategoryId.toString().replace('-uncategorized', '');
          } else {
            const currentCat = categories.find(c => c.id && c.id.toString() === currentCategoryId.toString());
            if (currentCat) {
              catName = currentCat.name;
              parentId = currentCat.parent_id;
            }
          }
          
          // 更新当前分类状态，但不重新加载图片
          console.log(`刷新当前分类: ID=${currentCategoryId}, 名称=${catName}, 父ID=${parentId}`);
          currentParentCategoryId = parentId;
          
          // 只更新UI状态，不重新加载图片
          updateBreadcrumb();
          
          // 查找并高亮当前分类按钮
          requestAnimationFrame(() => {
            const buttons = document.querySelectorAll(`.category-btn[data-category-id="${currentCategoryId}"]`);
            buttons.forEach(btn => {
              btn.classList.add('active');
              
              // 如果是子分类，展开父分类
              if (parentId) {
                const parentButtons = document.querySelectorAll(`.category-btn[data-category-id="${parentId}"]`);
                parentButtons.forEach(parentBtn => {
                  if (parentBtn.classList.contains('parent')) {
                    parentBtn.classList.add('expanded');
                    const subContainer = parentBtn.parentElement.querySelector(`.subcategory-container[data-parent-id="${parentId}"]`);
                    if (subContainer) {
                      subContainer.style.display = 'block';
                    }
                  }
                });
              }
              
              // 如果是有子分类的一级分类，自动展开子分类
              if (btn.classList.contains('parent')) {
                btn.classList.add('expanded');
                const subContainer = btn.parentElement.querySelector(`.subcategory-container[data-parent-id="${currentCategoryId}"]`);
                if (subContainer) {
                  subContainer.style.display = 'block';
                }
              }
            });
          }, 10);
        }
      } else {
        showToast(data.error || '加载分类失败', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('加载分类失败', 'error');
    }
  }
  
  // 渲染分类列表
  function renderCategoryList() {
    categoryListEl.innerHTML = '';
    if (categories.length === 0) {
      categoryListEl.innerHTML = '<p style="color: var(--text-secondary);">暂无分类，点击上方"添加一级分类"按钮创建新分类。</p>';
      return;
    }

    // 渲染特殊项（全部图片和未分类）
    const specialItems = categories.filter(cat => cat.id === 'all' || cat.id === 'uncategorized');
    specialItems.forEach(cat => {
      renderCategoryButton(cat);
    });
    
    // 先渲染一级分类（没有parent_id的）
    const topCategories = categories.filter(cat => isNormalCategory(cat.id) && !cat.parent_id);
    if (topCategories.length === 0) {
      if (specialItems.length === 0) {
        categoryListEl.innerHTML = '<p style="color: var(--text-secondary);">暂无分类，点击上方"添加一级分类"按钮创建新分类。</p>';
      }
      return;
    }
    
    topCategories.forEach(cat => {
      // 查找该分类的子分类
      const subCategories = categories.filter(subCat => 
        isNormalCategory(subCat.id) && subCat.parent_id === cat.id
      );
      
      // 创建并添加分类按钮
      const categoryContainer = document.createElement('div');
      categoryContainer.className = 'category-item-container';
      
      // 为一级分类按钮添加hasChildren属性，但不再创建子分类容器
      const btn = createCategoryButton(cat, subCategories.length > 0);
      categoryContainer.appendChild(btn);
      
      // 不再创建和添加子分类容器，所有子分类只在subcategoryNav中显示
      
      categoryListEl.appendChild(categoryContainer);
    });
  }

  // 创建分类按钮
  function createCategoryButton(cat, hasChildren = false, isSubcategory = false) {
    const btn = document.createElement('button');
    btn.className = `category-btn ${isSubcategory ? 'subcategory' : ''}`;
    
    // 如果当前显示的是这个分类，添加active类
    if (currentCategoryId && cat.id && currentCategoryId.toString() === cat.id.toString()) {
      btn.classList.add('active');
    }
    
    // 添加数据属性，方便调试和定位
    btn.dataset.categoryId = cat.id;
    if (cat.parent_id) {
      btn.dataset.parentId = cat.parent_id;
    }
    
    // 简化按钮文本设置
    btn.textContent = cat.name;
    
    // 添加点击事件：查看该分类图片
    btn.addEventListener('click', () => {
      viewCategory(cat.id, cat.name, cat.parent_id);
    });
    
    return btn;
  }

  // 更新面包屑导航
  function updateBreadcrumb() {
    if (!subcategoryNavEl) return;
    
    console.log(`更新导航，当前分类ID: ${currentCategoryId}, 父分类ID: ${currentParentCategoryId}`);
    
    // 清空并重新生成子分类导航
    subcategoryNavEl.innerHTML = '';
    
    // 如果没有选择分类或选择的是特殊分类，不显示面包屑导航
    if (!currentCategoryId || (currentCategoryId === 'all' || currentCategoryId === 'uncategorized')) {
      subcategoryNavEl.style.display = 'none';
      return;
    }

    // 确定当前工作的上下文（父分类ID）
    let contextParentId;
    
    // 如果当前是二级分类
    if (currentParentCategoryId) {
      contextParentId = currentParentCategoryId;
      console.log(`当前是二级分类，使用父分类ID: ${contextParentId}`);
    } 
    // 如果当前是一级分类
    else if (isNormalCategory(currentCategoryId)) {
      contextParentId = currentCategoryId;
      console.log(`当前是一级分类，使用自身ID: ${contextParentId}`);
    } else {
      // 无法确定上下文，隐藏二级导航
      subcategoryNavEl.style.display = 'none';
      return;
    }
    
    // 如果查看的是某个分类下的"未分类"图片
    if (currentCategoryId.toString().endsWith('-uncategorized')) {
      contextParentId = currentCategoryId.toString().replace('-uncategorized', '');
      console.log(`当前是特殊未分类视图，提取父分类ID: ${contextParentId}`);
    }
    
    // 查找当前一级分类下的所有二级分类
    const subCategories = categories.filter(cat => 
      isNormalCategory(cat.id) && cat.parent_id && cat.parent_id.toString() === contextParentId.toString()
    );
    
    // 如果当前分类是一级分类且有子分类，或者当前是二级分类，则显示二级分类导航
    if (subCategories.length > 0 || currentParentCategoryId) {
      // 显示面包屑导航区域
      subcategoryNavEl.style.display = 'flex';
      
      // 添加"全部"按钮，显示当前一级分类下的所有图片
      const allBtn = document.createElement('button');
      allBtn.className = 'category-btn';
      allBtn.textContent = '全部图片';
      if (currentCategoryId.toString() === contextParentId.toString()) {
        allBtn.classList.add('active');
      }
      allBtn.addEventListener('click', () => {
        // 根据上下文ID查找当前分类信息
        const contextCategory = categories.find(cat => cat.id && cat.id.toString() === contextParentId.toString());
        if (contextCategory) {
          viewCategory(contextCategory.id, contextCategory.name, contextCategory.parent_id);
        }
      });
      subcategoryNavEl.appendChild(allBtn);
      
      // 添加"未分类"按钮
      const uncategorizedBtn = document.createElement('button');
      uncategorizedBtn.className = 'category-btn';
      uncategorizedBtn.textContent = '未分类';
      if (currentCategoryId.toString() === `${contextParentId}-uncategorized`) {
        uncategorizedBtn.classList.add('active');
      }
      uncategorizedBtn.addEventListener('click', () => {
        // 根据上下文ID查找当前分类信息
        const contextCategory = categories.find(cat => cat.id && cat.id.toString() === contextParentId.toString());
        if (contextCategory) {
          viewCategory(`${contextParentId}-uncategorized`, '未分类', contextParentId);
        }
      });
      subcategoryNavEl.appendChild(uncategorizedBtn);
      
      // 添加所有子分类按钮
      subCategories.forEach(subCat => {
        const subBtn = document.createElement('button');
        subBtn.className = 'category-btn';
        subBtn.textContent = subCat.name;
        
        // 如果当前查看的是这个子分类，标记为活跃
        if (currentCategoryId.toString() === subCat.id.toString()) {
          subBtn.classList.add('active');
        }
        
        subBtn.addEventListener('click', () => {
          viewCategory(subCat.id, subCat.name, subCat.parent_id);
        });
        
        subcategoryNavEl.appendChild(subBtn);
      });
    } else {
      // 如果没有二级分类，隐藏导航
      subcategoryNavEl.style.display = 'none';
    }
  }

  // 查看分类图片
  async function viewCategory(id, name, parentId = null) {
    console.log(`查看分类: id=${id}, name=${name}, parentId=${parentId}`);
    currentCategoryId = id;
    currentParentCategoryId = parentId; // 记录父分类ID用于二级导航
    
    // 移除分类标题展示
    if (imagesSectionTitle) {
      imagesSectionTitle.textContent = ""; // 不再显示"分类：测试"这样的文本
    }
    
    if (imagesSection) {
      imagesSection.style.display = 'block';
    }
    
    if (imagesGallery) {
      imagesGallery.innerHTML = '<p>加载中...</p>';
    }
    
    // 更新分类按钮的active状态
    const buttons = document.querySelectorAll('.category-btn');
    buttons.forEach(btn => {
      // 如果当前按钮是父分类并且现在正在查看其子分类，不要移除active状态
      if (parentId && btn.dataset.categoryId === parentId) {
        // 保持一级分类的选中状态
      } else if (btn.dataset.categoryId !== id) {
        btn.classList.remove('active');
      }
    });
    
    // 更新面包屑导航，确保二级导航状态正确
    updateBreadcrumb();
    
    // 查找并标记当前选中的分类按钮
    requestAnimationFrame(() => {
      // 查找并高亮主分类列表中的按钮
      const mainButtons = categoryListEl.querySelectorAll(`.category-btn[data-category-id="${id}"]`);
      mainButtons.forEach(btn => {
        btn.classList.add('active');
      });
      
      // 如果是二级分类，也要高亮父分类按钮
      if (parentId) {
        const parentButtons = categoryListEl.querySelectorAll(`.category-btn[data-category-id="${parentId}"]`);
        parentButtons.forEach(btn => {
          btn.classList.add('active');
        });
      }
      
      // 查找并高亮二级导航中的按钮
      if (subcategoryNavEl) {
        const navButtons = subcategoryNavEl.querySelectorAll('.category-btn');
        navButtons.forEach(btn => {
          const btnCatId = btn.dataset.categoryId;
          if (btnCatId && btnCatId.toString() === id.toString()) {
            btn.classList.add('active');
          }
        });
      }
    }, 10);
    
    // 重置选择
    selectedIndices = [];
    lastSelectedIndex = null;
    
    // 重置当前页为第一页
    currentPage = 1;
    
    // 加载分类图片
    await loadCategoryImages(id);
  }

  // 加载分类图片（支持分页）
  async function loadCategoryImages(id) {
    try {
      let endpoint;
      
      // 构建带分页参数的API端点
      if (id === 'all') {
        endpoint = `/images/paged?page=${currentPage}&limit=${imagesPerPage}`;
      } else if (id === 'uncategorized') {
        endpoint = `/api/images/uncategorized/paged?page=${currentPage}&limit=${imagesPerPage}`;
      } else if (id.toString().endsWith('-uncategorized')) {
        // 处理父分类下的未分类图片
        const parentId = id.toString().replace('-uncategorized', '');
        // 确保parentId是有效的数字
        if (!isNaN(parseInt(parentId))) {
          endpoint = `/api/categories/${parentId}/uncategorized/paged?page=${currentPage}&limit=${imagesPerPage}`;
          console.log(`加载父分类ID=${parentId}下的未分类图片`);
        } else {
          // 如果parentId不是有效数字，则回退到一般的未分类
          endpoint = `/api/images/uncategorized/paged?page=${currentPage}&limit=${imagesPerPage}`;
          console.log('无效的父分类ID，回退到一般未分类图片');
        }
      } else {
        // 处理普通分类（包括子分类）图片
        // 确保分类ID是有效数字
        const validId = parseInt(id);
        if (isNaN(validId)) {
          console.error(`分类ID无效: ${id}`);
          showToast(`无效的分类ID: ${id}`, 'error');
          imagesGallery.innerHTML = '<p style="color: var(--text-secondary);">无法加载：无效的分类ID。</p>';
          return;
        }
        
        // 检查分类是否存在于本地缓存中
        const categoryExists = categories.some(cat => cat.id && cat.id.toString() === id.toString());
        if (!categoryExists) {
          console.error(`分类不存在: ${id}`);
          showToast(`分类不存在，请重新加载页面`, 'error');
          imagesGallery.innerHTML = '<p style="color: var(--text-secondary);">无法加载：分类可能已被删除。</p>';
          return;
        }
        
        // 根据分类类型选择不同的端点
        // 找到当前分类对象
        const category = categories.find(cat => cat.id && cat.id.toString() === id.toString());
        
        // 检查是否为一级分类（没有父级分类）
        if (category && category.parent_id === null) {
          // 如果是一级分类，使用新的API端点获取包括子分类在内的所有图片
          endpoint = `/api/categories/${id}/allimages/paged?page=${currentPage}&limit=${imagesPerPage}`;
          console.log(`加载一级分类ID=${id}的所有图片（包括子分类）`);
        } else {
          // 如果是二级分类，使用原有端点
          endpoint = `/api/categories/${id}/images/paged?page=${currentPage}&limit=${imagesPerPage}`;
          console.log(`加载分类ID=${id}的图片`);
        }
      }
      
      console.log(`加载分类图片: id=${id}, endpoint=${endpoint}`);
      
      // 显示加载状态
      imagesGallery.innerHTML = `
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
      
      // 定义一个包装函数处理加载逻辑，支持重试
      const loadImagesWithRetry = async (retryCount = 0) => {
        try {
          // 设置请求超时
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
          
          // 添加时间戳避免缓存问题
          const timestampedEndpoint = `${endpoint}${endpoint.includes('?') ? '&' : '?'}t=${Date.now()}`;
          
          const res = await fetch(timestampedEndpoint, { 
            signal: controller.signal,
            headers: { 
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          });
          
          clearTimeout(timeoutId);
          
          if (!res.ok) {
            const errorText = await res.text();
            console.error(`HTTP错误(${res.status}): ${errorText}`);
            throw new Error(`服务器返回错误: ${res.status} - ${res.statusText}`);
          }
          
          const data = await res.json();
          
          if (data.success) {
            // 保存图片数组
            const imgs = data.images || [];
            currentImages = imgs;
            
            // 如果有分页信息，更新分页控件
            if (data.pagination) {
              totalPages = data.pagination.totalPages;
              updatePaginationControls(data.pagination);
            }
            
            // 渲染图片
            renderImages(imgs);
            return true; // 加载成功
          } else {
            console.error('加载图片响应错误:', data.error);
            throw new Error(data.error || '加载图片失败');
          }
        } catch (fetchErr) {
          console.error(`加载图片网络错误 (尝试 ${retryCount + 1}/3):`, fetchErr);
          
          if (retryCount < 2) {
            // 还有重试机会
            console.log(`将在1秒后进行重试 (${retryCount + 1}/3)...`);
            
            // 更新加载状态
            imagesGallery.innerHTML = `
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
                <p>加载失败，正在重试 (${retryCount + 1}/3)...</p>
              </div>
            `;
            
            // 等待1秒后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
            return await loadImagesWithRetry(retryCount + 1);
          }
          
          // 重试次数用尽
          if (fetchErr.name === 'AbortError') {
            showToast('加载图片超时，请检查网络连接', 'error');
            imagesGallery.innerHTML = `
              <div class="error-container">
                <p style="color: var(--text-secondary);">加载图片超时，请检查网络连接</p>
                <button class="btn btn-sm" onclick="loadCategoryImages('${id}')">重试</button>
              </div>
            `;
          } else {
            showToast(`加载图片失败: ${fetchErr.message}`, 'error');
            imagesGallery.innerHTML = `
              <div class="error-container">
                <p style="color: var(--text-secondary);">加载图片失败: ${fetchErr.message}</p>
                <button class="btn btn-sm" onclick="loadCategoryImages('${id}')">重试</button>
              </div>
            `;
          }
          return false; // 加载失败
        }
      };
      
      // 执行加载逻辑
      await loadImagesWithRetry();
      
    } catch (error) {
      console.error('加载分类图片失败:', error);
      showToast(`加载失败: ${error.message}`, 'error');
      imagesGallery.innerHTML = `
        <div class="error-container">
          <p style="color: var(--text-secondary);">加载失败: ${error.message}</p>
          <button class="btn btn-sm" onclick="loadCategoryImages('${id}')">重试</button>
        </div>
      `;
    }
  }

  // 渲染图片网格
  function renderImages(images) {
    if (!images || images.length === 0) {
      imagesGallery.innerHTML = '<p style="color: var(--text-secondary);">该分类暂无图片。</p>';
      return;
    }
    
    imagesGallery.innerHTML = '';
    const isGridView = currentView === 'grid';

    images.forEach((img, idx) => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.dataset.index = idx;
      item.classList.add(isGridView ? 'gallery-item-grid' : 'gallery-item-list');

      // 确保设置图片的ID，用于删除操作
      if (img._id) {
        item.dataset.id = img._id;
      }

      // 添加图片内容根据视图类型
      if (isGridView) {
        item.innerHTML = `
          <div class="gallery-img-container">
            <div class="loading-placeholder"></div>
            <img class="gallery-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" 
                 data-src="${img.url}" alt="${img.filename}" loading="lazy" />
            <div class="filename">${img.filename}</div>
            <button class="mobile-copy-btn" data-index="${idx}" title="图片操作">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="19" cy="12" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle>
              </svg>
            </button>
          </div>
        `;
      } else {
        item.innerHTML = `
          <div class="gallery-img-container">
            <div class="loading-placeholder"></div>
            <img class="gallery-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" 
                 data-src="${img.url}" alt="${img.filename}" loading="lazy" />
          </div>
          <div class="gallery-item-details">
            <div class="gallery-item-title">${img.filename}</div>
            <div class="gallery-item-meta">
              <span>${formatBytes(img.fileSize || 0)}</span>
              <span>${img.uploadTime || '-'}</span>
              <span>${img.storage || 'local'}</span>
            </div>
            <div class="gallery-item-actions">
              <button class="btn btn-sm" data-action="copy" data-index="${idx}">复制链接</button>
              <button class="btn btn-sm" data-action="view" data-index="${idx}">查看图片</button>
              <button class="btn btn-sm btn-danger" data-action="delete" data-index="${idx}">删除图片</button>
            </div>
          </div>
        `;
      }

      // 修改点击处理逻辑，单击打开，CTRL/Shift+单击选中
      const handleClick = (e) => {
        // 如果点击的是按钮，不处理选择和查看
        if (e.target.closest('button')) return;
        
        const index = parseInt(item.dataset.index);
        
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
          // 普通点击：直接查看图片
          currentImageIndex = index;
          showImageModal(img);
        }
      };
      
      item.addEventListener('click', handleClick);

      // 右键菜单
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 如果没有选中任何图片，或者右键点击的图片不在选中列表中，
        // 则清除当前选择并选择右键点击的图片
        const index = parseInt(item.dataset.index);
        if (selectedIndices.length === 0 || !selectedIndices.includes(index)) {
          clearAllSelections();
          selectItem(index);
        }
        
        // 显示右键菜单
        showCatContextMenu(e, selectedIndices);
      });

      // 移动端按钮点击事件
      if (isGridView) {
        const copyBtn = item.querySelector('.mobile-copy-btn');
        if (copyBtn) {
          copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(copyBtn.getAttribute('data-index'));
            const imgToCopy = images[index];
            // 显示移动端菜单而不是直接复制
            showMobileCopyMenu(e, imgToCopy, index);
          });
        }
      } else {
        // 列表视图按钮点击事件
        const buttons = item.querySelectorAll('[data-action]');
        buttons.forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            const index = parseInt(btn.getAttribute('data-index'));
            const targetImg = images[index];
            
            if (action === 'copy') {
              copyToClipboard(targetImg.url, '图片链接已复制');
            } else if (action === 'view') {
              showImageModal(targetImg);
            } else if (action === 'delete') {
              handleSingleImageDelete(targetImg, index);
            }
          });
        });
      }

      imagesGallery.appendChild(item);
    });

    // 启用懒加载
    initLazyLoading();
  }

  // 实现图片懒加载
  function initLazyLoading() {
    const lazyImages = document.querySelectorAll('.gallery-img[data-src]');
    
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.getAttribute('data-src');
            
            img.onload = function() {
              const container = img.closest('.gallery-img-container');
              const placeholder = container.querySelector('.loading-placeholder');
              if (placeholder) {
                placeholder.style.display = 'none';
              }
              img.classList.add('loaded');
            };
            
            img.setAttribute('src', src);
            img.removeAttribute('data-src');
            imageObserver.unobserve(img);
          }
        });
      });
      
      lazyImages.forEach(img => {
        imageObserver.observe(img);
      });
    } else {
      lazyImages.forEach(img => {
        img.setAttribute('src', img.getAttribute('data-src'));
        img.removeAttribute('data-src');
      });
    }
  }

  // 复制到剪贴板
  function copyToClipboard(text, successMessage) {
    if (!navigator.clipboard) {
      fallbackCopy(text, successMessage);
      return;
    }
    
    navigator.clipboard.writeText(text)
      .then(() => {
        showToast(successMessage);
      })
      .catch(err => {
        console.error('复制失败: ', err);
        fallbackCopy(text, successMessage);
      });
  }
  
  // 回退复制方法
  function fallbackCopy(text, successMessage) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        showToast(successMessage);
      } else {
        showToast('复制失败，请手动复制', 'error');
      }
    } catch (err) {
      console.error('复制失败:', err);
      showToast('复制失败，请手动复制', 'error');
    }
    
    document.body.removeChild(textArea);
  }

  // 格式化文件大小
  function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // 更新图片分类
  async function updateImageCategory(imageId, categoryId) {
    try {
      // 增强类型检查，确保处理所有可能的边缘情况
      // 添加字符串"undefined"的检查
      let catId = categoryId === '' || categoryId === undefined || categoryId === 'null' || categoryId === 'undefined' || categoryId === null ? null : categoryId;
      
      // 处理一级分类的未分类状态
      let isParentUncategorized = false;
      let parentCategoryId = null;
      
      // 检查是否是带有"-uncategorized"后缀的特殊格式
      if (typeof catId === 'string' && catId.endsWith('-uncategorized')) {
        parentCategoryId = catId.replace('-uncategorized', '');
        isParentUncategorized = true;
        console.log('检测到一级分类的未分类格式，父分类ID:', parentCategoryId);
      }
      
      // 检查是否为二级分类
      let isSubcategory = false;
      if (catId !== null && !isParentUncategorized) {
        // 尝试在分类列表中找到此分类
        const targetCategory = categories.find(cat => 
          cat.id && cat.id.toString() === catId.toString()
        );
        // 如果存在且有父分类，则是二级分类
        if (targetCategory && targetCategory.parent_id) {
          isSubcategory = true;
          console.log('检测到二级分类，ID:', catId, '父分类ID:', targetCategory.parent_id);
        }
      }
      
      console.log('发送更新分类请求:', { 
        imageId, 
        原始categoryId: categoryId, 
        处理后catId: catId, 
        类型: typeof catId,
        isParentUncategorized,
        parentCategoryId,
        isSubcategory
      });
      
      // 构建请求体
      // 如果是一级分类的未分类状态，将categoryId设为null，同时传递parentCategoryId
      // 这样图片会被标记为"属于某个一级分类，但不属于任何二级分类"
      const requestBody = isParentUncategorized
        ? { categoryId: null, parentCategoryId }
        : { categoryId: catId };
      
      const res = await fetch(`/api/images/${imageId}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const data = await res.json();
      if (!data.success) {
        console.error('服务器返回更新失败:', data.error);
        showToast(data.error || '更新失败', 'error');
        return Promise.reject(data.error || '更新失败');
      }
      return Promise.resolve();
    } catch (err) {
      console.error('更新分类请求失败:', err);
      showToast('更新失败', 'error');
      return Promise.reject(err);
    }
  }

  // 简易 toast 提示
  function showToast(msg, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.className = `toast toast-${type}`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
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
              <span class="image-time">${img.uploadTime || ''}</span>
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
              <img src="${img.url}" alt="${img.filename}" class="modal-image" style="display: none;">
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
  
  // 关闭模态框
  function closeModal() {
    if (imageModal) {
      imageModal.classList.remove('show');
      if (keyNavigationListener) {
        document.removeEventListener('keydown', keyNavigationListener);
        keyNavigationListener = null;
      }
    }
  }
  
  // 预加载相邻图片，提升导航体验
  function preloadAdjacentImages(index) {
    const prevIndex = index > 0 ? index - 1 : currentImages.length - 1;
    const nextIndex = index < currentImages.length - 1 ? index + 1 : 0;
    
    if (currentImages[prevIndex] && currentImages[prevIndex].url) {
      preloadImage(currentImages[prevIndex].url);
    }
    
    if (currentImages[nextIndex] && currentImages[nextIndex].url) {
      preloadImage(currentImages[nextIndex].url);
    }
  }
  
  // 预加载图片
  function preloadImage(url) {
    if (!imageCache[url]) {
      const img = new Image();
      img.onload = () => {
        imageCache[url] = true;
      };
      img.src = url;
    }
  }
  
  // 导航到上一张图片
  function navigatePrev() {
    if (currentImages.length <= 1) return;
    
    currentImageIndex = currentImageIndex > 0 ? currentImageIndex - 1 : currentImages.length - 1;
    showImageModal(currentImages[currentImageIndex]);
  }
  
  // 导航到下一张图片
  function navigateNext() {
    if (currentImages.length <= 1) return;
    
    currentImageIndex = currentImageIndex < currentImages.length - 1 ? currentImageIndex + 1 : 0;
    showImageModal(currentImages[currentImageIndex]);
  }

  // helper to render list, we will insert after categories loaded
  function renderSpecialItems() {
    // 添加"全部图片"和"未分类"两个虚拟项
    const special = [
      { id: 'all', name: '全部图片' },
      { id: 'uncategorized', name: '未分类' }
    ];
    special.reverse().forEach(spl => {
      // 若已存在同名跳过
      if (categories.find(c => c.id === spl.id)) return;
      categories.unshift(spl);
    });
  }

  // 渲染普通分类按钮（用于特殊分类项）
  function renderCategoryButton(cat) {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.textContent = cat.name;
    
    // 如果当前显示的是这个分类，添加active类
    if (currentCategoryId && cat.id && currentCategoryId.toString() === cat.id.toString()) {
      btn.classList.add('active');
    }
    
    btn.addEventListener('click', () => {
      viewCategory(cat.id, cat.name);
    });
    
    categoryListEl.appendChild(btn);
  }

  // 加载默认分类设置
  async function loadDefaultCategorySetting() {
    try {
      const res = await fetch('/api/settings/defaultCategory');
      const data = await res.json();
      
      if (data.success && data.defaultCategoryId) {
        console.log('加载到默认分类设置:', data.defaultCategoryId);
        
        // 查找该分类
        let categoryToShow = null;
        let categoryName = '';
        let parentId = null;
        
        if (data.defaultCategoryId === 'all' || data.defaultCategoryId === 'uncategorized') {
          categoryToShow = data.defaultCategoryId;
          categoryName = data.defaultCategoryId === 'all' ? '全部图片' : '未分类';
          
          // 如果找到了有效的分类，则显示它
          if (categoryToShow !== null) {
            console.log('自动显示默认分类:', categoryToShow, categoryName);
            viewCategory(categoryToShow, categoryName, parentId);
          }
        } else {
          // 不再支持自定义分类作为默认分类
          console.log('默认分类设置不是特殊分类，忽略设置');
        }
      } else {
        console.log('没有设置默认分类或加载失败');
      }
    } catch (err) {
      console.error('加载默认分类设置出错:', err);
    }
  }

  // 判断是否是普通分类（非虚拟分类如"全部"和"未分类"）
  function isNormalCategory(id) {
    return id !== 'all' && id !== 'uncategorized';
  }

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
      
      // 确保currentImages存在且有效
      if (!currentImages || !Array.isArray(currentImages)) {
        showToast('图片数据无效，请刷新页面', 'error');
        return;
      }
      
      // 获取图片对象
      const imagesToDelete = selectedImageIndices
        .map(index => currentImages[index])
        .filter(img => img && img.storage && img.path); // 确保图片有必要的属性
      
      if (imagesToDelete.length === 0) {
        showToast('选中的图片无法删除', 'error');
        return;
      }
      
      console.log('准备删除图片:', imagesToDelete);
      
      // 发送删除请求
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
        loadCategoryImages(currentCategoryId); // 重新加载当前分类图片
        clearAllSelections(); // 清除选择
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
        loadCategoryImages(currentCategoryId); // 重新加载当前分类图片
      } else {
        showToast('删除图片失败：' + (result.message || '未知错误'), 'error');
      }
    } catch (err) {
      console.error('删除图片时出错：', err);
      showToast('删除图片时发生错误', 'error');
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
}); 