const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

/**
 * Session存储配置服务
 */
class SessionStoreService {
  constructor() {
  }

  /**
   * 获取session配置
   */
  getSessionConfig() {
    const sessionConfig = {
      secret: process.env.SESSION_SECRET || 'somesecret_please_change_in_production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false, // 生产环境中如果使用 HTTPS 请设置为 true
        httpOnly: true,
        maxAge: null // 默认为会话 cookie，具体过期时间在登录时设置
      }
    };

    console.log('使用文件作为Session存储');
    sessionConfig.store = new FileStore({
      path: path.join(process.cwd(), 'sessions'), // session 文件存储路径
      retries: 0, // 重试次数
      ttl: 30 * 24 * 60 * 60, // session 文件默认 TTL（秒），30天
      logFn: function() {} // 禁用日志输出
    });

    return sessionConfig;
  }
}

module.exports = SessionStoreService;
