const express = require('express');
const { getImageBaseUrl } = require('../utils/url-utils');
const {
  getImageDomainConfig,
  getDomainSecurityConfig,
  getDisplaySettingsConfig,
  getAnimatedAutoplayConfig
} = require('../config/db-config-helper');
const { getImageQualityConfig } = require('../utils/storage-utils');
const { invalidateDomainConfigCache } = require('../middleware/domain-security');

/**
 * 系统设置相关路由
 * 包括图片质量、域名配置、域名安全、显示设置等
 */
function createSettingsRoutes(configLoader, imageDb, isAuthenticated) {
  const router = express.Router();
  const config = configLoader.getConfig();

  /**
   * 获取所有系统设置
   */
  router.get('/api/settings', isAuthenticated, async (req, res) => {
    try {
      const [imageQuality, imageDomain, domainSecurity, displaySettings, animatedAutoplay] = await Promise.all([
        Promise.resolve(getImageQualityConfig(config)),
        getImageDomainConfig(imageDb, config),
        getDomainSecurityConfig(imageDb, config),
        getDisplaySettingsConfig(imageDb, config),
        getAnimatedAutoplayConfig(imageDb, config)
      ]);

      res.json({
        success: true,
        imageQuality,
        imageDomain,
        domainSecurity,
        displaySettings,
        animatedAutoplay
      });
    } catch (error) {
      console.error('获取系统设置失败:', error);
      res.status(500).json({
        success: false,
        message: '获取系统设置失败'
      });
    }
  });

  /**
   * 更新系统设置
   * 支持图片域名、图片质量、域名安全、显示设置等配置
   */
  router.post('/api/settings', isAuthenticated, async (req, res) => {
    try {
      let hasUpdates = false;
      let responseMessage = [];

      // 处理图片域名设置
      if (req.body.imageDomain) {
        const { enabled, domain, httpsOnly, backupDomains } = req.body.imageDomain;

        // 验证主域名格式
        if (enabled && domain) {
          const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (!cleanDomain || !/^[a-zA-Z0-9.-]+$/.test(cleanDomain)) {
            return res.status(400).json({ success: false, message: '无效的主图片域名格式' });
          }
        }

        // 验证备用域名格式
        if (backupDomains && Array.isArray(backupDomains)) {
          for (const backupDomain of backupDomains) {
            if (backupDomain && typeof backupDomain === 'string') {
              const cleanBackupDomain = backupDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
              if (cleanBackupDomain && !/^[a-zA-Z0-9.-]+$/.test(cleanBackupDomain)) {
                return res.status(400).json({ success: false, message: `无效的备用域名格式: ${backupDomain}` });
              }
            }
          }
        }

        // 构建新的图片域名配置
        const newImageDomainConfig = {};

        if (enabled !== undefined) {
          newImageDomainConfig.enabled = enabled;
        }

        if (domain !== undefined) {
          newImageDomainConfig.domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
        }

        if (httpsOnly !== undefined) {
          newImageDomainConfig.httpsOnly = httpsOnly;
        }

        if (backupDomains !== undefined) {
          // 过滤并清理备用域名列表
          newImageDomainConfig.backupDomains = Array.isArray(backupDomains) ?
            backupDomains
              .filter(domain => domain && typeof domain === 'string' && domain.trim() !== '')
              .map(domain => domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')) : [];
        }

        // 保存到数据库
        try {
          await imageDb.setSetting('imageDomain', newImageDomainConfig, '图片域名配置');
          console.log('图片域名配置已保存到数据库:', newImageDomainConfig);
        } catch (dbError) {
          console.warn('保存图片域名配置到数据库失败，回退到配置文件:', dbError.message);

          // 回退到配置文件保存
          if (!config.imageDomain) {
            config.imageDomain = {};
          }
          Object.assign(config.imageDomain, newImageDomainConfig);
        }

        // 使域名安全中间件的配置缓存立即失效
        invalidateDomainConfigCache();

        hasUpdates = true;
        responseMessage.push('图片域名设置已更新');
      }

      // 处理图片质量设置
      if (req.body.imageQuality) {
        // 验证图片质量参数是否有效
        const { webp, avif, pngOptimize } = req.body.imageQuality;

        // 验证webp和avif质量值
        if (webp !== undefined && (isNaN(webp) || webp < 0 || webp > 100)) {
          return res.status(400).json({ success: false, message: 'WebP质量值必须在0-100之间' });
        }

        if (avif !== undefined && (isNaN(avif) || avif < 0 || avif > 100)) {
          return res.status(400).json({ success: false, message: 'AVIF质量值必须在0-100之间' });
        }

        // 更新配置
        if (!config.imageQuality) {
          config.imageQuality = {};
        }

        if (webp !== undefined) {
          config.imageQuality.webp = webp;
        }

        if (avif !== undefined) {
          config.imageQuality.avif = avif;
        }

        if (pngOptimize !== undefined) {
          config.imageQuality.pngOptimize = pngOptimize;
        }

        hasUpdates = true;
        responseMessage.push('图片质量设置已更新');
      }

      // 处理域名安全设置
      if (req.body.domainSecurity) {
        const { enabled, allowedDomains, redirectToMain, mainDomain } = req.body.domainSecurity;

        // 验证域名格式
        if (enabled && allowedDomains && Array.isArray(allowedDomains)) {
          for (const domain of allowedDomains) {
            if (typeof domain !== 'string' || domain.trim() === '') {
              return res.status(400).json({ success: false, message: '域名不能为空' });
            }

            const cleanDomain = domain.trim().toLowerCase();
            // 基本域名格式验证（支持通配符）
            if (!cleanDomain.match(/^(\*\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) && !cleanDomain.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) && !cleanDomain.match(/^localhost$/) && !cleanDomain.match(/^\d+\.\d+\.\d+\.\d+$/)) {
              return res.status(400).json({ success: false, message: `无效的域名格式: ${domain}` });
            }
          }
        }

        // 验证主域名格式
        if (mainDomain && typeof mainDomain === 'string' && mainDomain.trim() !== '') {
          const cleanMainDomain = mainDomain.trim().toLowerCase();
          if (!cleanMainDomain.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) && !cleanMainDomain.match(/^localhost$/) && !cleanMainDomain.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            return res.status(400).json({ success: false, message: `无效的主域名格式: ${mainDomain}` });
          }
        }

        // 构建新的域名安全配置
        const newDomainSecurityConfig = {};

        if (enabled !== undefined) {
          newDomainSecurityConfig.enabled = enabled;
        }

        if (allowedDomains !== undefined) {
          newDomainSecurityConfig.allowedDomains = Array.isArray(allowedDomains) ?
            allowedDomains.map(d => d.trim().toLowerCase()).filter(d => d !== '') : [];
        }

        if (redirectToMain !== undefined) {
          newDomainSecurityConfig.redirectToMain = redirectToMain;
        }

        if (mainDomain !== undefined) {
          newDomainSecurityConfig.mainDomain = mainDomain ? mainDomain.trim().toLowerCase() : '';
        }

        // 保存到数据库
        try {
          await imageDb.setSetting('domainSecurity', newDomainSecurityConfig, '域名安全配置');
          console.log('域名安全配置已保存到数据库:', newDomainSecurityConfig);
        } catch (dbError) {
          console.warn('保存域名安全配置到数据库失败，回退到配置文件:', dbError.message);

          // 回退到配置文件保存
          if (!config.domainSecurity) {
            config.domainSecurity = {};
          }
          Object.assign(config.domainSecurity, newDomainSecurityConfig);
        }

        // 使域名安全中间件的配置缓存立即失效
        invalidateDomainConfigCache();

        hasUpdates = true;
        responseMessage.push('域名安全设置已更新');
      }

      // 处理显示设置
      if (req.body.displaySettings) {
        const { showRecentUploads } = req.body.displaySettings;

        // 构建新的显示设置配置
        const newDisplaySettings = {};

        if (showRecentUploads !== undefined) {
          newDisplaySettings.showRecentUploads = showRecentUploads;
        }

        // 保存到数据库
        try {
          await imageDb.setSetting('displaySettings', newDisplaySettings, '显示设置');
          console.log('显示设置已保存到数据库:', newDisplaySettings);
        } catch (dbError) {
          console.warn('保存显示设置到数据库失败，回退到配置文件:', dbError.message);

          // 回退到配置文件保存
          if (!config.displaySettings) {
            config.displaySettings = {};
          }
          Object.assign(config.displaySettings, newDisplaySettings);
        }

        hasUpdates = true;
        responseMessage.push('显示设置已更新');
      }

      // 处理动图自动播放设置
      if (req.body.animatedAutoplay) {
        const { gif, webp, avif } = req.body.animatedAutoplay;
        const newAnimatedAutoplay = {};

        if (gif !== undefined) newAnimatedAutoplay.gif = !!gif;
        if (webp !== undefined) newAnimatedAutoplay.webp = !!webp;
        if (avif !== undefined) newAnimatedAutoplay.avif = !!avif;

        try {
          await imageDb.setSetting('animatedAutoplay', newAnimatedAutoplay, '动图自动播放设置');
          console.log('动图自动播放设置已保存到数据库:', newAnimatedAutoplay);
        } catch (dbError) {
          console.warn('保存动图自动播放设置到数据库失败，回退到配置文件:', dbError.message);
          if (!config.animatedAutoplay) config.animatedAutoplay = {};
          Object.assign(config.animatedAutoplay, newAnimatedAutoplay);
        }

        hasUpdates = true;
        responseMessage.push('动图自动播放设置已更新');
      }

      if (hasUpdates) {
        // 保存到配置文件（作为备份）
        await configLoader.saveConfig();

        console.log('系统设置已更新');

        // 重新获取最新的配置返回给前端
        const [imageQuality, imageDomain, domainSecurity, displaySettings, animatedAutoplay] = await Promise.all([
          Promise.resolve(getImageQualityConfig(config)),
          getImageDomainConfig(imageDb, config),
          getDomainSecurityConfig(imageDb, config),
          getDisplaySettingsConfig(imageDb, config),
          getAnimatedAutoplayConfig(imageDb, config)
        ]);

        return res.json({
          success: true,
          message: responseMessage.join('，'),
          imageQuality,
          imageDomain,
          domainSecurity,
          displaySettings,
          animatedAutoplay
        });
      }

      return res.status(400).json({
        success: false,
        message: '未提供有效的设置数据'
      });
    } catch (error) {
      console.error('更新设置失败:', error);
      return res.status(500).json({
        success: false,
        message: '更新设置失败，服务器错误'
      });
    }
  });

  /**
   * 强制迁移所有图片URL到新域名（可选功能）
   */
  router.post('/api/migrate-image-urls', isAuthenticated, async (req, res) => {
    try {
      const { forceUpdate } = req.body;

      if (!forceUpdate) {
        return res.status(400).json({
          success: false,
          message: '请确认要强制更新所有图片的域名。此操作将覆盖所有现有图片的URL。'
        });
      }

      // 获取图片域名配置并构建图片基础URL
      const imageDomainConfig = await getImageDomainConfig(imageDb, config);
      const imageBaseUrl = await getImageBaseUrl(req, imageDomainConfig);

      // 获取所有图片记录
      const images = await imageDb.getAllImages();

      let updatedCount = 0;
      let errorCount = 0;

      for (const image of images) {
        try {
          const newImageUrl = `${imageBaseUrl}/i/${image.path}`;
          const newHtmlCode = `<img src="${newImageUrl}" alt="${image.filename}" />`;
          const newMarkdownCode = `![${image.filename}](${newImageUrl})`;

          // 更新数据库中的URL
          await imageDb.updateImageUrls(image._id, newImageUrl, newHtmlCode, newMarkdownCode);
          updatedCount++;
        } catch (error) {
          console.error(`更新图片 ${image.filename} 的URL失败:`, error);
          errorCount++;
        }
      }

      let message = `图片URL强制迁移完成！成功更新 ${updatedCount} 张图片的URL`;
      if (errorCount > 0) {
        message += `，${errorCount} 张图片更新失败`;
      }

      res.json({
        success: true,
        message: message,
        updatedCount: updatedCount,
        errorCount: errorCount,
        newBaseUrl: imageBaseUrl
      });
    } catch (error) {
      console.error('强制迁移图片URL失败:', error);
      res.status(500).json({
        success: false,
        message: `强制迁移图片URL失败: ${error.message}`
      });
    }
  });

  /**
   * 获取默认分类设置
   */
  router.get('/api/settings/defaultCategory', (req, res) => {
    try {
      // 从配置文件中获取默认分类设置
      const defaultCategoryId = config.defaultCategory || '';

      res.json({
        success: true,
        defaultCategoryId: defaultCategoryId
      });
    } catch (error) {
      console.error('获取默认分类设置失败:', error);
      res.status(500).json({
        success: false,
        error: '获取默认分类设置失败'
      });
    }
  });

  /**
   * 保存默认分类设置
   */
  router.post('/api/settings/defaultCategory', isAuthenticated, async (req, res) => {
    try {
      const { defaultCategoryId } = req.body;

      // 限制只能保存空设置、'all'或'uncategorized'作为默认分类
      if (defaultCategoryId && defaultCategoryId !== 'all' && defaultCategoryId !== 'uncategorized') {
        return res.status(400).json({
          success: false,
          error: '只能设置为空、全部图片或未分类作为默认分类'
        });
      }

      // 保存到配置对象
      config.defaultCategory = defaultCategoryId;

      // 保存到配置文件
      await configLoader.saveConfig();

      console.log('已设置默认分类:', defaultCategoryId);

      res.json({
        success: true,
        message: '默认分类设置已保存'
      });
    } catch (error) {
      console.error('保存默认分类设置失败:', error);
      res.status(500).json({
        success: false,
        error: '保存默认分类设置失败'
      });
    }
  });

  return router;
}

module.exports = createSettingsRoutes;
