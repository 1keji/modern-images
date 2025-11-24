/**
 * 请求相关中间件
 * 包括超时、内存监控等
 */

/**
 * 请求超时中间件
 */
function requestTimeout(req, res, next) {
  req.setTimeout(300000); // 5 minutes timeout for uploads
  res.setTimeout(300000);
  next();
}

/**
 * 内存监控中间件
 */
function memoryMonitor(req, res, next) {
  const memUsage = process.memoryUsage();
  if (memUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB threshold
    console.warn('High memory usage detected:', {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
    });

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
  next();
}

module.exports = {
  requestTimeout,
  memoryMonitor
};
