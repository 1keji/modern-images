/**
 * 异步上传处理模块
 * 支持任务队列、进度追踪和实时反馈
 */

/**
 * 任务状态映射
 */
const JOB_STATES = {
  waiting: '等待中',
  active: '处理中',
  completed: '已完成',
  failed: '失败'
};

/**
 * 异步上传管理器
 */
class AsyncUploadManager {
  constructor() {
    this.currentJobs = new Map(); // 当前正在处理的任务
    this.pollingIntervals = new Map(); // 轮询定时器
    this.onProgressCallback = null; // 进度更新回调
    this.onCompleteCallback = null; // 完成回调
    this.onErrorCallback = null; // 错误回调
  }

  /**
   * 提交上传任务
   */
  async submitUpload(formData, options = {}) {
    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '上传失败');
      }

      // 检查是否为异步模式
      if (result.async) {
        // 异步模式：开始轮询任务状态
        return await this.handleAsyncUpload(result);
      } else {
        // 同步模式：直接返回结果
        return result;
      }

    } catch (error) {
      console.error('提交上传任务失败:', error);
      throw error;
    }
  }

  /**
   * 处理异步上传任务
   */
  async handleAsyncUpload(taskInfo) {
    const { jobId, queue, totalFiles, statusUrl } = taskInfo;

    // 保存任务信息
    this.currentJobs.set(jobId, {
      jobId,
      queue,
      totalFiles,
      statusUrl,
      state: 'waiting',
      progress: 0,
      startTime: Date.now()
    });

    // 立即显示任务已提交
    this.updateProgress(jobId, {
      state: 'waiting',
      progress: 0,
      message: `已提交 ${totalFiles} 张图片处理任务...`
    });

    // 开始轮询状态
    return new Promise((resolve, reject) => {
      this.pollJobStatus(jobId, statusUrl, resolve, reject);
    });
  }

  /**
   * 轮询任务状态
   */
  pollJobStatus(jobId, statusUrl, resolve, reject) {
    let attemptCount = 0;
    const maxAttempts = 600; // 最多轮询 10 分钟（每秒一次）

    const poll = async () => {
      attemptCount++;

      if (attemptCount > maxAttempts) {
        this.stopPolling(jobId);
        reject(new Error('任务超时'));
        return;
      }

      try {
        const response = await fetch(statusUrl);
        const status = await response.json();

        if (!status.success) {
          this.stopPolling(jobId);
          reject(new Error(status.error || '查询任务状态失败'));
          return;
        }

        // 更新任务信息
        const jobInfo = this.currentJobs.get(jobId);
        if (jobInfo) {
          jobInfo.state = status.state;
          jobInfo.progress = status.progress || 0;
        }

        // 触发进度回调
        this.updateProgress(jobId, {
          state: status.state,
          progress: status.progress || 0,
          message: this.getStateMessage(status.state, status.progress)
        });

        // 检查任务状态
        if (status.state === 'completed') {
          // 任务完成
          this.stopPolling(jobId);
          this.currentJobs.delete(jobId);
          resolve(status.result);
        } else if (status.state === 'failed') {
          // 任务失败
          this.stopPolling(jobId);
          this.currentJobs.delete(jobId);
          reject(new Error(status.error || '任务处理失败'));
        } else {
          // 继续轮询
          // 使用 setTimeout 而不是 setInterval，避免累积
          const timeoutId = setTimeout(poll, 1000);
          this.pollingIntervals.set(jobId, timeoutId);
        }

      } catch (error) {
        console.error('轮询任务状态失败:', error);
        // 继续尝试
        const timeoutId = setTimeout(poll, 2000); // 失败后延长间隔
        this.pollingIntervals.set(jobId, timeoutId);
      }
    };

    // 首次轮询
    poll();
  }

  /**
   * 停止轮询
   */
  stopPolling(jobId) {
    const intervalId = this.pollingIntervals.get(jobId);
    if (intervalId) {
      clearTimeout(intervalId);
      this.pollingIntervals.delete(jobId);
    }
  }

  /**
   * 更新进度
   */
  updateProgress(jobId, progressInfo) {
    if (this.onProgressCallback) {
      this.onProgressCallback(jobId, progressInfo);
    }
  }

  /**
   * 获取状态描述
   */
  getStateMessage(state, progress) {
    const stateText = JOB_STATES[state] || state;

    if (state === 'active' && progress) {
      return `${stateText} (${progress}%)`;
    }

    return stateText;
  }

  /**
   * 设置进度回调
   */
  onProgress(callback) {
    this.onProgressCallback = callback;
    return this;
  }

  /**
   * 设置完成回调
   */
  onComplete(callback) {
    this.onCompleteCallback = callback;
    return this;
  }

  /**
   * 设置错误回调
   */
  onError(callback) {
    this.onErrorCallback = callback;
    return this;
  }

  /**
   * 取消所有任务
   */
  cancelAll() {
    for (const jobId of this.currentJobs.keys()) {
      this.stopPolling(jobId);
    }
    this.currentJobs.clear();
    this.pollingIntervals.clear();
  }
}

/**
 * 创建进度显示UI
 */
function createProgressUI() {
  // 检查是否已存在
  let progressContainer = document.getElementById('upload-progress-container');

  if (!progressContainer) {
    progressContainer = document.createElement('div');
    progressContainer.id = 'upload-progress-container';
    progressContainer.className = 'upload-progress-container';
    progressContainer.innerHTML = `
      <div class="upload-progress-card">
        <div class="upload-progress-header">
          <h4>上传进度</h4>
          <button id="close-progress" class="btn-close">×</button>
        </div>
        <div class="upload-progress-body">
          <div class="progress-bar-container">
            <div class="progress-bar" id="upload-progress-bar" style="width: 0%"></div>
          </div>
          <div class="progress-text" id="upload-progress-text">准备中...</div>
          <div class="progress-details" id="upload-progress-details"></div>
        </div>
      </div>
    `;

    document.body.appendChild(progressContainer);

    // 关闭按钮
    document.getElementById('close-progress').addEventListener('click', () => {
      hideProgressUI();
    });
  }

  return progressContainer;
}

/**
 * 显示进度UI
 */
function showProgressUI() {
  const container = createProgressUI();
  container.style.display = 'flex';

  // 重置进度
  const progressBar = document.getElementById('upload-progress-bar');
  const progressText = document.getElementById('upload-progress-text');
  const progressDetails = document.getElementById('upload-progress-details');

  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = '准备中...';
  if (progressDetails) progressDetails.textContent = '';
}

/**
 * 隐藏进度UI
 */
function hideProgressUI() {
  const container = document.getElementById('upload-progress-container');
  if (container) {
    container.style.display = 'none';
  }
}

/**
 * 更新进度UI
 */
function updateProgressUI(jobId, progressInfo) {
  const progressBar = document.getElementById('upload-progress-bar');
  const progressText = document.getElementById('upload-progress-text');
  const progressDetails = document.getElementById('upload-progress-details');

  if (progressBar) {
    const width = Math.min(progressInfo.progress || 0, 100);
    progressBar.style.width = `${width}%`;

    // 根据状态改变颜色
    if (progressInfo.state === 'completed') {
      progressBar.style.backgroundColor = '#10b981'; // 绿色
    } else if (progressInfo.state === 'failed') {
      progressBar.style.backgroundColor = '#ef4444'; // 红色
    } else {
      progressBar.style.backgroundColor = '#3b82f6'; // 蓝色
    }
  }

  if (progressText) {
    progressText.textContent = progressInfo.message || '';
  }

  if (progressDetails) {
    progressDetails.textContent = `任务ID: ${jobId}`;
  }
}

/**
 * 替换原有的 submitUploadForm 函数
 * 支持异步上传和进度追踪
 */
async function submitUploadFormAsync() {
  const uploadBtn = document.getElementById('uploadBtn');

  // 从全局变量获取 fileQueue
  if (!window.fileQueue || !window.fileQueue.length) {
    showToast('请先选择图片', 'error');
    return;
  }

  // 准备表单数据
  const formData = new FormData();
  formData.append('storage', 'local');

  // 获取格式选项
  const formatRadios = document.getElementsByName('format');
  let selectedFormat = 'original';
  for (const radio of formatRadios) {
    if (radio.checked) {
      selectedFormat = radio.value;
      break;
    }
  }
  formData.append('format', selectedFormat);

  // 添加文件
  for (let i = window.fileQueue.length - 1; i >= 0; i--) {
    formData.append('images', window.fileQueue[i].file);
  }

  // 禁用按钮
  uploadBtn.disabled = true;
  uploadBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
      <line x1="12" y1="2" x2="12" y2="6"></line>
      <line x1="12" y1="18" x2="12" y2="22"></line>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
      <line x1="2" y1="12" x2="6" y2="12"></line>
      <line x1="18" y1="12" x2="22" y2="12"></line>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
    </svg> 上传中...
  `;

  // 显示进度UI
  showProgressUI();

  // 创建上传管理器
  const uploadManager = new AsyncUploadManager();

  // 设置进度回调
  uploadManager.onProgress((jobId, progressInfo) => {
    updateProgressUI(jobId, progressInfo);
  });

  try {
    // 提交上传
    const result = await uploadManager.submitUpload(formData);

    // 处理结果
    if (result && result.success !== false) {
      // 成功
      const fileCount = window.fileQueue.length;
      showToast(`成功上传 ${fileCount} 张图片`);

      // 清空队列
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.value = '';
      window.fileQueue = [];

      // 更新预览（如果函数存在）
      if (typeof window.updatePreview === 'function') {
        window.updatePreview();
      }

      // 处理结果图片（兼容异步和同步模式）
      const images = result.results || result.images;
      if (images && images.length > 0) {
        // 检查是否需要存储到sessionStorage
        try {
          const settingsRes = await fetch('/api/settings');
          const settingsResult = await settingsRes.json();
          const showRecentUploads = settingsResult.success && settingsResult.displaySettings
            ? settingsResult.displaySettings.showRecentUploads
            : true;

          if (!showRecentUploads) {
            let existingImages = [];
            const existingStr = sessionStorage.getItem('recentUploadedImages');
            if (existingStr) {
              try {
                existingImages = JSON.parse(existingStr);
              } catch (e) {
                existingImages = [];
              }
            }

            const updatedImages = [...images, ...existingImages];
            sessionStorage.setItem('recentUploadedImages', JSON.stringify(updatedImages));
          }
        } catch (error) {
          console.error('处理上传后的图片存储失败:', error);
        }
      }

      // 刷新图片库
      if (typeof window.loadGallery === 'function') {
        window.loadGallery();
      }

      // 延迟隐藏进度UI
      setTimeout(() => {
        hideProgressUI();
      }, 2000);

    } else {
      throw new Error(result.error || '上传失败');
    }

  } catch (error) {
    console.error('上传失败:', error);
    showToast(`上传失败: ${error.message}`, 'error');
    hideProgressUI();
  } finally {
    // 恢复按钮
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '上传图片';
  }
}

// 添加样式
const style = document.createElement('style');
style.textContent = `
  .upload-progress-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .upload-progress-card {
    background: white;
    border-radius: 8px;
    padding: 24px;
    min-width: 400px;
    max-width: 600px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .upload-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .upload-progress-header h4 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #6b7280;
    padding: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .btn-close:hover {
    background: #f3f4f6;
    color: #111827;
  }

  .upload-progress-body {
    margin-top: 16px;
  }

  .progress-bar-container {
    width: 100%;
    height: 24px;
    background: #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 12px;
  }

  .progress-bar {
    height: 100%;
    background: #3b82f6;
    border-radius: 12px;
    transition: width 0.3s ease, background-color 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 12px;
    font-weight: 600;
  }

  .progress-text {
    font-size: 16px;
    font-weight: 500;
    color: #111827;
    margin-bottom: 8px;
  }

  .progress-details {
    font-size: 14px;
    color: #6b7280;
  }

  /* 暗色主题支持 */
  @media (prefers-color-scheme: dark) {
    .upload-progress-card {
      background: #1f2937;
      color: white;
    }

    .progress-bar-container {
      background: #374151;
    }

    .progress-text {
      color: #f3f4f6;
    }

    .progress-details {
      color: #9ca3af;
    }

    .btn-close {
      color: #9ca3af;
    }

    .btn-close:hover {
      background: #374151;
      color: #f3f4f6;
    }
  }
`;
document.head.appendChild(style);

// 导出给全局使用
if (typeof window !== 'undefined') {
  window.AsyncUploadManager = AsyncUploadManager;
  window.submitUploadFormAsync = submitUploadFormAsync;
}
