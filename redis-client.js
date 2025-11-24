// 确保加载环境变量
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const { createClient } = require('redis');

class RedisClient {
  constructor(config = null) {
    this.config = config || this.getDefaultConfig();
    this.client = null;
    this.isConnected = false;
    this.init();
  }

  getDefaultConfig() {
    return {
      enabled: process.env.REDIS_ENABLED === 'true',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || null,
      db: parseInt(process.env.REDIS_DB) || 0,
      connectionTimeout: parseInt(process.env.REDIS_CONNECTION_TIMEOUT) || 5000,
      maxMemory: process.env.REDIS_MAX_MEMORY || '256mb',
      maxMemoryPolicy: process.env.REDIS_MAX_MEMORY_POLICY || 'allkeys-lru',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      // TTL配置 (优化后的缓存策略)
      defaultTtl: {
        imageList: parseInt(process.env.REDIS_IMAGE_LIST_TTL) || 21600, // 图片列表缓存6小时 (原1小时，提升缓存命中率)
        imageInfo: parseInt(process.env.REDIS_IMAGE_INFO_TTL) || 43200, // 图片信息缓存12小时 (原2小时，图片元数据很少变化)
        config: parseInt(process.env.REDIS_CONFIG_TTL) || 3600, // 系统配置缓存1小时 (原30分钟，配置变更不频繁)
        userSession: parseInt(process.env.REDIS_USER_SESSION_TTL) || 604800, // 用户会话7天 (原1天，提升用户体验)
        apiCache: parseInt(process.env.REDIS_API_CACHE_TTL) || 1800, // API缓存30分钟 (原10分钟，API响应相对稳定)
        statistics: parseInt(process.env.REDIS_STATISTICS_TTL) || 600 // 统计数据10分钟 (原5分钟，统计不需要实时)
      }
    };
  }

  async init() {
    if (!this.config.enabled) {
      console.log('Redis已禁用，跳过初始化');
      return;
    }

    try {
      // 构建Redis连接配置
      const redisConfig = {
        socket: {
          host: this.config.host,
          port: this.config.port,
          connectTimeout: this.config.connectionTimeout,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('Redis重连失败次数过多，停止重连');
              return false;
            }
            return Math.min(retries * 50, 500);
          }
        },
        database: this.config.db
      };

      // 如果设置了密码，添加认证配置
      if (this.config.password) {
        redisConfig.password = this.config.password;
      }

      // 创建Redis客户端
      this.client = createClient(redisConfig);

      // 设置错误处理
      this.client.on('error', (err) => {
        console.error('Redis客户端错误:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis客户端连接成功');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('Redis客户端连接断开');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        console.log('Redis客户端正在重连...');
      });

      // 连接到Redis服务器
      await this.client.connect();
      console.log('Redis初始化成功');
      
      // 设置内存限制和策略
      await this.configureMemorySettings();
      
      // 加载TTL配置
      await this.loadTtlConfigFromCache();
    } catch (error) {
      console.error('Redis初始化失败:', error);
      this.client = null;
      this.isConnected = false;
    }
  }

  async configureMemorySettings() {
    if (!this.isEnabled()) return;
    
    try {
      // 设置最大内存
      if (this.config.maxMemory) {
        await this.client.configSet('maxmemory', this.config.maxMemory);
        console.log(`Redis最大内存设置为: ${this.config.maxMemory}`);
      }
      
      // 设置内存淘汰策略
      if (this.config.maxMemoryPolicy) {
        await this.client.configSet('maxmemory-policy', this.config.maxMemoryPolicy);
        console.log(`Redis内存淘汰策略设置为: ${this.config.maxMemoryPolicy}`);
      }
    } catch (error) {
      console.warn('Redis内存配置设置失败:', error);
    }
  }

  isEnabled() {
    return this.config.enabled && this.client && this.isConnected;
  }

  async get(key) {
    if (!this.isEnabled()) return null;
    
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Redis GET 操作失败:', key, error);
      return null;
    }
  }

  async set(key, value, ttl = null) {
    if (!this.isEnabled()) return false;
    
    try {
      const serializedValue = JSON.stringify(value);
      if (ttl) {
        await this.client.setEx(key, ttl, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }
      return true;
    } catch (error) {
      console.error('Redis SET 操作失败:', key, error);
      return false;
    }
  }

  async del(key) {
    if (!this.isEnabled()) return false;
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Redis DEL 操作失败:', key, error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isEnabled()) return false;
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis EXISTS 操作失败:', key, error);
      return false;
    }
  }

  async expire(key, ttl) {
    if (!this.isEnabled()) return false;
    
    try {
      await this.client.expire(key, ttl);
      return true;
    } catch (error) {
      console.error('Redis EXPIRE 操作失败:', key, error);
      return false;
    }
  }

  async flushCache() {
    if (!this.isEnabled()) return false;
    
    try {
      await this.client.flushDb();
      console.log('Redis缓存已清空');
      return true;
    } catch (error) {
      console.error('Redis缓存清空失败:', error);
      return false;
    }
  }

  async getStats() {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        connected: false,
        error: 'Redis未启用或连接失败'
      };
    }

    try {
      const [info, keyspace, stats, replication] = await Promise.all([
        this.client.info('memory'),
        this.client.info('keyspace'),
        this.client.info('stats'),
        this.client.info('replication')
      ]);
      
      // 获取当前配置信息
      let currentMaxMemory = '0';
      let currentMaxMemoryPolicy = 'noeviction';
      
      try {
        const [maxMemoryResult, policyResult] = await Promise.all([
          this.client.configGet('maxmemory'),
          this.client.configGet('maxmemory-policy')
        ]);
        
        if (maxMemoryResult && maxMemoryResult.maxmemory) {
          currentMaxMemory = maxMemoryResult.maxmemory;
        }
        if (policyResult && policyResult['maxmemory-policy']) {
          currentMaxMemoryPolicy = policyResult['maxmemory-policy'];
        }
      } catch (configError) {
        console.warn('获取Redis配置失败:', configError);
      }
      
      return {
        enabled: true,
        connected: this.isConnected,
        memoryInfo: {
          ...this.parseRedisInfo(info),
          maxmemory: currentMaxMemory,
          'maxmemory-policy': currentMaxMemoryPolicy
        },
        keyspaceInfo: this.parseRedisInfo(keyspace),
        statsInfo: this.parseRedisInfo(stats),
        replicationInfo: this.parseRedisInfo(replication),
        config: {
          host: this.config.host,
          port: this.config.port,
          db: this.config.db,
          configuredMaxMemory: this.config.maxMemory,
          configuredMaxMemoryPolicy: this.config.maxMemoryPolicy
        }
      };
    } catch (error) {
      console.error('获取Redis状态失败:', error);
      return {
        enabled: true,
        connected: false,
        error: error.message
      };
    }
  }

  parseRedisInfo(infoString) {
    const info = {};
    const lines = infoString.split('\r\n');
    
    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          info[key] = value;
        }
      }
    }
    
    return info;
  }

  async close() {
    if (this.client) {
      try {
        await this.client.quit();
        console.log('Redis客户端连接已关闭');
      } catch (error) {
        console.error('关闭Redis客户端时发生错误:', error);
      }
    }
  }

  // 缓存相关的辅助方法
  generateCacheKey(prefix, ...parts) {
    return `${prefix}:${parts.join(':')}`;
  }

  // 图片列表缓存
  async cacheImageList(storageType, images, ttl = null) {
    const key = this.generateCacheKey('images', storageType || 'all');
    const cacheTtl = ttl || this.config.defaultTtl.imageList;
    return await this.set(key, images, cacheTtl);
  }

  async getCachedImageList(storageType) {
    const key = this.generateCacheKey('images', storageType || 'all');
    return await this.get(key);
  }

  async invalidateImageListCache() {
    const patterns = ['images:*', 'images-paged:*'];
    for (const pattern of patterns) {
      try {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(keys);
        }
      } catch (error) {
        console.error('清除图片列表缓存失败:', error);
      }
    }
  }

  // 分页图片列表缓存
  async cachePagedImageList(page, limit, storageType, data, ttl = null) {
    const key = this.generateCacheKey('images-paged', `${storageType || 'all'}-p${page}-l${limit}`);
    const cacheTtl = ttl || this.config.defaultTtl.imageList;
    return await this.set(key, data, cacheTtl);
  }

  async getCachedPagedImageList(page, limit, storageType) {
    const key = this.generateCacheKey('images-paged', `${storageType || 'all'}-p${page}-l${limit}`);
    return await this.get(key);
  }

  // 图片信息缓存
  async cacheImageInfo(imageId, imageInfo, ttl = null) {
    const key = this.generateCacheKey('image-info', imageId);
    const cacheTtl = ttl || this.config.defaultTtl.imageInfo;
    return await this.set(key, imageInfo, cacheTtl);
  }

  async getCachedImageInfo(imageId) {
    const key = this.generateCacheKey('image-info', imageId);
    return await this.get(key);
  }

  async invalidateImageInfo(imageId) {
    const key = this.generateCacheKey('image-info', imageId);
    return await this.del(key);
  }

  // 系统配置缓存
  async cacheConfig(config, ttl = null) {
    const key = this.generateCacheKey('config', 'system');
    const cacheTtl = ttl || this.config.defaultTtl.config;
    return await this.set(key, config, cacheTtl);
  }

  async getCachedConfig() {
    const key = this.generateCacheKey('config', 'system');
    return await this.get(key);
  }

  async invalidateConfigCache() {
    const key = this.generateCacheKey('config', 'system');
    return await this.del(key);
  }

  // TTL配置管理
  getTtlConfig() {
    return this.config.defaultTtl;
  }

  async updateTtlConfig(ttlConfig) {
    // 验证TTL配置
    const validKeys = ['imageList', 'imageInfo', 'config', 'userSession', 'apiCache', 'statistics'];
    const updates = {};
    
    for (const [key, value] of Object.entries(ttlConfig)) {
      if (validKeys.includes(key) && typeof value === 'number' && value > 0) {
        updates[key] = Math.floor(value);
      }
    }
    
    if (Object.keys(updates).length > 0) {
      // 更新配置
      Object.assign(this.config.defaultTtl, updates);
      
      // 缓存配置到Redis
      const configKey = this.generateCacheKey('system', 'ttl-config');
      await this.set(configKey, this.config.defaultTtl, 86400); // 缓存1天
      
      return true;
    }
    
    return false;
  }

  async loadTtlConfigFromCache() {
    // 总是优先使用环境变量的配置
    const envConfig = {
      imageList: parseInt(process.env.REDIS_IMAGE_LIST_TTL) || null,
      imageInfo: parseInt(process.env.REDIS_IMAGE_INFO_TTL) || null,
      config: parseInt(process.env.REDIS_CONFIG_TTL) || null,
      userSession: parseInt(process.env.REDIS_USER_SESSION_TTL) || null,
      apiCache: parseInt(process.env.REDIS_API_CACHE_TTL) || null,
      statistics: parseInt(process.env.REDIS_STATISTICS_TTL) || null
    };
    
    // 更新环境变量中设置的值
    for (const [key, value] of Object.entries(envConfig)) {
      if (value !== null && value > 0) {
        this.config.defaultTtl[key] = value;
        console.log(`从环境变量更新TTL配置 ${key}: ${value}秒`);
      }
    }
    
    // 然后尝试从缓存加载用户手动设置的配置（不覆盖环境变量）
    const configKey = this.generateCacheKey('system', 'ttl-config');
    const cachedConfig = await this.get(configKey);
    
    if (cachedConfig) {
      console.log('从Redis缓存加载TTL配置:', cachedConfig);
      // 只更新那些环境变量中没有设置的值
      for (const [key, value] of Object.entries(cachedConfig)) {
        if (envConfig[key] === null && value > 0) {
          this.config.defaultTtl[key] = value;
          console.log(`从缓存更新TTL配置 ${key}: ${value}秒`);
        }
      }
    }
    
    console.log('最终TTL配置:', this.config.defaultTtl);
  }

  // 获取指定键的剩余TTL
  async getTtl(key) {
    if (!this.isEnabled()) return -1;
    
    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error('Redis TTL 操作失败:', key, error);
      return -1;
    }
  }

  // 批量设置TTL
  async setTtlBatch(keyTtlPairs) {
    if (!this.isEnabled()) return false;
    
    try {
      const pipeline = this.client.multi();
      
      for (const { key, ttl } of keyTtlPairs) {
        if (ttl > 0) {
          pipeline.expire(key, ttl);
        }
      }
      
      await pipeline.exec();
      return true;
    } catch (error) {
      console.error('Redis 批量设置TTL失败:', error);
      return false;
    }
  }

  // 获取所有缓存键及其TTL信息
  async getCacheInfo() {
    if (!this.isEnabled()) return [];
    
    try {
      const keys = await this.client.keys('*');
      const cacheInfo = [];
      
      for (const key of keys) {
        const [ttl, type] = await Promise.all([
          this.client.ttl(key),
          this.client.type(key)
        ]);
        
        cacheInfo.push({
          key,
          ttl,
          type,
          expired: ttl === -1 ? false : ttl <= 0
        });
      }
      
      return cacheInfo;
    } catch (error) {
      console.error('获取缓存信息失败:', error);
      return [];
    }
  }
}

module.exports = RedisClient; 