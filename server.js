/**
 * 图床系统 - 服务器入口文件
 * 现代化模块架构重构版本
 */

// 首先加载环境变量
require('dotenv').config();

// 导入核心模块
const ImageDatabase = require('./database');

// 导入配置和服务
const ConfigLoader = require('./src/config/config-loader');
const R2StorageService = require('./src/services/r2-storage');
const SessionStoreService = require('./src/services/session-store');
const DatabaseInitializer = require('./src/services/db-initializer');

// 导入Express应用创建器
const createApp = require('./src/app');

// ============= 初始化服务 =============

// 初始化PostgreSQL数据库
const imageDb = new ImageDatabase();

// 初始化配置加载器
const configLoader = new ConfigLoader();

// 初始化R2存储服务
const r2StorageService = new R2StorageService();

// 初始化Session存储服务
const sessionStoreService = new SessionStoreService();

// 初始化数据库初始化器
const dbInitializer = new DatabaseInitializer(imageDb);

// File system cache to avoid repeated scans
const fileSystemCache = {
  lastScan: 0,
  files: [],
  cacheTimeout: 60000 // 1 minute cache
};

// Performance counters
const performanceMetrics = {
  uploadCount: 0,
  processingTime: [],
  memoryUsage: [],
  lastCleanup: Date.now()
};

// ============= 异步初始化 =============

/**
 * 异步初始化所有服务
 */
async function initializeServices() {
  try {
    // 初始化数据库（导入JSON、恢复备份等）
    await dbInitializer.initialize().catch(err => {
      console.error('数据库初始化失败:', err.message);
      console.log('服务将继续运行，但数据库功能可能不可用');
    });

    // 启动自动备份（如果启用）
    if (process.env.AUTO_BACKUP_ENABLED === 'true') {
      const intervalHours = parseInt(process.env.AUTO_BACKUP_INTERVAL_HOURS) || 24;
      dbInitializer.startAutoBackup(intervalHours);
    }
  } catch (error) {
    console.error('服务初始化失败:', error);
  }
}

// 执行异步初始化（不阻塞服务器启动）
initializeServices();

// ============= 创建Express应用 =============

const app = createApp({
  configLoader,
  imageDb,
  r2StorageService,
  sessionStoreService,
  fileSystemCache,
  performanceMetrics
});

// ============= 启动服务器 =============

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`========================================`);
  console.log(`图床系统已启动`);
  console.log(`端口: ${port}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`数据库: ${imageDb.isConnected() ? '已连接' : '未连接'}`);
  console.log(`存储: ${process.env.STORAGE_TYPE || 'local'}`);
  if (r2StorageService.isAvailable()) {
    console.log(`R2存储: 已启用`);
  }
  console.log(`========================================`);
});

// ============= 优雅关闭 =============

// 处理进程退出信号
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，正在关闭服务器...');
  process.exit(0);
});

// 未捕获的异常处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  // 不要退出进程，继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  // 不要退出进程，继续运行
});

module.exports = app;
