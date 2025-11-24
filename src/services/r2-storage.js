const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getContentType } = require('../utils/file-utils');

/**
 * R2/S3存储服务模块
 */
class R2StorageService {
  constructor() {
    this.client = null;
    this.initClient();
  }

  /**
   * 初始化R2客户端
   */
  initClient() {
    const r2Enabled = process.env.R2_ENABLED === 'true';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT;

    if (r2Enabled && accessKeyId && secretAccessKey && endpoint) {
      this.client = new S3Client({
        region: process.env.R2_REGION || 'auto',
        endpoint: endpoint,
        credentials: {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
        },
      });
      console.log('R2客户端已初始化');
    } else {
      this.client = null;
      console.log('R2配置不完整，使用本地存储');
    }
  }

  /**
   * 检查R2是否可用
   */
  isAvailable() {
    return this.client &&
           process.env.R2_ENABLED === 'true' &&
           process.env.R2_ACCESS_KEY_ID &&
           process.env.R2_SECRET_ACCESS_KEY &&
           process.env.R2_ENDPOINT &&
           process.env.R2_BUCKET;
  }

  /**
   * 上传文件到R2
   * @param {Buffer} fileBuffer - 文件缓冲区
   * @param {string} filename - 文件名
   * @returns {Promise<string>} 文件URL
   */
  async uploadFile(fileBuffer, filename) {
    if (!this.client || !process.env.R2_BUCKET) {
      throw new Error('R2客户端未初始化或bucket未配置');
    }

    console.log(`开始上传到R2: ${filename}`);
    console.log(`文件大小: ${fileBuffer.length} bytes`);
    console.log(`Bucket: ${process.env.R2_BUCKET}`);
    console.log(`Endpoint: ${process.env.R2_ENDPOINT}`);

    const uploadParams = {
      Bucket: process.env.R2_BUCKET,
      Key: filename,
      Body: fileBuffer,
      ContentType: getContentType(filename),
    };

    console.log(`上传参数:`, {
      Bucket: uploadParams.Bucket,
      Key: uploadParams.Key,
      ContentType: uploadParams.ContentType,
      BodySize: uploadParams.Body.length
    });

    try {
      const command = new PutObjectCommand(uploadParams);
      const result = await this.client.send(command);
      console.log(`R2上传成功:`, result);

      // 构建文件URL
      let fileUrl;
      if (process.env.R2_CUSTOM_DOMAIN) {
        fileUrl = `https://${process.env.R2_CUSTOM_DOMAIN}/${filename}`;
      } else {
        // 使用R2的标准公共URL格式
        // Endpoint格式通常是: https://account-id.r2.cloudflarestorage.com
        // 公共URL格式是: https://bucket.account-id.r2.cloudflarestorage.com/filename
        const endpointHost = process.env.R2_ENDPOINT.replace('https://', '').replace('http://', '');
        fileUrl = `https://${process.env.R2_BUCKET}.${endpointHost}/${filename}`;
      }

      console.log(`生成的文件URL: ${fileUrl}`);
      return fileUrl;
    } catch (error) {
      console.error(`R2上传失败:`, error);
      throw error;
    }
  }

  /**
   * 从R2删除文件
   * @param {string} filename - 文件名
   */
  async deleteFile(filename) {
    if (!this.client || !process.env.R2_BUCKET) {
      throw new Error('R2客户端未初始化或bucket未配置');
    }

    const deleteParams = {
      Bucket: process.env.R2_BUCKET,
      Key: filename,
    };

    const command = new DeleteObjectCommand(deleteParams);
    await this.client.send(command);
  }

  /**
   * 获取R2客户端实例
   */
  getClient() {
    return this.client;
  }
}

module.exports = R2StorageService;
