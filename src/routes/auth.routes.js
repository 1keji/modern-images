const express = require('express');
const path = require('path');
const { generateSalt, hashPassword } = require('../utils/password');

/**
 * 认证相关路由
 */
function createAuthRoutes(configLoader, checkInitialSetup) {
  const router = express.Router();
  const config = configLoader.getConfig();

  // 初始设置页面
  router.get('/setup', (req, res) => {
    if (config.auth.isConfigured) {
      return res.redirect('/');
    }
    res.sendFile(path.join(process.cwd(), 'views', 'setup.html'));
  });

  // 执行初始设置
  router.post('/perform-setup', async (req, res) => {
    if (config.auth.isConfigured) {
      return res.status(400).json({ success: false, message: '系统已经配置过了' });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码都是必需的' });
    }

    const salt = generateSalt();
    const hashedPwd = hashPassword(password, salt);

    config.auth.username = username;
    config.auth.hashedPassword = hashedPwd;
    config.auth.salt = salt;
    config.auth.isConfigured = true;

    await configLoader.saveConfig();

    // 自动登录，初始设置完成后默认记住登录状态
    req.session.authenticated = true;
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
    console.log('初始设置完成，自动登录并设置 30 天过期时间');
    res.json({ success: true, message: '初始设置完成' });
  });

  // 登录页面
  router.get('/login', checkInitialSetup, (req, res) => {
    if (req.session.authenticated) {
      return res.redirect('/');
    }
    res.sendFile(path.join(process.cwd(), 'views', 'login.html'));
  });

  // 登录处理
  router.post('/login', checkInitialSetup, (req, res) => {
    const { username, password, rememberMe } = req.body;
    const hashedPwd = hashPassword(password, config.auth.salt);

    if (username === config.auth.username && hashedPwd === config.auth.hashedPassword) {
      req.session.authenticated = true;

      // 根据用户选择设置 session 过期时间
      if (rememberMe) {
        // 记住我：设置 30 天过期时间
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
        console.log('用户选择记住登录，session 过期时间设置为 30 天');
      } else {
        // 不记住：浏览器关闭后过期
        req.session.cookie.maxAge = null;
        console.log('用户未选择记住登录，session 将在浏览器关闭后过期');
      }

      return res.json({ success: true });
    } else {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
  });

  // 注销
  router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('注销时销毁 session 出错:', err);
      } else {
        console.log('用户已注销，session 已销毁');
      }
      res.redirect('/login');
    });
  });

  // 健康检查端点（用于 Docker 健康检查和负载均衡器）
  router.get('/api/health', (req, res) => {
    // 需要imageDb实例，这里通过依赖注入传入
    const imageDb = req.app.locals.imageDb;

    // 基础健康检查：服务器正在运行
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: imageDb.isConnected() ? 'connected' : 'disconnected'
    };

    // 如果数据库未连接，返回 503 状态
    if (!imageDb.isConnected()) {
      return res.status(503).json({
        ...health,
        status: 'unhealthy'
      });
    }

    res.status(200).json(health);
  });

  // 检查认证状态API
  router.get('/api/auth-status', (req, res) => {
    res.json({
      isConfigured: config.auth.isConfigured,
      isAuthenticated: !!req.session.authenticated
    });
  });

  return router;
}

module.exports = createAuthRoutes;
