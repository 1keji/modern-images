/**
 * 初始设置检查中间件
 */

/**
 * 检查是否需要初始配置的中间件
 * 需要config对象作为依赖
 */
function createSetupCheckMiddleware(config) {
  return function checkInitialSetup(req, res, next) {
    if (!config.auth.isConfigured && req.path !== '/setup' && req.path !== '/perform-setup') {
      return res.redirect('/setup');
    }
    next();
  };
}

module.exports = {
  createSetupCheckMiddleware
};
