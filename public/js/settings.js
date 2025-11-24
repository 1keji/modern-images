document.addEventListener('DOMContentLoaded', () => {
  // 导航相关变量
  let currentSection = 'image-quality';
  let categories = []; // 分类列表

  // 主要DOM元素
  const categoryListEl = document.getElementById('categoryList');
  const newCategoryNameEl = document.getElementById('newCategoryName');
  const addCategoryBtn = document.getElementById('addCategoryBtn');
  const addCategoryForm = document.getElementById('addCategoryForm');
  const defaultCategorySelect = document.getElementById('defaultCategory');
  const saveDefaultCategoryBtn = document.getElementById('saveDefaultCategoryBtn');
  
  // 二级分类相关元素
  const addSubcategoryForm = document.getElementById('addSubcategoryForm');
  const parentCategorySelect = document.getElementById('parentCategorySelect');
  const newSubcategoryNameEl = document.getElementById('newSubcategoryName');

  // 初始化
  initNavigation();
  initQualitySliders();
  initPresets();
  initImageDomainSettings();
  initDomainSecuritySettings();
  initDisplaySettings();

  // 分类管理功能初始化
  if (categoryListEl && addCategoryForm) {
    loadCategories();
    initCategoryActions();
  }

  // 默认分类设置初始化
  if (saveDefaultCategoryBtn && defaultCategorySelect) {
    loadDefaultCategorySetting();
    saveDefaultCategoryBtn.addEventListener('click', saveDefaultCategorySetting);
  }

  // 初始化导航切换功能
  function initNavigation() {
    // 侧边栏导航切换
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.hasAttribute('data-section')) {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const section = item.getAttribute('data-section');
          switchSection(section);
        });
      }
    });

    // 从URL获取初始部分
    const hash = window.location.hash.substring(1);
    if (hash && document.querySelector(`[data-section="${hash}"]`)) {
      switchSection(hash);
    }
  }

  // 切换设置部分
  function switchSection(sectionName) {
    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');

    // 更新内容区域
    document.querySelectorAll('.settings-section').forEach(section => {
      section.classList.remove('active');
    });
    document.getElementById(`${sectionName}-section`).classList.add('active');

    currentSection = sectionName;
    window.location.hash = sectionName;

    // 根据当前选择的部分加载相应数据
    if (sectionName === 'api-management') {
      loadApiSettings();
    } else if (sectionName === 'storage-config') {
      loadStorageConfig();
    } else if (sectionName === 'category-management') {
      loadCategories();
      loadDefaultCategorySetting();
    } else if (sectionName === 'image-domain') {
      loadImageDomainSettings();
    }
  }

  // 加载API设置
  function loadApiSettings() {
    // 这里可以实现API设置的加载功能
    console.log('加载API设置');
  }

  // 加载存储配置
  function loadStorageConfig() {
    // 这里可以实现存储配置的加载功能
    console.log('加载存储配置');
  }

  // 加载默认分类设置
  async function loadDefaultCategorySetting() {
    if (!defaultCategorySelect) return;
    
    try {
      const res = await fetch('/api/settings/defaultCategory');
      const data = await res.json();
      
      if (data.success) {
        // 更新选择器的值
        defaultCategorySelect.value = data.defaultCategoryId || '';
        console.log('已加载默认分类设置:', data.defaultCategoryId);
      } else {
        console.error('加载默认分类设置失败:', data.error);
      }
    } catch (err) {
      console.error('加载默认分类设置出错:', err);
    }
  }

  // 保存默认分类设置
  async function saveDefaultCategorySetting() {
    if (!defaultCategorySelect) return;
    
    const defaultCategoryId = defaultCategorySelect.value;
    console.log('保存默认分类设置:', defaultCategoryId);
    
    try {
      const res = await fetch('/api/settings/defaultCategory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCategoryId })
      });
      
      const data = await res.json();
      if (data.success) {
        showToast('默认分类设置已保存');
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch (err) {
      console.error('保存默认分类设置出错:', err);
      showToast('保存设置失败', 'error');
    }
  }

  // 初始化质量滑块
  function initQualitySliders() {
    // 质量滑块初始化
    document.querySelectorAll('.quality-slider').forEach(slider => {
      updateQualityDisplay(slider);
      slider.addEventListener('input', () => updateQualityDisplay(slider));
    });
    
    // 重置按钮
    const resetBtn = document.getElementById('resetDefaults');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetToDefaults);
    }
  }

  // 更新质量显示
  function updateQualityDisplay(slider) {
    const value = slider.value;
    const valueSpan = document.getElementById(slider.id + 'Value');
    const descSpan = document.getElementById(slider.id + 'Desc');
    
    if (valueSpan) valueSpan.textContent = value;
    if (descSpan) descSpan.textContent = getQualityDescription(parseInt(value));
  }

  // 质量描述映射
  function getQualityDescription(value) {
    if (value >= 90) return '最高质量';
    if (value >= 80) return '高质量';
    if (value >= 70) return '中等质量';
    if (value >= 60) return '低质量';
    return '压缩优先';
  }

  // 初始化预设功能
  function initPresets() {
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.closest('.preset-card').getAttribute('data-preset');
        applyPreset(preset);
      });
    });
  }

  // 应用预设
  function applyPreset(presetName) {
    const presets = {
      high: { webp: 92, avif: 85 },
      balanced: { webp: 80, avif: 75 },
      compressed: { webp: 65, avif: 60 }
    };
    
    const preset = presets[presetName];
    if (!preset) return;

    document.getElementById('webpQuality').value = preset.webp;
    document.getElementById('avifQuality').value = preset.avif;

    // 更新显示
    updateQualityDisplay(document.getElementById('webpQuality'));
    updateQualityDisplay(document.getElementById('avifQuality'));
  }

  // 恢复默认设置
  function resetToDefaults() {
    applyPreset('balanced');
    document.getElementById('pngOptimize').checked = false;
  }

  // 初始化分类管理功能
  function initCategoryActions() {
    // 添加分类表单提交事件
    if (addCategoryForm) {
      addCategoryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await addCategory();
      });
    }

    // 添加二级分类表单提交事件
    if (addSubcategoryForm) {
      addSubcategoryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await addSubcategory();
      });
    }
  }

  // 加载分类列表
  async function loadCategories() {
    if (!categoryListEl) return;
    
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      if (data.success) {
        categories = data.categories;
        renderCategoryList();
        updateDefaultCategoryOptions(); // 更新默认分类下拉列表
        updateParentCategoryOptions(); // 更新父分类下拉列表
      } else {
        showToast(data.error || '加载分类失败', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('加载分类失败', 'error');
    }
  }
  
  // 更新父分类下拉列表
  function updateParentCategoryOptions() {
    if (!parentCategorySelect) return;
    
    // 清空现有选项
    parentCategorySelect.innerHTML = '';
    
    // 添加选项提示
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- 请选择父分类 --';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    parentCategorySelect.appendChild(defaultOption);
    
    // 只添加一级分类（没有parent_id的分类）- 系统限制最多只支持二级分类
    const parentCategories = categories.filter(cat => 
      cat.id !== 'all' && cat.id !== 'uncategorized' && !cat.parent_id
    );
    
    parentCategories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      parentCategorySelect.appendChild(option);
    });
    
    // 添加帮助提示，说明分类层级限制
    const parentSelectHelp = document.getElementById('parentCategorySelectHelp');
    if (!parentSelectHelp) {
      const helpText = document.createElement('div');
      helpText.id = 'parentCategorySelectHelp';
      helpText.className = 'form-help';
      helpText.textContent = '系统限制最多只支持二级分类，只能选择一级分类作为父分类。';
      if (parentCategorySelect.nextElementSibling) {
        parentCategorySelect.parentNode.insertBefore(helpText, parentCategorySelect.nextElementSibling);
      } else {
        parentCategorySelect.parentNode.appendChild(helpText);
      }
    }
  }

  // 更新默认分类选择器的选项
  function updateDefaultCategoryOptions() {
    if (!defaultCategorySelect) return;
    
    // 清空现有选项，只保留第一个"不自动显示"的选项
    while (defaultCategorySelect.options.length > 1) {
      defaultCategorySelect.remove(1);
    }
    
    // 添加"全部图片"和"未分类"选项
    const specialOptions = [
      { id: 'all', name: '全部图片' },
      { id: 'uncategorized', name: '未分类' }
    ];
    
    specialOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.id;
      option.textContent = opt.name;
      defaultCategorySelect.appendChild(option);
    });
    
    // 不再添加用户创建的分类，只保留前三个选项
  }

  // 添加新分类
  async function addCategory() {
    const name = newCategoryNameEl.value.trim();
    if (!name) return;
    
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      
      if (data.success) {
        newCategoryNameEl.value = ''; // 清空输入框
        await loadCategories(); // 重新加载分类列表
        showToast('分类已添加');
      } else {
        showToast(data.error || '添加失败', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('添加分类失败', 'error');
    }
  }
  
  // 添加新二级分类
  async function addSubcategory() {
    const parentId = parentCategorySelect.value;
    const name = newSubcategoryNameEl.value.trim();
    
    if (!parentId) {
      showToast('请选择父分类', 'error');
      return;
    }
    
    if (!name) {
      showToast('请输入二级分类名称', 'error');
      return;
    }
    
    // 验证选择的父分类是一级分类
    const parentCategory = categories.find(cat => cat.id && cat.id.toString() === parentId.toString());
    if (!parentCategory) {
      showToast('所选父分类不存在', 'error');
      return;
    }
    
    if (parentCategory.parent_id) {
      showToast('系统限制最多只支持二级分类，只能选择一级分类作为父分类', 'error');
      return;
    }
    
    try {
      const res = await fetch('/api/categories/subcategory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId })
      });
      const data = await res.json();
      
      if (data.success) {
        newSubcategoryNameEl.value = ''; // 清空输入框
        parentCategorySelect.selectedIndex = 0; // 重置下拉选择
        await loadCategories(); // 重新加载分类列表
        showToast('二级分类已添加');
      } else {
        showToast(data.error || '添加二级分类失败', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('添加二级分类失败', 'error');
    }
  }

  // 渲染分类列表
  function renderCategoryList() {
    if (!categoryListEl) return;
    
    categoryListEl.innerHTML = '';
    // 过滤出一级分类
    const topLevelCategories = categories.filter(cat => cat.id !== 'all' && cat.id !== 'uncategorized' && !cat.parent_id);
    
    if (topLevelCategories.length === 0) {
      categoryListEl.innerHTML = '<p style="color: var(--text-secondary);">暂无分类，请先添加。</p>';
      return;
    }
    
    // 先渲染所有一级分类
    topLevelCategories.forEach(cat => {
      // 获取当前分类的子分类
      const subCategories = categories.filter(c => c.parent_id === cat.id);
      const hasSubcategories = subCategories.length > 0;
      
      // 创建一级分类项
      const item = createCategoryItem(cat);
      categoryListEl.appendChild(item);
      
      // 如果有子分类，创建一个容器并添加所有子分类
      if (hasSubcategories) {
        const subContainer = document.createElement('div');
        subContainer.className = 'subcategory-container';
        subContainer.style.marginLeft = '20px';
        subContainer.style.paddingLeft = '10px';
        subContainer.style.borderLeft = '1px solid var(--border-color)';
        
        // 渲染所有子分类
        subCategories.forEach(subCat => {
          const subItem = createCategoryItem(subCat, true);
          subContainer.appendChild(subItem);
        });
        
        categoryListEl.appendChild(subContainer);
      }
    });
  }
  
  // 创建分类项
  function createCategoryItem(cat, isSubcategory = false) {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.justifyContent = 'space-between';
    item.style.padding = '8px 0';
    item.style.borderBottom = '1px solid var(--border-color)';

    const nameSpan = document.createElement('span');
    
    // 为子分类添加前缀标记
    if (isSubcategory) {
      const prefix = document.createElement('span');
      prefix.textContent = '└─ ';
      prefix.style.color = 'var(--text-secondary)';
      nameSpan.appendChild(prefix);
    }
    
    const textNode = document.createTextNode(cat.name);
    nameSpan.appendChild(textNode);
    nameSpan.style.cursor = 'default';

    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '6px';

    // 编辑按钮
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-icon';
    editBtn.title = '重命名';
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    editBtn.addEventListener('click', () => renameCategory(cat));

    // 删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-icon';
    deleteBtn.title = '删除';
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
    deleteBtn.addEventListener('click', () => deleteCategory(cat));

    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);

    item.appendChild(nameSpan);
    item.appendChild(actionsDiv);
    
    return item;
  }

  // 重命名分类
  async function renameCategory(cat) {
    const newName = prompt('请输入新的分类名称', cat.name);
    if (!newName || newName.trim() === '' || newName === cat.name) return;
    
    try {
      const res = await fetch(`/api/categories/${cat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      const data = await res.json();
      
      if (data.success) {
        await loadCategories();
        showToast('已重命名');
      } else {
        showToast(data.error || '重命名失败', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('重命名失败', 'error');
    }
  }

  // 删除分类
  async function deleteCategory(cat) {
    if (!confirm(`确定删除分类 "${cat.name}" ?`)) return;
    
    try {
      const res = await fetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      const data = await res.json();
      
      if (data.success) {
        await loadCategories();
        showToast('已删除');
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('删除失败', 'error');
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

  // 复制功能
  function copyToClipboard(text, successMessage) {
    if (!text) {
      showMessage('没有可复制的内容', 'error');
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
      document.body.removeChild(textArea);
      
      if (successful) {
        showToast(successMessage);
      } else {
        showToast('复制失败，请手动复制', 'error');
      }
    } catch (err) {
      console.error('复制失败:', err);
      showToast('复制失败，请手动复制', 'error');
    }
  }

  // ============ 图片域名设置相关功能 ============

  // 初始化图片域名设置
  function initImageDomainSettings() {
    const enableImageDomain = document.getElementById('enableImageDomain');
    const imageDomainForm = document.getElementById('imageDomainForm');
    const migrateUrlsBtn = document.getElementById('migrateUrlsBtn');
    const addBackupDomainBtn = document.getElementById('addBackupDomain');

    // 检查元素是否正确加载
    if (!addBackupDomainBtn) {
      console.warn('找不到 addBackupDomain 按钮元素');
    }

    if (enableImageDomain) {
      enableImageDomain.addEventListener('change', toggleImageDomainConfig);
    }

    if (imageDomainForm) {
      imageDomainForm.addEventListener('submit', saveImageDomainSettings);
    }

    if (migrateUrlsBtn) {
      migrateUrlsBtn.addEventListener('click', migrateImageUrls);
    }

    // 使用事件委托来处理备用域名按钮点击（仅在首次初始化时绑定）
    if (!window.backupDomainEventBound) {
      document.addEventListener('click', function(event) {
        if (event.target && event.target.id === 'addBackupDomain') {
          event.preventDefault();
          addBackupDomainInput();
        }
      });
      window.backupDomainEventBound = true;
    }

  }

  // 加载图片域名设置
  async function loadImageDomainSettings() {
    try {
      const response = await fetch('/api/settings');
      const result = await response.json();

      if (result.success && result.imageDomain) {
        const config = result.imageDomain;
        
        // 填充表单
        const enableImageDomain = document.getElementById('enableImageDomain');
        const imageDomain = document.getElementById('imageDomain');
        const httpsOnly = document.getElementById('httpsOnly');

        if (enableImageDomain) {
          enableImageDomain.checked = config.enabled;
        }
        
        if (imageDomain) {
          imageDomain.value = config.domain || '';
        }
        
        // 加载备用域名
        loadBackupDomains(config.backupDomains || []);
        
        if (httpsOnly) {
          httpsOnly.checked = config.httpsOnly !== false;
        }

        // 更新UI显示
        toggleImageDomainConfig();
      }
    } catch (error) {
      console.error('加载图片域名设置失败:', error);
      showToast('加载图片域名设置失败', 'error');
    }
  }

  // 切换图片域名配置显示
  function toggleImageDomainConfig() {
    const enableImageDomain = document.getElementById('enableImageDomain');
    const imageDomainConfig = document.getElementById('imageDomainConfig');
    const backupDomainsConfig = document.getElementById('backupDomainsConfig');
    const httpsConfig = document.getElementById('httpsConfig');
    const domainExample = document.getElementById('domainExample');
    const urlMigrationSection = document.getElementById('urlMigrationSection');

    const isEnabled = enableImageDomain && enableImageDomain.checked;

    if (imageDomainConfig) {
      imageDomainConfig.style.display = isEnabled ? 'block' : 'none';
    }
    
    if (backupDomainsConfig) {
      backupDomainsConfig.style.display = isEnabled ? 'block' : 'none';
    }
    
    if (httpsConfig) {
      httpsConfig.style.display = isEnabled ? 'block' : 'none';
    }
    
    if (domainExample) {
      domainExample.style.display = isEnabled ? 'block' : 'none';
    }
    
    if (urlMigrationSection) {
      urlMigrationSection.style.display = isEnabled ? 'block' : 'none';
    }

    // 如果启用了域名，设置必填验证
    const imageDomainInput = document.getElementById('imageDomain');
    if (imageDomainInput) {
      imageDomainInput.required = isEnabled;
    }
  }

  // 保存图片域名设置
  async function saveImageDomainSettings(event) {
    event.preventDefault();

    const enableImageDomain = document.getElementById('enableImageDomain');
    const imageDomain = document.getElementById('imageDomain');
    const httpsOnly = document.getElementById('httpsOnly');
    const saveBtn = document.getElementById('saveImageDomainBtn');

    // 验证表单
    if (enableImageDomain.checked && (!imageDomain.value || imageDomain.value.trim() === '')) {
      showToast('请输入图片域名', 'error');
      imageDomain.focus();
      return;
    }

    // 验证主域名格式
    if (enableImageDomain.checked && imageDomain.value) {
      const domain = imageDomain.value.trim();
      const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!domainRegex.test(domain)) {
        showToast('请输入有效的主图片域名格式', 'error');
        imageDomain.focus();
        return;
      }
    }

    // 验证备用域名格式
    if (enableImageDomain.checked) {
      const validation = validateBackupDomains();
      if (!validation.isValid) {
        showToast(validation.errorMessage, 'error');
        return;
      }
    }

    // 显示保存状态
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    try {
      // 收集备用域名数据
      const backupDomains = collectBackupDomains();
      
      const requestData = {
        imageDomain: {
          enabled: enableImageDomain.checked,
          domain: imageDomain.value.trim(),
          httpsOnly: httpsOnly.checked,
          backupDomains: backupDomains
        }
      };

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });

      const result = await response.json();

      if (result.success) {
        showToast(result.message || '图片域名设置保存成功', 'success');
        
        // 如果域名配置发生了变化，提示用户关于新图片的处理方式
        if (enableImageDomain.checked && imageDomain.value.trim()) {
          showToast('域名配置已更新！新上传的图片将使用新域名，现有图片保持原有链接不变', 'info', 6000);
        }
      } else {
        showToast(result.message || '保存图片域名设置失败', 'error');
      }
    } catch (error) {
      console.error('保存图片域名设置失败:', error);
      showToast('保存设置时发生错误', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  }

  // 强制迁移所有图片URL到新域名
  async function migrateImageUrls() {
    // 第一次确认
    if (!confirm('⚠️ 确定要强制迁移所有图片到新域名吗？\n\n此操作将：\n• 覆盖所有现有图片的URL\n• 可能导致之前分享的链接失效\n• 无法撤销\n\n请确保新域名已正确配置并可访问！')) {
      return;
    }

    // 第二次确认
    if (!confirm('🔄 最后确认：强制迁移所有图片URL？\n\n点击"确定"开始迁移，点击"取消"终止操作。')) {
      return;
    }

    const migrateBtn = document.getElementById('migrateUrlsBtn');
    const originalText = migrateBtn.textContent;
    
    migrateBtn.disabled = true;
    migrateBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
      迁移中...
    `;

    try {
      const response = await fetch('/api/migrate-image-urls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ forceUpdate: true })
      });

      const result = await response.json();

      if (result.success) {
        showToast(result.message, 'success', 6000);
        console.log(`URL强制迁移完成: 更新${result.updatedCount}张图片，失败${result.errorCount}张`);
        
        // 额外提示迁移完成
        showToast('✅ 所有图片已成功迁移到新域名！请测试图片链接是否正常访问', 'success', 5000);
      } else {
        showToast(result.message || 'URL强制迁移失败', 'error');
      }
    } catch (error) {
      console.error('强制迁移URL失败:', error);
      showToast('强制迁移URL时发生错误', 'error');
    } finally {
      migrateBtn.disabled = false;
      migrateBtn.innerHTML = originalText;
    }
  }

  // 域名安全设置功能
  let domainSecuritySettings = {
    enabled: false,
    allowedDomains: [],
    redirectToMain: false,
    mainDomain: ''
  };

  function initDomainSecuritySettings() {
    const enableDomainSecurity = document.getElementById('enableDomainSecurity');
    const enableRedirectToMain = document.getElementById('enableRedirectToMain');
    const domainSecurityForm = document.getElementById('domainSecurityForm');
    const addDomainBtn = document.getElementById('addDomainBtn');
    const newDomainInput = document.getElementById('newDomain');
    const testDomainSecurityBtn = document.getElementById('testDomainSecurity');

    console.log('域名安全设置初始化:', {
      enableDomainSecurity: !!enableDomainSecurity,
      enableRedirectToMain: !!enableRedirectToMain,
      domainSecurityForm: !!domainSecurityForm,
      addDomainBtn: !!addDomainBtn,
      newDomainInput: !!newDomainInput,
      testDomainSecurityBtn: !!testDomainSecurityBtn
    });

    if (!enableDomainSecurity || !domainSecurityForm) {
      console.error('域名安全设置元素未找到');
      return;
    }

    // 加载现有设置
    loadDomainSecuritySettings();

    // 绑定事件
    enableDomainSecurity.addEventListener('change', toggleDomainSecurityConfig);
    enableRedirectToMain.addEventListener('change', toggleRedirectConfig);
    domainSecurityForm.addEventListener('submit', saveDomainSecuritySettings);
    addDomainBtn.addEventListener('click', function() {
      console.log('添加域名按钮被点击');
      addDomain();
    });
    newDomainInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addDomain();
      }
    });
    testDomainSecurityBtn.addEventListener('click', testCurrentDomain);

    // 更新当前域名显示
    updateCurrentDomainDisplay();
  }

  function loadDomainSecuritySettings() {
    fetch('/api/settings')
      .then(response => response.json())
      .then(data => {
        if (data.success && data.domainSecurity) {
          domainSecuritySettings = { ...data.domainSecurity };
          updateDomainSecurityUI();
          updateStatusDisplay();
        }
      })
      .catch(error => {
        console.error('加载域名安全设置失败:', error);
        showToast('无法加载域名安全设置', 'error');
      });
  }

  function updateDomainSecurityUI() {
    const enableDomainSecurity = document.getElementById('enableDomainSecurity');
    const enableRedirectToMain = document.getElementById('enableRedirectToMain');
    const mainDomainInput = document.getElementById('mainDomain');

    enableDomainSecurity.checked = domainSecuritySettings.enabled;
    enableRedirectToMain.checked = domainSecuritySettings.redirectToMain;
    mainDomainInput.value = domainSecuritySettings.mainDomain || '';

    toggleDomainSecurityConfig();
    toggleRedirectConfig();
    renderDomainList();
  }

  function toggleDomainSecurityConfig() {
    const enabled = document.getElementById('enableDomainSecurity').checked;
    const configElements = document.querySelectorAll('.domain-config');
    
    configElements.forEach(el => {
      el.style.display = enabled ? 'block' : 'none';
    });
  }

  function toggleRedirectConfig() {
    const enabled = document.getElementById('enableRedirectToMain').checked;
    const mainDomainConfig = document.getElementById('mainDomainConfig');
    
    if (mainDomainConfig) {
      mainDomainConfig.style.display = enabled ? 'block' : 'none';
    }
  }

  function renderDomainList() {
    const domainList = document.getElementById('domainList');
    if (!domainList) return;

    if (domainSecuritySettings.allowedDomains.length === 0) {
      domainList.innerHTML = '<div class="domain-empty-state">暂无允许的域名</div>';
      return;
    }

    domainList.innerHTML = domainSecuritySettings.allowedDomains.map((domain, index) => {
      const isWildcard = domain.startsWith('*.');
      const typeLabel = isWildcard ? '通配符' : '精确';
      
      return `
        <div class="domain-item">
          <div class="domain-info">
            <span class="domain-name">${domain}</span>
            <span class="domain-type">${typeLabel}</span>
          </div>
          <div class="domain-actions">
            <button type="button" class="remove-domain-btn" onclick="window.removeDomain(${index})">
              删除
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function addDomain() {
    console.log('addDomain 函数被调用');
    const newDomainInput = document.getElementById('newDomain');
    if (!newDomainInput) {
      console.error('newDomain 输入框未找到');
      showToast('输入框未找到，请刷新页面', 'error');
      return;
    }
    
    const domain = newDomainInput.value.trim().toLowerCase();
    console.log('输入的域名:', domain);

    if (!domain) {
      showToast('请输入有效的域名', 'error');
      return;
    }

    // 基本域名格式验证
    const domainRegex = /^(\*\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$|^localhost$|^\d+\.\d+\.\d+\.\d+$/;
    if (!domainRegex.test(domain)) {
      showToast('域名格式无效，请输入有效的域名格式（支持通配符 *.example.com）', 'error');
      return;
    }

    // 检查是否已存在
    if (domainSecuritySettings.allowedDomains.includes(domain)) {
      showToast('该域名已在允许列表中', 'error');
      return;
    }

    try {
      // 添加到列表
      domainSecuritySettings.allowedDomains.push(domain);
      newDomainInput.value = '';
      renderDomainList();
      updateStatusDisplay();
      showToast(`域名 "${domain}" 已添加到白名单`, 'success');
      console.log('域名添加成功:', domain);
      console.log('当前域名列表:', domainSecuritySettings.allowedDomains);
    } catch (error) {
      console.error('添加域名时出错:', error);
      showToast('添加域名时发生错误', 'error');
    }
  }

  function removeDomain(index) {
    if (index >= 0 && index < domainSecuritySettings.allowedDomains.length) {
      const removedDomain = domainSecuritySettings.allowedDomains[index];
      domainSecuritySettings.allowedDomains.splice(index, 1);
      renderDomainList();
      updateStatusDisplay();
      showToast(`域名 "${removedDomain}" 已从白名单移除`, 'success');
    }
  }

  function saveDomainSecuritySettings(e) {
    e.preventDefault();

    const enabled = document.getElementById('enableDomainSecurity').checked;
    const redirectToMain = document.getElementById('enableRedirectToMain').checked;
    const mainDomain = document.getElementById('mainDomain').value.trim().toLowerCase();

    // 验证设置
    if (enabled && domainSecuritySettings.allowedDomains.length === 0) {
      showToast('启用域名安全验证时必须至少添加一个允许的域名', 'error');
      return;
    }

    if (redirectToMain && !mainDomain) {
      showToast('启用重定向时必须设置主域名', 'error');
      return;
    }

    if (redirectToMain && !domainSecuritySettings.allowedDomains.includes(mainDomain)) {
      showToast('主域名必须在允许的域名列表中', 'error');
      return;
    }

    const settingsData = {
      domainSecurity: {
        enabled: enabled,
        allowedDomains: domainSecuritySettings.allowedDomains,
        redirectToMain: redirectToMain,
        mainDomain: mainDomain
      }
    };

    // 保存设置
    fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settingsData)
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        domainSecuritySettings = { ...data.domainSecurity };
        updateStatusDisplay();
        showToast('域名安全设置已更新', 'success');
      } else {
        showToast(data.message || '保存失败', 'error');
      }
    })
    .catch(error => {
      console.error('保存域名安全设置失败:', error);
      showToast('网络错误，请稍后重试', 'error');
    });
  }

  function testCurrentDomain() {
    const currentDomain = window.location.hostname;
    const enabled = domainSecuritySettings.enabled;
    const allowedDomains = domainSecuritySettings.allowedDomains;

    if (!enabled) {
      showToast('当前未启用域名安全验证，所有域名都可以访问', 'info');
      return;
    }

    const isAllowed = allowedDomains.some(allowedDomain => {
      if (allowedDomain.startsWith('*.')) {
        const baseDomain = allowedDomain.substring(2);
        return currentDomain === baseDomain || currentDomain.endsWith('.' + baseDomain);
      }
      return currentDomain === allowedDomain;
    });

    if (isAllowed) {
      showToast(`当前域名 "${currentDomain}" 在允许列表中`, 'success');
    } else {
      showToast(`当前域名 "${currentDomain}" 不在允许列表中`, 'error');
    }
  }

  function updateCurrentDomainDisplay() {
    const currentDomainEl = document.getElementById('currentDomain');
    if (currentDomainEl) {
      currentDomainEl.textContent = window.location.hostname;
    }
  }

  function updateStatusDisplay() {
    const securityStatusEl = document.getElementById('securityStatus');
    const allowedDomainsCountEl = document.getElementById('allowedDomainsCount');

    if (securityStatusEl) {
      const enabled = domainSecuritySettings.enabled;
      securityStatusEl.textContent = enabled ? '已启用' : '未启用';
      securityStatusEl.className = enabled ? 'status-enabled' : 'status-disabled';
    }

    if (allowedDomainsCountEl) {
      allowedDomainsCountEl.textContent = domainSecuritySettings.allowedDomains.length;
    }
  }

  // 测试函数，用于调试
  function testDomainSecurityFunctionality() {
    console.log('=== 域名安全功能测试 ===');
    console.log('domainSecuritySettings:', domainSecuritySettings);
    
    const elements = {
      enableDomainSecurity: document.getElementById('enableDomainSecurity'),
      newDomain: document.getElementById('newDomain'),
      addDomainBtn: document.getElementById('addDomainBtn'),
      domainList: document.getElementById('domainList')
    };
    
    console.log('DOM元素检查:', elements);
    
    // 测试添加域名
    if (elements.newDomain) {
      elements.newDomain.value = 'test.example.com';
      console.log('设置测试域名: test.example.com');
      
      // 模拟添加
      addDomain();
    }
    
    // 检查图片域名配置
    fetch('/api/settings')
      .then(response => response.json())
      .then(data => {
        if (data.success && data.imageDomain) {
          console.log('图片域名配置:', data.imageDomain);
          if (data.imageDomain.enabled) {
            console.log(`图片域名 "${data.imageDomain.domain}" 会自动允许访问图片资源`);
          }
        }
      })
      .catch(error => console.error('获取图片域名配置失败:', error));
  }

  // ============ 备用图片域名相关功能 ============
  
  // 加载备用域名到界面
  function loadBackupDomains(domains) {
    const backupDomainsList = document.getElementById('backupDomainsList');
    if (!backupDomainsList) return;
    
    backupDomainsList.innerHTML = '';
    
    if (domains && domains.length > 0) {
      domains.forEach((domain, index) => {
        if (domain && domain.trim()) {
          addBackupDomainInput(domain.trim(), index);
        }
      });
    }
  }
  
  // 添加备用域名输入框
  function addBackupDomainInput(value = '', index = null) {
    const backupDomainsList = document.getElementById('backupDomainsList');
    if (!backupDomainsList) {
      console.error('找不到 backupDomainsList 元素');
      return;
    }
    
    const domainItem = document.createElement('div');
    domainItem.className = 'backup-domain-item';
    domainItem.innerHTML = `
      <input type="text" 
             class="backup-domain-input" 
             placeholder="例如: old-img.example.com" 
             value="${value}"
             data-index="${index !== null ? index : Date.now()}">
      <button type="button" class="remove-backup-domain" onclick="removeBackupDomainInput(this)">
        删除
      </button>
    `;
    
    backupDomainsList.appendChild(domainItem);
  }
  
  // 删除备用域名输入框
  function removeBackupDomainInput(button) {
    const domainItem = button.closest('.backup-domain-item');
    if (domainItem) {
      domainItem.remove();
    }
  }
  
  // 收集所有备用域名
  function collectBackupDomains() {
    const inputs = document.querySelectorAll('.backup-domain-input');
    const domains = [];
    
    inputs.forEach(input => {
      const value = input.value.trim();
      if (value) {
        // 验证域名格式
        const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (domainRegex.test(value)) {
          domains.push(value);
        }
      }
    });
    
    return domains;
  }
  
  // 验证所有备用域名
  function validateBackupDomains() {
    const inputs = document.querySelectorAll('.backup-domain-input');
    let isValid = true;
    let errorMessage = '';
    
    inputs.forEach((input, index) => {
      const value = input.value.trim();
      if (value) {
        const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!domainRegex.test(value)) {
          isValid = false;
          errorMessage = `备用域名 ${index + 1} 格式无效：${value}`;
          input.style.borderColor = 'var(--error-color)';
        } else {
          input.style.borderColor = '';
        }
      }
    });
    
    return { isValid, errorMessage };
  }

  // ============ 显示设置相关功能 ============

  // 初始化显示设置
  function initDisplaySettings() {
    const displaySettingsForm = document.getElementById('displaySettingsForm');
    const showRecentUploadsCheckbox = document.getElementById('showRecentUploads');

    if (!displaySettingsForm || !showRecentUploadsCheckbox) {
      console.warn('显示设置元素未找到');
      return;
    }

    // 加载现有设置
    loadDisplaySettings();

    // 绑定表单提交事件
    displaySettingsForm.addEventListener('submit', saveDisplaySettings);
  }

  // 加载显示设置
  async function loadDisplaySettings() {
    try {
      const response = await fetch('/api/settings');
      const result = await response.json();

      if (result.success && result.displaySettings) {
        const showRecentUploadsCheckbox = document.getElementById('showRecentUploads');
        if (showRecentUploadsCheckbox) {
          showRecentUploadsCheckbox.checked = result.displaySettings.showRecentUploads !== false;
        }
      }
    } catch (error) {
      console.error('加载显示设置失败:', error);
      showToast('加载显示设置失败', 'error');
    }
  }

  // 保存显示设置
  async function saveDisplaySettings(event) {
    event.preventDefault();

    const showRecentUploadsCheckbox = document.getElementById('showRecentUploads');
    const saveBtn = document.getElementById('saveDisplaySettingsBtn');

    if (!showRecentUploadsCheckbox) {
      showToast('设置元素未找到', 'error');
      return;
    }

    // 显示保存状态
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line></svg> 保存中...';

    try {
      const requestData = {
        displaySettings: {
          showRecentUploads: showRecentUploadsCheckbox.checked
        }
      };

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });

      const result = await response.json();

      if (result.success) {
        showToast('显示设置保存成功', 'success');
      } else {
        showToast(result.message || '保存显示设置失败', 'error');
      }
    } catch (error) {
      console.error('保存显示设置失败:', error);
      showToast('保存设置时发生错误', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
    }
  }

  // 将函数暴露到全局作用域，以便调试和HTML中的onclick可以调用
  window.removeDomain = removeDomain;
  window.addDomain = addDomain;
  window.removeBackupDomainInput = removeBackupDomainInput;
  window.testCurrentDomain = testCurrentDomain;
  window.testDomainSecurityFunctionality = testDomainSecurityFunctionality;
}); 