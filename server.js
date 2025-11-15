// 首先加载环境变量
require('dotenv').config();

const express = require('express');
// Optional compression - only load if available
let compression;
try {
  compression = require('compression');
} catch (err) {
  console.log('Compression module not available, skipping compression optimization');
  compression = null;
}
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const RedisStore = require('connect-redis').default;
const crypto = require('crypto'); // 用于生成唯一文件名
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const cluster = require('cluster');
const ImageDatabase = require('./database'); // 引入PostgreSQL数据库模块
const RedisClient = require('./redis-client'); // 引入Redis客户端模块

// 读取配置文件（登录凭据）
const configPath = path.join(__dirname, 'config.json');
let config = require(configPath);

// 初始化PostgreSQL数据库
const imageDb = new ImageDatabase();

// 初始化Redis客户端
const redisClient = new RedisClient();

// 异步初始化函数，确保配置被正确缓存
async function initializeAppWithRedis() {
  // 等待Redis连接（最多等待5秒）
  await new Promise(resolve => {
    if (redisClient.isEnabled()) {
      let attempts = 0;
      const maxAttempts = 50; // 5秒（50 × 100ms）
      
      const checkConnection = () => {
        attempts++;
        if (redisClient.isConnected) {
          console.log('Redis连接已建立');
          resolve();
        } else if (attempts >= maxAttempts) {
          console.warn('Redis连接等待超时，继续启动服务器');
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    } else {
      resolve();
    }
  });
  
  // 初始化时将配置缓存到Redis
  if (redisClient.isEnabled() && redisClient.isConnected) {
    try {
      await redisClient.cacheConfig(config);
      console.log('初始配置已缓存到Redis');
    } catch (error) {
      console.error('初始化Redis配置缓存失败:', error);
    }
  }
}

// 调用初始化函数（不阻塞服务器启动）
initializeAppWithRedis().catch(error => {
  console.error('Redis初始化失败，但服务器继续启动:', error);
});

// File system cache to avoid repeated scans
let fileSystemCache = {
  lastScan: 0,
  files: [],
  cacheTimeout: 60000 // 1 minute cache
};

// Performance counters
let performanceMetrics = {
  uploadCount: 0,
  processingTime: [],
  memoryUsage: [],
  lastCleanup: Date.now()
};

// 图片记录文件路径 (用于向后兼容和数据迁移)
const imagesDbPath = path.join(__dirname, 'images.json');

// 自动导入JSON数据到PostgreSQL (如果JSON文件存在且PostgreSQL为空)
async function initializeDatabase() {
  try {
    // 获取数据库状态
    const dbStatus = await imageDb.getStatus();
    console.log(`数据库状态检查: ${dbStatus.isConnected ? '已连接' : '未连接'}, 记录数: ${dbStatus.dbImageCount}`);
    
    // 如果数据库未连接，停止后续操作
    if (!dbStatus.isConnected) {
      console.error('数据库未连接，无法进行数据初始化和恢复操作');
      return;
    }
    
    // 检查是否有JSON数据需要导入
    if (fs.existsSync(imagesDbPath)) {
      console.log('检测到JSON数据文件存在');
      
      // 安全检查：只有在数据库为空时才导入数据
      if (dbStatus.dbImageCount === 0) {
        console.log('数据库为空，准备导入JSON数据...');
        try {
          // 读取JSON文件内容进行验证
          const jsonContent = fs.readFileSync(imagesDbPath, 'utf8');
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
          const result = await imageDb.importFromJson(imagesDbPath);
          console.log(`JSON数据导入完成: 导入${result.imported}条记录`);
          
          // 导入后检查数据库状态
          const afterStatus = await imageDb.getStatus();
          if (afterStatus.dbImageCount !== result.imported) {
            console.warn(`⚠️ 警告: 导入后记录数 (${afterStatus.dbImageCount}) 与导入记录数 (${result.imported}) 不匹配`);
          } else {
            console.log(`✅ 导入后数据库记录数量校验通过: ${afterStatus.dbImageCount}`);
          }
          
          // 备份原JSON文件
          const backupPath = imagesDbPath + '.backup.' + Date.now();
          fs.copyFileSync(imagesDbPath, backupPath);
          console.log(`原JSON文件已备份到: ${backupPath}`);
        } catch (error) {
          console.error('JSON数据导入失败:', error);
        }
      } else {
        console.log(`数据库已包含 ${dbStatus.dbImageCount} 条记录，跳过JSON导入`);
      }
    } else {
      console.log('未检测到JSON数据文件');
    }
    
    // 如果没有数据，尝试从备份恢复
    if (dbStatus.dbImageCount === 0) {
      try {
        // 获取最新的备份文件
        const backupFiles = await imageDb.getBackupFiles();
        if (backupFiles.length > 0) {
          console.log(`检测到 ${backupFiles.length} 个备份文件，尝试从最新备份恢复`);
          const latestBackup = backupFiles[0];
          
          // 检查备份文件大小，确保不是空文件
          if (latestBackup.size > 100) {
            console.log(`从备份文件恢复: ${latestBackup.name}`);
            const result = await imageDb.importFromSql(latestBackup.path);
            console.log(`备份恢复完成: 导入${result.imported}条记录`);
            
            // 恢复后检查数据库状态
            const afterRestoreStatus = await imageDb.getStatus();
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
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
}

// 初始化数据库(异步，不阻塞服务启动)
initializeDatabase().catch(err => {
  console.error('数据库初始化失败:', err.message);
  console.log('服务将继续运行，但数据库功能可能不可用');
});

// 启动自动备份（如果启用）
if (process.env.AUTO_BACKUP_ENABLED === 'true') {
  const intervalHours = parseInt(process.env.AUTO_BACKUP_INTERVAL_HOURS) || 24;
  console.log(`启动自动备份，间隔: ${intervalHours} 小时`);
  imageDb.setAutoBackup(intervalHours);
}

// 保存图片记录 (使用PostgreSQL)
function saveImagesDb() {
  // 该函数保留用于向后兼容，但实际操作已在addImageRecord中完成
  console.log('注意: saveImagesDb函数已迁移到PostgreSQL，无需手动调用');
}

// 添加图片记录 (使用PostgreSQL，并清除Redis缓存)
async function addImageRecord(imageData) {
  try {
    const result = await imageDb.addImage(imageData);
    
    // 清除相关的Redis缓存
    if (redisClient.isEnabled()) {
      await redisClient.invalidateImageListCache();
      console.log('图片列表缓存已清除');
    }
    
    return result;
  } catch (error) {
    console.error('添加图片记录到数据库失败:', error);
    throw error;
  }
}

// 删除图片记录 (使用PostgreSQL，并清除Redis缓存)
async function removeImageRecord(imagePath) {
  try {
    const result = await imageDb.removeImage(imagePath);
    
    // 清除相关的Redis缓存
    if (redisClient.isEnabled()) {
      await redisClient.invalidateImageListCache();
      console.log('图片列表缓存已清除');
    }
    
    return result;
  } catch (error) {
    console.error('从数据库删除图片记录失败:', error);
    throw error;
  }
}

// 初始化R2客户端
let r2Client = null;

function initR2Client() {
  const r2Enabled = process.env.R2_ENABLED === 'true';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  
  if (r2Enabled && accessKeyId && secretAccessKey && endpoint) {
    r2Client = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      },
    });
    console.log('R2客户端已初始化');
  } else {
    r2Client = null;
    console.log('R2配置不完整，使用本地存储');
  }
}

// 初始化时设置R2客户端
initR2Client();

// 检查R2是否可用
function isR2Available() {
  return r2Client && 
         process.env.R2_ENABLED === 'true' && 
         process.env.R2_ACCESS_KEY_ID && 
         process.env.R2_SECRET_ACCESS_KEY && 
         process.env.R2_ENDPOINT && 
         process.env.R2_BUCKET;
}

// 获取当前存储配置
function getStorageConfig() {
  return {
    type: process.env.STORAGE_TYPE || 'local',
    r2: {
      enabled: process.env.R2_ENABLED === 'true',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      endpoint: process.env.R2_ENDPOINT || '',
      bucket: process.env.R2_BUCKET || '',
      region: process.env.R2_REGION || 'auto',
      customDomain: process.env.R2_CUSTOM_DOMAIN || ''
    }
  };
}

// 获取图片质量配置
function getImageQualityConfig() {
  return {
    webp: config.imageQuality?.webp || parseInt(process.env.IMAGE_QUALITY_WEBP) || 80,
    avif: config.imageQuality?.avif || parseInt(process.env.IMAGE_QUALITY_AVIF) || 75,
    pngOptimize: config.imageQuality?.pngOptimize !== undefined ? 
      config.imageQuality.pngOptimize : 
      process.env.IMAGE_QUALITY_PNG_OPTIMIZE !== 'false'
  };
}

// 检查认证配置是否已重置
function isAuthReset(authConfig) {
  return (!authConfig.username || authConfig.username.trim() === '') &&
         (!authConfig.hashedPassword || authConfig.hashedPassword.trim() === '');
}

// 清理所有session文件
function clearAllSessions() {
  const sessionsDir = path.join(__dirname, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir);
      for (const file of files) {
        if (file.startsWith('sess_')) {
          fs.unlinkSync(path.join(sessionsDir, file));
        }
      }
      console.log('所有session文件已清理');
    } catch (error) {
      console.error('清理session文件时发生错误:', error);
    }
  }
}

// 监听配置文件变化
fs.watchFile(configPath, async (curr, prev) => {
  if (curr.mtime !== prev.mtime) {
    try {
      // 检查文件是否存在
      if (fs.existsSync(configPath)) {
        // 保存当前的API配置
        const currentApiConfig = config.api;
        
        // 重新读取配置文件
        delete require.cache[configPath];
        const newConfig = require(configPath);
        
        // 检查认证信息是否被重置
        if (isAuthReset(newConfig.auth)) {
          console.log('检测到认证信息被重置');
          // 清理所有session文件
          clearAllSessions();
          // 重置认证信息，但保留其他配置
          config = {
            auth: {
              isConfigured: false,
              username: '',
              hashedPassword: '',
              salt: ''  // 为了安全，当认证信息重置时，也重置salt
            },
            api: currentApiConfig,  // 保留原有的API配置
            storage: {
              type: 'local'
            },
            imageQuality: {
              webp: 80,
              avif: 75,
              pngOptimize: true
            }
          };
          // 保存更新后的配置
          await saveConfig();
          console.log('认证信息已重置，所有登录session已清理，其他配置保持不变');
        } else {
          // 如果认证信息没有被重置，直接使用新的配置
          config = newConfig;
          console.log('配置文件已更新');
        }
      } else {
        // 如果文件不存在，创建默认配置
        config = {
          auth: {
            isConfigured: false,
            username: '',
            hashedPassword: '',
            salt: ''
          },
          api: {
            enabled: true,
            tokens: [],
            defaultFormat: 'original'
          },
          storage: {
            type: 'local'
          },
          imageQuality: {
            webp: 80,
            avif: 75,
            pngOptimize: true
          }
        };
        // 保存默认配置
        await saveConfig();
        console.log('配置文件已重置为默认状态');
      }
    } catch (error) {
      console.error('更新配置文件时发生错误:', error);
    }
  }
});

// 保存配置文件的函数
async function saveConfig() {
  try {
    // 保存到配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // 同时更新Redis缓存（如果启用）
    if (redisClient.isEnabled()) {
      await redisClient.cacheConfig(config);
      console.log('配置已同步到Redis缓存');
    }
  } catch (error) {
    console.error('保存配置失败:', error);
  }
}

// 密码加密相关函数
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

// R2上传函数
async function uploadToR2(fileBuffer, filename) {
  if (!r2Client || !process.env.R2_BUCKET) {
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
    const result = await r2Client.send(command);
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

// R2删除函数
async function deleteFromR2(filename) {
  if (!r2Client || !process.env.R2_BUCKET) {
    throw new Error('R2客户端未初始化或bucket未配置');
  }

  const deleteParams = {
    Bucket: process.env.R2_BUCKET,
    Key: filename,
  };

  const command = new DeleteObjectCommand(deleteParams);
  await r2Client.send(command);
}

// 获取文件的Content-Type
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Performance optimizations for Sharp (with safety checks)
try {
  if (sharp && typeof sharp.cache === 'function') {
    sharp.cache(false); // Disable Sharp cache for better memory management
    console.log('Sharp cache disabled for memory optimization');
  }
  if (sharp && typeof sharp.concurrency === 'function') {
    sharp.concurrency(1); // Limit Sharp concurrency to prevent memory spikes
    console.log('Sharp concurrency limited to 1');
  }
} catch (sharpError) {
  console.warn('Sharp optimization failed:', sharpError.message);
}

const app = express();
const port = process.env.PORT || 3000;

// Add compression middleware for better response times (if available)
if (compression) {
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));
  console.log('Response compression enabled');
} else {
  console.log('Response compression skipped - module not available');
}

// 信任代理，支持反向代理（Nginx、Cloudflare等）
app.set('trust proxy', true);

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutes timeout for uploads
  res.setTimeout(300000);
  next();
});

// Memory monitoring middleware
app.use((req, res, next) => {
  const memUsage = process.memoryUsage();
  if (memUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB threshold
    console.warn('High memory usage detected:', {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
    });
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
  next();
});

// 创建一个函数来正确检测协议（支持反向代理）
function getProtocol(req) {
  // 检查各种可能的HTTPS标头
  if (req.secure || 
      req.get('x-forwarded-proto') === 'https' || 
      req.get('x-forwarded-ssl') === 'on' ||
      req.get('x-forwarded-scheme') === 'https') {
    return 'https';
  }
  
  // 特殊处理Cloudflare的CF-Visitor头
  const cfVisitor = req.get('cf-visitor');
  if (cfVisitor) {
    try {
      const visitor = JSON.parse(cfVisitor);
      if (visitor.scheme === 'https') {
        return 'https';
      }
    } catch (e) {
      // 忽略JSON解析错误，继续其他检查
    }
  }
  
  return 'http';
}

// 创建一个函数来构建正确的基础URL
function getBaseUrl(req) {
  const protocol = getProtocol(req);
  return `${protocol}://${req.get('host')}`;
}

// 获取图片域名配置（优先从数据库读取）
async function getImageDomainConfig() {
  const defaultConfig = {
    enabled: false,
    domain: '',
    httpsOnly: true,
    backupDomains: []
  };
  
  try {
    // 优先从数据库读取
    const dbConfig = await imageDb.getSetting('imageDomain');
    if (dbConfig) {
      return {
        enabled: dbConfig.enabled !== undefined ? dbConfig.enabled : defaultConfig.enabled,
        domain: dbConfig.domain || defaultConfig.domain,
        httpsOnly: dbConfig.httpsOnly !== undefined ? dbConfig.httpsOnly : defaultConfig.httpsOnly,
        backupDomains: dbConfig.backupDomains || defaultConfig.backupDomains
      };
    }
  } catch (error) {
    console.warn('从数据库读取图片域名配置失败，使用配置文件:', error.message);
  }
  
  // 回退到配置文件
  return {
    enabled: config.imageDomain?.enabled || defaultConfig.enabled,
    domain: config.imageDomain?.domain || defaultConfig.domain,
    httpsOnly: config.imageDomain?.httpsOnly !== undefined ? config.imageDomain.httpsOnly : defaultConfig.httpsOnly,
    backupDomains: config.imageDomain?.backupDomains || defaultConfig.backupDomains
  };
}

// 获取域名安全配置（优先从数据库读取）
async function getDomainSecurityConfig() {
  const defaultConfig = {
    enabled: false,
    allowedDomains: [],
    redirectToMain: false,
    mainDomain: ''
  };
  
  try {
    // 优先从数据库读取
    const dbConfig = await imageDb.getSetting('domainSecurity');
    if (dbConfig) {
      return {
        enabled: dbConfig.enabled !== undefined ? dbConfig.enabled : defaultConfig.enabled,
        allowedDomains: dbConfig.allowedDomains || defaultConfig.allowedDomains,
        redirectToMain: dbConfig.redirectToMain !== undefined ? dbConfig.redirectToMain : defaultConfig.redirectToMain,
        mainDomain: dbConfig.mainDomain || defaultConfig.mainDomain
      };
    }
  } catch (error) {
    console.warn('从数据库读取域名安全配置失败，使用配置文件:', error.message);
  }
  
  // 回退到配置文件
  return {
    enabled: config.domainSecurity?.enabled || defaultConfig.enabled,
    allowedDomains: config.domainSecurity?.allowedDomains || defaultConfig.allowedDomains,
    redirectToMain: config.domainSecurity?.redirectToMain || defaultConfig.redirectToMain,
    mainDomain: config.domainSecurity?.mainDomain || defaultConfig.mainDomain
  };
}

// 获取显示设置配置（优先从数据库读取）
async function getDisplaySettingsConfig() {
  const defaultConfig = {
    showRecentUploads: true
  };

  try {
    // 优先从数据库读取
    const dbConfig = await imageDb.getSetting('displaySettings');
    if (dbConfig) {
      return {
        showRecentUploads: dbConfig.showRecentUploads !== undefined ? dbConfig.showRecentUploads : defaultConfig.showRecentUploads
      };
    }
  } catch (error) {
    console.warn('从数据库读取显示设置失败，使用配置文件:', error.message);
  }

  // 回退到配置文件
  return {
    showRecentUploads: config.displaySettings?.showRecentUploads !== undefined ? config.displaySettings.showRecentUploads : defaultConfig.showRecentUploads
  };
}

// 创建一个函数来构建图片URL，支持独立的图片域名
async function getImageBaseUrl(req) {
  const imageDomainConfig = await getImageDomainConfig();
  
  if (imageDomainConfig.enabled && imageDomainConfig.domain) {
    // 使用独立的图片域名
    const protocol = imageDomainConfig.httpsOnly ? 'https' : getProtocol(req);
    const domain = imageDomainConfig.domain.replace(/^https?:\/\//, ''); // 移除协议前缀
    return `${protocol}://${domain}`;
  } else {
    // 使用默认的网站域名
    return getBaseUrl(req);
  }
}

// 配置 express 解析表单数据
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置 session 中间件，优先使用Redis存储
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'somesecret_please_change_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // 生产环境中如果使用 HTTPS 请设置为 true
    httpOnly: true,
    maxAge: null // 默认为会话 cookie，具体过期时间在登录时设置
  }
};

// 根据Redis是否可用选择session存储方式
if (redisClient.isEnabled()) {
  console.log('使用Redis作为Session存储');
  sessionConfig.store = new RedisStore({
    client: redisClient.client,
    prefix: 'sess:',
    ttl: 30 * 24 * 60 * 60 // 30天TTL
  });
} else {
  console.log('使用文件作为Session存储');
  sessionConfig.store = new FileStore({
    path: path.join(__dirname, 'sessions'), // session 文件存储路径
    retries: 0, // 重试次数
    ttl: 30 * 24 * 60 * 60, // session 文件默认 TTL（秒），30天
    logFn: function() {} // 禁用日志输出
  });
}

app.use(session(sessionConfig));

// 应用域名安全验证中间件到所有路由
app.use(domainSecurityCheck);

// 检查是否需要初始配置的中间件
function checkInitialSetup(req, res, next) {
  if (!config.auth.isConfigured && req.path !== '/setup' && req.path !== '/perform-setup') {
    return res.redirect('/setup');
  }
  next();
}

// 域名安全验证中间件
async function domainSecurityCheck(req, res, next) {
  try {
    const domainConfig = await getDomainSecurityConfig();
    
    // 如果域名安全验证未启用，直接通过
    if (!domainConfig.enabled) {
      return next();
    }
  
    const requestHost = req.get('host');
    if (!requestHost) {
      return res.status(400).json({ 
        success: false, 
        message: '请求无效' 
      });
    }
    
    // 移除端口号，只比较域名部分
    const requestDomain = requestHost.split(':')[0].toLowerCase();
    
    // 获取图片域名配置
    const imageDomainConfig = await getImageDomainConfig();
  
  // 检查是否是图片独立域名访问（包括主图片域名和备用图片域名）
  if (imageDomainConfig.enabled) {
    let isImageDomain = false;
    
    // 检查主图片域名
    if (imageDomainConfig.domain) {
      const imageDomain = imageDomainConfig.domain.replace(/^https?:\/\//, '').toLowerCase();
      if (requestDomain === imageDomain) {
        isImageDomain = true;
      }
    }
    
    // 检查备用图片域名
    if (!isImageDomain && imageDomainConfig.backupDomains && Array.isArray(imageDomainConfig.backupDomains)) {
      for (const backupDomain of imageDomainConfig.backupDomains) {
        if (backupDomain && typeof backupDomain === 'string') {
          const cleanBackupDomain = backupDomain.replace(/^https?:\/\//, '').toLowerCase();
          if (requestDomain === cleanBackupDomain) {
            isImageDomain = true;
            break;
          }
        }
      }
    }
    
    if (isImageDomain) {
      // 如果是图片域名（主域名或备用域名），只允许访问图片资源和基本静态资源
      if (req.path.startsWith('/i/') || 
          req.path.startsWith('/css/') || 
          req.path.startsWith('/js/') ||
          req.path === '/favicon.ico' ||
          req.path === '/robots.txt') {
        return next(); // 允许访问图片和必要的静态资源
      } else {
        // 图片域名不允许访问网站管理界面
        console.log(`图片域名 "${requestDomain}" 尝试访问非图片资源: ${req.path}`);
        if (req.path.startsWith('/api/')) {
          return res.status(403).json({ 
            success: false, 
            message: '访问被拒绝',
            code: 'DOMAIN_NOT_ALLOWED'
          });
        } else {
          return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>访问被拒绝</title></head><body><h1>403 - 访问被拒绝</h1><p>您无权访问此资源。</p></body></html>');
        }
      }
    }
  }
  
  // 检查是否在允许的域名列表中
  const allowedDomains = domainConfig.allowedDomains.map(domain => domain.toLowerCase());
  const isAllowed = allowedDomains.some(allowedDomain => {
    // 支持精确匹配和通配符子域名匹配
    if (allowedDomain.startsWith('*.')) {
      const baseDomain = allowedDomain.substring(2);
      return requestDomain === baseDomain || requestDomain.endsWith('.' + baseDomain);
    }
    return requestDomain === allowedDomain;
  });
  
  if (!isAllowed) {
    console.log(`域名安全验证失败: 请求域名 "${requestDomain}" 不在允许列表中`);
    console.log(`请求路径: ${req.path}`);
    console.log(`允许的域名列表: ${allowedDomains.join(', ')}`);
    
    // 如果配置了重定向到主域名且不是API请求
    if (domainConfig.redirectToMain && domainConfig.mainDomain && !req.path.startsWith('/api/')) {
      const protocol = getProtocol(req);
      const redirectUrl = `${protocol}://${domainConfig.mainDomain}${req.originalUrl}`;
      console.log(`重定向到主域名: ${redirectUrl}`);
      return res.redirect(301, redirectUrl);
    }
    
    // 返回403错误，使用通用错误信息
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ 
        success: false, 
        message: '访问被拒绝',
        code: 'DOMAIN_NOT_ALLOWED'
      });
    } else {
      return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>访问被拒绝</title></head><body><h1>403 - 访问被拒绝</h1><p>您无权访问此资源。</p></body></html>');
    }
  }
    
    next();
  } catch (error) {
    console.error('域名安全验证出错:', error);
    // 出错时允许通过，避免阻塞正常访问
    next();
  }
}

// 鉴权中间件，检测用户是否登录
function isAuthenticated(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

// API鉴权中间件，检测请求是否包含有效的API令牌
function apiAuthenticated(req, res, next) {
  const token = req.headers['x-api-token'] || req.query.token;
  
  if (!token) {
    return res.status(401).json({ success: false, message: '缺少API令牌' });
  }
  
  if (!config.api.enabled) {
    return res.status(403).json({ success: false, message: 'API功能未启用' });
  }
  
  const validToken = config.api.tokens.find(t => t.token === token);
  if (!validToken) {
    return res.status(401).json({ success: false, message: '无效的API令牌' });
  }
  
  // 将API令牌信息添加到请求对象中，以便后续使用
  req.apiToken = validToken;
  next();
}

// 公共静态资源（CSS、JS等）
// 注意：不再直接暴露 /uploads 目录，而是通过 /i 路由隐藏真实根目录
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
// 对于上传后的图片，设置静态资源路由，添加 AVIF MIME 类型支持
app.use('/i', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: function (res, filePath) {
    if (filePath.endsWith('.avif')) {
      res.setHeader('Content-Type', 'image/avif');
    }
  }
}));

// 使用内存存储，以便后续利用 sharp 进行图片转换
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedMimetypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    if (allowedMimetypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式'), false);
    }
  }
});

// 确保目录存在的函数
function ensureDirExistence(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 确保 sessions 目录存在
const sessionsDir = path.join(__dirname, 'sessions');
ensureDirExistence(sessionsDir);

// 确保 temp 目录存在（用于文件上传）
const tempDir = path.join(__dirname, 'temp');
ensureDirExistence(tempDir);

// 获取当前日期的年月日文件夹路径
function getYearMonthPath() {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return path.join(year, month, day);
}

// 递归获取目录下所有文件
// Optimized getAllFiles with caching
function getAllFiles(dir, fileList = []) {
  const now = Date.now();
  const isRootCall = fileList.length === 0; // 判断是否为根调用

  // 只在根调用时使用缓存
  if (isRootCall && fileSystemCache.lastScan &&
      (now - fileSystemCache.lastScan) < fileSystemCache.cacheTimeout &&
      fileSystemCache.files.length > 0) {
    return fileSystemCache.files.slice(); // Return copy to prevent mutations
  }

  if (fs.existsSync(dir)) {
    try {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        try {
          if (fs.statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList);
          } else {
            // Only include image files to improve performance
            const ext = path.extname(file).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext)) {
              fileList.push(filePath);
            }
          }
        } catch (statError) {
          console.warn(`Unable to stat file: ${filePath}`, statError.message);
        }
      });
    } catch (readError) {
      console.error(`Error reading directory: ${dir}`, readError.message);
    }
  }

  // 只在根调用时更新缓存
  if (isRootCall) {
    fileSystemCache.lastScan = now;
    fileSystemCache.files = fileList.slice();
  }

  return fileList;
}

// Function to clear file system cache when files are added/removed
function invalidateFileSystemCache() {
  fileSystemCache.lastScan = 0;
  fileSystemCache.files = [];
}

// Optimized concurrent image processing function
async function processImageConcurrently(file, formatOption, orderIndex, uploadTime, yearMonthPath, imageBaseUrl) {
  const startTime = Date.now();
  
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    let outputFormat = '';
    let outputFilename = '';
    let fileBuffer = file.buffer;
    
    // 自动重命名：使用 16 位随机十六进制字符串作为文件名，再加上三位数定位
    const uniqueId = crypto.randomBytes(8).toString('hex');
    
    // 获取原始格式
    const originalFormat = ext.replace('.', '').toLowerCase();
    
    // Create Sharp instance once
    const sharpInstance = sharp(file.buffer, {
      failOnError: false,
      limitInputPixels: 268402689 // ~16K x 16K max resolution
    });
    
    // 根据上传选项进行图片格式转换与重命名
    if (formatOption === 'webp') {
      outputFormat = 'webp';
      outputFilename = uniqueId + orderIndex + '.webp';
      // 只有当原始格式不是webp时才进行转换
      if (originalFormat !== 'webp') {
        const quality = getImageQualityConfig().webp;
        fileBuffer = await sharpInstance.toFormat('webp', { quality }).toBuffer();
      }
    } else if (formatOption === 'avif') {
      outputFormat = 'avif';
      outputFilename = uniqueId + orderIndex + '.avif';
      // 只有当原始格式不是avif时才进行转换
      if (originalFormat !== 'avif') {
        const quality = getImageQualityConfig().avif;
        fileBuffer = await sharpInstance.toFormat('avif', { quality }).toBuffer();
      }
    } else {
      // 保持原始格式，但可能需要优化
      outputFormat = originalFormat;
      outputFilename = uniqueId + orderIndex + ext;
      
      // 对于PNG格式，应用优化设置
      if (originalFormat === 'png' && getImageQualityConfig().pngOptimize) {
        fileBuffer = await sharpInstance.png({ 
          compressionLevel: 6,  // 0-9，6是一个好的平衡点
          adaptiveFiltering: true,
          palette: true  // 尝试使用调色板模式以减小文件大小
        }).toBuffer();
      }
      // 其他格式保持原样，不进行处理
    }
    
    let imageUrl = '';
    let storage = 'local';
    let relativePath = path.join(yearMonthPath, outputFilename);

    // 检查是否使用R2存储
    const storageConfig = getStorageConfig();
    if (storageConfig.type === 'r2' && storageConfig.r2.enabled && r2Client) {
      try {
        const r2Path = relativePath.replace(/\\/g, '/'); // 确保使用正斜杠
        imageUrl = await uploadToR2(fileBuffer, r2Path);
        storage = 'r2';
      } catch (r2Error) {
        console.error('R2上传失败，回退到本地存储:', r2Error);
        
        // 回退到本地存储
        const uploadDir = path.join(__dirname, 'uploads', yearMonthPath);
        ensureDirExistence(uploadDir);
        const destination = path.join(uploadDir, outputFilename);
        await fsPromises.writeFile(destination, fileBuffer);
        await fsPromises.utimes(destination, uploadTime, uploadTime);
        const urlPath = relativePath.replace(/\\/g, '/');
        imageUrl = `${imageBaseUrl}/i/${urlPath}`;
      }
    } else {
      // 使用本地存储
      const uploadDir = path.join(__dirname, 'uploads', yearMonthPath);
      ensureDirExistence(uploadDir);
      const destination = path.join(uploadDir, outputFilename);
      await fsPromises.writeFile(destination, fileBuffer);
      await fsPromises.utimes(destination, uploadTime, uploadTime);
      const urlPath = relativePath.replace(/\\/g, '/');
      imageUrl = `${imageBaseUrl}/i/${urlPath}`;
    }

    const processingTime = Date.now() - startTime;
    
    return {
      filename: outputFilename,
      originalFilename: file.originalname,
      path: relativePath.replace(/\\/g, '/'),
      url: imageUrl,
      htmlCode: `<img src="${imageUrl}" alt="${outputFilename}" />`,
      markdownCode: `![${outputFilename}](${imageUrl})`,
      uploadTime: uploadTime.toISOString(),
      fileSize: fileBuffer.length,
      storage: storage,
      format: outputFormat,
      processingTime: processingTime
    };
  } catch (error) {
    console.error(`Error processing image ${file.originalname}:`, error);
    throw error;
  }
}

// Periodic cleanup function to prevent memory leaks
function performCleanup() {
  const now = Date.now();
  
  // Cleanup performance metrics older than 1 hour
  if (now - performanceMetrics.lastCleanup > 3600000) {
    performanceMetrics.processingTime = performanceMetrics.processingTime.slice(-50);
    performanceMetrics.memoryUsage = performanceMetrics.memoryUsage.slice(-50);
    performanceMetrics.lastCleanup = now;
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    console.log('Performed periodic cleanup');
  }
}

// Run cleanup every 30 minutes
setInterval(performCleanup, 30 * 60 * 1000);

// 清理空文件夹的递归函数
function cleanEmptyDirs(dir) {
  if (fs.existsSync(dir)) {
    let entries = fs.readdirSync(dir);
    
    // 先递归清理子目录
    entries.forEach(entry => {
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        cleanEmptyDirs(fullPath);
      }
    });
    
    // 重新检查当前目录
    entries = fs.readdirSync(dir);
    if (entries.length === 0 && dir !== path.join(__dirname, 'uploads')) {
      // 不删除uploads根目录，只删除其子目录
      fs.rmdirSync(dir);
      console.log(`已删除空文件夹: ${dir}`);
    }
  }
}

// 生成API令牌的函数
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 合并数据库记录和文件系统扫描的图片列表（带Redis缓存）
async function mergeImagesFromDbAndFileSystem(req, storageType = null, useCache = true) {
  const baseUrl = getBaseUrl(req);
  const imageBaseUrl = await getImageBaseUrl(req);
  
  // 尝试从Redis缓存获取
  if (useCache && redisClient.isEnabled()) {
    const cachedImages = await redisClient.getCachedImageList(storageType);
    if (cachedImages) {
      console.log('从Redis缓存返回图片列表');
      return cachedImages;
    }
  }
  
  let images = await imageDb.getAllImages(null, storageType); // 从PostgreSQL数据库获取
  
  // 创建一个路径集合，用于检查哪些文件已经在数据库中
  const recordedPaths = new Set(images.map(img => img.path));
  
  // 只有在查询所有图片或本地图片时才扫描文件系统
  if (!storageType || storageType === 'local') {
    // 扫描文件系统查找未记录的图片
    const uploadsDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const uploadedFiles = getAllFiles(uploadsDir);
      uploadedFiles.forEach(filePath => {
        const stats = fs.statSync(filePath);
        const relativePath = path.relative(uploadsDir, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        
        // 只添加未在数据库中记录的图片
        if (!recordedPaths.has(normalizedPath)) {
          const filename = path.basename(filePath);
          const imageUrl = `${imageBaseUrl}/i/${normalizedPath}`;
          
          images.push({
            filename: filename,
            path: normalizedPath,
            uploadTime: stats.mtime.toISOString(),
            fileSize: stats.size,
            storage: 'local',
            format: path.extname(filename).substring(1),
            url: imageUrl,
            htmlCode: `<img src="${imageUrl}" alt="${filename}" />`,
            markdownCode: `![${filename}](${imageUrl})`
          });
        }
      });
    }
  }
  
      // 缓存结果到Redis
    if (useCache && redisClient.isEnabled()) {
      await redisClient.cacheImageList(storageType, images);
      console.log('图片列表已缓存到Redis');
    }
  
  return images;
}

/* ---------------- 初始配置相关路由 ---------------- */

// 初始设置页面
app.get('/setup', (req, res) => {
  if (config.auth.isConfigured) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'views', 'setup.html'));
});

// 执行初始设置
app.post('/perform-setup', async (req, res) => {
  if (config.auth.isConfigured) {
    return res.status(400).json({ success: false, message: '系统已经配置过了' });
  }

  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码都是必需的' });
  }

  const salt = generateSalt();
  const hashedPassword = hashPassword(password, salt);

  config.auth.username = username;
  config.auth.hashedPassword = hashedPassword;
  config.auth.salt = salt;
  config.auth.isConfigured = true;

  await saveConfig();
  
  // 自动登录，初始设置完成后默认记住登录状态
  req.session.authenticated = true;
  req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
  console.log('初始设置完成，自动登录并设置 30 天过期时间');
  res.json({ success: true, message: '初始设置完成' });
});

/* ---------------- 登录相关路由 ---------------- */

// 登录页面
app.get('/login', checkInitialSetup, (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// 登录处理
app.post('/login', checkInitialSetup, (req, res) => {
  const { username, password, rememberMe } = req.body;
  const hashedPassword = hashPassword(password, config.auth.salt);
  
  if (username === config.auth.username && hashedPassword === config.auth.hashedPassword) {
    req.session.authenticated = true;
    
    // 根据用户选择设置 session 过期时间
    if (rememberMe) {
      // 记住我：设置 30 天过期时间
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
      console.log('用户选择记住登录，session 过期时间设置为 30 天');
    } else {
      // 不记住：浏览器关闭后过期
      req.session.cookie.maxAge = null;
      console.log('用户未选择记住登录，session 将在浏览器关闭后过期');
    }
    
    return res.json({ success: true });
  } else {
    return res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
});

// 注销
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('注销时销毁 session 出错:', err);
    } else {
      console.log('用户已注销，session 已销毁');
    }
    res.redirect('/login');
  });
});

// 健康检查端点（用于 Docker 健康检查和负载均衡器）
app.get('/api/health', (req, res) => {
  // 基础健康检查：服务器正在运行
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: imageDb.isConnected() ? 'connected' : 'disconnected'
  };

  // 如果数据库未连接，返回 503 状态
  if (!imageDb.isConnected()) {
    return res.status(503).json({
      ...health,
      status: 'unhealthy'
    });
  }

  res.status(200).json(health);
});

// 检查认证状态API
app.get('/api/auth-status', (req, res) => {
  res.json({
    isConfigured: config.auth.isConfigured,
    isAuthenticated: !!req.session.authenticated
  });
});

// 受保护的首页（图床主页面）
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// 调试页面
app.get('/debug', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'debug.html'));
});

// Redis缓存管理页面
app.get('/redis-management', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'redis-management.html'));
});

// HTTPS链接测试页面
app.get('/test-https', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'test-https.html'));
});

/* ---------------- 存储配置相关路由 ---------------- */

// 存储配置页面
app.get('/storage-config', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'storage-config.html'));
});

// 获取存储配置
app.get('/api/storage-config', isAuthenticated, (req, res) => {
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
app.post('/api/storage-config', isAuthenticated, (req, res) => {
  res.status(400).json({ 
    success: false, 
    message: '存储配置需要通过环境变量设置，请更新.env文件并重启服务' 
  });
});

// 调试接口：检查R2配置状态
app.get('/api/debug/r2-status', isAuthenticated, (req, res) => {
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

/* ---------------- Redis缓存相关路由 ---------------- */

// 获取Redis状态信息
app.get('/api/debug/redis-status', isAuthenticated, async (req, res) => {
  try {
    const stats = await redisClient.getStats();
    res.json({
      success: true,
      redis: stats
    });
  } catch (error) {
    console.error('获取Redis状态失败:', error);
    res.status(500).json({ 
      success: false, 
      message: `获取Redis状态失败: ${error.message}` 
    });
  }
});

// 清空Redis缓存
app.post('/api/cache/flush', isAuthenticated, async (req, res) => {
  try {
    const result = await redisClient.flushCache();
    if (result) {
      res.json({
        success: true,
        message: 'Redis缓存已清空'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Redis未启用或清空失败'
      });
    }
  } catch (error) {
    console.error('清空Redis缓存失败:', error);
    res.status(500).json({ 
      success: false, 
      message: `清空Redis缓存失败: ${error.message}` 
    });
  }
});

// 清除图片列表缓存
app.post('/api/cache/invalidate-images', isAuthenticated, async (req, res) => {
  try {
    await redisClient.invalidateImageListCache();
    res.json({
      success: true,
      message: '图片列表缓存已清除'
    });
  } catch (error) {
    console.error('清除图片列表缓存失败:', error);
    res.status(500).json({ 
      success: false, 
      message: `清除图片列表缓存失败: ${error.message}` 
    });
  }
});

// 清除配置缓存
app.post('/api/cache/invalidate-config', isAuthenticated, async (req, res) => {
  try {
    await redisClient.invalidateConfigCache();
    res.json({
      success: true,
      message: '配置缓存已清除'
    });
  } catch (error) {
    console.error('清除配置缓存失败:', error);
    res.status(500).json({ 
      success: false, 
      message: `清除配置缓存失败: ${error.message}` 
    });
  }
});

// Redis内存配置管理
app.post('/api/redis/configure-memory', isAuthenticated, async (req, res) => {
  try {
    const { maxMemory, maxMemoryPolicy } = req.body;
    
    if (!redisClient.isEnabled()) {
      return res.status(400).json({
        success: false,
        message: 'Redis未启用或连接失败'
      });
    }
    
    const results = [];
    
    if (maxMemory) {
      try {
        await redisClient.client.configSet('maxmemory', maxMemory);
        results.push(`最大内存设置为: ${maxMemory}`);
      } catch (error) {
        console.error('设置Redis最大内存失败:', error);
        return res.status(500).json({
          success: false,
          message: `设置最大内存失败: ${error.message}`
        });
      }
    }
    
    if (maxMemoryPolicy) {
      try {
        await redisClient.client.configSet('maxmemory-policy', maxMemoryPolicy);
        results.push(`内存淘汰策略设置为: ${maxMemoryPolicy}`);
      } catch (error) {
        console.error('设置Redis内存策略失败:', error);
        return res.status(500).json({
          success: false,
          message: `设置内存策略失败: ${error.message}`
        });
      }
    }
    
    if (results.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供有效的配置参数'
      });
    }
    
    res.json({
      success: true,
      message: results.join(', ')
    });
  } catch (error) {
    console.error('Redis内存配置失败:', error);
    res.status(500).json({ 
      success: false, 
      message: `Redis内存配置失败: ${error.message}` 
    });
  }
});

// TTL配置管理
app.get('/api/redis/ttl-config', isAuthenticated, async (req, res) => {
  try {
    if (!redisClient.isEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'Redis未启用或连接失败'
      });
    }

    const ttlConfig = redisClient.getTtlConfig();
    
    // 添加调试信息
    const envConfig = {
      imageList: parseInt(process.env.REDIS_IMAGE_LIST_TTL) || null,
      imageInfo: parseInt(process.env.REDIS_IMAGE_INFO_TTL) || null,
      config: parseInt(process.env.REDIS_CONFIG_TTL) || null,
      userSession: parseInt(process.env.REDIS_USER_SESSION_TTL) || null,
      apiCache: parseInt(process.env.REDIS_API_CACHE_TTL) || null,
      statistics: parseInt(process.env.REDIS_STATISTICS_TTL) || null
    };
    
    console.log('当前环境变量TTL配置:', envConfig);
    console.log('当前Redis客户端TTL配置:', ttlConfig);
    
    res.json({
      success: true,
      config: ttlConfig,
      debug: {
        envConfig,
        currentConfig: ttlConfig
      }
    });
  } catch (error) {
    console.error('获取TTL配置失败:', error);
    res.status(500).json({
      success: false,
      message: `获取TTL配置失败: ${error.message}`
    });
  }
});

app.post('/api/redis/ttl-config', isAuthenticated, async (req, res) => {
  try {
    if (!redisClient.isEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'Redis未启用或连接失败'
      });
    }

    const { ttlConfig } = req.body;
    if (!ttlConfig || typeof ttlConfig !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'TTL配置格式不正确'
      });
    }

    const updated = await redisClient.updateTtlConfig(ttlConfig);
    if (updated) {
      res.json({
        success: true,
        message: 'TTL配置已更新',
        config: redisClient.getTtlConfig()
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'TTL配置更新失败，请检查配置格式'
      });
    }
  } catch (error) {
    console.error('更新TTL配置失败:', error);
    res.status(500).json({
      success: false,
      message: `更新TTL配置失败: ${error.message}`
    });
  }
});

// 获取缓存键信息
app.get('/api/redis/cache-info', isAuthenticated, async (req, res) => {
  try {
    if (!redisClient.isEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'Redis未启用或连接失败'
      });
    }

    const cacheInfo = await redisClient.getCacheInfo();
    res.json({
      success: true,
      cacheInfo
    });
  } catch (error) {
    console.error('获取缓存信息失败:', error);
    res.status(500).json({
      success: false,
      message: `获取缓存信息失败: ${error.message}`
    });
  }
});

// 批量更新缓存TTL
app.post('/api/redis/batch-ttl', isAuthenticated, async (req, res) => {
  try {
    if (!redisClient.isEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'Redis未启用或连接失败'
      });
    }

    const { keyTtlPairs } = req.body;
    if (!Array.isArray(keyTtlPairs)) {
      return res.status(400).json({
        success: false,
        message: 'keyTtlPairs必须是数组'
      });
    }

    const result = await redisClient.setTtlBatch(keyTtlPairs);
    if (result) {
      res.json({
        success: true,
        message: `已成功更新${keyTtlPairs.length}个缓存键的TTL`
      });
    } else {
      res.status(500).json({
        success: false,
        message: '批量更新TTL失败'
      });
    }
  } catch (error) {
    console.error('批量更新TTL失败:', error);
    res.status(500).json({
      success: false,
      message: `批量更新TTL失败: ${error.message}`
    });
  }
});

// 重置TTL配置（重新从环境变量加载）
app.post('/api/redis/ttl-config/reset', isAuthenticated, async (req, res) => {
  try {
    if (!redisClient.isEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'Redis未启用或连接失败'
      });
    }

    // 清除缓存的TTL配置
    const configKey = redisClient.generateCacheKey('system', 'ttl-config');
    await redisClient.del(configKey);
    
    // 重新加载TTL配置
    await redisClient.loadTtlConfigFromCache();
    
    res.json({
      success: true,
      message: 'TTL配置已重置，重新从环境变量加载',
      config: redisClient.getTtlConfig()
    });
  } catch (error) {
    console.error('重置TTL配置失败:', error);
    res.status(500).json({
      success: false,
      message: `重置TTL配置失败: ${error.message}`
    });
  }
});

/* ---------------- 系统设置相关路由 ---------------- */

// 系统设置页面
app.get('/settings', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'settings.html'));
});

// 获取系统设置
app.get('/api/settings', isAuthenticated, async (req, res) => {
  try {
    const [imageQuality, imageDomain, domainSecurity, displaySettings] = await Promise.all([
      Promise.resolve(getImageQualityConfig()), // 这个暂时还是同步的
      getImageDomainConfig(),
      getDomainSecurityConfig(),
      getDisplaySettingsConfig()
    ]);

    res.json({
      success: true,
      imageQuality,
      imageDomain,
      domainSecurity,
      displaySettings
    });
  } catch (error) {
    console.error('获取系统设置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取系统设置失败'
    });
  }
});

// 更新系统设置
app.post('/api/settings', isAuthenticated, async (req, res) => {
  try {
    let hasUpdates = false;
    let responseMessage = [];

    // 处理图片域名设置
    if (req.body.imageDomain) {
      const { enabled, domain, httpsOnly, backupDomains } = req.body.imageDomain;
      
      // 验证主域名格式
      if (enabled && domain) {
        const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (!cleanDomain || !/^[a-zA-Z0-9.-]+$/.test(cleanDomain)) {
          return res.status(400).json({ success: false, message: '无效的主图片域名格式' });
        }
      }
      
      // 验证备用域名格式
      if (backupDomains && Array.isArray(backupDomains)) {
        for (const backupDomain of backupDomains) {
          if (backupDomain && typeof backupDomain === 'string') {
            const cleanBackupDomain = backupDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
            if (cleanBackupDomain && !/^[a-zA-Z0-9.-]+$/.test(cleanBackupDomain)) {
              return res.status(400).json({ success: false, message: `无效的备用域名格式: ${backupDomain}` });
            }
          }
        }
      }
      
      // 构建新的图片域名配置
      const newImageDomainConfig = {};
      
      if (enabled !== undefined) {
        newImageDomainConfig.enabled = enabled;
      }
      
      if (domain !== undefined) {
        newImageDomainConfig.domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      }
      
      if (httpsOnly !== undefined) {
        newImageDomainConfig.httpsOnly = httpsOnly;
      }
      
      if (backupDomains !== undefined) {
        // 过滤并清理备用域名列表
        newImageDomainConfig.backupDomains = Array.isArray(backupDomains) ? 
          backupDomains
            .filter(domain => domain && typeof domain === 'string' && domain.trim() !== '')
            .map(domain => domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')) : [];
      }
      
      // 保存到数据库
      try {
        await imageDb.setSetting('imageDomain', newImageDomainConfig, '图片域名配置');
        console.log('图片域名配置已保存到数据库:', newImageDomainConfig);
      } catch (dbError) {
        console.warn('保存图片域名配置到数据库失败，回退到配置文件:', dbError.message);
        
        // 回退到配置文件保存
        if (!config.imageDomain) {
          config.imageDomain = {};
        }
        Object.assign(config.imageDomain, newImageDomainConfig);
      }
      
      hasUpdates = true;
      responseMessage.push('图片域名设置已更新');
    }

    // 处理图片质量设置
    if (req.body.imageQuality) {
      // 验证图片质量参数是否有效
      const { webp, avif, pngOptimize } = req.body.imageQuality;
      
      // 验证webp和avif质量值
      if (webp !== undefined && (isNaN(webp) || webp < 0 || webp > 100)) {
        return res.status(400).json({ success: false, message: 'WebP质量值必须在0-100之间' });
      }
      
      if (avif !== undefined && (isNaN(avif) || avif < 0 || avif > 100)) {
        return res.status(400).json({ success: false, message: 'AVIF质量值必须在0-100之间' });
      }
      
      // 更新配置
      if (!config.imageQuality) {
        config.imageQuality = {};
      }
      
      if (webp !== undefined) {
        config.imageQuality.webp = webp;
      }
      
      if (avif !== undefined) {
        config.imageQuality.avif = avif;
      }
      
      if (pngOptimize !== undefined) {
        config.imageQuality.pngOptimize = pngOptimize;
      }
      
      hasUpdates = true;
      responseMessage.push('图片质量设置已更新');
    }

    // 处理域名安全设置
    if (req.body.domainSecurity) {
      const { enabled, allowedDomains, redirectToMain, mainDomain } = req.body.domainSecurity;
      
      // 验证域名格式
      if (enabled && allowedDomains && Array.isArray(allowedDomains)) {
        for (const domain of allowedDomains) {
          if (typeof domain !== 'string' || domain.trim() === '') {
            return res.status(400).json({ success: false, message: '域名不能为空' });
          }
          
          const cleanDomain = domain.trim().toLowerCase();
          // 基本域名格式验证（支持通配符）
          if (!cleanDomain.match(/^(\*\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) && !cleanDomain.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) && !cleanDomain.match(/^localhost$/) && !cleanDomain.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            return res.status(400).json({ success: false, message: `无效的域名格式: ${domain}` });
          }
        }
      }
      
      // 验证主域名格式
      if (mainDomain && typeof mainDomain === 'string' && mainDomain.trim() !== '') {
        const cleanMainDomain = mainDomain.trim().toLowerCase();
        if (!cleanMainDomain.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) && !cleanMainDomain.match(/^localhost$/) && !cleanMainDomain.match(/^\d+\.\d+\.\d+\.\d+$/)) {
          return res.status(400).json({ success: false, message: `无效的主域名格式: ${mainDomain}` });
        }
      }
      
      // 构建新的域名安全配置
      const newDomainSecurityConfig = {};
      
      if (enabled !== undefined) {
        newDomainSecurityConfig.enabled = enabled;
      }
      
      if (allowedDomains !== undefined) {
        newDomainSecurityConfig.allowedDomains = Array.isArray(allowedDomains) ? 
          allowedDomains.map(d => d.trim().toLowerCase()).filter(d => d !== '') : [];
      }
      
      if (redirectToMain !== undefined) {
        newDomainSecurityConfig.redirectToMain = redirectToMain;
      }
      
      if (mainDomain !== undefined) {
        newDomainSecurityConfig.mainDomain = mainDomain ? mainDomain.trim().toLowerCase() : '';
      }
      
      // 保存到数据库
      try {
        await imageDb.setSetting('domainSecurity', newDomainSecurityConfig, '域名安全配置');
        console.log('域名安全配置已保存到数据库:', newDomainSecurityConfig);
      } catch (dbError) {
        console.warn('保存域名安全配置到数据库失败，回退到配置文件:', dbError.message);
        
        // 回退到配置文件保存
        if (!config.domainSecurity) {
          config.domainSecurity = {};
        }
        Object.assign(config.domainSecurity, newDomainSecurityConfig);
      }
      
      hasUpdates = true;
      responseMessage.push('域名安全设置已更新');
    }

    // 处理显示设置
    if (req.body.displaySettings) {
      const { showRecentUploads } = req.body.displaySettings;

      // 构建新的显示设置配置
      const newDisplaySettings = {};

      if (showRecentUploads !== undefined) {
        newDisplaySettings.showRecentUploads = showRecentUploads;
      }

      // 保存到数据库
      try {
        await imageDb.setSetting('displaySettings', newDisplaySettings, '显示设置');
        console.log('显示设置已保存到数据库:', newDisplaySettings);
      } catch (dbError) {
        console.warn('保存显示设置到数据库失败，回退到配置文件:', dbError.message);

        // 回退到配置文件保存
        if (!config.displaySettings) {
          config.displaySettings = {};
        }
        Object.assign(config.displaySettings, newDisplaySettings);
      }

      hasUpdates = true;
      responseMessage.push('显示设置已更新');
    }

    if (hasUpdates) {
      // 保存到配置文件（作为备份）
      await saveConfig();
      
      // 清除Redis缓存（如果启用）
      if (redisClient.isEnabled()) {
        redisClient.invalidateConfigCache();
      }
      
      console.log('系统设置已更新');
      
      // 重新获取最新的配置返回给前端
      const [imageQuality, imageDomain, domainSecurity, displaySettings] = await Promise.all([
        Promise.resolve(getImageQualityConfig()), // 这个暂时还是同步的
        getImageDomainConfig(),
        getDomainSecurityConfig(),
        getDisplaySettingsConfig()
      ]);

      return res.json({
        success: true,
        message: responseMessage.join('，'),
        imageQuality,
        imageDomain,
        domainSecurity,
        displaySettings
      });
    }
    
    return res.status(400).json({ 
      success: false, 
      message: '未提供有效的设置数据' 
    });
  } catch (error) {
    console.error('更新设置失败:', error);
    return res.status(500).json({ 
      success: false, 
      message: '更新设置失败，服务器错误' 
    });
  }
});

// 强制迁移所有图片URL到新域名（可选功能）
app.post('/api/migrate-image-urls', isAuthenticated, async (req, res) => {
  try {
    const { forceUpdate } = req.body;
    
    if (!forceUpdate) {
      return res.status(400).json({
        success: false,
        message: '请确认要强制更新所有图片的域名。此操作将覆盖所有现有图片的URL。'
      });
    }
    
    const imageBaseUrl = await getImageBaseUrl(req);
    
    // 获取所有图片记录
    const images = await imageDb.getAllImages();
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const image of images) {
      try {
        const newImageUrl = `${imageBaseUrl}/i/${image.path}`;
        const newHtmlCode = `<img src="${newImageUrl}" alt="${image.filename}" />`;
        const newMarkdownCode = `![${image.filename}](${newImageUrl})`;
        
        // 更新数据库中的URL
        await imageDb.updateImageUrls(image._id, newImageUrl, newHtmlCode, newMarkdownCode);
        updatedCount++;
      } catch (error) {
        console.error(`更新图片 ${image.filename} 的URL失败:`, error);
        errorCount++;
      }
    }
    
    // 清除Redis缓存
    if (redisClient.isEnabled()) {
      await redisClient.invalidateImageListCache();
    }
    
    let message = `图片URL强制迁移完成！成功更新 ${updatedCount} 张图片的URL`;
    if (errorCount > 0) {
      message += `，${errorCount} 张图片更新失败`;
    }
    
    res.json({
      success: true,
      message: message,
      updatedCount: updatedCount,
      errorCount: errorCount,
      newBaseUrl: imageBaseUrl
    });
  } catch (error) {
    console.error('强制迁移图片URL失败:', error);
    res.status(500).json({ 
      success: false, 
      message: `强制迁移图片URL失败: ${error.message}` 
    });
  }
});

// 获取默认分类设置
app.get('/api/settings/defaultCategory', (req, res) => {
  try {
    // 从配置文件中获取默认分类设置
    const defaultCategoryId = config.defaultCategory || '';
    
    res.json({
      success: true,
      defaultCategoryId: defaultCategoryId
    });
  } catch (error) {
    console.error('获取默认分类设置失败:', error);
    res.status(500).json({
      success: false,
      error: '获取默认分类设置失败'
    });
  }
});

// 保存默认分类设置
app.post('/api/settings/defaultCategory', isAuthenticated, async (req, res) => {
  try {
    const { defaultCategoryId } = req.body;
    
    // 限制只能保存空设置、'all'或'uncategorized'作为默认分类
    if (defaultCategoryId && defaultCategoryId !== 'all' && defaultCategoryId !== 'uncategorized') {
      return res.status(400).json({
        success: false,
        error: '只能设置为空、全部图片或未分类作为默认分类'
      });
    }
    
    // 保存到配置对象
    config.defaultCategory = defaultCategoryId;
    
    // 保存到配置文件
    await saveConfig();
    
    console.log('已设置默认分类:', defaultCategoryId);
    
    res.json({
      success: true,
      message: '默认分类设置已保存'
    });
  } catch (error) {
    console.error('保存默认分类设置失败:', error);
    res.status(500).json({
      success: false,
      error: '保存默认分类设置失败'
    });
  }
});

/* ---------------- API管理相关路由 ---------------- */

// API管理页面
app.get('/api-management', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'api-management.html'));
});

// 获取所有API令牌
app.get('/api/tokens', isAuthenticated, async (req, res) => {
  try {
    // 简化逻辑：直接使用内存中的配置
    // saveConfig() 已经确保配置同步到Redis和文件
    res.json({
      success: true, 
      enabled: config.api.enabled,
      tokens: config.api.tokens,
      defaultFormat: config.api.defaultFormat
    });
  } catch (error) {
    console.error('获取API设置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取API设置失败'
    });
  }
});

// 切换API启用状态
app.post('/api/toggle', isAuthenticated, async (req, res) => {
  try {
    config.api.enabled = !config.api.enabled;
    await saveConfig();
    
    res.json({
      success: true, 
      enabled: config.api.enabled
    });
  } catch (error) {
    console.error('切换API状态失败:', error);
    res.status(500).json({
      success: false,
      message: '保存设置失败'
    });
  }
});

// 设置API默认格式
app.post('/api/format', isAuthenticated, async (req, res) => {
  try {
    const { format } = req.body;
    
    if (!['original', 'webp', 'avif'].includes(format)) {
      return res.status(400).json({ 
        success: false, 
        message: '无效的格式选项' 
      });
    }
    
    config.api.defaultFormat = format;
    await saveConfig();
    
    res.json({
      success: true,
      format: format
    });
  } catch (error) {
    console.error('设置API格式失败:', error);
    res.status(500).json({
      success: false,
      message: '保存设置失败'
    });
  }
});

// 创建新的API令牌
app.post('/api/tokens', isAuthenticated, async (req, res) => {
  try {
    const { name, expiresAt } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '令牌名称不能为空' });
    }
    
    const newToken = {
      id: Date.now().toString(),
      name: name,
      token: generateToken(),
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt || null
    };
    
    config.api.tokens.push(newToken);
    await saveConfig();
    
    res.json({
      success: true,
      token: newToken
    });
  } catch (error) {
    console.error('创建API令牌失败:', error);
    res.status(500).json({
      success: false,
      message: '保存令牌失败'
    });
  }
});

// 删除API令牌
app.delete('/api/tokens/:id', isAuthenticated, async (req, res) => {
  try {
    const tokenId = req.params.id;
    const tokenIndex = config.api.tokens.findIndex(t => t.id === tokenId);
    
    if (tokenIndex === -1) {
      return res.status(404).json({ success: false, message: '找不到指定的令牌' });
    }
    
    config.api.tokens.splice(tokenIndex, 1);
    await saveConfig();
    
    res.json({
      success: true,
      message: '令牌已成功删除'
    });
  } catch (error) {
    console.error('删除API令牌失败:', error);
    res.status(500).json({
      success: false,
      message: '删除令牌失败'
    });
  }
});

/* ---------------- 上传与图片接口（需登录） ---------------- */

// 上传接口：处理图片上传、存储位置及格式转换，同时自动重命名，并在文件名上增加三位数的上传顺序定位
app.post('/upload', isAuthenticated, upload.array('images'), async (req, res) => {
  const requestStartTime = Date.now();
  
  try {
    // format: "original", "webp", "avif"，默认 original
    const formatOption = req.body.format || 'original';
    
    let resultImages = [];
    // 获取年月日文件夹路径及基本 URL
    const yearMonthPath = getYearMonthPath();
    const baseUrl = getBaseUrl(req);
    const imageBaseUrl = await getImageBaseUrl(req);
    // 设置相同的上传时间，确保同一批次上传的文件时间一致
    const uploadTime = new Date();
    
    // 遍历每个上传文件，使用上传列表中的顺序生成三位数定位
    // 由于前端已从后往前传输文件，这里需要反向计算orderIndex以保持正确的文件名顺序
    // 为确保数据库存储顺序与本地显示顺序一致，我们从后往前处理（最后一张先处理并存储）
    for (let i = req.files.length - 1; i >= 0; i--) {
      const file = req.files[i];
      const orderIndex = (req.files.length - i).toString().padStart(3, '0');
      const ext = path.extname(file.originalname).toLowerCase();
      let outputFormat = '';
      let outputFilename = '';
      let fileBuffer = file.buffer;
      
      // 自动重命名：使用 16 位随机十六进制字符串作为文件名，再加上三位数定位
      const uniqueId = crypto.randomBytes(8).toString('hex');
      
      // 获取原始格式
      const originalFormat = ext.replace('.', '').toLowerCase();
      
      // 根据上传选项进行图片格式转换与重命名
      if (formatOption === 'webp') {
        outputFormat = 'webp';
        outputFilename = uniqueId + orderIndex + '.webp';
        // 只有当原始格式不是webp时才进行转换
        if (originalFormat !== 'webp') {
          const quality = getImageQualityConfig().webp;
          fileBuffer = await sharp(file.buffer).toFormat('webp', { quality }).toBuffer();
        }
      } else if (formatOption === 'avif') {
        outputFormat = 'avif';
        outputFilename = uniqueId + orderIndex + '.avif';
        // 只有当原始格式不是avif时才进行转换
        if (originalFormat !== 'avif') {
          const quality = getImageQualityConfig().avif;
          fileBuffer = await sharp(file.buffer).toFormat('avif', { quality }).toBuffer();
        }
      } else {
        // 保持原始格式，但可能需要优化
        outputFormat = originalFormat;
        outputFilename = uniqueId + orderIndex + ext;
        
        // 对于PNG格式，应用优化设置
        if (originalFormat === 'png' && getImageQualityConfig().pngOptimize) {
          fileBuffer = await sharp(file.buffer).png({ 
            compressionLevel: 6,  // 0-9，6是一个好的平衡点
            adaptiveFiltering: true,
            palette: true  // 尝试使用调色板模式以减小文件大小
          }).toBuffer();
        }
        // 其他格式保持原样，不进行处理
      }
      
      let imageUrl = '';
      let storage = 'local';
      let relativePath = path.join(yearMonthPath, outputFilename);

      // 检查是否使用R2存储
      const storageConfig = getStorageConfig();
      if (storageConfig.type === 'r2' && storageConfig.r2.enabled && r2Client) {
        console.log(`尝试使用R2存储上传文件: ${outputFilename}`);
        console.log(`当前存储配置:`, {
          type: storageConfig.type,
          r2Enabled: storageConfig.r2.enabled,
          hasR2Client: !!r2Client,
          bucket: storageConfig.r2.bucket,
          endpoint: storageConfig.r2.endpoint
        });
        
        try {
          const r2Path = relativePath.replace(/\\/g, '/'); // 确保使用正斜杠
          console.log(`R2文件路径: ${r2Path}`);
          imageUrl = await uploadToR2(fileBuffer, r2Path);
          storage = 'r2';
          console.log(`R2上传成功，图片URL: ${imageUrl}`);
        } catch (r2Error) {
          console.error('R2上传失败，回退到本地存储:', r2Error);
          console.error('错误详情:', r2Error.message);
          console.error('错误堆栈:', r2Error.stack);
          
          // 回退到本地存储
          const uploadDir = path.join(__dirname, 'uploads', yearMonthPath);
          ensureDirExistence(uploadDir);
          const destination = path.join(uploadDir, outputFilename);
          fs.writeFileSync(destination, fileBuffer);
          fs.utimesSync(destination, uploadTime, uploadTime);
          const urlPath = relativePath.replace(/\\/g, '/');
          imageUrl = `${imageBaseUrl}/i/${urlPath}`;
          console.log(`回退到本地存储成功，图片URL: ${imageUrl}`);
        }
      } else {
        console.log('使用本地存储');
        console.log(`存储配置检查:`, {
          storageType: storageConfig.type,
          r2Enabled: storageConfig.r2.enabled,
          hasR2Client: !!r2Client
        });
        
        // 存储到uploads目录
        const uploadDir = path.join(__dirname, 'uploads', yearMonthPath);
        ensureDirExistence(uploadDir);
        const destination = path.join(uploadDir, outputFilename);
        fs.writeFileSync(destination, fileBuffer);
        fs.utimesSync(destination, uploadTime, uploadTime);
        const urlPath = relativePath.replace(/\\/g, '/');
        imageUrl = `${imageBaseUrl}/i/${urlPath}`;
        console.log(`本地存储成功，图片URL: ${imageUrl}`);
      }
      
      // 获取文件大小信息
      const fileSize = fileBuffer.length;
      
      const imageData = {
        filename: outputFilename,
        path: relativePath.replace(/\\/g, '/'),
        uploadTime: uploadTime.toISOString(),
        fileSize: fileSize,
        storage: storage,
        format: outputFormat,
        url: imageUrl,
        htmlCode: `<img src="${imageUrl}" alt="${outputFilename}" />`,
        markdownCode: `![](${imageUrl})`
      };
      
      // 添加到图片记录
      await addImageRecord(imageData);
      
      resultImages.push({
        ...imageData,
        uploadTime: uploadTime.toLocaleString() // 返回本地化的时间字符串
      });
    }
    
    // 反转结果数组顺序，确保返回顺序与本地显示顺序一致（第一张在前，最后一张在后）
    resultImages.reverse();

    // 清除文件系统缓存，因为有新文件上传
    invalidateFileSystemCache();

    res.json({
      success: true,
      images: resultImages
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------------- API上传接口 ---------------- */

// API上传接口：处理图片上传，并将图片存储在api专用目录中
app.post('/api/upload', apiAuthenticated, upload.array('images'), async (req, res) => {
  try {
    // 优先使用请求中指定的格式，如果没有则使用默认格式设置
    const formatOption = req.query.format || config.api.defaultFormat || 'original';
    
    // 获取存储策略参数，支持通过API参数指定存储方式
    // 可选值: 'r2', 'local', 'auto'(跟随全局设置)
    const storageParam = req.query.storage || req.body.storage || 'auto';
    
    // 获取"api上传"分类ID，如果不存在则创建
    let apiUploadCategoryId = null;
    try {
      apiUploadCategoryId = await imageDb.ensureApiUploadCategory();
      console.log('API上传使用的分类ID:', apiUploadCategoryId);
    } catch (catError) {
      console.error('获取API上传分类失败:', catError);
      // 继续执行，只是不会设置分类
    }
    
    let resultImages = [];
    // 获取年月日文件夹路径及基本 URL
    const yearMonthPath = path.join('api', getYearMonthPath());
    const baseUrl = getBaseUrl(req);
    const imageBaseUrl = await getImageBaseUrl(req);
    // 设置相同的上传时间，确保同一批次上传的文件时间一致
    const uploadTime = new Date();
    
    // 遍历每个上传文件，使用上传列表中的顺序生成三位数定位
    // 由于前端已从后往前传输文件，这里需要反向计算orderIndex以保持正确的文件名顺序
    // 为确保数据库存储顺序与本地显示顺序一致，我们从后往前处理（最后一张先处理并存储）
    for (let i = req.files.length - 1; i >= 0; i--) {
      const file = req.files[i];
      const orderIndex = (req.files.length - i).toString().padStart(3, '0');
      const ext = path.extname(file.originalname).toLowerCase();
      let outputFormat = '';
      let outputFilename = '';
      let fileBuffer = file.buffer;
      
      // 自动重命名：使用 16 位随机十六进制字符串作为文件名，再加上三位数定位
      const uniqueId = crypto.randomBytes(8).toString('hex');
      
      // 获取原始格式
      const originalFormat = ext.replace('.', '').toLowerCase();
      
      // 根据上传选项进行图片格式转换与重命名
      if (formatOption === 'webp') {
        outputFormat = 'webp';
        outputFilename = uniqueId + orderIndex + '.webp';
        // 只有当原始格式不是webp时才进行转换
        if (originalFormat !== 'webp') {
          const quality = getImageQualityConfig().webp;
          fileBuffer = await sharp(file.buffer).toFormat('webp', { quality }).toBuffer();
        }
      } else if (formatOption === 'avif') {
        outputFormat = 'avif';
        outputFilename = uniqueId + orderIndex + '.avif';
        // 只有当原始格式不是avif时才进行转换
        if (originalFormat !== 'avif') {
          const quality = getImageQualityConfig().avif;
          fileBuffer = await sharp(file.buffer).toFormat('avif', { quality }).toBuffer();
        }
      } else {
        // 保持原始格式，但可能需要优化
        outputFormat = originalFormat;
        outputFilename = uniqueId + orderIndex + ext;
        
        // 对于PNG格式，应用优化设置
        if (originalFormat === 'png' && getImageQualityConfig().pngOptimize) {
          fileBuffer = await sharp(file.buffer).png({ 
            compressionLevel: 6,  // 0-9，6是一个好的平衡点
            adaptiveFiltering: true,
            palette: true  // 尝试使用调色板模式以减小文件大小
          }).toBuffer();
        }
        // 其他格式保持原样，不进行处理
      }
      
      let imageUrl = '';
      let storage = 'local';
      let relativePath = path.join(yearMonthPath, outputFilename);

      // 决定使用哪种存储策略
      let shouldUseR2 = false;
      let storageError = null;
      
      if (storageParam === 'r2') {
        // 强制使用R2存储，检查R2是否可用
        shouldUseR2 = true;
        if (!isR2Available()) {
          storageError = 'R2存储不可用：请检查R2配置或联系管理员';
        }
      } else if (storageParam === 'local') {
        // 强制使用本地存储
        shouldUseR2 = false;
      } else {
        // auto: 跟随全局配置
        shouldUseR2 = getStorageConfig().type === 'r2' && isR2Available();
      }

      // 如果指定了R2存储但不可用，返回错误
      if (storageParam === 'r2' && storageError) {
        throw new Error(storageError);
      }

      // 检查是否使用R2存储
      if (shouldUseR2 && isR2Available()) {
        try {
          const r2Path = relativePath.replace(/\\/g, '/'); // 确保使用正斜杠
          imageUrl = await uploadToR2(fileBuffer, r2Path);
          storage = 'r2';
          console.log(`API上传成功使用R2存储: ${r2Path}`);
        } catch (r2Error) {
          console.error('R2上传失败:', r2Error);
          
          // 如果是强制使用R2存储，不回退到本地存储
          if (storageParam === 'r2') {
            throw new Error(`R2上传失败: ${r2Error.message}`);
          }
          
          // 否则回退到本地存储
          console.log('回退到本地存储');
          const uploadDir = path.join(__dirname, 'uploads', yearMonthPath);
          ensureDirExistence(uploadDir);
          const destination = path.join(uploadDir, outputFilename);
          fs.writeFileSync(destination, fileBuffer);
          fs.utimesSync(destination, uploadTime, uploadTime);
          const urlPath = relativePath.replace(/\\/g, '/');
          imageUrl = `${imageBaseUrl}/i/${urlPath}`;
          console.log(`API上传回退到本地存储: ${urlPath}`);
        }
      } else {
        // 存储到api/uploads目录
        const uploadDir = path.join(__dirname, 'uploads', yearMonthPath);
        ensureDirExistence(uploadDir);
        const destination = path.join(uploadDir, outputFilename);
        fs.writeFileSync(destination, fileBuffer);
        fs.utimesSync(destination, uploadTime, uploadTime);
        const urlPath = relativePath.replace(/\\/g, '/');
        imageUrl = `${imageBaseUrl}/i/${urlPath}`;
        console.log(`API上传使用本地存储: ${urlPath}`);
      }
      
      // 获取文件大小信息
      const fileSize = fileBuffer.length;
      
      const imageData = {
        filename: outputFilename,
        path: relativePath.replace(/\\/g, '/'),
        uploadTime: uploadTime.toISOString(),
        fileSize: fileSize,
        storage: storage,
        format: outputFormat,
        url: imageUrl,
        htmlCode: `<img src="${imageUrl}" alt="${outputFilename}" />`,
        markdownCode: `![](${imageUrl})`,
        categoryId: apiUploadCategoryId // 设置分类为"api上传"
      };
      
      // 添加到图片记录
      await addImageRecord(imageData);
      
      resultImages.push({
        ...imageData,
        uploadTime: uploadTime.toLocaleString() // 返回本地化的时间字符串
      });
    }
    
    // 反转结果数组顺序，确保返回顺序与本地显示顺序一致（第一张在前，最后一张在后）
    resultImages.reverse();

    // 清除文件系统缓存，因为有新文件上传
    invalidateFileSystemCache();

    // 根据PicGo等客户端的需求，返回不同格式的响应
    if (req.query.picgo === 'true') {
      // PicGo兼容格式
      return res.json({
        success: true,
        result: resultImages.map(img => img.url)
      });
    }

    res.json({
      success: true,
      images: resultImages
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 接口：获取所有图片（支持limit参数和存储类型过滤，带Redis缓存）
app.get('/images', isAuthenticated, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const storageType = req.query.storage; // 可以是 'local', 'r2', 或不设置（获取所有）
    const useCache = req.query.cache !== 'false'; // 允许禁用缓存
    
    // 合并数据库记录和文件系统中的图片
    let images = await mergeImagesFromDbAndFileSystem(req, storageType, useCache);
    
    // 按上传时间排序（最新的在前），对于相同时间的图片按ID升序排序（确保同一批次的顺序正确）
    images.sort((a, b) => {
      const dateA = new Date(a.uploadTime);
      const dateB = new Date(b.uploadTime);
      if (dateB.getTime() !== dateA.getTime()) {
        return dateB - dateA;
      }
      // 相同时间的情况下，按ID升序排序（较小ID先显示）
      return (a._id || 0) - (b._id || 0);
    });
    
    if (limit > 0) {
      images = images.slice(0, limit);
    }
    
    // 转换时间格式为本地化字符串
    images = images.map(img => ({
      ...img,
      uploadTime: new Date(img.uploadTime).toLocaleString()
    }));
    
    res.json({ 
      success: true, 
      images: images,
      cached: useCache && redisClient.isEnabled()
    });
  } catch (error) {
    console.error('获取图片列表失败:', error);
    res.status(500).json({ success: false, message: `获取图片列表失败: ${error.message}` });
  }
});

// 分页获取图片（支持存储类型过滤）
app.get('/images/paged', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const storageType = req.query.storage || null;
    
    const result = await imageDb.getImagesPaged(page, limit, storageType);
    
    res.json({
      success: true,
      images: result.images,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('分页获取图片失败:', error);
    res.status(500).json({ success: false, message: `获取图片列表失败: ${error.message}` });
  }
});

// 获取图片存储统计信息
app.get('/api/storage-stats', isAuthenticated, async (req, res) => {
  try {
    // 使用PostgreSQL获取统计信息，性能更好
    const stats = await imageDb.getStorageStats();
    // 获取存储空间使用（字节）
    let sizeStats = { total: 0, local: 0, r2: 0 };
    try {
      sizeStats = await imageDb.getStorageUsage();
    } catch (sizeErr) {
      console.warn('获取存储空间使用情况失败:', sizeErr.message);
    }
    
    // 检查文件系统中未记录的图片
    const images = await imageDb.getAllImages();
    const recordedPaths = new Set(images.map(img => img.path));
    
    const uploadsDir = path.join(__dirname, 'uploads');
    let unrecordedCount = 0;
    let unrecordedSize = 0;
    
    if (fs.existsSync(uploadsDir)) {
      const uploadedFiles = getAllFiles(uploadsDir);
      unrecordedCount = uploadedFiles.filter(filePath => {
        const relativePath = path.relative(uploadsDir, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        return !recordedPaths.has(normalizedPath);
      }).length;
      
      // 计算未记录文件大小
      unrecordedSize = uploadedFiles.reduce((acc, filePath) => {
        const relativePath = path.relative(uploadsDir, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        if (!recordedPaths.has(normalizedPath)) {
          try {
            const { size } = fs.statSync(filePath);
            return acc + size;
          } catch (_) {
            return acc;
          }
        }
        return acc;
      }, 0);
    }
    
    // 更新统计信息包含未记录的图片
    const finalStats = {
      total: stats.total + unrecordedCount,
      local: stats.local + unrecordedCount, // 文件系统中的图片都是本地存储
      r2: stats.r2
    };
    
    // 更新空间使用信息（字节）
    const finalSizes = {
      total: sizeStats.total + unrecordedSize,
      local: sizeStats.local + unrecordedSize,
      r2: sizeStats.r2
    };
    
    res.json({
      success: true,
      stats: finalStats,
      sizes: finalSizes,
      // 为向后兼容保留旧字段
      totalImages: finalStats.total,
      totalSize: finalSizes.total
    });
  } catch (error) {
    console.error('获取存储统计失败:', error);
    res.status(500).json({ success: false, message: `获取存储统计失败: ${error.message}` });
  }
});

// 图片库页面路由
app.get('/gallery', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'gallery.html'));
});

// 迁移工具页面路由
app.get('/migrate', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'migrate.html'));
});

// 管理中心页面
app.get('/admin-center', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-center.html'));
});

// 系统状态API
app.get('/api/system-status', isAuthenticated, async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    
    // 统计PostgreSQL数据库中的图片记录
    const dbStatus = await imageDb.getStatus();
    const dbImageCount = dbStatus.dbImageCount;
    
    // 统计文件系统中的图片
    let fsImageCount = 0;
    const uploadsDir = path.join(__dirname, 'uploads');
    
    if (fs.existsSync(uploadsDir)) {
      const uploadedFiles = getAllFiles(uploadsDir);
      fsImageCount = uploadedFiles.length;
    }
    
    // 计算需要迁移的图片数量
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

/* ---------------- 图片删除API ---------------- */

// 删除图片API（支持单张或多张删除）
app.post('/api/delete', isAuthenticated, async (req, res) => {
  try {
    let images = req.body.images;
    if (!Array.isArray(images)) {
      return res.status(400).json({ success: false, message: '无效的请求格式.' });
    }
    
    for (let image of images) {
      if (!image.storage || !image.path) continue;
      
      if (image.storage === 'local') {
        const filePath = path.join(__dirname, 'uploads', image.path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        } else {
          console.warn("文件不存在: ", filePath);
        }
      } else if (image.storage === 'r2') {
        try {
          await deleteFromR2(image.path);
          console.log("R2文件已删除: ", image.path);
        } catch (error) {
          console.error("R2文件删除失败: ", image.path, error);
        }
      }
      
      // 从图片记录中删除
      await removeImageRecord(image.path);
    }
    
    // 在删除图片后清理空文件夹
    cleanEmptyDirs(path.join(__dirname, 'uploads'));

    // 清除文件系统缓存，因为有文件被删除
    invalidateFileSystemCache();

    res.json({ success: true, message: '图片删除成功.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 测试R2连接
app.post('/api/test-r2', isAuthenticated, async (req, res) => {
  try {
          if (!getStorageConfig().r2.enabled) {
      return res.status(400).json({ success: false, message: 'R2存储未启用' });
    }
    
    if (!r2Client) {
      return res.status(400).json({ success: false, message: 'R2客户端未初始化，请检查配置' });
    }
    
    // 创建一个测试文件
    const testFilename = `test-${Date.now()}.txt`;
    const testBuffer = Buffer.from('This is a test file for R2 connection');
    
    console.log(`开始R2连接测试，上传文件: ${testFilename}`);
    await uploadToR2(testBuffer, testFilename);
    
    // 测试完成后删除测试文件
    try {
      await deleteFromR2(testFilename);
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

// 迁移现有图片到数据库记录
app.post('/api/migrate-images', isAuthenticated, async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const imageBaseUrl = await getImageBaseUrl(req);
    
    // 创建一个路径集合，用于检查哪些文件已经在数据库中
    const images = await imageDb.getAllImages();
    const recordedPaths = new Set(images.map(img => img.path));
    
    let migratedCount = 0;
    let errorCount = 0;
    const uploadsDir = path.join(__dirname, 'uploads');
    
    if (fs.existsSync(uploadsDir)) {
      const uploadedFiles = getAllFiles(uploadsDir);
      
      // 准备批量插入的数据
      const imagesToMigrate = [];
      
      uploadedFiles.forEach(filePath => {
        const stats = fs.statSync(filePath);
        const relativePath = path.relative(uploadsDir, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        
        // 只添加未在数据库中记录的图片
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
      
      // 批量添加到PostgreSQL数据库
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

    // 清除文件系统缓存，因为图片迁移操作可能影响文件系统状态
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

// 数据库备份API - 将PostgreSQL数据导出为SQL
app.post('/api/backup-database', isAuthenticated, async (req, res) => {
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
      // 向后兼容：支持JSON格式备份
      const backupPath = path.join(__dirname, `images_backup_${Date.now()}.json`);
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

// 手动导入JSON数据到PostgreSQL
app.post('/api/import-json', isAuthenticated, async (req, res) => {
  try {
    const jsonPath = path.join(__dirname, 'images.json');
    
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

// 数据库状态详情API
app.get('/api/database-status', isAuthenticated, async (req, res) => {
  try {
    const status = await imageDb.getStatusWithConfig();
    const stats = await imageDb.getStorageStats();
    
    // 增强状态信息
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

// SQLite 自动检测导入 API
app.post('/api/sqlite-auto-import', isAuthenticated, async (req, res) => {
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

// 获取备份文件列表API
app.get('/api/backup-files', isAuthenticated, async (req, res) => {
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

// SQL文件恢复API
app.post('/api/restore-from-sql', isAuthenticated, async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ success: false, message: '请指定要恢复的SQL文件' });
    }

    const backupDir = path.join(__dirname, 'backups');
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

// 上传SQL文件恢复API
app.post('/api/upload-sql-restore', isAuthenticated, multer({ dest: 'temp/' }).single('sqlFile'), async (req, res) => {
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
    // 清理临时文件
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

// 自动备份设置API
app.post('/api/auto-backup-settings', isAuthenticated, async (req, res) => {
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

// SQLite 文件上传导入 API
app.post('/api/sqlite-upload-import', isAuthenticated, multer({ dest: 'temp/' }).single('sqliteFile'), async (req, res) => {
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
      // JSON 文件导入
      try {
        result = await imageDb.importFromJson(tempFilePath);
        result.message = `JSON 文件导入完成！导入 ${result.imported} 条记录${result.skipped > 0 ? `，跳过 ${result.skipped} 条重复记录` : ''}${result.errors > 0 ? `，${result.errors} 条记录导入失败` : ''}。`;
      } catch (error) {
        throw new Error(`JSON 文件格式错误: ${error.message}`);
      }
    } else if (fileExt === '.db') {
      // SQLite 数据库文件导入
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
    // 清理临时文件
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

// Performance monitoring endpoint (development/debugging)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/performance', isAuthenticated, (req, res) => {
    const memUsage = process.memoryUsage();
    const avgProcessingTime = performanceMetrics.processingTime.length > 0 
      ? performanceMetrics.processingTime.reduce((a, b) => a + b, 0) / performanceMetrics.processingTime.length 
      : 0;
    
    res.json({
      success: true,
      metrics: {
        uploadCount: performanceMetrics.uploadCount,
        averageProcessingTime: Math.round(avgProcessingTime),
        memoryUsage: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
          external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
          rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
        },
        uptime: Math.round(process.uptime()),
        lastCleanup: new Date(performanceMetrics.lastCleanup).toLocaleString(),
        fileSystemCache: {
          lastScan: fileSystemCache.lastScan ? new Date(fileSystemCache.lastScan).toLocaleString() : 'Never',
          filesCount: fileSystemCache.files.length,
          cacheAge: fileSystemCache.lastScan ? Date.now() - fileSystemCache.lastScan : 0
        }
      }
    });
  });
}

// 安全启动服务器
const server = app.listen(port, (err) => {
  if (err) {
    console.error('服务器启动失败:', err);
    process.exit(1);
  }
  
  console.log(`✅ Server successfully started on port ${port}`);
  console.log('🚀 Performance optimizations status:');
  console.log(`   - Concurrent image processing: ✅`);
  console.log(`   - File system caching: ✅`);
  console.log(`   - Database connection pooling: ✅`);
  console.log(`   - Response compression: ${compression ? '✅' : '⚠️  Not available'}`);
  console.log(`   - Memory monitoring: ✅`);
  console.log(`   - Sharp optimization: ✅`);
  console.log('');
  console.log(`📊 Access: http://localhost:${port}`);
  
  // 通知PM2服务已准备好
  if (process.send) {
    process.send('ready');
  }
});

// 处理服务器错误
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❗ Port ${port} is already in use. Please try a different port.`);
    process.exit(1);
  } else {
    console.error('服务器错误:', err);
    process.exit(1);
  }
});

// 优雅关闭处理
process.on('SIGINT', async () => {
  console.log('\n正在关闭服务器...');
  await imageDb.close();
  console.log('数据库连接已关闭');
  await redisClient.close();
  console.log('Redis连接已关闭');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('收到SIGTERM信号，正在关闭服务器...');
  await imageDb.close();
  console.log('数据库连接已关闭');
  await redisClient.close();
  console.log('Redis连接已关闭');
  process.exit(0);
});

// 强制数据库重连API
app.post('/api/force-reconnect', isAuthenticated, async (req, res) => {
  try {
    console.log('收到强制数据库重连请求');
    
    // 如果数据库已连接且没有正在重连，则无需操作
    const status = await imageDb.getStatus();
    
    if (status.isConnected && !imageDb.reconnectInterval) {
      return res.json({
        success: true,
        message: '数据库连接正常，无需重连',
        alreadyConnected: true
      });
    }
    
    // 停止现有的重连尝试
    imageDb.stopReconnect();
    
    // 标记连接状态为失败，启动新的重连尝试
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

// ==================== 分类管理页面 ====================
// 页面：分类管理
app.get('/categories', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'categories.html'));
});

// ==================== 分类相关 API ====================
// 获取所有分类
app.get('/api/categories', isAuthenticated, async (req, res) => {
  try {
    const categories = await imageDb.getAllCategories();
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || '获取分类失败' });
  }
});

// 新增: 获取顶级分类（没有父分类的）
app.get('/api/categories/top', isAuthenticated, async (req, res) => {
  try {
    const categories = await imageDb.getTopLevelCategories();
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || '获取顶级分类失败' });
  }
});

// 新增: 获取子分类
app.get('/api/categories/:id/subcategories', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ success: false, error: '无效的分类ID' });
    }
    
    const categories = await imageDb.getSubCategories(parseInt(id));
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || '获取子分类失败' });
  }
});

// 添加分类
app.post('/api/categories', isAuthenticated, async (req, res) => {
  try {
    let { name, parentId } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: '分类名称不能为空' });
    }
    
    // 如果有父分类ID，需要确保它是数字
    if (parentId) {
      parentId = parseInt(parentId);
      if (isNaN(parentId)) {
        return res.status(400).json({ success: false, error: '无效的父分类ID' });
      }
    } else {
      parentId = null; // 确保为null而不是undefined
    }
    
    name = name.trim();
    const id = await imageDb.addCategory(name, parentId);
    
    res.json({
      success: true,
      category: {
        id,
        name,
        parent_id: parentId,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('添加分类失败:', error);
    res.status(500).json({ success: false, error: error.message || '添加分类失败' });
  }
});

// 添加二级分类
app.post('/api/categories/subcategory', isAuthenticated, async (req, res) => {
  try {
    let { name, parentId } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: '分类名称不能为空' });
    }
    
    // 必须有父分类ID
    if (!parentId) {
      return res.status(400).json({ success: false, error: '父分类ID不能为空' });
    }
    
    parentId = parseInt(parentId);
    if (isNaN(parentId)) {
      return res.status(400).json({ success: false, error: '无效的父分类ID' });
    }
    
    // 检查父分类是否存在
    const parentCategory = await imageDb.getCategoryById(parentId);
    if (!parentCategory) {
      return res.status(404).json({ success: false, error: '父分类不存在' });
    }
    
    // 检查父分类是否已经是子分类（不允许多级嵌套）
    if (parentCategory.parent_id) {
      return res.status(400).json({ success: false, error: '不支持多级嵌套，只能添加到顶级分类下' });
    }
    
    name = name.trim();
    const id = await imageDb.addCategory(name, parentId);
    
    res.json({
      success: true,
      category: {
        id,
        name,
        parent_id: parentId,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('添加二级分类失败:', error);
    res.status(500).json({ success: false, error: error.message || '添加二级分类失败' });
  }
});

// 更新分类
app.put('/api/categories/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    let { name, parentId } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: '分类名称不能为空' });
    }
    
    // 处理parentId参数
    if (parentId !== undefined) {
      if (parentId === null || parentId === '') {
        parentId = null;
      } else {
        parentId = parseInt(parentId);
        if (isNaN(parentId)) {
          return res.status(400).json({ success: false, error: '无效的父分类ID' });
        }
        
        // 防止循环引用：分类不能成为自己的子分类
        if (parseInt(id) === parentId) {
          return res.status(400).json({ success: false, error: '分类不能成为自己的父分类' });
        }
      }
    }
    
    name = name.trim();
    const ok = await imageDb.updateCategory(id, name, parentId);
    
    if (!ok) {
      return res.status(404).json({ success: false, error: '分类不存在' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('更新分类失败:', error);
    res.status(500).json({ success: false, error: error.message || '更新分类失败' });
  }
});

// 删除分类
app.delete('/api/categories/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await imageDb.deleteCategory(id);
    res.json({ success: ok });
  } catch (err) {
    console.error('删除分类失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取指定分类下的图片
app.get('/api/categories/:id/images', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const images = await imageDb.getImagesByCategory(id);
    res.json({ success: true, images });
  } catch (err) {
    console.error('获取分类图片失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取指定分类下的图片（分页版本）
app.get('/api/categories/:id/images/paged', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    // 确保ID是有效的数字
    const categoryId = parseInt(id);
    if (isNaN(categoryId)) {
      console.error(`无效的分类ID参数: ${id}`);
      return res.status(400).json({ success: false, error: '无效的分类ID' });
    }

    // 验证分类是否存在
    try {
      const category = await imageDb.getCategoryById(categoryId);
      if (!category) {
        console.error(`请求的分类不存在: ID=${categoryId}`);
        return res.status(404).json({ success: false, error: `ID为${categoryId}的分类不存在` });
      }
      
      console.log(`加载分类图片: ID=${category.id}, 名称=${category.name}, 父ID=${category.parent_id || 'NULL'}`);
    } catch (categoryErr) {
      console.error(`检查分类存在时出错: ${categoryErr.message}`);
      // 即使出错仍继续执行，尝试加载图片
    }

    console.log(`分页获取分类ID=${categoryId}的图片，第${page}页，每页${limit}条`);
    const result = await imageDb.getImagesByCategoryPaged(categoryId, page, limit);
    
    res.json({ 
      success: true, 
      images: result.images,
      pagination: result.pagination
    });
  } catch (err) {
    console.error(`分页获取分类图片失败，ID=${req.params.id}, 错误:`, err);
    res.status(500).json({ success: false, error: err.message || '分页获取分类图片失败' });
  }
});

// 新增：获取一级分类及其所有子分类的所有图片（分页版本）
app.get('/api/categories/:id/allimages/paged', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    // 确保ID是有效的数字
    const categoryId = parseInt(id);
    if (isNaN(categoryId)) {
      console.error(`无效的分类ID参数: ${id}`);
      return res.status(400).json({ success: false, error: '无效的分类ID' });
    }

    try {
      console.log(`分页获取一级分类ID=${categoryId}及其所有子分类的图片，第${page}页，每页${limit}条`);
      const result = await imageDb.getImagesInParentCategoryPaged(categoryId, page, limit);
      
      res.json({ 
        success: true, 
        images: result.images,
        pagination: result.pagination
      });
    } catch (err) {
      // 如果发生错误（例如，指定的不是一级分类），返回适当的错误消息
      console.error(`获取一级分类及其子分类图片失败，ID=${categoryId}:`, err);
      return res.status(400).json({ success: false, error: err.message });
    }
  } catch (err) {
    console.error(`分页获取一级分类及其子分类图片失败，ID=${req.params.id}, 错误:`, err);
    res.status(500).json({ success: false, error: err.message || '分页获取一级分类及其子分类图片失败' });
  }
});

// 获取未分类图片
app.get('/api/images/uncategorized', isAuthenticated, async (req, res) => {
  try {
    // 合并数据库与文件系统图片（不使用缓存，确保实时）
    let images = await mergeImagesFromDbAndFileSystem(req, null, false);

    // 过滤条件：数据库中 categoryId 为空，或文件系统中尚未入库（无 categoryId 字段）
    const uncategorized = images.filter(img => !img.categoryId);

    // 按上传时间倒序，对于相同时间的图片按ID升序排序（确保同一批次的顺序正确）
    uncategorized.sort((a, b) => {
      const dateA = new Date(a.uploadTime);
      const dateB = new Date(b.uploadTime);
      if (dateB.getTime() !== dateA.getTime()) {
        return dateB - dateA;
      }
      // 相同时间的情况下，按ID升序排序（较小ID先显示）
      return (a._id || 0) - (b._id || 0);
    });

    // 本地化时间格式
    const formatted = uncategorized.map(img => ({
      ...img,
      uploadTime: new Date(img.uploadTime).toLocaleString()
    }));

    res.json({ success: true, images: formatted });
  } catch (err) {
    console.error('获取未分类图片失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取未分类图片（分页版本）
app.get('/api/images/uncategorized/paged', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    const result = await imageDb.getImagesWithoutCategoryPaged(page, limit);
    res.json({ 
      success: true, 
      images: result.images,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('分页获取未分类图片失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取特定父分类下未归类到子分类的图片（分页版本）
app.get('/api/categories/:id/uncategorized/paged', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    // 确保ID是有效的数字
    const categoryId = parseInt(id);
    if (isNaN(categoryId)) {
      return res.status(400).json({ success: false, error: '无效的分类ID' });
    }
    
    // 首先验证父分类是否存在
    const category = await imageDb.getCategoryById(categoryId);
    if (!category) {
      return res.status(404).json({ success: false, error: `ID为${categoryId}的分类不存在` });
    }
    
    // 验证这是一个一级分类（没有父分类）
    if (category.parent_id) {
      return res.status(400).json({ 
        success: false, 
        error: `ID为${categoryId}的分类是二级分类，不能作为父分类查询未分类图片` 
      });
    }
    
    console.log(`获取父分类ID=${categoryId}下的未归类图片，分页：第${page}页，每页${limit}条`);
    const result = await imageDb.getImagesInCategoryWithoutSubcategoryPaged(categoryId, page, limit);
    res.json({ 
      success: true, 
      images: result.images,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('分页获取分类下未归类图片失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新图片的分类
app.put('/api/images/:id/category', isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的图片ID' });
    }
    
    let { categoryId, parentCategoryId } = req.body;
    
    // 增强类型检查
    if (categoryId === '' || categoryId === 'null' || categoryId === 'undefined' || categoryId === undefined) {
      categoryId = null;
      console.log('将分类ID设置为null');
    }
    
    // 处理父分类未分类的情况
    if (parentCategoryId) {
      parentCategoryId = parseInt(parentCategoryId);
      if (isNaN(parentCategoryId)) {
        return res.status(400).json({ success: false, error: '无效的父分类ID' });
      }
      
      // 验证父分类是否存在且是一级分类
      const category = await imageDb.getCategoryById(parentCategoryId);
      if (!category) {
        return res.status(404).json({ success: false, error: `ID为${parentCategoryId}的父分类不存在` });
      }
      
      if (category.parent_id) {
        return res.status(400).json({ 
          success: false, 
          error: `ID为${parentCategoryId}的分类是二级分类，不能作为父分类` 
        });
      }
      
      console.log(`图片${id}设置为父分类${parentCategoryId}下的未分类状态`);
      // 设置了parentCategoryId时，确保categoryId为null
      // 这表示图片属于一级分类，但不属于任何二级分类
      categoryId = null;
    }
    
    console.log('更新图片分类', { id, categoryId, parentCategoryId, 类型: typeof categoryId });
    
    // 使用修改后的方法更新图片分类
    let ok;
    if (parentCategoryId) {
      // 当提供父分类ID时，表示图片设置为该一级分类下的未分类状态
      // updateImageCategoryWithParent方法会设置正确的categoryId值
      ok = await imageDb.updateImageCategoryWithParent(id, null, parentCategoryId);
    } else {
      // 没有父分类ID时，直接使用提供的categoryId
      // 如果categoryId为null，表示完全移除分类（顶级未分类）
      ok = await imageDb.updateImageCategory(id, categoryId);
    }
    
    res.json({ success: ok });
  } catch (err) {
    console.error('更新图片分类失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});