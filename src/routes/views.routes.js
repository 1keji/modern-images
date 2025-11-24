const express = require('express');
const path = require('path');

/**
 * 视图页面路由
 */
function createViewsRoutes(isAuthenticated) {
  const router = express.Router();

  // 受保护的首页（图床主页面）
  router.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'index.html'));
  });

  // 调试页面
  router.get('/debug', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'debug.html'));
  });

  // 图库页面
  router.get('/gallery', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'gallery.html'));
  });

  // 数据迁移页面
  router.get('/migrate', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'migrate.html'));
  });

  // 管理中心页面
  router.get('/admin-center', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'admin-center.html'));
  });

  // 分类管理页面
  router.get('/categories', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'categories.html'));
  });

  // 设置页面
  router.get('/settings', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'settings.html'));
  });

  // API管理页面
  router.get('/api-management', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'api-management.html'));
  });

  // Redis缓存管理页面
  router.get('/redis-management', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'redis-management.html'));
  });

  // HTTPS链接测试页面
  router.get('/test-https', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'test-https.html'));
  });

  // 存储配置页面
  router.get('/storage-config', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'views', 'storage-config.html'));
  });

  return router;
}

module.exports = createViewsRoutes;
