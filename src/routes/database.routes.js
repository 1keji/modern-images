/**
 * Database and Migration Routes
 * Handles database status, backup, restore, migration, and import operations
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { getAllFiles } = require('../utils/file-utils');
const { getBaseUrl, getImageBaseUrl } = require('../utils/url-utils');

/**
 * Create database routes with dependency injection
 * @param {Function} isAuthenticated - Authentication middleware
 * @param {Object} imageDb - Database instance
 * @param {Object} r2StorageService - R2 storage service with uploadToR2/deleteFromR2 methods
 * @param {Object} multer - Multer middleware factory
 * @param {Object} configLoader - Configuration loader instance
 * @param {Object} redisClient - Redis client instance
 * @returns {express.Router} Express router with database routes
 */
function createDatabaseRoutes(isAuthenticated, imageDb, r2StorageService, multer, configLoader) {
  const router = express.Router();

  // Helper function to remove image record
  async function removeImageRecord(imagePath) {
    try {
      const result = await imageDb.removeImage(imagePath);
      return result;
    } catch (error) {
      console.error('从数据库删除图片记录失败:', error);
      throw error;
    }
  }

  // Helper function to clean empty directories
  function cleanEmptyDirs(dir) {
    if (fs.existsSync(dir)) {
      let entries = fs.readdirSync(dir);

      // First, recursively clean subdirectories
      entries.forEach(entry => {
        const fullPath = path.join(dir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          cleanEmptyDirs(fullPath);
        }
      });

      // Re-check current directory
      entries = fs.readdirSync(dir);
      if (entries.length === 0 && dir !== path.join(process.cwd(), 'uploads')) {
        // Don't delete uploads root directory, only its subdirectories
        fs.rmdirSync(dir);
        console.log(`已删除空文件夹: ${dir}`);
      }
    }
  }

  // Helper function to invalidate file system cache
  function invalidateFileSystemCache() {
    // This would typically interact with a cache object
    // For now, it's a no-op as the cache is managed in server.js
    // The caller should handle cache invalidation if needed
  }

  // ==================== Database Status & Health ====================

  /**
   * GET /api/database-status
   * Get detailed database status including connection state and storage stats
   */
  router.get('/api/database-status', isAuthenticated, async (req, res) => {
    try {
      const status = await imageDb.getStatusWithConfig();
      const stats = await imageDb.getStorageStats();

      // Enhanced status information
      const enhancedStatus = {
        ...status,
        reconnecting: imageDb.reconnectInterval !== null,
        reconnectAttempts: imageDb.reconnectAttempts || 0,
        lastConnectionError: status.connectionError || null,
        connectionMonitoring: imageDb.connectionMonitorInterval !== null,
        storageStats: stats
      };

      res.json({
        success: true,
        database: enhancedStatus
      });
    } catch (error) {
      console.error('获取数据库状态失败:', error);
      res.status(500).json({ success: false, message: `获取数据库状态失败: ${error.message}` });
    }
  });

  /**
   * GET /api/system-status
   * Get overall system status including database and filesystem counts
   */
  router.get('/api/system-status', isAuthenticated, async (req, res) => {
    try {
      const config = configLoader.getConfig();
      const baseUrl = getBaseUrl(req);

      // Count images in PostgreSQL database
      const dbStatus = await imageDb.getStatus();
      const dbImageCount = dbStatus.dbImageCount;

      // Count images in filesystem
      let fsImageCount = 0;
      const uploadsDir = path.join(process.cwd(), 'uploads');

      if (fs.existsSync(uploadsDir)) {
        const uploadedFiles = getAllFiles(uploadsDir);
        fsImageCount = uploadedFiles.length;
      }

      // Calculate images that need migration
      const images = await imageDb.getAllImages();
      const recordedPaths = new Set(images.map(img => img.path));
      let needMigrationCount = 0;

      if (fs.existsSync(uploadsDir)) {
        const uploadedFiles = getAllFiles(uploadsDir);
        uploadedFiles.forEach(filePath => {
          const relativePath = path.relative(uploadsDir, filePath);
          const normalizedPath = relativePath.replace(/\\/g, '/');

          if (!recordedPaths.has(normalizedPath)) {
            needMigrationCount++;
          }
        });
      }

      res.json({
        success: true,
        status: {
          dbImageCount: dbImageCount,
          fsImageCount: fsImageCount,
          needMigrationCount: needMigrationCount,
          dbPath: dbStatus.dbPath,
          dbConnected: dbStatus.isConnected,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('获取系统状态失败:', error);
      res.status(500).json({ success: false, message: `获取系统状态失败: ${error.message}` });
    }
  });

  /**
   * POST /api/force-reconnect
   * Force database reconnection attempt
   */
  router.post('/api/force-reconnect', isAuthenticated, async (req, res) => {
    try {
      console.log('收到强制数据库重连请求');

      // If database is connected and not currently reconnecting, no action needed
      const status = await imageDb.getStatus();

      if (status.isConnected && !imageDb.reconnectInterval) {
        return res.json({
          success: true,
          message: '数据库连接正常，无需重连',
          alreadyConnected: true
        });
      }

      // Stop existing reconnection attempts
      imageDb.stopReconnect();

      // Mark connection state as failed, start new reconnection attempt
      imageDb.connectionFailed = true;
      imageDb.startReconnect();

      res.json({
        success: true,
        message: '已启动数据库重连流程',
        reconnecting: true
      });
    } catch (error) {
      console.error('强制数据库重连失败:', error);
      res.status(500).json({
        success: false,
        message: `强制数据库重连失败: ${error.message}`
      });
    }
  });

  // ==================== Backup Operations ====================

  /**
   * POST /api/backup-database
   * Backup database to SQL or JSON format
   */
  router.post('/api/backup-database', isAuthenticated, async (req, res) => {
    try {
      const { format = 'sql' } = req.body;

      if (format === 'sql') {
        const result = await imageDb.exportToSql();
        res.json({
          success: true,
          message: `SQL数据库备份成功！共备份了 ${result.recordCount} 条记录。`,
          backupPath: path.basename(result.path),
          recordCount: result.recordCount,
          format: 'sql'
        });
      } else {
        // Backward compatibility: support JSON format backup
        const backupPath = path.join(process.cwd(), `images_backup_${Date.now()}.json`);
        const count = await imageDb.exportToJson(backupPath);
        res.json({
          success: true,
          message: `JSON数据库备份成功！共备份了 ${count} 条记录。`,
          backupPath: path.basename(backupPath),
          recordCount: count,
          format: 'json'
        });
      }
    } catch (error) {
      console.error('数据库备份失败:', error);
      res.status(500).json({ success: false, message: `数据库备份失败: ${error.message}` });
    }
  });

  /**
   * GET /api/backup-files
   * Get list of available backup files
   */
  router.get('/api/backup-files', isAuthenticated, async (req, res) => {
    try {
      const backupFiles = await imageDb.getBackupFiles();
      res.json({
        success: true,
        files: backupFiles
      });
    } catch (error) {
      console.error('获取备份文件列表失败:', error);
      res.status(500).json({ success: false, message: `获取备份文件列表失败: ${error.message}` });
    }
  });

  /**
   * POST /api/auto-backup-settings
   * Configure automatic backup settings
   */
  router.post('/api/auto-backup-settings', isAuthenticated, async (req, res) => {
    try {
      const { intervalHours } = req.body;

      if (intervalHours !== undefined) {
        if (intervalHours <= 0) {
          imageDb.stopAutoBackup();
          res.json({
            success: true,
            message: '自动备份已禁用'
          });
        } else {
          imageDb.setAutoBackup(intervalHours);
          res.json({
            success: true,
            message: `自动备份已设置，间隔: ${intervalHours} 小时`
          });
        }
      } else {
        res.status(400).json({ success: false, message: '请提供有效的备份间隔时间' });
      }
    } catch (error) {
      console.error('设置自动备份失败:', error);
      res.status(500).json({ success: false, message: `设置自动备份失败: ${error.message}` });
    }
  });

  // ==================== Restore Operations ====================

  /**
   * POST /api/restore-from-sql
   * Restore database from an existing SQL backup file
   */
  router.post('/api/restore-from-sql', isAuthenticated, async (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename) {
        return res.status(400).json({ success: false, message: '请指定要恢复的SQL文件' });
      }

      const backupDir = path.join(process.cwd(), 'backups');
      const sqlPath = path.join(backupDir, filename);

      if (!fs.existsSync(sqlPath)) {
        return res.status(404).json({ success: false, message: 'SQL文件不存在' });
      }

      const result = await imageDb.importFromSql(sqlPath);
      res.json({
        success: true,
        message: `SQL数据恢复完成！共恢复了 ${result.imported} 条记录。`,
        imported: result.imported
      });
    } catch (error) {
      console.error('SQL数据恢复失败:', error);
      res.status(500).json({ success: false, message: `SQL数据恢复失败: ${error.message}` });
    }
  });

  /**
   * POST /api/upload-sql-restore
   * Upload and restore database from a SQL file
   */
  router.post('/api/upload-sql-restore', isAuthenticated, multer({ dest: 'temp/' }).single('sqlFile'), async (req, res) => {
    let tempFilePath = null;

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: '未上传SQL文件' });
      }

      tempFilePath = req.file.path;
      const originalName = req.file.originalname;
      const fileExt = path.extname(originalName).toLowerCase();

      if (fileExt !== '.sql') {
        throw new Error('只支持.sql文件格式');
      }

      console.log(`接收到SQL恢复文件: ${originalName}, 临时路径: ${tempFilePath}`);

      const result = await imageDb.importFromSql(tempFilePath);
      res.json({
        success: true,
        message: `SQL文件恢复完成！共恢复了 ${result.imported} 条记录。`,
        imported: result.imported
      });

    } catch (error) {
      console.error('SQL文件上传恢复失败:', error);
      res.status(500).json({ success: false, message: `SQL文件上传恢复失败: ${error.message}` });
    } finally {
      // Clean up temporary file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`临时文件已删除: ${tempFilePath}`);
        } catch (error) {
          console.warn(`删除临时文件失败: ${tempFilePath}`, error);
        }
      }
    }
  });

  // ==================== Import Operations ====================

  /**
   * POST /api/import-json
   * Manually import JSON data to PostgreSQL
   */
  router.post('/api/import-json', isAuthenticated, async (req, res) => {
    try {
      const jsonPath = path.join(process.cwd(), 'images.json');

      if (!fs.existsSync(jsonPath)) {
        return res.status(400).json({ success: false, message: 'images.json文件不存在' });
      }

      const result = await imageDb.importFromJson(jsonPath);

      res.json({
        success: true,
        message: `JSON数据导入完成！导入${result.imported}条，跳过${result.skipped}条，错误${result.errors}条。`,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors
      });
    } catch (error) {
      console.error('JSON数据导入失败:', error);
      res.status(500).json({ success: false, message: `JSON数据导入失败: ${error.message}` });
    }
  });

  /**
   * POST /api/sqlite-auto-import
   * Auto-detect and import from SQLite database
   */
  router.post('/api/sqlite-auto-import', isAuthenticated, async (req, res) => {
    try {
      const result = await imageDb.autoImportSqlite();

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors,
          files: result.files
        });
      } else {
        res.json({
          success: false,
          warning: result.warning,
          message: result.message,
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors
        });
      }
    } catch (error) {
      console.error('SQLite 自动导入失败:', error);
      res.status(500).json({ success: false, message: `SQLite 自动导入失败: ${error.message}` });
    }
  });

  /**
   * POST /api/sqlite-upload-import
   * Upload and import from SQLite database or JSON file
   */
  router.post('/api/sqlite-upload-import', isAuthenticated, multer({ dest: 'temp/' }).single('sqliteFile'), async (req, res) => {
    let tempFilePath = null;

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: '未上传文件' });
      }

      tempFilePath = req.file.path;
      const originalName = req.file.originalname;
      const fileExt = path.extname(originalName).toLowerCase();

      console.log(`接收到上传文件: ${originalName}, 临时路径: ${tempFilePath}`);

      let result;

      if (fileExt === '.json') {
        // JSON file import
        try {
          result = await imageDb.importFromJson(tempFilePath);
          result.message = `JSON 文件导入完成！导入 ${result.imported} 条记录${result.skipped > 0 ? `，跳过 ${result.skipped} 条重复记录` : ''}${result.errors > 0 ? `，${result.errors} 条记录导入失败` : ''}。`;
        } catch (error) {
          throw new Error(`JSON 文件格式错误: ${error.message}`);
        }
      } else if (fileExt === '.db') {
        // SQLite database file import
        try {
          result = await imageDb.importFromSqlite(tempFilePath);
          result.message = `SQLite 数据库导入完成！导入 ${result.imported} 条记录${result.skipped > 0 ? `，跳过 ${result.skipped} 条重复记录` : ''}${result.errors > 0 ? `，${result.errors} 条记录导入失败` : ''}。`;
        } catch (error) {
          throw new Error(`SQLite 数据库导入失败: ${error.message}`);
        }
      } else {
        throw new Error('不支持的文件格式。请上传 .db 或 .json 文件。');
      }

      res.json({
        success: true,
        message: result.message,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors
      });

    } catch (error) {
      console.error('文件上传导入失败:', error);
      res.status(500).json({ success: false, message: `文件上传导入失败: ${error.message}` });
    } finally {
      // Clean up temporary file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`临时文件已删除: ${tempFilePath}`);
        } catch (error) {
          console.warn(`删除临时文件失败: ${tempFilePath}`, error);
        }
      }
    }
  });

  // ==================== Migration Operations ====================

  /**
   * POST /api/migrate-images
   * Migrate existing filesystem images to database records
   */
  router.post('/api/migrate-images', isAuthenticated, async (req, res) => {
    try {
      const config = configLoader.getConfig();
      const baseUrl = getBaseUrl(req);
      const imageBaseUrl = await getImageBaseUrl(req, config.imageDomain || {});

      // Create a path set to check which files are already in the database
      const images = await imageDb.getAllImages();
      const recordedPaths = new Set(images.map(img => img.path));

      let migratedCount = 0;
      let errorCount = 0;
      const uploadsDir = path.join(process.cwd(), 'uploads');

      if (fs.existsSync(uploadsDir)) {
        const uploadedFiles = getAllFiles(uploadsDir);

        // Prepare data for batch insertion
        const imagesToMigrate = [];

        uploadedFiles.forEach(filePath => {
          const stats = fs.statSync(filePath);
          const relativePath = path.relative(uploadsDir, filePath);
          const normalizedPath = relativePath.replace(/\\/g, '/');

          // Only add images not already recorded in database
          if (!recordedPaths.has(normalizedPath)) {
            const filename = path.basename(filePath);
            const imageUrl = `${imageBaseUrl}/i/${normalizedPath}`;

            const imageData = {
              filename: filename,
              path: normalizedPath,
              uploadTime: stats.mtime.toISOString(),
              fileSize: stats.size,
              storage: 'local',
              format: path.extname(filename).substring(1),
              url: imageUrl,
              htmlCode: `<img src="${imageUrl}" alt="${filename}" />`,
              markdownCode: `![${filename}](${imageUrl})`
            };

            imagesToMigrate.push(imageData);
          }
        });

        // Batch add to PostgreSQL database
        for (const imageData of imagesToMigrate) {
          try {
            await imageDb.addImage(imageData);
            migratedCount++;
          } catch (error) {
            console.error('迁移图片失败:', imageData.path, error.message);
            errorCount++;
          }
        }
      }

      let message = `迁移完成！共添加了 ${migratedCount} 张图片到数据库记录中。`;
      if (errorCount > 0) {
        message += ` ${errorCount} 张图片迁移失败。`;
      }

      // Clear filesystem cache as migration operation may affect filesystem state
      invalidateFileSystemCache();

      res.json({
        success: true,
        message: message,
        migratedCount: migratedCount,
        errorCount: errorCount
      });
    } catch (error) {
      console.error('图片迁移失败:', error);
      res.status(500).json({ success: false, message: `图片迁移失败: ${error.message}` });
    }
  });

  return router;
}

module.exports = createDatabaseRoutes;
