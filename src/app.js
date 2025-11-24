/**
 * Express应用配置模块
 * 负责创建和配置Express应用实例
 */
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');

// 导入中间件
const { isAuthenticated, createApiAuthMiddleware } = require('./middleware/auth');
const { createSetupCheckMiddleware } = require('./middleware/setup-check');
const { createDomainSecurityMiddleware } = require('./middleware/domain-security');
const { requestTimeout, memoryMonitor } = require('./middleware/request-utils');

// 导入路由
const createAuthRoutes = require('./routes/auth.routes');
const createViewsRoutes = require('./routes/views.routes');
const createUploadRoutes = require('./routes/upload.routes');
const createImagesRoutes = require('./routes/images.routes');
const createCategoriesRoutes = require('./routes/categories.routes');
const createSettingsRoutes = require('./routes/settings.routes');
const createApiManagementRoutes = require('./routes/api-management.routes');
const createStorageRoutes = require('./routes/storage.routes');
const createDatabaseRoutes = require('./routes/database.routes');

// 导入工具
const { ensureDirExistence } = require('./utils/file-utils');

/**
 * 创建并配置Express应用
 * @param {Object} dependencies - 依赖对象
 * @returns {Express} 配置好的Express应用
 */
function createApp(dependencies) {
  const {
    configLoader,
    imageDb,
    r2StorageService,
    sessionStoreService,
    fileSystemCache,
    performanceMetrics
  } = dependencies;

  const app = express();
  const config = configLoader.getConfig();

  // 响应压缩中间件 (优化性能)
  let compression;
  try {
    compression = require('compression');
    app.use(compression({
      level: 6, // 压缩级别 (0-9)，6是性能和压缩比的最佳平衡点
      threshold: 1024, // 仅压缩大于1KB的响应
      filter: (req, res) => {
        // 允许通过请求头禁用压缩
        if (req.headers['x-no-compression']) {
          return false;
        }
        // 不压缩已经压缩的图片格式
        const contentType = res.getHeader('Content-Type');
        if (contentType && /image\/(jpeg|jpg|png|gif|webp|avif)/.test(contentType)) {
          return false;
        }
        return compression.filter(req, res);
      },
      // 内存级别 (1-9)，8是默认值
      memLevel: 8
    }));
    console.log('Response compression enabled with optimized settings (level: 6, threshold: 1KB)');
  } catch (err) {
    console.error('Compression module not available:', err.message);
    console.log('Install with: npm install compression');
  }

  // 信任代理，支持反向代理（Nginx、Cloudflare等）
  app.set('trust proxy', true);

  // 请求超时和内存监控中间件
  app.use(requestTimeout);
  app.use(memoryMonitor);

  // 解析表单数据
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 配置Session中间件
  const sessionConfig = sessionStoreService.getSessionConfig();
  app.use(session(sessionConfig));

  // 确保必要的目录存在
  ensureDirExistence(path.join(process.cwd(), 'sessions'));
  ensureDirExistence(path.join(process.cwd(), 'temp'));
  ensureDirExistence(path.join(process.cwd(), 'uploads'));

  // === 2025优化：公共静态资源（CSS、JS等）添加缓存策略 ===
  // CSS和JS文件缓存1天，启用协商缓存
  app.use('/css', express.static(path.join(process.cwd(), 'public', 'css'), {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  }));

  app.use('/js', express.static(path.join(process.cwd(), 'public', 'js'), {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  }));

  // === 2025优化：图片资源缓存策略 ===
  // 图片文件缓存7天，AVIF格式支持，启用强缓存
  app.use('/i', express.static(path.join(process.cwd(), 'uploads'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    immutable: true,
    setHeaders: function (res, filePath) {
      // 设置AVIF MIME类型
      if (filePath.endsWith('.avif')) {
        res.setHeader('Content-Type', 'image/avif');
      }
      // 图片强缓存7天
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }));

  // 配置Multer文件上传
  const storage = multer.memoryStorage();
  const upload = multer({
    storage: storage,
    limits: {
      fieldSize: 1024 * 1024 // 限制表单字段值最大1MB
    },
    fileFilter: (req, file, cb) => {
      const allowedMimetypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
      if (allowedMimetypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('不支持的文件格式'), false);
      }
    }
  });

  // 创建中间件实例
  const checkInitialSetup = createSetupCheckMiddleware(config);
  const domainSecurityCheck = createDomainSecurityMiddleware(imageDb);
  const apiAuthenticated = createApiAuthMiddleware(config);

  // 应用域名安全验证中间件到所有路由
  app.use(domainSecurityCheck);

  // 将依赖注入到app.locals供路由使用
  app.locals.imageDb = imageDb;
  app.locals.r2StorageService = r2StorageService;
  app.locals.configLoader = configLoader;
  app.locals.config = config;
  app.locals.fileSystemCache = fileSystemCache;
  app.locals.performanceMetrics = performanceMetrics;

  // 挂载路由模块
  app.use(createAuthRoutes(configLoader, checkInitialSetup));
  app.use(createViewsRoutes(isAuthenticated));
  app.use(createUploadRoutes({
    isAuthenticated,
    apiAuthenticated,
    upload,
    imageDb,
    r2StorageService,
    config
  }));
  app.use(createImagesRoutes({
    isAuthenticated,
    imageDb,
    r2StorageService,
    config,
    fileSystemCache
  }));
  app.use(createCategoriesRoutes({
    isAuthenticated,
    imageDb
  }));
  app.use(createSettingsRoutes(configLoader, imageDb, isAuthenticated));
  app.use(createApiManagementRoutes(isAuthenticated, configLoader));
  app.use(createStorageRoutes(isAuthenticated, r2StorageService.getClient()));
  app.use(createDatabaseRoutes(
    isAuthenticated,
    imageDb,
    r2StorageService,
    multer,
    configLoader
  ));

  // 定期清理函数（防止内存泄漏）
  function performCleanup() {
    const now = Date.now();

    // 清理超过1小时的性能指标
    if (now - performanceMetrics.lastCleanup > 3600000) {
      performanceMetrics.processingTime = performanceMetrics.processingTime.slice(-50);
      performanceMetrics.memoryUsage = performanceMetrics.memoryUsage.slice(-50);
      performanceMetrics.lastCleanup = now;

      // 如果可用，强制垃圾回收
      if (global.gc) {
        global.gc();
      }

      console.log('Performed periodic cleanup');
    }
  }

  // 每30分钟运行一次清理
  setInterval(performCleanup, 30 * 60 * 1000);

  return app;
}

module.exports = createApp;
