/**
 * 数据库模块主入口
 * 组合所有子模块并导出 ImageDatabase 类
 */

// 确保加载环境变量
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

// 导入所有子模块
const ConnectionMixin = require('./connection');
const SchemaMixin = require('./schema');
const ImagesMixin = require('./images');
const CategoriesMixin = require('./categories');
const BackupMixin = require('./backup');
const SettingsMixin = require('./settings');
const IntegrityMixin = require('./integrity');
const UtilsMixin = require('./utils');

class ImageDatabase {
  constructor(config = null) {
    this.config = config || this.getDefaultConfig();
    this.pool = null;
    this.autoBackupInterval = null;
    this.dataCheckInterval = null;
    this.reconnectInterval = null;
    this.lastKnownRecordCount = 0;
    this.pgToolsAvailable = null;
    this.connectionFailed = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 10000;
    this.init();
  }

  async init() {
    this.isInitialized = false;
    this.connectionFailed = false;

    try {
      await this.createConnectionPool();

      const client = await this.pool.connect();
      console.log('PostgreSQL数据库连接成功');
      client.release();

      await this.createTables();

      await this.detectPgTools();

      await this.ensureApiUploadCategory();

      await this.startDataIntegrityCheck();

      this.startConnectionMonitoring();

      this.isInitialized = true;
      console.log('PostgreSQL数据库初始化成功');
    } catch (error) {
      this.connectionFailed = true;
      console.error('PostgreSQL数据库初始化失败:', error);

      this.startReconnect();

      throw error;
    }
  }
}

// 混入所有模块方法
Object.assign(
  ImageDatabase.prototype,
  ConnectionMixin,
  SchemaMixin,
  ImagesMixin,
  CategoriesMixin,
  BackupMixin,
  SettingsMixin,
  IntegrityMixin,
  UtilsMixin
);

module.exports = ImageDatabase;
