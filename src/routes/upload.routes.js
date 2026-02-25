const express = require('express');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs');
const { promises: fsPromises } = require('fs');
const { getYearMonthPath } = require('../utils/date-utils');
const { getBaseUrl, getImageBaseUrl } = require('../utils/url-utils');
const { ensureDirExistence } = require('../utils/file-utils');
const { getStorageConfig, getImageQualityConfig, isR2Available } = require('../utils/storage-utils');
const { getImageDomainConfig } = require('../config/db-config-helper');

/**
 * 上传相关路由
 * 处理图片上传、存储位置及格式转换
 */
function createUploadRoutes({
  isAuthenticated,
  apiAuthenticated,
  upload,
  imageDb,
  r2StorageService,
  config
}) {
  const router = express.Router();

  /**
   * 添加图片记录到数据库并清除缓存
   */
  async function addImageRecord(imageData) {
    try {
      const result = await imageDb.addImage(imageData);
      return result;
    } catch (error) {
      console.error('添加图片记录到数据库失败:', error);
      throw error;
    }
  }

  /**
   * 清除文件系统缓存
   */
  function invalidateFileSystemCache() {
    // 通过 app.locals 访问文件系统缓存
    const fileSystemCache = router.app?.locals?.fileSystemCache;
    if (fileSystemCache) {
      fileSystemCache.lastScan = 0;
      fileSystemCache.files = [];
    }
  }

  /**
   * 上传文件到R2存储
   */
  async function uploadToR2(fileBuffer, filename) {
    if (!r2StorageService || !r2StorageService.isAvailable()) {
      throw new Error('R2客户端未初始化或配置不完整');
    }

    console.log(`开始上传到R2: ${filename}`);
    console.log(`文件大小: ${fileBuffer.length} bytes`);

    return await r2StorageService.uploadFile(fileBuffer, filename);
  }

  /**
   * 检查R2是否可用
   */
  function checkR2Available() {
    return r2StorageService && r2StorageService.isAvailable();
  }

  // 上传接口：处理图片上传、存储位置及格式转换，同时自动重命名，并在文件名上增加三位数的上传顺序定位
  router.post('/upload', isAuthenticated, upload.array('images'), async (req, res) => {
    const requestStartTime = Date.now();

    try {
      // format: "original", "webp", "avif"，默认 original
      const formatOption = req.body.format || 'original';

      let resultImages = [];
      // 获取年月日文件夹路径及基本 URL
      const yearMonthPath = getYearMonthPath();
      const baseUrl = getBaseUrl(req);
      const imageDomainConfig = await getImageDomainConfig(imageDb, config);
      const imageBaseUrl = await getImageBaseUrl(req, imageDomainConfig);
      // 设置相同的上传时间，确保同一批次上传的文件时间一致
      const uploadTime = new Date();

      // === 2025优化：并行处理多张图片上传 ===
      // 使用 Promise.all 并行处理所有图片，大幅提升多图上传速度
      // 由于前端已从后往前传输文件，这里需要反向计算orderIndex以保持正确的文件名顺序
      const processImageTask = async (file, i) => {
        const orderIndex = (req.files.length - i).toString().padStart(3, '0');
        const ext = path.extname(file.originalname).toLowerCase();
        let outputFormat = '';
        let outputFilename = '';
        let fileBuffer = file.buffer;

        // 自动重命名：使用 16 位随机十六进制字符串作为文件名，再加上三位数定位
        const uniqueId = crypto.randomBytes(8).toString('hex');

        // 获取原始格式
        const originalFormat = ext.replace('.', '').toLowerCase();

        // 根据上传选项进行图片格式转换与重命名
        if (formatOption === 'webp') {
          outputFormat = 'webp';
          outputFilename = uniqueId + orderIndex + '.webp';
          // 只有当原始格式不是webp时才进行转换
          if (originalFormat !== 'webp') {
            const quality = getImageQualityConfig(config).webp;
            fileBuffer = await sharp(file.buffer).toFormat('webp', { quality }).toBuffer();
          }
        } else if (formatOption === 'avif') {
          outputFormat = 'avif';
          outputFilename = uniqueId + orderIndex + '.avif';
          // 只有当原始格式不是avif时才进行转换
          if (originalFormat !== 'avif') {
            const quality = getImageQualityConfig(config).avif;
            fileBuffer = await sharp(file.buffer).toFormat('avif', { quality }).toBuffer();
          }
        } else {
          // 保持原始格式，但可能需要优化
          outputFormat = originalFormat;
          outputFilename = uniqueId + orderIndex + ext;

          // 对于PNG格式，应用优化设置
          if (originalFormat === 'png' && getImageQualityConfig(config).pngOptimize) {
            fileBuffer = await sharp(file.buffer).png({
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
        const storageConfig = getStorageConfig();
        if (storageConfig.type === 'r2' && storageConfig.r2.enabled && checkR2Available()) {
          console.log(`尝试使用R2存储上传文件: ${outputFilename}`);
          console.log(`当前存储配置:`, {
            type: storageConfig.type,
            r2Enabled: storageConfig.r2.enabled,
            hasR2Client: !!r2StorageService,
            bucket: storageConfig.r2.bucket,
            endpoint: storageConfig.r2.endpoint
          });

          try {
            const r2Path = relativePath.replace(/\\/g, '/'); // 确保使用正斜杠
            console.log(`R2文件路径: ${r2Path}`);
            imageUrl = await uploadToR2(fileBuffer, r2Path);
            storage = 'r2';
            console.log(`R2上传成功，图片URL: ${imageUrl}`);
          } catch (r2Error) {
            console.error('R2上传失败，回退到本地存储:', r2Error);
            console.error('错误详情:', r2Error.message);
            console.error('错误堆栈:', r2Error.stack);

            // 回退到本地存储
            const uploadDir = path.join(process.cwd(), 'uploads', yearMonthPath);
            ensureDirExistence(uploadDir);
            const destination = path.join(uploadDir, outputFilename);
            await fsPromises.writeFile(destination, fileBuffer);
            await fsPromises.utimes(destination, uploadTime, uploadTime);
            const urlPath = relativePath.replace(/\\/g, '/');
            imageUrl = `${imageBaseUrl}/i/${urlPath}`;
            console.log(`回退到本地存储成功，图片URL: ${imageUrl}`);
          }
        } else {
          console.log('使用本地存储');
          console.log(`存储配置检查:`, {
            storageType: storageConfig.type,
            r2Enabled: storageConfig.r2.enabled,
            hasR2Client: !!r2StorageService
          });

          // 存储到uploads目录
          const uploadDir = path.join(process.cwd(), 'uploads', yearMonthPath);
          ensureDirExistence(uploadDir);
          const destination = path.join(uploadDir, outputFilename);
          await fsPromises.writeFile(destination, fileBuffer);
          await fsPromises.utimes(destination, uploadTime, uploadTime);
          const urlPath = relativePath.replace(/\\/g, '/');
          imageUrl = `${imageBaseUrl}/i/${urlPath}`;
          console.log(`本地存储成功，图片URL: ${imageUrl}`);
        }

        // 获取文件大小信息
        const fileSize = fileBuffer.length;

        const imageData = {
          filename: outputFilename,
          path: relativePath.replace(/\\/g, '/'),
          uploadTime: uploadTime.toISOString(),
          fileSize: fileSize,
          storage: storage,
          format: outputFormat,
          url: imageUrl,
          htmlCode: `<img src="${imageUrl}" alt="${outputFilename}" />`,
          markdownCode: `![](${imageUrl})`
        };

        // 添加到图片记录
        await addImageRecord(imageData);

        return {
          ...imageData,
          uploadTime: uploadTime.toLocaleString() // 返回本地化的时间字符串
        };
      };

      // 并行处理所有图片（从后往前索引，与原逻辑保持一致）
      const processingTasks = [];
      for (let i = req.files.length - 1; i >= 0; i--) {
        processingTasks.push(processImageTask(req.files[i], i));
      }

      resultImages = await Promise.all(processingTasks);

      // 反转结果数组顺序，确保返回顺序与本地显示顺序一致（第一张在前，最后一张在后）
      resultImages.reverse();

      // 清除文件系统缓存，因为有新文件上传
      invalidateFileSystemCache();

      res.json({
        success: true,
        images: resultImages
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /* ---------------- API上传接口 ---------------- */

  // API上传接口：处理图片上传，并将图片存储在api专用目录中
  router.post('/api/upload', apiAuthenticated, upload.array('images'), async (req, res) => {
    try {
      // 优先使用请求中指定的格式，如果没有则使用默认格式设置
      const formatOption = req.query.format || config.api.defaultFormat || 'original';

      // 获取存储策略参数，支持通过API参数指定存储方式
      // 可选值: 'r2', 'local', 'auto'(跟随全局设置)
      const storageParam = req.query.storage || req.body.storage || 'auto';

      // 获取"api上传"分类ID，如果不存在则创建
      let apiUploadCategoryId = null;
      try {
        apiUploadCategoryId = await imageDb.ensureApiUploadCategory();
        console.log('API上传使用的分类ID:', apiUploadCategoryId);
      } catch (catError) {
        console.error('获取API上传分类失败:', catError);
        // 继续执行，只是不会设置分类
      }

      let resultImages = [];
      // 获取年月日文件夹路径及基本 URL
      const yearMonthPath = path.join('api', getYearMonthPath());
      const baseUrl = getBaseUrl(req);
      const imageDomainConfig = await getImageDomainConfig(imageDb, config);
      const imageBaseUrl = await getImageBaseUrl(req, imageDomainConfig);
      // 设置相同的上传时间，确保同一批次上传的文件时间一致
      const uploadTime = new Date();

      // === 2025优化：并行处理API上传 ===
      const processApiImageTask = async (file, i) => {
        const orderIndex = (req.files.length - i).toString().padStart(3, '0');
        const ext = path.extname(file.originalname).toLowerCase();
        let outputFormat = '';
        let outputFilename = '';
        let fileBuffer = file.buffer;

        // 自动重命名：使用 16 位随机十六进制字符串作为文件名，再加上三位数定位
        const uniqueId = crypto.randomBytes(8).toString('hex');

        // 获取原始格式
        const originalFormat = ext.replace('.', '').toLowerCase();

        // 根据上传选项进行图片格式转换与重命名
        if (formatOption === 'webp') {
          outputFormat = 'webp';
          outputFilename = uniqueId + orderIndex + '.webp';
          // 只有当原始格式不是webp时才进行转换
          if (originalFormat !== 'webp') {
            const quality = getImageQualityConfig(config).webp;
            fileBuffer = await sharp(file.buffer).toFormat('webp', { quality }).toBuffer();
          }
        } else if (formatOption === 'avif') {
          outputFormat = 'avif';
          outputFilename = uniqueId + orderIndex + '.avif';
          // 只有当原始格式不是avif时才进行转换
          if (originalFormat !== 'avif') {
            const quality = getImageQualityConfig(config).avif;
            fileBuffer = await sharp(file.buffer).toFormat('avif', { quality }).toBuffer();
          }
        } else {
          // 保持原始格式，但可能需要优化
          outputFormat = originalFormat;
          outputFilename = uniqueId + orderIndex + ext;

          // 对于PNG格式，应用优化设置
          if (originalFormat === 'png' && getImageQualityConfig(config).pngOptimize) {
            fileBuffer = await sharp(file.buffer).png({
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

        // 决定使用哪种存储策略
        let shouldUseR2 = false;
        let storageError = null;

        if (storageParam === 'r2') {
          // 强制使用R2存储，检查R2是否可用
          shouldUseR2 = true;
          if (!checkR2Available()) {
            storageError = 'R2存储不可用：请检查R2配置或联系管理员';
          }
        } else if (storageParam === 'local') {
          // 强制使用本地存储
          shouldUseR2 = false;
        } else {
          // auto: 跟随全局配置
          shouldUseR2 = getStorageConfig().type === 'r2' && checkR2Available();
        }

        // 如果指定了R2存储但不可用，返回错误
        if (storageParam === 'r2' && storageError) {
          throw new Error(storageError);
        }

        // 检查是否使用R2存储
        if (shouldUseR2 && checkR2Available()) {
          try {
            const r2Path = relativePath.replace(/\\/g, '/'); // 确保使用正斜杠
            imageUrl = await uploadToR2(fileBuffer, r2Path);
            storage = 'r2';
            console.log(`API上传成功使用R2存储: ${r2Path}`);
          } catch (r2Error) {
            console.error('R2上传失败:', r2Error);

            // 如果是强制使用R2存储，不回退到本地存储
            if (storageParam === 'r2') {
              throw new Error(`R2上传失败: ${r2Error.message}`);
            }

            // 否则回退到本地存储
            console.log('回退到本地存储');
            const uploadDir = path.join(process.cwd(), 'uploads', yearMonthPath);
            ensureDirExistence(uploadDir);
            const destination = path.join(uploadDir, outputFilename);
            await fsPromises.writeFile(destination, fileBuffer);
            await fsPromises.utimes(destination, uploadTime, uploadTime);
            const urlPath = relativePath.replace(/\\/g, '/');
            imageUrl = `${imageBaseUrl}/i/${urlPath}`;
            console.log(`API上传回退到本地存储: ${urlPath}`);
          }
        } else {
          // 存储到api/uploads目录
          const uploadDir = path.join(process.cwd(), 'uploads', yearMonthPath);
          ensureDirExistence(uploadDir);
          const destination = path.join(uploadDir, outputFilename);
          await fsPromises.writeFile(destination, fileBuffer);
          await fsPromises.utimes(destination, uploadTime, uploadTime);
          const urlPath = relativePath.replace(/\\/g, '/');
          imageUrl = `${imageBaseUrl}/i/${urlPath}`;
          console.log(`API上传使用本地存储: ${urlPath}`);
        }

        // 获取文件大小信息
        const fileSize = fileBuffer.length;

        const imageData = {
          filename: outputFilename,
          path: relativePath.replace(/\\/g, '/'),
          uploadTime: uploadTime.toISOString(),
          fileSize: fileSize,
          storage: storage,
          format: outputFormat,
          url: imageUrl,
          htmlCode: `<img src="${imageUrl}" alt="${outputFilename}" />`,
          markdownCode: `![](${imageUrl})`,
          categoryId: apiUploadCategoryId // 设置分类为"api上传"
        };

        // 添加到图片记录
        await addImageRecord(imageData);

        return {
          ...imageData,
          uploadTime: uploadTime.toLocaleString() // 返回本地化的时间字符串
        };
      };

      // 并行处理所有API上传的图片
      const apiProcessingTasks = [];
      for (let i = req.files.length - 1; i >= 0; i--) {
        apiProcessingTasks.push(processApiImageTask(req.files[i], i));
      }

      resultImages = await Promise.all(apiProcessingTasks);

      // 反转结果数组顺序，确保返回顺序与本地显示顺序一致（第一张在前，最后一张在后）
      resultImages.reverse();

      // 清除文件系统缓存，因为有新文件上传
      invalidateFileSystemCache();

      // 根据PicGo等客户端的需求，返回不同格式的响应
      if (req.query.picgo === 'true') {
        // PicGo兼容格式
        return res.json({
          success: true,
          result: resultImages.map(img => img.url)
        });
      }

      res.json({
        success: true,
        images: resultImages
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createUploadRoutes;
