/**
 * 相册图片库模块
 * 与 gallery.js 保持一致的交互风格，附加相册专属操作
 */
(function () {
  // ── 状态 ───────────────────────────────────────────────────
  let currentAlbumId = null;
  let uncategorizedAlbumId = null;
  let allAlbums = [];
  let pendingMoveTargetId = null;
  let pendingMoveImageIds = [];
  let currentPage = 1;
  let totalPages = 1;
  let imagesPerPage = parseInt(localStorage.getItem('albumGalleryPerPage')) || 50;
  let albumImages = [];          // 当前页图片
  let selectedIndices = [];
  let lastSelectedIndex = null;
  let currentImageIndex = -1;
  let isLoading = false;
  let lazyLoadObserver = null;
  let lazyLoadRetryTimer = null;
  let imageModal = null;
  let keyNavListener = null;
  const imageCache = {};
  let animatedAutoplaySettings = { gif: true, webp: true, avif: true };

  // ── DOM 引用（在 openAlbumGallery 后才可用）────────────────
  function el(id) { return document.getElementById(id); }

  // ── Toast ──────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, type = 'success') {
    let tc = document.getElementById('ag-toast-container');
    if (!tc) {
      tc = document.createElement('div');
      tc.id = 'ag-toast-container';
      tc.className = 'toast-container';
      document.body.appendChild(tc);
    }
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icon = type === 'success'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    t.innerHTML = `<div class="toast-icon">${icon}</div><div class="toast-content"><div class="toast-title">${type === 'success' ? '成功' : '错误'}</div><div class="toast-message">${msg}</div></div><button class="toast-close">&times;</button>`;
    tc.appendChild(t);
    t.offsetHeight;
    t.classList.add('show');
    const remove = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
    t.querySelector('.toast-close').addEventListener('click', remove);
    setTimeout(remove, 3000);
  }

  // ── 格式化 ─────────────────────────────────────────────────
  function formatBytes(bytes, dec = 1) {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dec)) + ' ' + s[i];
  }

  // ── 剪贴板 ─────────────────────────────────────────────────
  function copyToClipboard(text, msg) {
    if (!text) return;
    const write = () => showToast(msg || '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(write).catch(() => fallbackCopy(text, msg));
    } else {
      fallbackCopy(text, msg);
    }
  }
  function fallbackCopy(text, msg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(msg || '已复制'); } catch (_) { showToast('复制失败', 'error'); }
    document.body.removeChild(ta);
  }

  // ── 动图设置 ───────────────────────────────────────────────
  async function loadAnimatedSettings() {
    try {
      const r = await fetch('/api/settings');
      const d = await r.json();
      if (d.success && d.animatedAutoplay) {
        animatedAutoplaySettings = {
          gif: d.animatedAutoplay.gif !== false,
          webp: d.animatedAutoplay.webp !== false,
          avif: d.animatedAutoplay.avif !== false
        };
      }
    } catch (_) {}
  }
  function isAnimated(img) {
    return img.format === 'gif' || ((img.format === 'webp' || img.format === 'avif') && img.isAnimated);
  }
  function shouldShowStatic(img) {
    if (!isAnimated(img)) return false;
    return !animatedAutoplaySettings[img.format];
  }
  function tryMakeStaticFrame(imgEl, container, img) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth || 200;
      canvas.height = imgEl.naturalHeight || 200;
      canvas.className = 'gallery-img loaded static-frame';
      canvas.style.cssText = 'object-fit:cover;width:100%;height:100%';
      canvas.getContext('2d').drawImage(imgEl, 0, 0);
      imgEl.parentNode.insertBefore(canvas, imgEl);
      imgEl.style.display = 'none';
      container.addEventListener('mouseenter', () => { canvas.style.display = 'none'; imgEl.style.display = ''; imgEl.classList.add('loaded'); container.querySelector('.animated-badge')?.classList.add('playing'); });
      container.addEventListener('mouseleave', () => { canvas.style.display = ''; imgEl.style.display = 'none'; container.querySelector('.animated-badge')?.classList.remove('playing'); });
      return true;
    } catch (_) { return false; }
  }

  // ── 懒加载 ─────────────────────────────────────────────────
  function cleanupLazyLoad() {
    if (lazyLoadRetryTimer) { clearTimeout(lazyLoadRetryTimer); lazyLoadRetryTimer = null; }
    if (lazyLoadObserver) { lazyLoadObserver.disconnect(); lazyLoadObserver = null; }
  }
  function initLazyLoadWithRetry(retry = 0) {
    if (lazyLoadRetryTimer) { clearTimeout(lazyLoadRetryTimer); lazyLoadRetryTimer = null; }
    const imgs = document.querySelectorAll('#albumGallery .gallery-img[data-src]');
    if (imgs.length === 0) {
      if (retry < 3) lazyLoadRetryTimer = setTimeout(() => initLazyLoadWithRetry(retry + 1), 60);
      return;
    }
    if (lazyLoadObserver) { lazyLoadObserver.disconnect(); lazyLoadObserver = null; }
    if ('IntersectionObserver' in window) {
      lazyLoadObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          const src = img.dataset.src;
          if (!src) { obs.unobserve(img); return; }
          img.onload = () => {
            img.closest('.gallery-img-container')?.querySelector('.loading-placeholder')?.remove();
            const item = img.closest('.gallery-item');
            if (item?.dataset.animated === 'true') {
              const idx = parseInt(item.dataset.index);
              const imgData = albumImages[idx];
              if (imgData && shouldShowStatic(imgData)) {
                if (tryMakeStaticFrame(img, img.closest('.gallery-img-container'), imgData)) return;
              }
            }
            img.classList.add('loaded');
          };
          img.onerror = () => { img.classList.add('error'); img.closest('.loading-placeholder')?.remove(); };
          img.src = src;
          img.removeAttribute('data-src');
          obs.unobserve(img);
        });
      }, { rootMargin: '60px', threshold: 0.01 });
      imgs.forEach(img => lazyLoadObserver.observe(img));
    } else {
      imgs.forEach(img => { if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); } });
    }
  }

  // ── 选择管理 ───────────────────────────────────────────────
  function clearSelections() {
    selectedIndices = [];
    document.querySelectorAll('#albumGallery .gallery-item').forEach(i => i.classList.remove('selected'));
  }
  function selectItem(index) {
    if (!selectedIndices.includes(index)) selectedIndices.push(index);
    document.querySelectorAll('#albumGallery .gallery-item')[index]?.classList.add('selected');
  }
  function toggleSelection(index) {
    const items = document.querySelectorAll('#albumGallery .gallery-item');
    if (selectedIndices.includes(index)) {
      selectedIndices = selectedIndices.filter(i => i !== index);
      items[index]?.classList.remove('selected');
    } else {
      selectedIndices.push(index);
      items[index]?.classList.add('selected');
    }
  }

  // ── 分页 ───────────────────────────────────────────────────
  function buildPagination(total, page, limit, tp) {
    currentPage = page; totalPages = tp;
    ['agPageNumbers', 'agPageNumbersBottom'].forEach(cid => {
      const c = el(cid); if (!c) return;
      c.innerHTML = '';
      const max = 5;
      const addBtn = (n) => {
        const b = document.createElement('div');
        b.className = 'page-number' + (n === currentPage ? ' active' : '');
        b.textContent = n;
        b.addEventListener('click', () => { if (n !== currentPage) { currentPage = n; loadAlbumImages(); } });
        c.appendChild(b);
      };
      const addDots = () => { const d = document.createElement('div'); d.className = 'page-number page-ellipsis'; d.textContent = '...'; c.appendChild(d); };
      if (tp <= max) { for (let i = 1; i <= tp; i++) addBtn(i); }
      else {
        addBtn(1);
        let s = Math.max(2, page - 1), e = Math.min(tp - 1, s + max - 3);
        if (e - s < max - 3) s = Math.max(2, e - (max - 3));
        if (s > 2) addDots();
        for (let i = s; i <= e; i++) addBtn(i);
        if (e < tp - 1) addDots();
        addBtn(tp);
      }
    });

    const start = total > 0 ? (page - 1) * limit + 1 : 0;
    const end = Math.min(page * limit, total);
    const info = el('agPaginationInfo');
    if (info) info.textContent = `显示 ${start}–${end}，共 ${total} 张图片`;

    ['agPrevPage', 'agPrevPageBottom'].forEach(id => { const b = el(id); if (b) b.disabled = page <= 1; });
    ['agNextPage', 'agNextPageBottom'].forEach(id => { const b = el(id); if (b) b.disabled = page >= tp; });
  }

  // ── 加载图片 ───────────────────────────────────────────────
  async function loadAlbumImages() {
    if (isLoading || !currentAlbumId) return;
    isLoading = true;
    cleanupLazyLoad();

    const gallery = el('albumGallery');
    if (!gallery) { isLoading = false; return; }
    const savedView = localStorage.getItem('albumGalleryView') || 'grid';
    gallery.className = savedView === 'grid' ? 'gallery-grid' : 'gallery-list';
    gallery.innerHTML = `<div class="loading-container"><div class="loading-spinner"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg></div><p>正在加载...</p></div>`;

    try {
      const r = await fetch(`/api/albums/${currentAlbumId}/images?page=${currentPage}&limit=${imagesPerPage}`);
      const data = await r.json();
      if (!data.success) throw new Error(data.error || '加载失败');
      albumImages = data.images;
      buildPagination(data.pagination.total, data.pagination.page, data.pagination.limit, data.pagination.totalPages);
      renderGallery(albumImages);
    } catch (err) {
      gallery.innerHTML = `<div class="error-message"><p>加载失败：${err.message}</p><button onclick="window.albumGallery.reload()" style="margin-top:12px;padding:6px 14px;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;">重试</button></div>`;
      showToast(err.message, 'error');
    } finally { isLoading = false; }
  }

  // ── 渲染图片 ───────────────────────────────────────────────
  function renderGallery(images) {
    const gallery = el('albumGallery'); if (!gallery) return;
    const savedView = localStorage.getItem('albumGalleryView') || 'grid';
    const isGrid = savedView === 'grid';
    gallery.className = isGrid ? 'gallery-grid' : 'gallery-list';
    gallery.innerHTML = '';

    if (images.length === 0) {
      gallery.innerHTML = '<div class="empty-gallery">相册中还没有图片，点击上方上传区开始上传</div>';
      return;
    }

    images.forEach((img, index) => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.dataset.index = index;
      item.dataset.format = img.format || '';
      item.dataset.animated = isAnimated(img) ? 'true' : 'false';
      if (img._id) item.dataset.id = img._id;

      const badge = isAnimated(img) ? `<div class="animated-badge">${img.format === 'gif' ? 'GIF' : '动图'}</div>` : '';
      const lazyPlaceholder = `<div class="loading-placeholder"></div>`;
      const lazyImg = `<img class="gallery-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" data-src="${img.url}" alt="${esc(img.filename)}" loading="lazy"/>`;
      const copyBtn = `<button class="mobile-copy-btn" data-index="${index}" title="操作"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;

      if (isGrid) {
        item.classList.add('gallery-item-grid');
        item.innerHTML = `<div class="gallery-img-container">${lazyPlaceholder}${lazyImg}${badge}<div class="filename">${esc(img.filename)}</div>${copyBtn}</div>`;
      } else {
        item.classList.add('gallery-item-list');
        item.innerHTML = `<div class="gallery-img-container">${lazyPlaceholder}${lazyImg}${badge}${copyBtn}</div><div class="gallery-details"><div class="filename">${esc(img.filename)}</div><div class="file-info">${formatBytes(img.fileSize)} · ${img.format}${isAnimated(img) ? ' · 动图' : ''}</div><div class="file-time">${img.uploadTime || ''}</div></div>`;
      }

      // 点击事件
      item.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          toggleSelection(index); lastSelectedIndex = index;
        } else if (e.shiftKey) {
          if (lastSelectedIndex === null) lastSelectedIndex = index;
          clearSelections();
          const s = Math.min(lastSelectedIndex, index), end = Math.max(lastSelectedIndex, index);
          for (let i = s; i <= end; i++) selectItem(i);
        } else {
          clearSelections(); selectItem(index); lastSelectedIndex = index;
          currentImageIndex = index; showImageModal(img);
        }
      });

      // 右键菜单
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        let selected;
        if (selectedIndices.length > 0 && selectedIndices.includes(index)) {
          selected = selectedIndices.map(i => albumImages[i]);
        } else {
          clearSelections(); selectItem(index); selected = [img];
        }
        currentImageIndex = index;
        showContextMenu(e, selected);
      });

      // 移动端按钮
      item.querySelector('.mobile-copy-btn')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        showMobileMenu(e, img, index);
      });

      gallery.appendChild(item);
    });

    cleanupLazyLoad();
    initLazyLoadWithRetry();
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ── 右键菜单 ───────────────────────────────────────────────
  function showContextMenu(event, selected) {
    let menu = el('agContextMenu');
    if (!menu) { menu = document.createElement('div'); menu.id = 'agContextMenu'; menu.className = 'context-menu'; document.body.appendChild(menu); }
    menu.style.cssText = `top:${event.pageY}px;left:${event.pageX}px;display:block`;
    const multi = selected.length > 1;
    const single = !multi ? selected[0] : null;
    const canMarkAnimated = single?._id && (single.format === 'webp' || single.format === 'avif');
    const isCurrentlyAnimated = single?.isAnimated;

    menu.innerHTML = `
      <div class="context-menu-item" data-action="copyUrl">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        复制${multi ? '所有' : ''}图片链接
      </div>
      <div class="context-menu-item" data-action="copyHTML">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        复制 HTML 代码
      </div>
      <div class="context-menu-item" data-action="copyMarkdown">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        复制 Markdown
      </div>
      <div class="context-menu-item" data-action="copyForum">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        复制论坛格式
      </div>
      <div class="context-menu-item" data-action="openInTab">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        在新标签页打开
      </div>
      ${canMarkAnimated ? `<div class="context-menu-divider"></div><div class="context-menu-item" data-action="toggleAnimated"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>${isCurrentlyAnimated ? '取消动图标记' : '标记为动图'}</div>` : ''}
      <div class="context-menu-divider"></div>
      ${single ? `<div class="context-menu-item" data-action="setCover"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>设为相册封面</div>` : ''}
      <div class="context-menu-item" data-action="moveToAlbum"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>移动到相册</div>
      ${String(currentAlbumId) !== String(uncategorizedAlbumId) ? `<div class="context-menu-item" data-action="moveToUncategorized"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>移到未分类</div>` : ''}
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-danger" data-action="deleteImages"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>删除图片</div>
    `;

    menu.querySelectorAll('.context-menu-item[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        menu.style.display = 'none';
        const action = item.dataset.action;
        if (action === 'copyUrl') copyToClipboard(selected.map(i => i.url).join('\n'), multi ? '所有链接已复制' : '链接已复制');
        else if (action === 'copyHTML') copyToClipboard(selected.map(i => `<img src="${i.url}" alt="${i.filename}" />`).join('\n'), 'HTML已复制');
        else if (action === 'copyMarkdown') copyToClipboard(selected.map(i => `![${i.filename}](${i.url})`).join('\n'), 'Markdown已复制');
        else if (action === 'copyForum') copyToClipboard(selected.map(i => `[img]${i.url}[/img]`).join('\n'), '论坛格式已复制');
        else if (action === 'openInTab' && selected[0]) window.open(selected[0].url, '_blank');
        else if (action === 'toggleAnimated') handleToggleAnimated(single);
        else if (action === 'setCover' && single) handleSetCover(single._id);
        else if (action === 'moveToAlbum') openMoveModal(selected.map(i => i._id));
        else if (action === 'moveToUncategorized') handleMoveToUncategorized(selected.map(i => i._id));
        else if (action === 'deleteImages') handleDeleteImages(selected);
      });
    });

    const hide = (e) => { if (!menu.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('click', hide); } };
    requestAnimationFrame(() => document.addEventListener('click', hide));
  }

  // ── 移动端菜单 ─────────────────────────────────────────────
  function showMobileMenu(event, img, index) {
    el('agMobileMenu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'agMobileMenu';
    menu.className = 'mobile-copy-menu';
    const isNotUncategorized = String(currentAlbumId) !== String(uncategorizedAlbumId);
    menu.innerHTML = `
      <div class="mobile-copy-menu-backdrop"></div>
      <div class="mobile-copy-menu-content">
        <div class="mobile-copy-menu-header"><div class="mobile-copy-menu-title">图片操作</div><button class="mobile-copy-menu-close">&times;</button></div>
        <div class="mobile-copy-menu-body">
          <div class="mobile-copy-menu-item" data-action="copyUrl"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制图片链接</span></div>
          <div class="mobile-copy-menu-item" data-action="copyHTML"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg><span>复制 HTML</span></div>
          <div class="mobile-copy-menu-item" data-action="copyMarkdown"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg><span>复制 Markdown</span></div>
          <div class="mobile-copy-menu-item" data-action="copyForum"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span>复制论坛格式</span></div>
          <div class="mobile-copy-menu-item" data-action="openInTab"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span>在新标签页打开</span></div>
          <div class="mobile-copy-menu-item" data-action="setCover"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>设为相册封面</span></div>
          <div class="mobile-copy-menu-item" data-action="moveToAlbum"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>移动到相册</span></div>
          ${isNotUncategorized ? `<div class="mobile-copy-menu-item" data-action="moveToUncategorized"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>移到未分类</span></div>` : ''}
          <div class="mobile-copy-menu-divider"></div>
          <div class="mobile-copy-menu-item mobile-copy-menu-item-danger" data-action="deleteImage"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg><span>删除图片</span></div>
        </div>
      </div>`;
    document.body.appendChild(menu);
    const close = () => { menu.classList.add('closing'); setTimeout(() => menu.remove(), 300); };
    menu.querySelector('.mobile-copy-menu-close').addEventListener('click', close);
    menu.querySelector('.mobile-copy-menu-backdrop').addEventListener('click', close);
    menu.querySelectorAll('.mobile-copy-menu-item[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        const a = item.dataset.action;
        if (a === 'copyUrl') copyToClipboard(img.url, '链接已复制');
        else if (a === 'copyHTML') copyToClipboard(`<img src="${img.url}" alt="${img.filename}" />`, 'HTML已复制');
        else if (a === 'copyMarkdown') copyToClipboard(`![${img.filename}](${img.url})`, 'Markdown已复制');
        else if (a === 'copyForum') copyToClipboard(`[img]${img.url}[/img]`, '论坛格式已复制');
        else if (a === 'openInTab') window.open(img.url, '_blank');
        else if (a === 'setCover') handleSetCover(img._id);
        else if (a === 'moveToAlbum') openMoveModal([img._id]);
        else if (a === 'moveToUncategorized') handleMoveToUncategorized([img._id]);
        else if (a === 'deleteImage') handleDeleteImages([img]);
        close();
      });
    });
    requestAnimationFrame(() => menu.classList.add('show'));
  }

  // ── 图片模态框 ─────────────────────────────────────────────
  function showImageModal(img) {
    if (!imageModal) {
      imageModal = document.createElement('div');
      imageModal.id = 'agImageModal';
      imageModal.className = 'modal-backdrop';
      document.body.appendChild(imageModal);
      imageModal.addEventListener('click', (e) => { if (e.target === imageModal) closeModal(); });
    }
    imageModal.classList.remove('show');
    const tempImg = new Image();
    tempImg.onload = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const ratio = tempImg.width / tempImg.height;
      let w = Math.min(vw * 0.9, tempImg.width), h = w / ratio;
      if (h > vh * 0.85) { h = vh * 0.85; w = h * ratio; }
      w = Math.max(w, 300);
      imageModal.innerHTML = `
        <div class="modal-container modal-image-only" style="width:${Math.round(w)}px;max-width:${Math.round(w)}px">
          <div class="modal-header"><div class="modal-title">${esc(img.filename)}</div><button class="modal-close">&times;</button></div>
          <div class="modal-body">
            <div class="image-info"><span class="image-size">${formatBytes(img.fileSize)}</span></div>
            <div class="image-preview">
              <div class="image-loading"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg></div>
              <img src="${img.url}" alt="${esc(img.filename)}" class="modal-image" style="display:none">
            </div>
          </div>
          <div class="modal-navigation">
            <button class="nav-prev" title="上一张"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
            <button class="nav-next" title="下一张"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
          </div>
        </div>`;
      imageModal.classList.add('show');
      imageModal.querySelector('.modal-close').addEventListener('click', closeModal);
      imageModal.querySelector('.nav-prev').addEventListener('click', () => {
        const prev = (currentImageIndex - 1 + albumImages.length) % albumImages.length;
        currentImageIndex = prev; showImageModal(albumImages[prev]);
      });
      imageModal.querySelector('.nav-next').addEventListener('click', () => {
        const next = (currentImageIndex + 1) % albumImages.length;
        currentImageIndex = next; showImageModal(albumImages[next]);
      });
      if (keyNavListener) document.removeEventListener('keydown', keyNavListener);
      keyNavListener = (e) => {
        if (e.key === 'Escape') closeModal();
        else if (e.key === 'ArrowLeft') imageModal.querySelector('.nav-prev')?.click();
        else if (e.key === 'ArrowRight') imageModal.querySelector('.nav-next')?.click();
      };
      document.addEventListener('keydown', keyNavListener);
      const modalImg = imageModal.querySelector('.modal-image');
      modalImg.onload = () => { modalImg.style.display = 'block'; imageModal.querySelector('.image-loading').style.display = 'none'; };
      modalImg.onerror = () => { imageModal.querySelector('.image-loading').innerHTML = '<p>加载失败</p>'; };
    };
    tempImg.onerror = () => { imageModal.innerHTML = `<div class="modal-container modal-image-only"><div class="modal-header"><div class="modal-title">${esc(img.filename)}</div><button class="modal-close">&times;</button></div><div class="modal-body"><p>图片加载失败</p></div></div>`; imageModal.classList.add('show'); imageModal.querySelector('.modal-close').addEventListener('click', closeModal); };
    tempImg.src = img.url;
  }
  function closeModal() {
    imageModal?.classList.remove('show');
    if (keyNavListener) { document.removeEventListener('keydown', keyNavListener); keyNavListener = null; }
  }

  // ── 相册操作 ───────────────────────────────────────────────
  async function handleSetCover(imageId) {
    const r = await fetch(`/api/albums/${currentAlbumId}/cover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_id: imageId }) });
    const d = await r.json();
    if (d.success) { showToast('封面已更新'); window.albumPage?.refreshList?.(); }
    else showToast('设置封面失败', 'error');
  }

  async function handleToggleAnimated(img) {
    const newVal = !img.isAnimated;
    const r = await fetch(`/api/images/${img._id}/animated`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isAnimated: newVal }) });
    const d = await r.json();
    if (d.success) { showToast(newVal ? '已标记为动图' : '已取消动图标记'); loadAlbumImages(); }
    else showToast('操作失败', 'error');
  }

  function openMoveModal(imageIds) {
    let modal = el('agMoveModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'agMoveModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-box" style="max-width:420px">
          <h3>移动到相册</h3>
          <p class="modal-subtitle">选择目标相册，将 <strong id="agMoveCount"></strong> 张图片移入</p>
          <div class="modal-divider"></div>
          <div class="move-album-list" id="agMoveList"></div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="agMoveCancelBtn">取消</button>
            <button class="btn btn-primary" id="agMoveConfirmBtn" disabled>确认移动</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('active'); pendingMoveTargetId = null; } });
      el('agMoveCancelBtn').addEventListener('click', () => { modal.classList.remove('active'); pendingMoveTargetId = null; });
      el('agMoveConfirmBtn').addEventListener('click', async () => {
        if (pendingMoveTargetId === null) return;
        const btn = el('agMoveConfirmBtn');
        btn.disabled = true;
        const ids = pendingMoveImageIds;
        const targetId = pendingMoveTargetId;
        await fetch(`/api/albums/${targetId}/images`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_ids: ids }) });
        modal.classList.remove('active');
        showToast(`已移动 ${ids.length} 张图片`);
        pendingMoveTargetId = null; pendingMoveImageIds = [];
        clearSelections(); loadAlbumImages(); window.albumPage?.refreshList?.();
      });
    }
    pendingMoveImageIds = imageIds;
    pendingMoveTargetId = null;
    const confirmBtn = el('agMoveConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    el('agMoveCount').textContent = imageIds.length;
    const list = el('agMoveList');
    const folderIcon = `<svg class="move-album-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const targets = allAlbums.filter(a => String(a.id) !== String(currentAlbumId));
    list.innerHTML = targets.length ? targets.map(a => `
      <div class="move-album-item" data-id="${a.id}">
        ${folderIcon}
        <span class="move-album-name">${esc(a.name)}</span>
        <span class="move-album-count">${a.image_count} 张</span>
      </div>`).join('') : '<div class="move-album-empty">暂无其他相册</div>';
    list.querySelectorAll('.move-album-item').forEach(item => {
      item.addEventListener('click', () => {
        list.querySelectorAll('.move-album-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        pendingMoveTargetId = Number(item.dataset.id);
        if (confirmBtn) confirmBtn.disabled = false;
      });
    });
    modal.classList.add('active');
  }

  async function handleMoveToUncategorized(imageIds) {
    if (!uncategorizedAlbumId) { showToast('找不到未分类相册', 'error'); return; }
    await fetch(`/api/albums/${uncategorizedAlbumId}/images`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_ids: imageIds }) });
    showToast(`已移动 ${imageIds.length} 张图片到「未分类」`);
    clearSelections(); loadAlbumImages(); window.albumPage?.refreshList?.();
  }

  async function handleDeleteImages(imgs) {
    if (!imgs.length) return;
    if (!confirm(`确定要删除选中的 ${imgs.length} 张图片吗？此操作不可恢复。`)) return;
    const valid = imgs.filter(i => i?.path && i?.storage);
    if (!valid.length) { showToast('图片信息无效', 'error'); return; }
    try {
      const r = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: valid }) });
      const d = await r.json();
      if (d.success) { showToast('已删除'); clearSelections(); loadAlbumImages(); window.albumPage?.refreshList?.(); }
      else showToast('删除失败：' + (d.message || ''), 'error');
    } catch (e) { showToast('删除时出错', 'error'); }
  }

  async function handleBatchDelete() {
    const sel = document.querySelectorAll('#albumGallery .gallery-item.selected');
    if (!sel.length) { showToast('请先选择要删除的图片', 'info'); return; }
    const imgs = Array.from(sel).map(i => albumImages[parseInt(i.dataset.index)]).filter(Boolean);
    await handleDeleteImages(imgs);
  }

  // ── 公开 API ───────────────────────────────────────────────
  window.albumGallery = {
    open(albumId, ucId, albums) {
      currentAlbumId = albumId;
      uncategorizedAlbumId = ucId;
      allAlbums = albums || [];
      currentPage = 1;
      clearSelections();
      loadAlbumImages();
    },
    reload: loadAlbumImages,
    setAlbums(albums) { allAlbums = albums; }
  };

  // ── DOM 就绪后绑定控件 ─────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // 视图切换
    const gv = el('agGridViewBtn'), lv = el('agListViewBtn'), gal = el('albumGallery');
    function setView(v) {
      localStorage.setItem('albumGalleryView', v);
      gv?.classList.toggle('active', v === 'grid');
      lv?.classList.toggle('active', v === 'list');
      if (gal) gal.className = v === 'grid' ? 'gallery-grid' : 'gallery-list';
      if (currentAlbumId) loadAlbumImages();
    }
    const saved = localStorage.getItem('albumGalleryView') || 'grid';
    gv?.classList.toggle('active', saved === 'grid');
    lv?.classList.toggle('active', saved === 'list');
    gv?.addEventListener('click', () => setView('grid'));
    lv?.addEventListener('click', () => setView('list'));

    // 每页数量
    const ps = el('agPerPageSelect');
    if (ps) { ps.value = imagesPerPage; ps.addEventListener('change', () => { imagesPerPage = parseInt(ps.value); localStorage.setItem('albumGalleryPerPage', imagesPerPage); currentPage = 1; loadAlbumImages(); }); }

    // 翻页
    ['agPrevPage','agPrevPageBottom'].forEach(id => el(id)?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadAlbumImages(); } }));
    ['agNextPage','agNextPageBottom'].forEach(id => el(id)?.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; loadAlbumImages(); } }));

    // 删除
    ['agDeleteBtn','agDeleteBtnBottom'].forEach(id => el(id)?.addEventListener('click', handleBatchDelete));

    // 点空白取消选择，关闭菜单
    document.addEventListener('click', (e) => {
      const menu = el('agContextMenu');
      if (menu?.style.display === 'block' && !menu.contains(e.target)) menu.style.display = 'none';
      if (!e.target.closest('#albumGallery .gallery-item') && !e.target.closest('#agContextMenu')) clearSelections();
    });

    loadAnimatedSettings();
  });
})();
