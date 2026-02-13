/**
 * 数据库配置辅助函数
 * 用于从数据库读取配置，并提供回退到config.json的机制
 */

/**
 * 获取图片域名配置（优先从数据库读取）
 */
async function getImageDomainConfig(imageDb, config) {
  const defaultConfig = {
    enabled: false,
    domain: '',
    httpsOnly: true,
    backupDomains: []
  };

  try {
    // 优先从数据库读取
    const dbConfig = await imageDb.getSetting('imageDomain');
    if (dbConfig) {
      return {
        enabled: dbConfig.enabled !== undefined ? dbConfig.enabled : defaultConfig.enabled,
        domain: dbConfig.domain || defaultConfig.domain,
        httpsOnly: dbConfig.httpsOnly !== undefined ? dbConfig.httpsOnly : defaultConfig.httpsOnly,
        backupDomains: dbConfig.backupDomains || defaultConfig.backupDomains
      };
    }
  } catch (error) {
    console.warn('从数据库读取图片域名配置失败，使用配置文件:', error.message);
  }

  // 回退到配置文件
  return {
    enabled: config.imageDomain?.enabled || defaultConfig.enabled,
    domain: config.imageDomain?.domain || defaultConfig.domain,
    httpsOnly: config.imageDomain?.httpsOnly !== undefined ? config.imageDomain.httpsOnly : defaultConfig.httpsOnly,
    backupDomains: config.imageDomain?.backupDomains || defaultConfig.backupDomains
  };
}

/**
 * 获取域名安全配置（优先从数据库读取）
 */
async function getDomainSecurityConfig(imageDb, config) {
  const defaultConfig = {
    enabled: false,
    allowedDomains: [],
    redirectToMain: false,
    mainDomain: ''
  };

  try {
    // 优先从数据库读取
    const dbConfig = await imageDb.getSetting('domainSecurity');
    if (dbConfig) {
      return {
        enabled: dbConfig.enabled !== undefined ? dbConfig.enabled : defaultConfig.enabled,
        allowedDomains: dbConfig.allowedDomains || defaultConfig.allowedDomains,
        redirectToMain: dbConfig.redirectToMain !== undefined ? dbConfig.redirectToMain : defaultConfig.redirectToMain,
        mainDomain: dbConfig.mainDomain || defaultConfig.mainDomain
      };
    }
  } catch (error) {
    console.warn('从数据库读取域名安全配置失败，使用配置文件:', error.message);
  }

  // 回退到配置文件
  return {
    enabled: config.domainSecurity?.enabled || defaultConfig.enabled,
    allowedDomains: config.domainSecurity?.allowedDomains || defaultConfig.allowedDomains,
    redirectToMain: config.domainSecurity?.redirectToMain || defaultConfig.redirectToMain,
    mainDomain: config.domainSecurity?.mainDomain || defaultConfig.mainDomain
  };
}

/**
 * 获取显示设置配置（优先从数据库读取）
 */
async function getDisplaySettingsConfig(imageDb, config) {
  const defaultConfig = {
    showRecentUploads: true
  };

  try {
    // 优先从数据库读取
    const dbConfig = await imageDb.getSetting('displaySettings');
    if (dbConfig) {
      return {
        showRecentUploads: dbConfig.showRecentUploads !== undefined ? dbConfig.showRecentUploads : defaultConfig.showRecentUploads
      };
    }
  } catch (error) {
    console.warn('从数据库读取显示设置失败，使用配置文件:', error.message);
  }

  // 回退到配置文件
  return {
    showRecentUploads: config.displaySettings?.showRecentUploads !== undefined ? config.displaySettings.showRecentUploads : defaultConfig.showRecentUploads
  };
}

/**
 * 获取动图自动播放配置（优先从数据库读取）
 */
async function getAnimatedAutoplayConfig(imageDb, config) {
  const defaultConfig = {
    gif: true,
    webp: true,
    avif: true
  };

  try {
    const dbConfig = await imageDb.getSetting('animatedAutoplay');
    if (dbConfig) {
      return {
        gif: dbConfig.gif !== undefined ? dbConfig.gif : defaultConfig.gif,
        webp: dbConfig.webp !== undefined ? dbConfig.webp : defaultConfig.webp,
        avif: dbConfig.avif !== undefined ? dbConfig.avif : defaultConfig.avif
      };
    }
  } catch (error) {
    console.warn('从数据库读取动图自动播放配置失败，使用配置文件:', error.message);
  }

  return {
    gif: config.animatedAutoplay?.gif !== undefined ? config.animatedAutoplay.gif : defaultConfig.gif,
    webp: config.animatedAutoplay?.webp !== undefined ? config.animatedAutoplay.webp : defaultConfig.webp,
    avif: config.animatedAutoplay?.avif !== undefined ? config.animatedAutoplay.avif : defaultConfig.avif
  };
}

module.exports = {
  getImageDomainConfig,
  getDomainSecurityConfig,
  getDisplaySettingsConfig,
  getAnimatedAutoplayConfig
};
