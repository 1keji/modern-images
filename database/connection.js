/**
 * 数据库连接管理模块
 * 处理连接池创建、重连机制、连接监控
 */

const { Pool } = require('pg');
const { spawn } = require('child_process');

const ConnectionMixin = {
  getDefaultConfig() {
    const envConfig = this.getDefaultPostgreSQLConfig();

    console.log('环境变量检查:', {
      DB_HOST: process.env.DB_HOST ? '✓' : '✗ (使用默认值)',
      DB_PORT: process.env.DB_PORT ? '✓' : '✗ (使用默认值)',
      DB_NAME: process.env.DB_NAME ? '✓' : '✗ (使用默认值)',
      DB_USER: process.env.DB_USER ? '✓' : '✗ (使用默认值)',
      DB_PASSWORD: process.env.DB_PASSWORD ? '✓' : '✗ (使用默认值)'
    });

    console.log('使用环境变量数据库配置');
    console.log('数据库配置:', {
      host: envConfig.host,
      port: envConfig.port,
      database: envConfig.database,
      user: envConfig.user,
      ssl: envConfig.ssl,
      passwordSet: envConfig.password !== 'your_password_here'
    });

    return envConfig;
  },

  getDefaultPostgreSQLConfig() {
    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'imagehosting',
      user: process.env.DB_USER || 'imagehosting_user',
      password: process.env.DB_PASSWORD || 'your_password_here',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      min: 2,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      acquireTimeoutMillis: 20000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
      statement_timeout: 300000,
      query_timeout: 300000,
      application_name: 'modern-image-hosting'
    };
  },

  async createConnectionPool() {
    if (this.pool) {
      try {
        await this.pool.end();
        console.log('关闭旧的数据库连接池');
      } catch (error) {
        console.error('关闭旧连接池失败:', error);
      }
    }

    this.pool = new Pool(this.config);

    this.pool.on('error', (err) => {
      console.error('数据库池连接错误:', err.message);
      if (!this.connectionFailed) {
        this.connectionFailed = true;
        this.startReconnect();
      }
    });
  },

  startReconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }

    this.reconnectAttempts = 0;
    console.log('启动数据库自动重连机制');

    this.reconnectInterval = setInterval(async () => {
      if (!this.connectionFailed) {
        this.stopReconnect();
        return;
      }

      this.reconnectAttempts++;
      console.log(`尝试重新连接数据库 (第 ${this.reconnectAttempts} 次)`);

      try {
        await this.createConnectionPool();

        const client = await this.pool.connect();
        console.log('数据库重连成功!');
        client.release();

        this.connectionFailed = false;
        this.isInitialized = true;
        this.reconnectAttempts = 0;

        await this.startDataIntegrityCheck();

        this.stopReconnect();
      } catch (error) {
        console.error(`数据库重连失败 (第 ${this.reconnectAttempts} 次):`, error.message);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          clearInterval(this.reconnectInterval);
          const longerDelay = this.reconnectDelay * 3;
          console.log(`达到最大重试次数 (${this.maxReconnectAttempts})，增加重连间隔至 ${longerDelay/1000} 秒`);

          this.reconnectInterval = setInterval(this.startReconnect.bind(this), longerDelay);
          this.reconnectAttempts = 0;
        }
      }
    }, this.reconnectDelay);
  },

  stopReconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
      console.log('数据库重连机制已停止');
    }
  },

  startConnectionMonitoring() {
    const monitorInterval = 30 * 1000;

    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
    }

    this.connectionMonitorInterval = setInterval(async () => {
      try {
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();

        if (this.connectionFailed) {
          console.log('检测到数据库连接已恢复');
          this.connectionFailed = false;

          await this.startDataIntegrityCheck();
        }
      } catch (error) {
        if (!this.connectionFailed) {
          console.error('检测到数据库连接已断开:', error.message);
          this.connectionFailed = true;
          this.startReconnect();
        }
      }
    }, monitorInterval);

    console.log(`数据库连接监控已启动，间隔: ${monitorInterval/1000} 秒`);
  },

  stopConnectionMonitoring() {
    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
      this.connectionMonitorInterval = null;
      console.log('数据库连接监控已停止');
    }
  },

  async detectPgTools() {
    if (this.pgToolsAvailable !== null) {
      return this.pgToolsAvailable;
    }

    try {
      const pgdumpPath = process.env.PGDUMP_PATH || 'pg_dump';
      const psqlPath = process.env.PSQL_PATH || 'psql';

      const pgdumpAvailable = await this.checkCommand(pgdumpPath, ['--version']);
      const psqlAvailable = await this.checkCommand(psqlPath, ['--version']);

      this.pgToolsAvailable = pgdumpAvailable && psqlAvailable;

      if (this.pgToolsAvailable) {
        console.log('✅ PostgreSQL 客户端工具已检测到');
      } else {
        console.log('⚠️  PostgreSQL 客户端工具未找到，将使用 JavaScript 回退方案');
        console.log('提示: 若要使用原生 pg_dump/psql，请安装 postgresql-client 包');
      }

      return this.pgToolsAvailable;
    } catch (error) {
      console.log('⚠️  PostgreSQL 工具检测失败，使用 JavaScript 回退方案');
      this.pgToolsAvailable = false;
      return false;
    }
  },

  checkCommand(command, args = []) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'ignore' });

      const timeout = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 5000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code !== null);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  },

  async close() {
    this.stopAutoBackup();
    this.stopDataIntegrityCheck();
    this.stopReconnect();
    this.stopConnectionMonitoring();

    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
};

module.exports = ConnectionMixin;
