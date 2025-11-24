const fs = require('fs');
const path = require('path');

/**
 * 数据库初始化服务
 * 负责数据库初始化、JSON导入、备份恢复等
 */
class DatabaseInitializer {
  constructor(imageDb) {
    this.imageDb = imageDb;
    this.imagesDbPath = path.join(process.cwd(), 'images.json');
  }

  /**
   * 初始化数据库
   * 自动导入JSON数据或从备份恢复
   */
  async initialize() {
    try {
      // 获取数据库状态
      const dbStatus = await this.imageDb.getStatus();
      console.log(`数据库状态检查: ${dbStatus.isConnected ? '已连接' : '未连接'}, 记录数: ${dbStatus.dbImageCount}`);

      // 如果数据库未连接，停止后续操作
      if (!dbStatus.isConnected) {
        console.error('数据库未连接，无法进行数据初始化和恢复操作');
        return;
      }

      // 检查是否有JSON数据需要导入
      if (fs.existsSync(this.imagesDbPath)) {
        console.log('检测到JSON数据文件存在');

        // 安全检查：只有在数据库为空时才导入数据
        if (dbStatus.dbImageCount === 0) {
          console.log('数据库为空，准备导入JSON数据...');
          await this.importFromJson();
        } else {
          console.log(`数据库已包含 ${dbStatus.dbImageCount} 条记录，跳过JSON导入`);
        }
      } else {
        console.log('未检测到JSON数据文件');
      }

      // 如果没有数据，尝试从备份恢复
      if (dbStatus.dbImageCount === 0) {
        await this.restoreFromBackup();
      }
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
  }

  /**
   * 从JSON文件导入数据
   */
  async importFromJson() {
    try {
      // 读取JSON文件内容进行验证
      const jsonContent = fs.readFileSync(this.imagesDbPath, 'utf8');
      let jsonData;
      try {
        jsonData = JSON.parse(jsonContent);
        if (!Array.isArray(jsonData) || jsonData.length === 0) {
          console.log('JSON文件格式无效或为空，跳过导入');
          return;
        }
        console.log(`JSON文件包含 ${jsonData.length} 条记录`);
      } catch (parseError) {
        console.error('JSON解析失败:', parseError);
        console.log('JSON文件格式无效，跳过导入');
        return;
      }

      // 导入数据
      const result = await this.imageDb.importFromJson(this.imagesDbPath);
      console.log(`JSON数据导入完成: 导入${result.imported}条记录`);

      // 导入后检查数据库状态
      const afterStatus = await this.imageDb.getStatus();
      if (afterStatus.dbImageCount !== result.imported) {
        console.warn(`⚠️ 警告: 导入后记录数 (${afterStatus.dbImageCount}) 与导入记录数 (${result.imported}) 不匹配`);
      } else {
        console.log(`✅ 导入后数据库记录数量校验通过: ${afterStatus.dbImageCount}`);
      }

      // 备份原JSON文件
      const backupPath = this.imagesDbPath + '.backup.' + Date.now();
      fs.copyFileSync(this.imagesDbPath, backupPath);
      console.log(`原JSON文件已备份到: ${backupPath}`);
    } catch (error) {
      console.error('JSON数据导入失败:', error);
    }
  }

  /**
   * 从备份文件恢复数据
   */
  async restoreFromBackup() {
    try {
      // 获取最新的备份文件
      const backupFiles = await this.imageDb.getBackupFiles();
      if (backupFiles.length > 0) {
        console.log(`检测到 ${backupFiles.length} 个备份文件，尝试从最新备份恢复`);
        const latestBackup = backupFiles[0];

        // 检查备份文件大小，确保不是空文件
        if (latestBackup.size > 100) {
          console.log(`从备份文件恢复: ${latestBackup.name}`);
          const result = await this.imageDb.importFromSql(latestBackup.path);
          console.log(`备份恢复完成: 导入${result.imported}条记录`);

          // 恢复后检查数据库状态
          const afterRestoreStatus = await this.imageDb.getStatus();
          console.log(`✅ 恢复后数据库记录数量: ${afterRestoreStatus.dbImageCount}`);
        } else {
          console.log(`备份文件 ${latestBackup.name} 大小异常 (${latestBackup.size} 字节)，跳过恢复`);
        }
      } else {
        console.log('未找到备份文件');
      }
    } catch (backupError) {
      console.error('从备份恢复失败:', backupError);
    }
  }

  /**
   * 启动自动备份
   * @param {number} intervalHours - 备份间隔（小时）
   */
  startAutoBackup(intervalHours = 24) {
    console.log(`启动自动备份，间隔: ${intervalHours} 小时`);
    this.imageDb.setAutoBackup(intervalHours);
  }
}

module.exports = DatabaseInitializer;
