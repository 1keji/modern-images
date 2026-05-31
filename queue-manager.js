/**
 * 任务队列管理器
 * 使用 Bull (基于 Redis) 实现异步任务处理
 *
 * 功能：
 * - 图片上传处理队列
 * - 数据库备份/恢复队列
 * - 存储迁移队列
 * - 任务进度追踪
 */

const Queue = require('bull');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

class QueueManager {
  constructor(redisClient, imageDb, config) {
    this.redisClient = redisClient;
    this.imageDb = imageDb;
    this.config = config;
    this.queues = {};
    this.initialized = false;
  }

  /**
   * 初始化所有队列
   */
  async initialize() {
    if (this.initialized) {
      console.log('⚠️  队列管理器已初始化');
      return;
    }

    try {
      // 获取 Redis 配置
      const redisConfig = {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0'),
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      };

      // 创建图片处理队列
      this.queues.imageProcessing = new Queue('image-processing', {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 3, // 失败重试 3 次
          backoff: {
            type: 'exponential',
            delay: 2000 // 2秒后重试
          },
          removeOnComplete: 100, // 保留最近 100 个完成的任务
          removeOnFail: 200 // 保留最近 200 个失败的任务
        }
      });

      // 创建数据库备份队列
      this.queues.databaseBackup = new Queue('database-backup', {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 2,
          timeout: 600000, // 10 分钟超时
          removeOnComplete: 50
        }
      });

      // 创建存储迁移队列
      this.queues.storageMigration = new Queue('storage-migration', {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 1,
          timeout: 1800000, // 30 分钟超时
          removeOnComplete: 10
        }
      });

      // 注册处理器
      this.registerProcessors();

      // 注册事件监听器
      this.registerEventListeners();

      this.initialized = true;
      console.log('✅ 任务队列管理器初始化成功');
    } catch (error) {
      console.error('❌ 任务队列初始化失败:', error);
      throw error;
    }
  }

  /**
   * 注册任务处理器
   */
  registerProcessors() {
    // 图片处理器（支持并发）
    this.queues.imageProcessing.process('upload', 5, async (job) => {
      return await this.processImageUpload(job);
    });

    // 批量图片处理器
    this.queues.imageProcessing.process('batch-upload', 1, async (job) => {
      return await this.processBatchImageUpload(job);
    });

    // 数据库备份处理器
    this.queues.databaseBackup.process('backup', async (job) => {
      return await this.processDatabaseBackup(job);
    });

    // 数据库恢复处理器
    this.queues.databaseBackup.process('restore', async (job) => {
      return await this.processDatabaseRestore(job);
    });

    // 存储迁移处理器
    this.queues.storageMigration.process('migrate', async (job) => {
      return await this.processStorageMigration(job);
    });
  }

  /**
   * 注册事件监听器
   */
  registerEventListeners() {
    Object.entries(this.queues).forEach(([name, queue]) => {
      queue.on('completed', (job, result) => {
        console.log(`✅ [${name}] 任务完成: ${job.id}`, {
          duration: Date.now() - job.timestamp,
          result: result?.message || 'success'
        });
      });

      queue.on('failed', (job, err) => {
        console.error(`❌ [${name}] 任务失败: ${job.id}`, {
          error: err.message,
          attempts: job.attemptsMade
        });
      });

      queue.on('stalled', (job) => {
        console.warn(`⚠️  [${name}] 任务停滞: ${job.id}`);
      });
    });
  }

  /**
   * 处理单张图片上传
   */
  async processImageUpload(job) {
    const { fileData, options, userId } = job.data;
    const startTime = Date.now();

    try {
      // 更新进度: 开始处理
      await job.progress(10);

      // 解析文件缓冲区
      const fileBuffer = Buffer.from(fileData.buffer, 'base64');
      const originalName = fileData.originalname;
      const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;

      // 更新进度: 图片优化
      await job.progress(30);

      // Sharp 图片处理
      const quality = parseInt(options.quality || process.env.IMAGE_QUALITY_WEBP || 80);
      const optimizedBuffer = await sharp(fileBuffer)
        .toFormat('webp', { quality })
        .toBuffer();

      // 更新进度: 上传存储
      await job.progress(60);

      // 根据存储类型处理
      let imageUrl, imagePath;
      if (options.storageType === 'r2' && options.r2Config) {
        // R2 云存储
        const r2Path = `images/${filename}`;
        imageUrl = await this.uploadToR2(optimizedBuffer, r2Path, options.r2Config);
        imagePath = r2Path;
      } else {
        // 本地存储
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        imagePath = path.join('uploads', filename);
        const fullPath = path.join(process.cwd(), imagePath);
        fs.writeFileSync(fullPath, optimizedBuffer);

        // 生成 URL
        const domain = options.imageDomain || options.currentDomain;
        imageUrl = `${domain}/i/${filename}`;
      }

      // 更新进度: 保存数据库
      await job.progress(80);

      // 生成 Markdown 和 HTML 代码
      const markdownCode = `![${originalName}](${imageUrl})`;
      const htmlCode = `<img src="${imageUrl}" alt="${originalName}" />`;

      // 保存到数据库
      const imageData = {
        filename,
        path: imagePath,
        upload_time: new Date(),
        file_size: optimizedBuffer.length,
        storage: options.storageType || 'local',
        format: 'webp',
        url: imageUrl,
        html_code: htmlCode,
        markdown_code: markdownCode
      };

      await this.imageDb.addImage(imageData);

      // 清除缓存
      if (this.redisClient?.connected) {
        await this.redisClient.del('cache:images:all');
        await this.redisClient.del('cache:stats');
      }

      // 更新进度: 完成
      await job.progress(100);

      const duration = Date.now() - startTime;
      return {
        success: true,
        filename,
        url: imageUrl,
        markdown: markdownCode,
        html: htmlCode,
        size: optimizedBuffer.length,
        duration
      };

    } catch (error) {
      console.error('图片处理失败:', error);
      throw error;
    }
  }

  /**
   * 处理批量图片上传（并行优化）
   */
  async processBatchImageUpload(job) {
    const { files, options, userId } = job.data;
    const startTime = Date.now();
    const results = [];
    const errors = [];

    try {
      // 并发限制（同时处理 5 张图片）
      const limit = pLimit(5);

      const tasks = files.map((fileData, index) =>
        limit(async () => {
          try {
            // 为每张图片创建子任务
            const subJob = await this.queues.imageProcessing.add('upload', {
              fileData,
              options,
              userId
            }, {
              priority: 1 // 优先级
            });

            // 等待子任务完成
            const result = await subJob.finished();
            results.push(result);

            // 更新批量任务进度
            const progress = Math.floor(((index + 1) / files.length) * 100);
            await job.progress(progress);

            return result;
          } catch (error) {
            errors.push({
              filename: fileData.originalname,
              error: error.message
            });
            return null;
          }
        })
      );

      await Promise.all(tasks);

      const duration = Date.now() - startTime;
      const successCount = results.filter(r => r !== null).length;

      return {
        success: true,
        total: files.length,
        successCount,
        failCount: errors.length,
        results: results.filter(r => r !== null),
        errors,
        duration
      };

    } catch (error) {
      console.error('批量图片处理失败:', error);
      throw error;
    }
  }

  /**
   * 处理数据库备份
   */
  async processDatabaseBackup(job) {
    const { format } = job.data;

    try {
      await job.progress(10);

      let result;
      if (format === 'sql') {
        await job.progress(30);
        result = await this.imageDb.exportToSql();
      } else {
        await job.progress(30);
        result = await this.imageDb.exportToJson();
      }

      await job.progress(100);

      return {
        success: true,
        format,
        path: result.path,
        message: result.message
      };

    } catch (error) {
      console.error('数据库备份失败:', error);
      throw error;
    }
  }

  /**
   * 处理数据库恢复
   */
  async processDatabaseRestore(job) {
    const { filePath, format } = job.data;

    try {
      await job.progress(10);

      let result;
      if (format === 'sql') {
        await job.progress(30);
        result = await this.imageDb.importFromSql(filePath);
      } else {
        await job.progress(30);
        result = await this.imageDb.importFromJson(filePath);
      }

      await job.progress(100);

      return {
        success: true,
        format,
        message: result.message || '恢复成功'
      };

    } catch (error) {
      console.error('数据库恢复失败:', error);
      throw error;
    }
  }

  /**
   * 处理存储迁移
   */
  async processStorageMigration(job) {
    const { fromStorage, toStorage, options } = job.data;

    try {
      await job.progress(5);

      // 获取需要迁移的图片列表
      const images = await this.imageDb.getImagesByStorage(fromStorage);
      const total = images.length;
      let migrated = 0;
      let failed = 0;

      await job.progress(10);

      // 并发限制（同时处理 3 张图片）
      const limit = pLimit(3);

      const tasks = images.map((image, index) =>
        limit(async () => {
          try {
            // 读取源文件
            let fileBuffer;
            if (fromStorage === 'local') {
              const fullPath = path.join(process.cwd(), image.path);
              fileBuffer = fs.readFileSync(fullPath);
            } else {
              // 从 R2 下载（需要实现）
              fileBuffer = await this.downloadFromR2(image.path, options.r2Config);
            }

            // 上传到目标存储
            let newUrl, newPath;
            if (toStorage === 'r2') {
              const r2Path = `images/${path.basename(image.path)}`;
              newUrl = await this.uploadToR2(fileBuffer, r2Path, options.r2Config);
              newPath = r2Path;
            } else {
              const uploadDir = path.join(process.cwd(), 'uploads');
              if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
              }
              newPath = path.join('uploads', path.basename(image.path));
              const fullPath = path.join(process.cwd(), newPath);
              fs.writeFileSync(fullPath, fileBuffer);

              const domain = options.imageDomain || options.currentDomain;
              newUrl = `${domain}/i/${path.basename(image.path)}`;
            }

            // 更新数据库
            await this.imageDb.updateImageStorage(image.id, {
              storage: toStorage,
              path: newPath,
              url: newUrl
            });

            migrated++;

            // 更新进度
            const progress = Math.floor(10 + ((index + 1) / total) * 85);
            await job.progress(progress);

          } catch (error) {
            console.error(`迁移图片 ${image.filename} 失败:`, error);
            failed++;
          }
        })
      );

      await Promise.all(tasks);

      await job.progress(100);

      return {
        success: true,
        total,
        migrated,
        failed,
        message: `迁移完成: ${migrated}/${total} 成功, ${failed} 失败`
      };

    } catch (error) {
      console.error('存储迁移失败:', error);
      throw error;
    }
  }

  /**
   * 上传文件到 R2
   */
  async uploadToR2(buffer, key, r2Config) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

    const s3Client = new S3Client({
      region: r2Config.region || 'auto',
      endpoint: r2Config.endpoint,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey
      }
    });

    const command = new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/webp'
    });

    await s3Client.send(command);

    // 返回 URL
    if (r2Config.customDomain) {
      return `${r2Config.customDomain}/${key}`;
    } else {
      return `${r2Config.endpoint}/${r2Config.bucket}/${key}`;
    }
  }

  /**
   * 从 R2 下载文件
   */
  async downloadFromR2(key, r2Config) {
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

    const s3Client = new S3Client({
      region: r2Config.region || 'auto',
      endpoint: r2Config.endpoint,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey
      }
    });

    const command = new GetObjectCommand({
      Bucket: r2Config.bucket,
      Key: key
    });

    const response = await s3Client.send(command);
    const chunks = [];

    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  /**
   * 添加图片处理任务
   */
  async addImageUploadJob(fileData, options, userId = null) {
    const job = await this.queues.imageProcessing.add('upload', {
      fileData,
      options,
      userId
    }, {
      priority: 2
    });

    return {
      jobId: job.id,
      queue: 'image-processing'
    };
  }

  /**
   * 添加批量图片处理任务
   */
  async addBatchImageUploadJob(files, options, userId = null) {
    const job = await this.queues.imageProcessing.add('batch-upload', {
      files,
      options,
      userId
    }, {
      priority: 1
    });

    return {
      jobId: job.id,
      queue: 'image-processing'
    };
  }

  /**
   * 添加备份任务
   */
  async addBackupJob(format = 'sql') {
    const job = await this.queues.databaseBackup.add('backup', {
      format
    });

    return {
      jobId: job.id,
      queue: 'database-backup'
    };
  }

  /**
   * 添加恢复任务
   */
  async addRestoreJob(filePath, format = 'sql') {
    const job = await this.queues.databaseBackup.add('restore', {
      filePath,
      format
    });

    return {
      jobId: job.id,
      queue: 'database-backup'
    };
  }

  /**
   * 添加存储迁移任务
   */
  async addMigrationJob(fromStorage, toStorage, options) {
    const job = await this.queues.storageMigration.add('migrate', {
      fromStorage,
      toStorage,
      options
    });

    return {
      jobId: job.id,
      queue: 'storage-migration'
    };
  }

  /**
   * 获取任务状态
   */
  async getJobStatus(queueName, jobId) {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      return {
        exists: false,
        message: '任务不存在'
      };
    }

    const state = await job.getState();
    const progress = job.progress();
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      exists: true,
      jobId: job.id,
      state,
      progress,
      result,
      failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp
    };
  }

  /**
   * 获取队列统计信息
   */
  async getQueueStats(queueName) {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed
    };
  }

  /**
   * 清理队列
   */
  async cleanQueue(queueName, grace = 0, type = 'completed') {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    await queue.clean(grace, type);
    return {
      success: true,
      message: `队列 ${queueName} 的 ${type} 任务已清理`
    };
  }

  /**
   * 关闭所有队列
   */
  async shutdown() {
    console.log('🔄 正在关闭任务队列...');

    for (const [name, queue] of Object.entries(this.queues)) {
      try {
        await queue.close();
        console.log(`✅ 队列 ${name} 已关闭`);
      } catch (error) {
        console.error(`❌ 关闭队列 ${name} 失败:`, error);
      }
    }

    this.initialized = false;
    console.log('✅ 所有队列已关闭');
  }
}

module.exports = QueueManager;
