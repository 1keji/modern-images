/**
 * 数据完整性检查模块
 * 处理数据完整性监控和状态获取
 */

const fs = require('fs');
const path = require('path');

const IntegrityMixin = {
  // 获取数据库状态
  async getStatus() {
    if (this.connectionFailed) {
      let errorMsg = '数据库连接失败';
      if (this.reconnectAttempts > 0) {
        errorMsg += `，正在尝试重连 (第 ${this.reconnectAttempts} 次)`;
      }

      return {
        dbImageCount: 0,
        dbType: 'PostgreSQL',
        isConnected: false,
        connectionError: errorMsg,
        reconnecting: this.reconnectAttempts > 0
      };
    }

    try {
      const client = await Promise.race([
        this.pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('数据库连接超时')), 3000))
      ]);

      try {
        const query = 'SELECT COUNT(*) as count FROM images';
        const result = await client.query(query);
        return {
          dbImageCount: parseInt(result.rows[0].count),
          dbType: 'PostgreSQL',
          isConnected: true
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取数据库状态失败:', error);

      if (!this.connectionFailed) {
        this.connectionFailed = true;
        this.startReconnect();
      }

      return {
        dbImageCount: 0,
        dbType: 'PostgreSQL',
        isConnected: false,
        connectionError: error.message,
        reconnecting: this.reconnectAttempts > 0
      };
    }
  },

  // 获取包含配置信息的详细状态
  async getStatusWithConfig() {
    try {
      const client = await this.pool.connect();
      try {
        const query = 'SELECT COUNT(*) as count FROM images';
        const result = await client.query(query);
        return {
          dbImageCount: parseInt(result.rows[0].count),
          dbType: 'PostgreSQL',
          isConnected: true,
          config: {
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            user: this.config.user
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取数据库状态失败:', error);
      return {
        dbImageCount: 0,
        dbType: 'PostgreSQL',
        isConnected: false,
        config: null
      };
    }
  },

  // 启动数据完整性定期检查
  async startDataIntegrityCheck(intervalMinutes = 30) {
    if (this.connectionFailed) {
      console.warn('数据库连接失败，不启动数据完整性检查');
      return;
    }

    try {
      const status = await this.getStatus();
      if (!status.isConnected) {
        console.warn('数据库未连接，不启动数据完整性检查');
        this.connectionFailed = true;
        return;
      }
      this.lastKnownRecordCount = status.dbImageCount;
      console.log(`初始数据库记录数: ${this.lastKnownRecordCount}`);
    } catch (error) {
      console.error('获取初始记录数失败:', error);
      this.connectionFailed = true;
      return;
    }

    if (this.dataCheckInterval) {
      clearInterval(this.dataCheckInterval);
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    this.dataCheckInterval = setInterval(async () => {
      try {
        if (this.connectionFailed) {
          console.warn('数据库连接已失败，跳过数据完整性检查');
          return;
        }

        const status = await this.getStatus();

        if (!status.isConnected) {
          console.warn('数据库未连接，跳过数据完整性检查');
          this.connectionFailed = true;
          return;
        }

        const currentCount = status.dbImageCount;

        if (this.lastKnownRecordCount > 0 && currentCount === 0) {
          console.error(`❌ 严重警告: 数据库记录数从 ${this.lastKnownRecordCount} 减少到 0，可能存在数据丢失!`);

          const connStatus = await this.getStatus();
          if (!connStatus.isConnected) {
            console.error('数据库未连接，无法执行自动恢复');
            return;
          }

          const backupFiles = await this.getBackupFiles();
          if (backupFiles.length > 0) {
            const latestBackup = backupFiles[0];
            console.log(`尝试从最新备份自动恢复: ${latestBackup.name}`);

            try {
              const backupDir = path.join(__dirname, '..', 'backups');
              const recoveryLogPath = path.join(backupDir, `recovery_log_${Date.now()}.txt`);
              fs.writeFileSync(recoveryLogPath, `自动恢复日志\n时间: ${new Date().toISOString()}\n原记录数: ${this.lastKnownRecordCount}\n当前记录数: ${currentCount}\n使用备份: ${latestBackup.name}\n`);

              const result = await this.importFromSql(latestBackup.path);

              fs.appendFileSync(recoveryLogPath, `恢复结果: 导入 ${result.imported} 条记录\n`);

              console.log(`自动恢复完成，导入了 ${result.imported} 条记录`);

              const newStatus = await this.getStatus();
              this.lastKnownRecordCount = newStatus.dbImageCount;
              fs.appendFileSync(recoveryLogPath, `恢复后记录数: ${this.lastKnownRecordCount}\n`);
            } catch (error) {
              console.error('自动恢复失败:', error);
            }
          } else {
            console.error('没有可用的备份文件进行恢复');
          }
        }
        else if (this.lastKnownRecordCount > 10 && currentCount < this.lastKnownRecordCount / 2) {
          console.warn(`⚠️ 警告: 数据库记录数从 ${this.lastKnownRecordCount} 减少到 ${currentCount}，减少超过一半`);

          const backupDir = path.join(__dirname, '..', 'backups');
          const warningLogPath = path.join(backupDir, `data_reduction_warning_${Date.now()}.txt`);
          fs.writeFileSync(warningLogPath, `数据减少警告\n时间: ${new Date().toISOString()}\n原记录数: ${this.lastKnownRecordCount}\n当前记录数: ${currentCount}\n`);
        }
        else {
          this.lastKnownRecordCount = currentCount;
        }
      } catch (error) {
        console.error('数据完整性检查失败:', error);
      }
    }, intervalMs);

    console.log(`数据完整性检查已启动，间隔: ${intervalMinutes} 分钟`);
  },

  // 停止数据完整性检查
  stopDataIntegrityCheck() {
    if (this.dataCheckInterval) {
      clearInterval(this.dataCheckInterval);
      this.dataCheckInterval = null;
      console.log('数据完整性检查已停止');
    }
  }
};

module.exports = IntegrityMixin;
