/**
 * 认证中间件模块
 */

/**
 * 鉴权中间件，检测用户是否登录
 */
function isAuthenticated(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

/**
 * API鉴权中间件，检测请求是否包含有效的API令牌
 * 需要config对象作为依赖
 */
function createApiAuthMiddleware(config) {
  return function apiAuthenticated(req, res, next) {
    const token = req.headers['x-api-token'] || req.query.token;

    if (!token) {
      return res.status(401).json({ success: false, message: '缺少API令牌' });
    }

    if (!config.api.enabled) {
      return res.status(403).json({ success: false, message: 'API功能未启用' });
    }

    const validToken = config.api.tokens.find(t => t.token === token);
    if (!validToken) {
      return res.status(401).json({ success: false, message: '无效的API令牌' });
    }

    // 将API令牌信息添加到请求对象中，以便后续使用
    req.apiToken = validToken;
    next();
  };
}

module.exports = {
  isAuthenticated,
  createApiAuthMiddleware
};
