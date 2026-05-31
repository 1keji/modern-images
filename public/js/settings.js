document.addEventListener('DOMContentLoaded', () => {
  // 导航相关变量
  let currentSection = 'image-quality';

  // 初始化
  initNavigation();
  initQualitySliders();
  initPresets();
  initImageDomainSettings();
  initDomainSecuritySettings();
  initDisplaySettings();
  initAnimatedSettings();

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

  // ============ 动图设置相关功能 ============

  function initAnimatedSettings() {
    const form = document.getElementById('animatedSettingsForm');
    if (!form) return;

    loadAnimatedSettings();
    form.addEventListener('submit', saveAnimatedSettings);
  }

  async function loadAnimatedSettings() {
    try {
      const response = await fetch('/api/settings');
      const result = await response.json();

      if (result.success && result.animatedAutoplay) {
        const s = result.animatedAutoplay;
        const gifEl = document.getElementById('gifAutoplay');
        const webpEl = document.getElementById('webpAutoplay');
        const avifEl = document.getElementById('avifAutoplay');
        if (gifEl) gifEl.checked = s.gif !== false;
        if (webpEl) webpEl.checked = s.webp !== false;
        if (avifEl) avifEl.checked = s.avif !== false;
      }
    } catch (error) {
      console.error('加载动图设置失败:', error);
    }
  }

  async function saveAnimatedSettings(event) {
    event.preventDefault();
    const saveBtn = document.getElementById('saveAnimatedSettingsBtn');
    const originalHTML = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    try {
      const requestData = {
        animatedAutoplay: {
          gif: document.getElementById('gifAutoplay').checked,
          webp: document.getElementById('webpAutoplay').checked,
          avif: document.getElementById('avifAutoplay').checked
        }
      };

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });

      const result = await response.json();
      if (result.success) {
        showToast('动图设置保存成功', 'success');
      } else {
        showToast(result.message || '保存失败', 'error');
      }
    } catch (error) {
      console.error('保存动图设置失败:', error);
      showToast('保存设置时发生错误', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalHTML;
    }
  }

  // 将函数暴露到全局作用域，以便调试和HTML中的onclick可以调用
  window.removeDomain = removeDomain;
  window.addDomain = addDomain;
  window.removeBackupDomainInput = removeBackupDomainInput;
  window.testCurrentDomain = testCurrentDomain;
  window.testDomainSecurityFunctionality = testDomainSecurityFunctionality;
}); 