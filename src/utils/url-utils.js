/**
 * URL处理工具模块
 * 提供协议检测、URL构建等功能，支持反向代理环境
 */

/**
 * 正确检测协议（支持反向代理）
 * @param {Object} req - Express请求对象
 * @returns {string} 'http' 或 'https'
 */
function getProtocol(req) {
  // 检查各种可能的HTTPS标头
  if (req.secure ||
      req.get('x-forwarded-proto') === 'https' ||
      req.get('x-forwarded-ssl') === 'on' ||
      req.get('x-forwarded-scheme') === 'https') {
    return 'https';
  }

  // 特殊处理Cloudflare的CF-Visitor头
  const cfVisitor = req.get('cf-visitor');
  if (cfVisitor) {
    try {
      const visitor = JSON.parse(cfVisitor);
      if (visitor.scheme === 'https') {
        return 'https';
      }
    } catch (e) {
      // 忽略JSON解析错误，继续其他检查
    }
  }

  return 'http';
}

/**
 * 构建正确的基础URL
 * @param {Object} req - Express请求对象
 * @returns {string} 基础URL，如 'https://example.com'
 */
function getBaseUrl(req) {
  const protocol = getProtocol(req);
  return `${protocol}://${req.get('host')}`;
}

/**
 * 构建图片URL，支持独立的图片域名
 * @param {Object} req - Express请求对象
 * @param {Object} imageDomainConfig - 图片域名配置
 * @returns {string} 图片基础URL
 */
async function getImageBaseUrl(req, imageDomainConfig) {
  if (imageDomainConfig.enabled && imageDomainConfig.domain) {
    // 使用独立的图片域名
    const protocol = imageDomainConfig.httpsOnly ? 'https' : getProtocol(req);
    const domain = imageDomainConfig.domain.replace(/^https?:\/\//, ''); // 移除协议前缀
    return `${protocol}://${domain}`;
  } else {
    // 使用默认的网站域名
    return getBaseUrl(req);
  }
}

module.exports = {
  getProtocol,
  getBaseUrl,
  getImageBaseUrl
};
