/**
 * 存储配置工具模块
 */

/**
 * 获取当前存储配置
 * @returns {Object} 存储配置对象
 */
function getStorageConfig() {
  return {
    type: process.env.STORAGE_TYPE || 'local',
    r2: {
      enabled: process.env.R2_ENABLED === 'true',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      endpoint: process.env.R2_ENDPOINT || '',
      bucket: process.env.R2_BUCKET || '',
      region: process.env.R2_REGION || 'auto',
      customDomain: process.env.R2_CUSTOM_DOMAIN || ''
    }
  };
}

/**
 * 获取图片质量配置
 * @param {Object} config - 全局配置对象
 * @returns {Object} 图片质量配置
 */
function getImageQualityConfig(config) {
  return {
    webp: config.imageQuality?.webp || parseInt(process.env.IMAGE_QUALITY_WEBP) || 80,
    avif: config.imageQuality?.avif || parseInt(process.env.IMAGE_QUALITY_AVIF) || 75,
    pngOptimize: config.imageQuality?.pngOptimize !== undefined ?
      config.imageQuality.pngOptimize :
      process.env.IMAGE_QUALITY_PNG_OPTIMIZE !== 'false'
  };
}

/**
 * 检查R2是否可用
 * @param {Object} r2Client - R2客户端实例
 * @returns {boolean} 是否可用
 */
function isR2Available(r2Client) {
  return r2Client &&
         process.env.R2_ENABLED === 'true' &&
         process.env.R2_ACCESS_KEY_ID &&
         process.env.R2_SECRET_ACCESS_KEY &&
         process.env.R2_ENDPOINT &&
         process.env.R2_BUCKET;
}

module.exports = {
  getStorageConfig,
  getImageQualityConfig,
  isR2Available
};
