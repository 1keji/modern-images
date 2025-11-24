/**
 * Storage Configuration Routes
 * Handles storage configuration management and R2 testing
 */

const express = require('express');
const { getStorageConfig } = require('../utils/storage-utils');

/**
 * Create storage routes with dependency injection
 * @param {Function} isAuthenticated - Authentication middleware
 * @param {Object} r2Client - R2 S3 client instance
 * @returns {express.Router} Express router with storage routes
 */
function createStorageRoutes(isAuthenticated, r2Client) {
  const router = express.Router();

  // 获取存储配置
  router.get('/api/storage-config', isAuthenticated, (req, res) => {
    const storageConfig = getStorageConfig();
    res.json({
      success: true,
      config: {
        type: storageConfig.type,
        r2: {
          enabled: storageConfig.r2.enabled,
          endpoint: storageConfig.r2.endpoint,
          bucket: storageConfig.r2.bucket,
          region: storageConfig.r2.region,
          customDomain: storageConfig.r2.customDomain,
          // 不返回敏感信息
          hasCredentials: !!(storageConfig.r2.accessKeyId && storageConfig.r2.secretAccessKey)
        }
      }
    });
  });

  // 更新存储配置
  router.post('/api/storage-config', isAuthenticated, (req, res) => {
    res.status(400).json({
      success: false,
      message: '存储配置需要通过环境变量设置，请更新.env文件并重启服务'
    });
  });

  // 调试接口：检查R2配置状态
  router.get('/api/debug/r2-status', isAuthenticated, (req, res) => {
    const storageConfig = getStorageConfig();
    const status = {
      storageType: storageConfig.type,
      r2Config: {
        enabled: storageConfig.r2.enabled,
        hasAccessKey: !!storageConfig.r2.accessKeyId,
        hasSecretKey: !!storageConfig.r2.secretAccessKey,
        endpoint: storageConfig.r2.endpoint,
        bucket: storageConfig.r2.bucket,
        region: storageConfig.r2.region,
        customDomain: storageConfig.r2.customDomain
      },
      clientStatus: {
        hasR2Client: !!r2Client,
        clientConfig: r2Client ? {
          region: r2Client.config.region,
          endpoint: r2Client.config.endpoint
        } : null
      }
    };

    res.json({
      success: true,
      status: status
    });
  });

  // 测试R2连接
  router.post('/api/test-r2', isAuthenticated, async (req, res) => {
    try {
      if (!getStorageConfig().r2.enabled) {
        return res.status(400).json({ success: false, message: 'R2存储未启用' });
      }

      if (!r2Client) {
        return res.status(400).json({ success: false, message: 'R2客户端未初始化，请检查配置' });
      }

      // Import required dependencies for R2 testing
      const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

      // 创建一个测试文件
      const testFilename = `test-${Date.now()}.txt`;
      const testBuffer = Buffer.from('This is a test file for R2 connection');

      console.log(`开始R2连接测试，上传文件: ${testFilename}`);

      // 上传测试文件
      const uploadParams = {
        Bucket: process.env.R2_BUCKET,
        Key: testFilename,
        Body: testBuffer,
        ContentType: 'text/plain'
      };

      await r2Client.send(new PutObjectCommand(uploadParams));

      // 测试完成后删除测试文件
      try {
        const deleteParams = {
          Bucket: process.env.R2_BUCKET,
          Key: testFilename
        };
        await r2Client.send(new DeleteObjectCommand(deleteParams));
        console.log(`测试文件删除成功: ${testFilename}`);
      } catch (deleteError) {
        console.log('删除测试文件失败（可忽略）:', deleteError.message);
      }

      res.json({ success: true, message: 'R2连接测试成功！请确保Bucket已设置为公开访问。' });
    } catch (error) {
      console.error('R2连接测试失败:', error);
      res.status(500).json({ success: false, message: `R2连接测试失败: ${error.message}` });
    }
  });

  return router;
}

module.exports = createStorageRoutes;
