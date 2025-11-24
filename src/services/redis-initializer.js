/**
 * Redis初始化服务
 * 负责Redis连接等待和配置缓存
 */
class RedisInitializer {
  constructor(redisClient) {
    this.redisClient = redisClient;
  }

  /**
   * 异步初始化Redis，等待连接并缓存配置
   * @param {Object} config - 配置对象
   */
  async initialize(config) {
    // 等待Redis连接（最多等待5秒）
    await new Promise(resolve => {
      if (this.redisClient.isEnabled()) {
        let attempts = 0;
        const maxAttempts = 50; // 5秒（50 × 100ms）

        const checkConnection = () => {
          attempts++;
          if (this.redisClient.isConnected) {
            console.log('Redis连接已建立');
            resolve();
          } else if (attempts >= maxAttempts) {
            console.warn('Redis连接等待超时，继续启动服务器');
            resolve();
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      } else {
        resolve();
      }
    });

    // 初始化时将配置缓存到Redis
    if (this.redisClient.isEnabled() && this.redisClient.isConnected) {
      try {
        await this.redisClient.cacheConfig(config);
        console.log('初始配置已缓存到Redis');
      } catch (error) {
        console.error('初始化Redis配置缓存失败:', error);
      }
    }
  }
}

module.exports = RedisInitializer;
