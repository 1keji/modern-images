/**
 * 图片相关路由模块
 * 提供图片列表、删除、分类管理、存储统计等功能
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { getBaseUrl, getImageBaseUrl } = require('../utils/url-utils');
const { getAllFiles } = require('../utils/file-utils');
const { getImageDomainConfig } = require('../config/db-config-helper');

/**
 * 创建图片路由
 * @param {Object} dependencies - 依赖注入对象
 * @param {Function} dependencies.isAuthenticated - 认证中间件
 * @param {Object} dependencies.imageDb - 图片数据库实例
 * @param {Object} dependencies.redisClient - Redis客户端实例
 * @param {Object} dependencies.r2StorageService - R2存储服务实例
 * @param {Object} dependencies.config - 全局配置对象
 * @param {Object} dependencies.fileSystemCache - 文件系统缓存对象
 * @returns {express.Router} Express路由器
 */
function createImagesRouter(dependencies) {
  const router = express.Router();
  const { isAuthenticated, imageDb, r2StorageService, config, fileSystemCache } = dependencies;

  // 如果没有传入文件系统缓存，使用默认值
  const fsCache = fileSystemCache || {
    lastScan: 0,
    files: [],
    cacheTimeout: 60000 // 1 minute cache
  };

  /* ---------------- 辅助函数 ---------------- */

  /**
   * 清除文件系统缓存
   */
  function invalidateFileSystemCache() {
    fsCache.lastScan = 0;
    fsCache.files = [];
  }

  /**
   * 递归清理空文件夹
   */
  function cleanEmptyDirs(dir) {
    if (fs.existsSync(dir)) {
      let entries = fs.readdirSync(dir);

      // 先递归清理子目录
      entries.forEach(entry => {
        const fullPath = path.join(dir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          cleanEmptyDirs(fullPath);
        }
      });

      // 重新检查当前目录
      entries = fs.readdirSync(dir);
      if (entries.length === 0 && dir !== path.join(process.cwd(), 'uploads')) {
        // 不删除uploads根目录，只删除其子目录
        fs.rmdirSync(dir);
        console.log(`已删除空文件夹: ${dir}`);
      }
    }
  }

  /**
   * 删除图片记录
   */
  async function removeImageRecord(imagePath) {
    try {
      const result = await imageDb.removeImage(imagePath);
      return result;
    } catch (error) {
      console.error('从数据库删除图片记录失败:', error);
      throw error;
    }
  }

  /**
   * 合并数据库记录和文件系统扫描的图片列表
   */
  async function mergeImagesFromDbAndFileSystem(req, storageType = null, useCache = true) {
    const baseUrl = getBaseUrl(req);
    const imageDomainConfig = await getImageDomainConfig(imageDb, config);
    const imageBaseUrl = await getImageBaseUrl(req, imageDomainConfig);

    let images = await imageDb.getAllImages(null, storageType); // 从PostgreSQL数据库获取

    // 创建一个路径集合，用于检查哪些文件已经在数据库中
    const recordedPaths = new Set(images.map(img => img.path));

    // 只有在查询所有图片或本地图片时才扫描文件系统
    if (!storageType || storageType === 'local') {
      // 扫描文件系统查找未记录的图片
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (fs.existsSync(uploadsDir)) {
        const uploadedFiles = getAllFiles(uploadsDir, [], fsCache);
        uploadedFiles.forEach(filePath => {
          const stats = fs.statSync(filePath);
          const relativePath = path.relative(uploadsDir, filePath);
          const normalizedPath = relativePath.replace(/\\/g, '/');

          // 只添加未在数据库中记录的图片
          if (!recordedPaths.has(normalizedPath)) {
            const filename = path.basename(filePath);
            const imageUrl = `${imageBaseUrl}/i/${normalizedPath}`;

            images.push({
              filename: filename,
              path: normalizedPath,
              uploadTime: stats.mtime.toISOString(),
              fileSize: stats.size,
              storage: 'local',
              format: path.extname(filename).substring(1),
              url: imageUrl,
              htmlCode: `<img src="${imageUrl}" alt="${filename}" />`,
              markdownCode: `![${filename}](${imageUrl})`
            });
          }
        });
      }
    }

    return images;
  }

  /* ---------------- 图片列表路由 ---------------- */

  // 获取图片列表（支持存储类型过滤，带缓存）
  router.get('/images', isAuthenticated, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 30;
      const storageType = req.query.storage; // 可以是 'local', 'r2', 或不设置（获取所有）
      const useCache = req.query.cache !== 'false'; // 允许禁用缓存

      // 合并数据库记录和文件系统中的图片
      let images = await mergeImagesFromDbAndFileSystem(req, storageType, useCache);

      // 按上传时间排序（最新的在前），对于相同时间的图片按文件名中的orderIndex排序
      images.sort((a, b) => {
        const dateA = new Date(a.uploadTime);
        const dateB = new Date(b.uploadTime);
        if (dateB.getTime() !== dateA.getTime()) {
          return dateB - dateA;
        }
        // 相同时间的情况下，按文件名中的orderIndex排序（001, 002, 003...）
        // 文件名格式：uniqueId(16位) + orderIndex(3位) + extension
        const getOrderIndex = (filename) => {
          if (!filename) return 0;
          const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
          const orderStr = nameWithoutExt.slice(-3);
          return parseInt(orderStr, 10) || 0;
        };
        return getOrderIndex(a.filename) - getOrderIndex(b.filename);
      });

      if (limit > 0) {
        images = images.slice(0, limit);
      }

      // 转换时间格式为本地化字符串
      images = images.map(img => ({
        ...img,
        uploadTime: new Date(img.uploadTime).toLocaleString()
      }));

      res.json({
        success: true,
        images: images
      });
    } catch (error) {
      console.error('获取图片列表失败:', error);
      res.status(500).json({ success: false, message: `获取图片列表失败: ${error.message}` });
    }
  });

  // 分页获取图片（支持存储类型过滤）
  router.get('/images/paged', isAuthenticated, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const storageType = req.query.storage || null;

      const result = await imageDb.getImagesPaged(page, limit, storageType);

      res.json({
        success: true,
        images: result.images,
        pagination: result.pagination
      });
    } catch (error) {
      console.error('分页获取图片失败:', error);
      res.status(500).json({ success: false, message: `获取图片列表失败: ${error.message}` });
    }
  });

  /* ---------------- 存储统计路由 ---------------- */

  // 获取图片存储统计信息
  router.get('/api/storage-stats', isAuthenticated, async (req, res) => {
    try {
      // 使用PostgreSQL获取统计信息，性能更好
      const stats = await imageDb.getStorageStats();
      // 获取存储空间使用（字节）
      let sizeStats = { total: 0, local: 0, r2: 0 };
      try {
        sizeStats = await imageDb.getStorageUsage();
      } catch (sizeErr) {
        console.warn('获取存储空间使用情况失败:', sizeErr.message);
      }

      // 仅查询路径集合，避免加载全量图片数据
      const recordedPaths = await imageDb.getAllImagePaths();

      const uploadsDir = path.join(process.cwd(), 'uploads');
      let unrecordedCount = 0;
      let unrecordedSize = 0;

      if (fs.existsSync(uploadsDir)) {
        const uploadedFiles = getAllFiles(uploadsDir, [], fsCache);
        unrecordedCount = uploadedFiles.filter(filePath => {
          const relativePath = path.relative(uploadsDir, filePath);
          const normalizedPath = relativePath.replace(/\\/g, '/');
          return !recordedPaths.has(normalizedPath);
        }).length;

        // 计算未记录文件大小
        unrecordedSize = uploadedFiles.reduce((acc, filePath) => {
          const relativePath = path.relative(uploadsDir, filePath);
          const normalizedPath = relativePath.replace(/\\/g, '/');
          if (!recordedPaths.has(normalizedPath)) {
            try {
              const { size } = fs.statSync(filePath);
              return acc + size;
            } catch (_) {
              return acc;
            }
          }
          return acc;
        }, 0);
      }

      // 更新统计信息包含未记录的图片
      const finalStats = {
        total: stats.total + unrecordedCount,
        local: stats.local + unrecordedCount, // 文件系统中的图片都是本地存储
        r2: stats.r2
      };

      // 更新空间使用信息（字节）
      const finalSizes = {
        total: sizeStats.total + unrecordedSize,
        local: sizeStats.local + unrecordedSize,
        r2: sizeStats.r2
      };

      res.json({
        success: true,
        stats: finalStats,
        sizes: finalSizes,
        // 为向后兼容保留旧字段
        totalImages: finalStats.total,
        totalSize: finalSizes.total
      });
    } catch (error) {
      console.error('获取存储统计失败:', error);
      res.status(500).json({ success: false, message: `获取存储统计失败: ${error.message}` });
    }
  });

  /* ---------------- 图片删除路由 ---------------- */

  // 删除图片API（支持单张或多张删除）
  router.post('/api/delete', isAuthenticated, async (req, res) => {
    try {
      let images = req.body.images;
      if (!Array.isArray(images)) {
        return res.status(400).json({ success: false, message: '无效的请求格式.' });
      }

      for (let image of images) {
        if (!image.storage || !image.path) continue;

        if (image.storage === 'local') {
          const filePath = path.join(process.cwd(), 'uploads', image.path);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          } else {
            console.warn("文件不存在: ", filePath);
          }
        } else if (image.storage === 'r2') {
          try {
            await r2StorageService.deleteFile(image.path);
            console.log("R2文件已删除: ", image.path);
          } catch (error) {
            console.error("R2文件删除失败: ", image.path, error);
          }
        }

        // 从图片记录中删除
        await removeImageRecord(image.path);
      }

      // 在删除图片后清理空文件夹
      cleanEmptyDirs(path.join(process.cwd(), 'uploads'));

      // 清除文件系统缓存，因为有文件被删除
      invalidateFileSystemCache();

      res.json({ success: true, message: '图片删除成功.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  /* ---------------- 图片分类管理路由 ---------------- */

  // 更新图片的分类
  router.put('/api/images/:id/category', isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, error: '无效的图片ID' });
      }

      let { categoryId, parentCategoryId } = req.body;

      // 增强类型检查
      if (categoryId === '' || categoryId === 'null' || categoryId === 'undefined' || categoryId === undefined) {
        categoryId = null;
        console.log('将分类ID设置为null');
      }

      // 处理父分类未分类的情况
      if (parentCategoryId) {
        parentCategoryId = parseInt(parentCategoryId);
        if (isNaN(parentCategoryId)) {
          return res.status(400).json({ success: false, error: '无效的父分类ID' });
        }

        // 验证父分类是否存在且是一级分类
        const category = await imageDb.getCategoryById(parentCategoryId);
        if (!category) {
          return res.status(404).json({ success: false, error: `ID为${parentCategoryId}的父分类不存在` });
        }

        if (category.parent_id) {
          return res.status(400).json({
            success: false,
            error: `ID为${parentCategoryId}的分类是二级分类，不能作为父分类`
          });
        }

        console.log(`图片${id}设置为父分类${parentCategoryId}下的未分类状态`);
        // 设置了parentCategoryId时，确保categoryId为null
        // 这表示图片属于一级分类，但不属于任何二级分类
        categoryId = null;
      }

      console.log('更新图片分类', { id, categoryId, parentCategoryId, 类型: typeof categoryId });

      // 使用修改后的方法更新图片分类
      let ok;
      if (parentCategoryId) {
        // 当提供父分类ID时，表示图片设置为该一级分类下的未分类状态
        // updateImageCategoryWithParent方法会设置正确的categoryId值
        ok = await imageDb.updateImageCategoryWithParent(id, null, parentCategoryId);
      } else {
        // 没有父分类ID时，直接使用提供的categoryId
        // 如果categoryId为null，表示完全移除分类（顶级未分类）
        ok = await imageDb.updateImageCategory(id, categoryId);
      }

      res.json({ success: ok });
    } catch (err) {
      console.error('更新图片分类失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /* ---------------- 动图标记路由 ---------------- */

  // 设置/取消图片的动图标记
  router.put('/api/images/:id/animated', isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, error: '无效的图片ID' });
      }

      const { isAnimated } = req.body;
      if (typeof isAnimated !== 'boolean') {
        return res.status(400).json({ success: false, error: '无效的参数，isAnimated 必须为布尔值' });
      }

      const ok = await imageDb.setImageAnimated(id, isAnimated);
      res.json({ success: ok });
    } catch (err) {
      console.error('设置动图标记失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /* ---------------- 未分类图片路由 ---------------- */

  // 获取未分类图片
  router.get('/api/images/uncategorized', isAuthenticated, async (req, res) => {
    try {
      // 直接查询数据库中 category_id IS NULL 的图片，避免全量加载后内存过滤
      const images = await imageDb.getImagesWithoutCategory();
      res.json({ success: true, images });
    } catch (err) {
      console.error('获取未分类图片失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 获取未分类图片（分页版本）
  router.get('/api/images/uncategorized/paged', isAuthenticated, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;

      const result = await imageDb.getImagesWithoutCategoryPaged(page, limit);
      res.json({
        success: true,
        images: result.images,
        pagination: result.pagination
      });
    } catch (err) {
      console.error('分页获取未分类图片失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /* ---------------- 分类图片查询路由 ---------------- */

  // 获取指定分类下的图片（非分页）
  router.get('/api/categories/:id/images', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const images = await imageDb.getImagesByCategory(id);
      res.json({ success: true, images });
    } catch (err) {
      console.error('获取分类图片失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 获取指定分类下的图片（分页版本）
  router.get('/api/categories/:id/images/paged', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;

      // 确保ID是有效的数字
      const categoryId = parseInt(id);
      if (isNaN(categoryId)) {
        console.error(`无效的分类ID参数: ${id}`);
        return res.status(400).json({ success: false, error: '无效的分类ID' });
      }

      // 验证分类是否存在
      try {
        const category = await imageDb.getCategoryById(categoryId);
        if (!category) {
          console.error(`请求的分类不存在: ID=${categoryId}`);
          return res.status(404).json({ success: false, error: `ID为${categoryId}的分类不存在` });
        }

        console.log(`加载分类图片: ID=${category.id}, 名称=${category.name}, 父ID=${category.parent_id || 'NULL'}`);
      } catch (categoryErr) {
        console.error(`检查分类存在时出错: ${categoryErr.message}`);
        // 即使出错仍继续执行，尝试加载图片
      }

      console.log(`分页获取分类ID=${categoryId}的图片，第${page}页，每页${limit}条`);
      const result = await imageDb.getImagesByCategoryPaged(categoryId, page, limit);

      res.json({
        success: true,
        images: result.images,
        pagination: result.pagination
      });
    } catch (err) {
      console.error(`分页获取分类图片失败，ID=${req.params.id}, 错误:`, err);
      res.status(500).json({ success: false, error: err.message || '分页获取分类图片失败' });
    }
  });

  // 获取一级分类及其所有子分类的所有图片（分页版本）
  router.get('/api/categories/:id/allimages/paged', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;

      // 确保ID是有效的数字
      const categoryId = parseInt(id);
      if (isNaN(categoryId)) {
        console.error(`无效的分类ID参数: ${id}`);
        return res.status(400).json({ success: false, error: '无效的分类ID' });
      }

      try {
        console.log(`分页获取一级分类ID=${categoryId}及其所有子分类的图片，第${page}页，每页${limit}条`);
        const result = await imageDb.getImagesInParentCategoryPaged(categoryId, page, limit);

        res.json({
          success: true,
          images: result.images,
          pagination: result.pagination
        });
      } catch (err) {
        // 如果发生错误（例如，指定的不是一级分类），返回适当的错误消息
        console.error(`获取一级分类及其子分类图片失败，ID=${categoryId}:`, err);
        return res.status(400).json({ success: false, error: err.message });
      }
    } catch (err) {
      console.error(`分页获取一级分类及其子分类图片失败，ID=${req.params.id}, 错误:`, err);
      res.status(500).json({ success: false, error: err.message || '分页获取一级分类及其子分类图片失败' });
    }
  });

  // 获取特定父分类下未归类到子分类的图片（分页版本）
  router.get('/api/categories/:id/uncategorized/paged', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;

      // 确保ID是有效的数字
      const categoryId = parseInt(id);
      if (isNaN(categoryId)) {
        return res.status(400).json({ success: false, error: '无效的分类ID' });
      }

      // 首先验证父分类是否存在
      const category = await imageDb.getCategoryById(categoryId);
      if (!category) {
        return res.status(404).json({ success: false, error: `ID为${categoryId}的分类不存在` });
      }

      // 验证这是一个一级分类（没有父分类）
      if (category.parent_id) {
        return res.status(400).json({
          success: false,
          error: `ID为${categoryId}的分类是二级分类，不能作为父分类查询未分类图片`
        });
      }

      console.log(`获取父分类ID=${categoryId}下的未归类图片，分页：第${page}页，每页${limit}条`);
      const result = await imageDb.getImagesInCategoryWithoutSubcategoryPaged(categoryId, page, limit);
      res.json({
        success: true,
        images: result.images,
        pagination: result.pagination
      });
    } catch (err) {
      console.error('分页获取分类下未归类图片失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createImagesRouter;
