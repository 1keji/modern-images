const express = require('express');

/**
 * 优化后的数据库管理路由
 * 使用任务队列实现异步备份、恢复和迁移
 */
function createDatabaseRoutesOptimized({
  isAuthenticated,
  imageDb,
  queueManager,
  config
}) {
  const router = express.Router();

  /**
   * 数据库备份（异步）
   */
  router.post('/api/backup-database', isAuthenticated, async (req, res) => {
    try {
      const { format = 'sql', async = true } = req.body;

      // 检查队列是否可用
      if (!queueManager || !queueManager.initialized) {
        // 降级：使用同步方式
        console.warn('任务队列不可用，使用同步备份');
        return await handleSyncBackup(req, res, format);
      }

      if (async) {
        // 异步模式：提交任务
        const jobInfo = await queueManager.addBackupJob(format);

        return res.json({
          success: true,
          async: true,
          jobId: jobInfo.jobId,
          queue: jobInfo.queue,
          message: '备份任务已提交，正在后台处理...',
          statusUrl: `/api/jobs/${jobInfo.queue}/${jobInfo.jobId}/status`
        });
      } else {
        // 同步模式（兼容）
        return await handleSyncBackup(req, res, format);
      }

    } catch (error) {
      console.error('提交备份任务失败:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * 数据库恢复（异步）
   */
  router.post('/api/restore-database', isAuthenticated, async (req, res) => {
    try {
      const { filePath, format = 'sql', async = true } = req.body;

      if (!filePath) {
        return res.status(400).json({
          success: false,
          error: '请指定要恢复的文件路径'
        });
      }

      // 检查队列是否可用
      if (!queueManager || !queueManager.initialized) {
        console.warn('任务队列不可用，使用同步恢复');
        return await handleSyncRestore(req, res, filePath, format);
      }

      if (async) {
        // 异步模式：提交任务
        const jobInfo = await queueManager.addRestoreJob(filePath, format);

        return res.json({
          success: true,
          async: true,
          jobId: jobInfo.jobId,
          queue: jobInfo.queue,
          message: '恢复任务已提交，正在后台处理...',
          statusUrl: `/api/jobs/${jobInfo.queue}/${jobInfo.jobId}/status`
        });
      } else {
        // 同步模式（兼容）
        return await handleSyncRestore(req, res, filePath, format);
      }

    } catch (error) {
      console.error('提交恢复任务失败:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * 存储迁移（异步）
   */
  router.post('/api/migrate-storage', isAuthenticated, async (req, res) => {
    try {
      const { fromStorage, toStorage, async = true } = req.body;

      if (!fromStorage || !toStorage) {
        return res.status(400).json({
          success: false,
          error: '请指定源存储和目标存储类型'
        });
      }

      if (fromStorage === toStorage) {
        return res.status(400).json({
          success: false,
          error: '源存储和目标存储不能相同'
        });
      }

      // 检查队列是否可用
      if (!queueManager || !queueManager.initialized) {
        return res.status(503).json({
          success: false,
          error: '任务队列服务不可用，迁移操作必须使用异步模式'
        });
      }

      if (async) {
        // 获取配置信息
        const storageConfig = getStorageConfig();
        const imageDomainConfig = await getImageDomainConfig(imageDb, config);

        const options = {
          r2Config: toStorage === 'r2' ? {
            enabled: true,
            bucket: storageConfig.r2.bucket,
            endpoint: storageConfig.r2.endpoint,
            region: storageConfig.r2.region,
            accessKeyId: storageConfig.r2.accessKeyId,
            secretAccessKey: storageConfig.r2.secretAccessKey,
            customDomain: storageConfig.r2.customDomain
          } : null,
          currentDomain: req.protocol + '://' + req.get('host'),
          imageDomain: imageDomainConfig?.imageDomain
        };

        // 提交迁移任务
        const jobInfo = await queueManager.addMigrationJob(
          fromStorage,
          toStorage,
          options
        );

        return res.json({
          success: true,
          async: true,
          jobId: jobInfo.jobId,
          queue: jobInfo.queue,
          message: '迁移任务已提交，正在后台处理...',
          statusUrl: `/api/jobs/${jobInfo.queue}/${jobInfo.jobId}/status`
        });
      } else {
        return res.status(501).json({
          success: false,
          error: '存储迁移仅支持异步模式'
        });
      }

    } catch (error) {
      console.error('提交迁移任务失败:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * 获取备份列表
   */
  router.get('/api/backups/list', isAuthenticated, async (req, res) => {
    try {
      const backups = await imageDb.listBackups();

      res.json({
        success: true,
        backups
      });

    } catch (error) {
      console.error('获取备份列表失败:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * 删除备份文件
   */
  router.delete('/api/backups/:filename', isAuthenticated, async (req, res) => {
    try {
      const { filename } = req.params;

      const result = await imageDb.deleteBackup(filename);

      res.json({
        success: true,
        message: result.message
      });

    } catch (error) {
      console.error('删除备份失败:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * 同步备份处理（降级方案）
   */
  async function handleSyncBackup(req, res, format) {
    try {
      let result;
      if (format === 'sql') {
        result = await imageDb.exportToSql();
      } else {
        result = await imageDb.exportToJson();
      }

      res.json({
        success: true,
        async: false,
        ...result
      });

    } catch (error) {
      console.error('同步备份失败:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * 同步恢复处理（降级方案）
   */
  async function handleSyncRestore(req, res, filePath, format) {
    try {
      let result;
      if (format === 'sql') {
        result = await imageDb.importFromSql(filePath);
      } else {
        result = await imageDb.importFromJson(filePath);
      }

      res.json({
        success: true,
        async: false,
        message: result.message || '恢复成功'
      });

    } catch (error) {
      console.error('同步恢复失败:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  return router;
}

/**
 * 获取存储配置（辅助函数）
 */
function getStorageConfig() {
  return {
    type: process.env.STORAGE_TYPE || 'local',
    r2: {
      enabled: process.env.R2_ENABLED === 'true',
      bucket: process.env.R2_BUCKET,
      endpoint: process.env.R2_ENDPOINT,
      region: process.env.R2_REGION || 'auto',
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      customDomain: process.env.R2_CUSTOM_DOMAIN
    }
  };
}

/**
 * 获取图片域名配置（辅助函数）
 */
async function getImageDomainConfig(imageDb, config) {
  try {
    const setting = await imageDb.getSystemSetting('image_domain');
    if (setting) {
      return setting;
    }
  } catch (error) {
    console.error('获取图片域名配置失败:', error);
  }
  return null;
}

module.exports = createDatabaseRoutesOptimized;
