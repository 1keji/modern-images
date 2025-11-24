const { getProtocol } = require('../utils/url-utils');
const { getDomainSecurityConfig, getImageDomainConfig } = require('../config/db-config-helper');

/**
 * 域名安全验证中间件
 * 需要imageDb作为依赖
 */
function createDomainSecurityMiddleware(imageDb) {
  return async function domainSecurityCheck(req, res, next) {
    try {
      const domainConfig = await getDomainSecurityConfig(imageDb, {});

      // 如果域名安全验证未启用，直接通过
      if (!domainConfig.enabled) {
        return next();
      }

      const requestHost = req.get('host');
      if (!requestHost) {
        return res.status(400).json({
          success: false,
          message: '请求无效'
        });
      }

      // 移除端口号，只比较域名部分
      const requestDomain = requestHost.split(':')[0].toLowerCase();

      // 获取图片域名配置
      const imageDomainConfig = await getImageDomainConfig(imageDb, {});

      // 检查是否是图片独立域名访问（包括主图片域名和备用图片域名）
      if (imageDomainConfig.enabled) {
        let isImageDomain = false;

        // 检查主图片域名
        if (imageDomainConfig.domain) {
          const imageDomain = imageDomainConfig.domain.replace(/^https?:\/\//, '').toLowerCase();
          if (requestDomain === imageDomain) {
            isImageDomain = true;
          }
        }

        // 检查备用图片域名
        if (!isImageDomain && imageDomainConfig.backupDomains && Array.isArray(imageDomainConfig.backupDomains)) {
          for (const backupDomain of imageDomainConfig.backupDomains) {
            if (backupDomain && typeof backupDomain === 'string') {
              const cleanBackupDomain = backupDomain.replace(/^https?:\/\//, '').toLowerCase();
              if (requestDomain === cleanBackupDomain) {
                isImageDomain = true;
                break;
              }
            }
          }
        }

        if (isImageDomain) {
          // 如果是图片域名（主域名或备用域名），只允许访问图片资源和基本静态资源
          if (req.path.startsWith('/i/') ||
              req.path.startsWith('/css/') ||
              req.path.startsWith('/js/') ||
              req.path === '/favicon.ico' ||
              req.path === '/robots.txt') {
            return next(); // 允许访问图片和必要的静态资源
          } else {
            // 图片域名不允许访问网站管理界面
            console.log(`图片域名 "${requestDomain}" 尝试访问非图片资源: ${req.path}`);
            if (req.path.startsWith('/api/')) {
              return res.status(403).json({
                success: false,
                message: '访问被拒绝',
                code: 'DOMAIN_NOT_ALLOWED'
              });
            } else {
              return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>访问被拒绝</title></head><body><h1>403 - 访问被拒绝</h1><p>您无权访问此资源。</p></body></html>');
            }
          }
        }
      }

      // 检查是否在允许的域名列表中
      const allowedDomains = domainConfig.allowedDomains.map(domain => domain.toLowerCase());
      const isAllowed = allowedDomains.some(allowedDomain => {
        // 支持精确匹配和通配符子域名匹配
        if (allowedDomain.startsWith('*.')) {
          const baseDomain = allowedDomain.substring(2);
          return requestDomain === baseDomain || requestDomain.endsWith('.' + baseDomain);
        }
        return requestDomain === allowedDomain;
      });

      if (!isAllowed) {
        console.log(`域名安全验证失败: 请求域名 "${requestDomain}" 不在允许列表中`);
        console.log(`请求路径: ${req.path}`);
        console.log(`允许的域名列表: ${allowedDomains.join(', ')}`);

        // 如果配置了重定向到主域名且不是API请求
        if (domainConfig.redirectToMain && domainConfig.mainDomain && !req.path.startsWith('/api/')) {
          const protocol = getProtocol(req);
          const redirectUrl = `${protocol}://${domainConfig.mainDomain}${req.originalUrl}`;
          console.log(`重定向到主域名: ${redirectUrl}`);
          return res.redirect(301, redirectUrl);
        }

        // 返回403错误，使用通用错误信息
        if (req.path.startsWith('/api/')) {
          return res.status(403).json({
            success: false,
            message: '访问被拒绝',
            code: 'DOMAIN_NOT_ALLOWED'
          });
        } else {
          return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>访问被拒绝</title></head><body><h1>403 - 访问被拒绝</h1><p>您无权访问此资源。</p></body></html>');
        }
      }

      next();
    } catch (error) {
      console.error('域名安全验证出错:', error);
      // 出错时允许通过，避免阻塞正常访问
      next();
    }
  };
}

module.exports = {
  createDomainSecurityMiddleware
};
