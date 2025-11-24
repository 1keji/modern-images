const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fsPromises = require('fs').promises;
const { ensureDirExistence } = require('../utils/file-utils');
const { getImageQualityConfig } = require('../utils/storage-utils');

/**
 * 图片处理服务
 * 负责图片格式转换、优化、上传等操作
 */

// Performance optimizations for Sharp (with safety checks)
try {
  if (sharp && typeof sharp.cache === 'function') {
    // 启用Sharp缓存以提升性能 (50MB内存限制)
    sharp.cache({ memory: 50 });
    console.log('Sharp cache enabled with 50MB memory limit');
  }
  if (sharp && typeof sharp.concurrency === 'function') {
    // 根据CPU核心数设置并发数 (核心数的一半，最少2个，最多4个)
    const cpuCount = os.cpus().length;
    const concurrency = Math.max(2, Math.min(4, Math.floor(cpuCount / 2)));
    sharp.concurrency(concurrency);
    console.log(`Sharp concurrency set to ${concurrency} (CPU cores: ${cpuCount})`);
  }
} catch (sharpError) {
  console.warn('Sharp optimization failed:', sharpError.message);
}

/**
 * 并发处理单个图片
 * @param {Object} file - Multer文件对象
 * @param {string} formatOption - 格式选项 ('webp', 'avif', 'original')
 * @param {number} orderIndex - 排序索引
 * @param {Date} uploadTime - 上传时间
 * @param {string} yearMonthPath - 年月日路径
 * @param {string} imageBaseUrl - 图片基础URL
 * @param {Object} r2StorageService - R2存储服务实例
 * @param {Object} storageConfig - 存储配置
 * @param {Object} config - 全局配置
 * @returns {Promise<Object>} 处理后的图片信息
 */
async function processImageConcurrently(
  file,
  formatOption,
  orderIndex,
  uploadTime,
  yearMonthPath,
  imageBaseUrl,
  r2StorageService,
  storageConfig,
  config
) {
  const startTime = Date.now();

  try {
    const ext = path.extname(file.originalname).toLowerCase();
    let outputFormat = '';
    let outputFilename = '';
    let fileBuffer = file.buffer;

    // 自动重命名：使用 16 位随机十六进制字符串作为文件名，再加上三位数定位
    const uniqueId = crypto.randomBytes(8).toString('hex');

    // 获取原始格式
    const originalFormat = ext.replace('.', '').toLowerCase();

    // Create Sharp instance once
    const sharpInstance = sharp(file.buffer, {
      failOnError: false,
      limitInputPixels: 268402689 // ~16K x 16K max resolution
    });

    // 根据上传选项进行图片格式转换与重命名
    if (formatOption === 'webp') {
      outputFormat = 'webp';
      outputFilename = uniqueId + orderIndex + '.webp';
      // 只有当原始格式不是webp时才进行转换
      if (originalFormat !== 'webp') {
        const quality = getImageQualityConfig(config).webp;
        fileBuffer = await sharpInstance.toFormat('webp', { quality }).toBuffer();
      }
    } else if (formatOption === 'avif') {
      outputFormat = 'avif';
      outputFilename = uniqueId + orderIndex + '.avif';
      // 只有当原始格式不是avif时才进行转换
      if (originalFormat !== 'avif') {
        const quality = getImageQualityConfig(config).avif;
        fileBuffer = await sharpInstance.toFormat('avif', { quality }).toBuffer();
      }
    } else {
      // 保持原始格式，但可能需要优化
      outputFormat = originalFormat;
      outputFilename = uniqueId + orderIndex + ext;

      // 对于PNG格式，应用优化设置
      if (originalFormat === 'png' && getImageQualityConfig(config).pngOptimize) {
        fileBuffer = await sharpInstance.png({
          compressionLevel: 6,  // 0-9，6是一个好的平衡点
          adaptiveFiltering: true,
          palette: true  // 尝试使用调色板模式以减小文件大小
        }).toBuffer();
      }
      // 其他格式保持原样，不进行处理
    }

    let imageUrl = '';
    let storage = 'local';
    let relativePath = path.join(yearMonthPath, outputFilename);

    // 检查是否使用R2存储
    if (storageConfig.type === 'r2' && storageConfig.r2.enabled && r2StorageService && r2StorageService.isAvailable()) {
      try {
        const r2Path = relativePath.replace(/\\/g, '/'); // 确保使用正斜杠
        imageUrl = await r2StorageService.uploadFile(fileBuffer, r2Path);
        storage = 'r2';
      } catch (r2Error) {
        console.error('R2上传失败，回退到本地存储:', r2Error);

        // 回退到本地存储
        const uploadDir = path.join(process.cwd(), 'uploads', yearMonthPath);
        ensureDirExistence(uploadDir);
        const destination = path.join(uploadDir, outputFilename);
        await fsPromises.writeFile(destination, fileBuffer);
        await fsPromises.utimes(destination, uploadTime, uploadTime);
        const urlPath = relativePath.replace(/\\/g, '/');
        imageUrl = `${imageBaseUrl}/i/${urlPath}`;
      }
    } else {
      // 使用本地存储
      const uploadDir = path.join(process.cwd(), 'uploads', yearMonthPath);
      ensureDirExistence(uploadDir);
      const destination = path.join(uploadDir, outputFilename);
      await fsPromises.writeFile(destination, fileBuffer);
      await fsPromises.utimes(destination, uploadTime, uploadTime);
      const urlPath = relativePath.replace(/\\/g, '/');
      imageUrl = `${imageBaseUrl}/i/${urlPath}`;
    }

    const processingTime = Date.now() - startTime;

    return {
      filename: outputFilename,
      originalFilename: file.originalname,
      path: relativePath.replace(/\\/g, '/'),
      url: imageUrl,
      htmlCode: `<img src="${imageUrl}" alt="${outputFilename}" />`,
      markdownCode: `![${outputFilename}](${imageUrl})`,
      uploadTime: uploadTime.toISOString(),
      fileSize: fileBuffer.length,
      storage: storage,
      format: outputFormat,
      processingTime: processingTime
    };
  } catch (error) {
    console.error(`Error processing image ${file.originalname}:`, error);
    throw error;
  }
}

/**
 * 生成API令牌
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  processImageConcurrently,
  generateToken
};
