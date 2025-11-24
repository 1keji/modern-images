/**
 * 集成示例文件
 * 演示如何将优化模块集成到现有项目中
 *
 * 使用方法：
 * 1. 复制相关代码片段到您的 server.js 或 app.js
 * 2. 根据实际情况调整参数
 * 3. 测试功能是否正常
 */

// ============================================
// 第一步：导入必要的模块
// ============================================

const express = require('express');
const QueueManager = require('./queue-manager');
const { extendDatabase } = require('./database-optimized');

// ============================================
// 第二步：初始化队列管理器
// ============================================

/**
 * 初始化任务队列系统
 * 在创建 Express 应用之前调用
 */
async function initializeQueueManager(redisClient, imageDb, config) {
  // 创建队列管理器实例
  const queueManager = new QueueManager(redisClient, imageDb, config);

  // 检查 Redis 是否可用
  if (!redisClient.isEnabled() || !redisClient.isConnected) {
    console.warn('⚠️  Redis 未启用或未连接，任务队列功能将不可用');
    console.warn('⚠️  系统将自动降级到同步处理模式');
    return null;
  }

  try {
    // 初始化队列
    await queueManager.initialize();
    console.log('✅ 任务队列系统已启动');
    console.log('   - 图片处理队列: image-processing');
    console.log('   - 数据库备份队列: database-backup');
    console.log('   - 存储迁移队列: storage-migration');

    return queueManager;
  } catch (error) {
    console.error('❌ 任务队列初始化失败:', error);
    console.error('   系统将使用同步处理模式');
    return null;
  }
}

// ============================================
// 第三步：扩展数据库功能
// ============================================

/**
 * 为数据库实例添加批量操作方法
 */
function setupDatabaseOptimizations(imageDb) {
  console.log('🔧 正在加载数据库优化扩展...');

  // 扩展数据库实例
  extendDatabase(imageDb);

  console.log('✅ 数据库优化扩展已加载');
  console.log('   新增方法:');
  console.log('   - addImagesBatch() - 批量插入图片');
  console.log('   - addImagesBatchOptimized() - 优化批量插入');
  console.log('   - updateImagesBatch() - 批量更新');
  console.log('   - deleteImagesBatch() - 批量删除');
  console.log('   - getImagesPaginated() - 分页查询');
  console.log('   - getImageStats() - 统计信息');
}

// ============================================
// 第四步：注册优化路由
// ============================================

/**
 * 注册优化后的路由
 * 支持异步上传、备份、迁移等功能
 */
function registerOptimizedRoutes(app, dependencies) {
  const {
    isAuthenticated,
    apiAuthenticated,
    upload,
    imageDb,
    redisClient,
    r2StorageService,
    config,
    queueManager
  } = dependencies;

  // 方案 A：完全替换原路由（生产环境谨慎使用）
  // const createUploadRoutes = require('./src/routes/upload.routes.optimized');
  // app.use('/', createUploadRoutes({
  //   isAuthenticated,
  //   apiAuthenticated,
  //   upload,
  //   imageDb,
  //   redisClient,
  //   r2StorageService,
  //   config,
  //   queueManager
  // }));

  // 方案 B：渐进式集成（推荐）
  // 保留原路由，新增 /v2 路由作为优化版本
  const createUploadRoutesOptimized = require('./src/routes/upload.routes.optimized');
  app.use('/v2', createUploadRoutesOptimized({
    isAuthenticated,
    apiAuthenticated,
    upload,
    imageDb,
    redisClient,
    r2StorageService,
    config,
    queueManager
  }));

  // 注册数据库管理路由（备份、恢复、迁移）
  const createDatabaseRoutesOptimized = require('./src/routes/database.routes.optimized');
  app.use('/', createDatabaseRoutesOptimized({
    isAuthenticated,
    imageDb,
    queueManager,
    config
  }));

  console.log('✅ 优化路由已注册');
  console.log('   - POST /v2/upload - 异步图片上传');
  console.log('   - POST /v2/api/upload - 异步 API 上传');
  console.log('   - GET /api/jobs/:queue/:jobId/status - 查询任务状态');
  console.log('   - POST /api/backup-database - 异步备份');
  console.log('   - POST /api/restore-database - 异步恢复');
  console.log('   - POST /api/migrate-storage - 异步迁移');
  console.log('   - GET /api/queues/stats - 队列统计');
}

// ============================================
// 第五步：优雅关闭处理
// ============================================

/**
 * 注册优雅关闭处理器
 * 确保在服务关闭时正确清理资源
 */
function setupGracefulShutdown(queueManager, imageDb, redisClient) {
  const shutdown = async (signal) => {
    console.log(`\n收到 ${signal} 信号，开始优雅关闭...`);

    try {
      // 1. 关闭队列管理器
      if (queueManager && queueManager.initialized) {
        console.log('🔄 正在关闭任务队列...');
        await queueManager.shutdown();
      }

      // 2. 关闭数据库连接
      if (imageDb && imageDb.pool) {
        console.log('🔄 正在关闭数据库连接...');
        await imageDb.pool.end();
      }

      // 3. 关闭 Redis 连接
      if (redisClient && redisClient.client) {
        console.log('🔄 正在关闭 Redis 连接...');
        await redisClient.disconnect();
      }

      console.log('✅ 所有资源已清理，服务已关闭');
      process.exit(0);
    } catch (error) {
      console.error('❌ 关闭过程中发生错误:', error);
      process.exit(1);
    }
  };

  // 监听退出信号
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 未捕获的异常处理
  process.on('uncaughtException', (error) => {
    console.error('❌ 未捕获的异常:', error);
    // 不要立即退出，让队列任务有机会完成
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未处理的 Promise 拒绝:', reason);
    // 不要立即退出，让队列任务有机会完成
  });
}

// ============================================
// 完整集成示例
// ============================================

/**
 * 主函数：完整的集成流程
 * 在您的 server.js 或 app.js 中调用
 */
async function integrateOptimizations(existingDependencies) {
  const {
    redisClient,
    imageDb,
    config,
    app,
    isAuthenticated,
    apiAuthenticated,
    upload,
    r2StorageService
  } = existingDependencies;

  console.log('\n========================================');
  console.log('开始集成性能优化模块...');
  console.log('========================================\n');

  // 步骤 1：扩展数据库功能
  setupDatabaseOptimizations(imageDb);

  // 步骤 2：初始化队列管理器
  const queueManager = await initializeQueueManager(redisClient, imageDb, config);

  // 步骤 3：注册路由
  registerOptimizedRoutes(app, {
    isAuthenticated,
    apiAuthenticated,
    upload,
    imageDb,
    redisClient,
    r2StorageService,
    config,
    queueManager
  });

  // 步骤 4：设置优雅关闭
  setupGracefulShutdown(queueManager, imageDb, redisClient);

  console.log('\n========================================');
  console.log('性能优化模块集成完成！');
  console.log('========================================\n');

  return {
    queueManager,
    optimizedDb: imageDb
  };
}

// ============================================
// 使用示例
// ============================================

/**
 * 在您的 server.js 中使用：
 *
 * // 1. 导入集成函数
 * const { integrateOptimizations } = require('./INTEGRATION_EXAMPLE');
 *
 * // 2. 在创建 Express 应用后调用
 * const app = express();
 * // ... 其他中间件配置 ...
 *
 * // 3. 集成优化模块
 * const { queueManager, optimizedDb } = await integrateOptimizations({
 *   redisClient,
 *   imageDb,
 *   config,
 *   app,
 *   isAuthenticated,
 *   apiAuthenticated,
 *   upload,
 *   r2StorageService
 * });
 *
 * // 4. 启动服务器
 * const port = process.env.PORT || 3000;
 * app.listen(port, () => {
 *   console.log(`服务器运行在端口 ${port}`);
 * });
 */

// ============================================
// 测试功能
// ============================================

/**
 * 测试队列功能是否正常
 */
async function testQueueFunctionality(queueManager) {
  if (!queueManager || !queueManager.initialized) {
    console.log('⚠️  队列未初始化，跳过测试');
    return;
  }

  console.log('\n🧪 开始测试队列功能...\n');

  try {
    // 测试 1：获取队列统计
    const stats = await queueManager.getQueueStats('imageProcessing');
    console.log('✅ 队列统计测试通过:', stats);

    // 测试 2：提交一个测试任务（不会实际执行）
    // const testJob = await queueManager.addImageUploadJob({
    //   buffer: 'test',
    //   originalname: 'test.jpg'
    // }, {}, 'test-user');
    // console.log('✅ 任务提交测试通过:', testJob);

    console.log('\n✅ 所有队列测试通过！\n');
  } catch (error) {
    console.error('❌ 队列测试失败:', error);
  }
}

/**
 * 测试数据库批量操作
 */
async function testDatabaseBatchOperations(imageDb) {
  console.log('\n🧪 开始测试数据库批量操作...\n');

  try {
    // 测试 1：获取统计信息
    const stats = await imageDb.getImageStats();
    console.log('✅ 统计信息测试通过:', stats);

    // 测试 2：按存储类型统计
    const countByStorage = await imageDb.getImageCountByStorage();
    console.log('✅ 存储类型统计测试通过:', countByStorage);

    console.log('\n✅ 所有数据库测试通过！\n');
  } catch (error) {
    console.error('❌ 数据库测试失败:', error);
  }
}

// ============================================
// 导出
// ============================================

module.exports = {
  integrateOptimizations,
  initializeQueueManager,
  setupDatabaseOptimizations,
  registerOptimizedRoutes,
  setupGracefulShutdown,
  testQueueFunctionality,
  testDatabaseBatchOperations
};

// ============================================
// 直接运行测试（可选）
// ============================================

/**
 * 如果直接运行此文件，执行测试
 * node INTEGRATION_EXAMPLE.js
 */
if (require.main === module) {
  console.log('这是一个集成示例文件，不应直接运行');
  console.log('请参考文件中的注释和 OPTIMIZATION_GUIDE.md 进行集成');
  process.exit(0);
}
