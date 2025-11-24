/**
 * Redis Management Routes
 * Handles Redis cache management, TTL configuration, and monitoring
 */

const express = require('express');

/**
 * Create Redis routes with dependency injection
 * @param {Function} isAuthenticated - Authentication middleware
 * @param {Object} redisClient - Redis client instance
 * @returns {express.Router} Express router with Redis routes
 */
function createRedisRoutes(isAuthenticated, redisClient) {
  const router = express.Router();

  // 获取Redis状态信息
  router.get('/api/debug/redis-status', isAuthenticated, async (req, res) => {
    try {
      const stats = await redisClient.getStats();
      res.json({
        success: true,
        redis: stats
      });
    } catch (error) {
      console.error('获取Redis状态失败:', error);
      res.status(500).json({
        success: false,
        message: `获取Redis状态失败: ${error.message}`
      });
    }
  });

  // 清空Redis缓存
  router.post('/api/cache/flush', isAuthenticated, async (req, res) => {
    try {
      const result = await redisClient.flushCache();
      if (result) {
        res.json({
          success: true,
          message: 'Redis缓存已清空'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Redis未启用或清空失败'
        });
      }
    } catch (error) {
      console.error('清空Redis缓存失败:', error);
      res.status(500).json({
        success: false,
        message: `清空Redis缓存失败: ${error.message}`
      });
    }
  });

  // 清除图片列表缓存
  router.post('/api/cache/invalidate-images', isAuthenticated, async (req, res) => {
    try {
      await redisClient.invalidateImageListCache();
      res.json({
        success: true,
        message: '图片列表缓存已清除'
      });
    } catch (error) {
      console.error('清除图片列表缓存失败:', error);
      res.status(500).json({
        success: false,
        message: `清除图片列表缓存失败: ${error.message}`
      });
    }
  });

  // 清除配置缓存
  router.post('/api/cache/invalidate-config', isAuthenticated, async (req, res) => {
    try {
      await redisClient.invalidateConfigCache();
      res.json({
        success: true,
        message: '配置缓存已清除'
      });
    } catch (error) {
      console.error('清除配置缓存失败:', error);
      res.status(500).json({
        success: false,
        message: `清除配置缓存失败: ${error.message}`
      });
    }
  });

  // Redis内存配置管理
  router.post('/api/redis/configure-memory', isAuthenticated, async (req, res) => {
    try {
      const { maxMemory, maxMemoryPolicy } = req.body;

      if (!redisClient.isEnabled()) {
        return res.status(400).json({
          success: false,
          message: 'Redis未启用或连接失败'
        });
      }

      const results = [];

      if (maxMemory) {
        try {
          await redisClient.client.configSet('maxmemory', maxMemory);
          results.push(`最大内存设置为: ${maxMemory}`);
        } catch (error) {
          console.error('设置Redis最大内存失败:', error);
          return res.status(500).json({
            success: false,
            message: `设置最大内存失败: ${error.message}`
          });
        }
      }

      if (maxMemoryPolicy) {
        try {
          await redisClient.client.configSet('maxmemory-policy', maxMemoryPolicy);
          results.push(`内存淘汰策略设置为: ${maxMemoryPolicy}`);
        } catch (error) {
          console.error('设置Redis内存策略失败:', error);
          return res.status(500).json({
            success: false,
            message: `设置内存策略失败: ${error.message}`
          });
        }
      }

      if (results.length === 0) {
        return res.status(400).json({
          success: false,
          message: '没有提供有效的配置参数'
        });
      }

      res.json({
        success: true,
        message: results.join(', ')
      });
    } catch (error) {
      console.error('Redis内存配置失败:', error);
      res.status(500).json({
        success: false,
        message: `Redis内存配置失败: ${error.message}`
      });
    }
  });

  // TTL配置管理 - GET
  router.get('/api/redis/ttl-config', isAuthenticated, async (req, res) => {
    try {
      if (!redisClient.isEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'Redis未启用或连接失败'
        });
      }

      const ttlConfig = redisClient.getTtlConfig();

      // 添加调试信息
      const envConfig = {
        imageList: parseInt(process.env.REDIS_IMAGE_LIST_TTL) || null,
        imageInfo: parseInt(process.env.REDIS_IMAGE_INFO_TTL) || null,
        config: parseInt(process.env.REDIS_CONFIG_TTL) || null,
        userSession: parseInt(process.env.REDIS_USER_SESSION_TTL) || null,
        apiCache: parseInt(process.env.REDIS_API_CACHE_TTL) || null,
        statistics: parseInt(process.env.REDIS_STATISTICS_TTL) || null
      };

      console.log('当前环境变量TTL配置:', envConfig);
      console.log('当前Redis客户端TTL配置:', ttlConfig);

      res.json({
        success: true,
        config: ttlConfig,
        debug: {
          envConfig,
          currentConfig: ttlConfig
        }
      });
    } catch (error) {
      console.error('获取TTL配置失败:', error);
      res.status(500).json({
        success: false,
        message: `获取TTL配置失败: ${error.message}`
      });
    }
  });

  // TTL配置管理 - POST
  router.post('/api/redis/ttl-config', isAuthenticated, async (req, res) => {
    try {
      if (!redisClient.isEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'Redis未启用或连接失败'
        });
      }

      const { ttlConfig } = req.body;
      if (!ttlConfig || typeof ttlConfig !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'TTL配置格式不正确'
        });
      }

      const updated = await redisClient.updateTtlConfig(ttlConfig);
      if (updated) {
        res.json({
          success: true,
          message: 'TTL配置已更新',
          config: redisClient.getTtlConfig()
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'TTL配置更新失败,请检查配置格式'
        });
      }
    } catch (error) {
      console.error('更新TTL配置失败:', error);
      res.status(500).json({
        success: false,
        message: `更新TTL配置失败: ${error.message}`
      });
    }
  });

  // 获取缓存键信息
  router.get('/api/redis/cache-info', isAuthenticated, async (req, res) => {
    try {
      if (!redisClient.isEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'Redis未启用或连接失败'
        });
      }

      const cacheInfo = await redisClient.getCacheInfo();
      res.json({
        success: true,
        cacheInfo
      });
    } catch (error) {
      console.error('获取缓存信息失败:', error);
      res.status(500).json({
        success: false,
        message: `获取缓存信息失败: ${error.message}`
      });
    }
  });

  // 批量更新缓存TTL
  router.post('/api/redis/batch-ttl', isAuthenticated, async (req, res) => {
    try {
      if (!redisClient.isEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'Redis未启用或连接失败'
        });
      }

      const { keyTtlPairs } = req.body;
      if (!Array.isArray(keyTtlPairs)) {
        return res.status(400).json({
          success: false,
          message: 'keyTtlPairs必须是数组'
        });
      }

      const result = await redisClient.setTtlBatch(keyTtlPairs);
      if (result) {
        res.json({
          success: true,
          message: `已成功更新${keyTtlPairs.length}个缓存键的TTL`
        });
      } else {
        res.status(500).json({
          success: false,
          message: '批量更新TTL失败'
        });
      }
    } catch (error) {
      console.error('批量更新TTL失败:', error);
      res.status(500).json({
        success: false,
        message: `批量更新TTL失败: ${error.message}`
      });
    }
  });

  // 重置TTL配置（重新从环境变量加载）
  router.post('/api/redis/ttl-config/reset', isAuthenticated, async (req, res) => {
    try {
      if (!redisClient.isEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'Redis未启用或连接失败'
        });
      }

      // 清除缓存的TTL配置
      const configKey = redisClient.generateCacheKey('system', 'ttl-config');
      await redisClient.del(configKey);

      // 重新加载TTL配置
      await redisClient.loadTtlConfigFromCache();

      res.json({
        success: true,
        message: 'TTL配置已重置,重新从环境变量加载',
        config: redisClient.getTtlConfig()
      });
    } catch (error) {
      console.error('重置TTL配置失败:', error);
      res.status(500).json({
        success: false,
        message: `重置TTL配置失败: ${error.message}`
      });
    }
  });

  return router;
}

module.exports = createRedisRoutes;
