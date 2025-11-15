// 确保加载环境变量
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class ImageDatabase {
  constructor(config = null) {
    this.config = config || this.getDefaultConfig();
    this.pool = null;
    this.autoBackupInterval = null;
    this.dataCheckInterval = null;
    this.reconnectInterval = null; // 新增：重连检查定时器
    this.lastKnownRecordCount = 0;  // 保存上次已知的记录数
    this.pgToolsAvailable = null; // 缓存 PostgreSQL 工具可用性
    this.connectionFailed = false; // 连接失败标志
    this.reconnectAttempts = 0; // 新增：重连尝试次数
    this.maxReconnectAttempts = 10; // 新增：最大重连尝试次数
    this.reconnectDelay = 10000; // 新增：重连延迟 10 秒
    this.init();
  }

  getDefaultConfig() {
    // 使用环境变量进行数据库配置
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
  }

  getDefaultPostgreSQLConfig() {
    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'imagehosting',
      user: process.env.DB_USER || 'imagehosting_user',
      password: process.env.DB_PASSWORD || 'your_password_here',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      // Optimized connection pool settings
      min: 2,
      max: 20, // Increased max connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased timeout
      acquireTimeoutMillis: 20000, // Time to wait for connection
      createTimeoutMillis: 30000, // Time to wait for connection creation
      destroyTimeoutMillis: 5000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
      // Performance optimizations
      statement_timeout: 300000, // 5 minutes
      query_timeout: 300000,
      application_name: 'modern-image-hosting'
    };
  }

  async init() {
    // 初始状态标记
    this.isInitialized = false;
    this.connectionFailed = false;
    
    try {
      // 创建连接池
      await this.createConnectionPool();
      
      // 测试连接
      const client = await this.pool.connect();
      console.log('PostgreSQL数据库连接成功');
      client.release();
      
      // 创建表结构
      await this.createTables();
      
      // 检测 PostgreSQL 工具可用性
      await this.detectPgTools();
      
      // 确保"api上传"默认分类存在
      await this.ensureApiUploadCategory();
      
      // 启动数据完整性检查
      await this.startDataIntegrityCheck();
      
      // 启动数据库连接监控
      this.startConnectionMonitoring();
      
      this.isInitialized = true;
      console.log('PostgreSQL数据库初始化成功');
    } catch (error) {
      this.connectionFailed = true;
      console.error('PostgreSQL数据库初始化失败:', error);
      
      // 启动自动重连
      this.startReconnect();
      
      throw error;
    }
  }

  // 新增：创建连接池方法，用于初始化和重连
  async createConnectionPool() {
    if (this.pool) {
      // 如果有现有连接池，先关闭它
      try {
        await this.pool.end();
        console.log('关闭旧的数据库连接池');
      } catch (error) {
        console.error('关闭旧连接池失败:', error);
      }
    }
    
    // 创建新的连接池
    this.pool = new Pool(this.config);
    
    // 监听连接池错误
    this.pool.on('error', (err) => {
      console.error('数据库池连接错误:', err.message);
      if (!this.connectionFailed) {
        this.connectionFailed = true;
        this.startReconnect();
      }
    });
  }
  
  // 新增：开始自动重连
  startReconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    
    this.reconnectAttempts = 0;
    console.log('启动数据库自动重连机制');
    
    this.reconnectInterval = setInterval(async () => {
      if (!this.connectionFailed) {
        // 如果已经连接成功，停止重连
        this.stopReconnect();
        return;
      }
      
      this.reconnectAttempts++;
      console.log(`尝试重新连接数据库 (第 ${this.reconnectAttempts} 次)`);
      
      try {
        // 尝试创建新的连接池
        await this.createConnectionPool();
        
        // 测试连接
        const client = await this.pool.connect();
        console.log('数据库重连成功!');
        client.release();
        
        // 更新状态
        this.connectionFailed = false;
        this.isInitialized = true;
        this.reconnectAttempts = 0;
        
        // 重新初始化数据检查
        await this.startDataIntegrityCheck();
        
        // 重连成功，停止重连定时器
        this.stopReconnect();
      } catch (error) {
        console.error(`数据库重连失败 (第 ${this.reconnectAttempts} 次):`, error.message);
        
        // 如果达到最大重试次数，增加延迟时间
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          clearInterval(this.reconnectInterval);
          const longerDelay = this.reconnectDelay * 3;
          console.log(`达到最大重试次数 (${this.maxReconnectAttempts})，增加重连间隔至 ${longerDelay/1000} 秒`);
          
          this.reconnectInterval = setInterval(this.startReconnect.bind(this), longerDelay);
          this.reconnectAttempts = 0;
        }
      }
    }, this.reconnectDelay);
  }
  
  // 新增：停止自动重连
  stopReconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
      console.log('数据库重连机制已停止');
    }
  }
  
  // 新增：启动数据库连接监控
  startConnectionMonitoring() {
    // 每30秒检查一次数据库连接状态
    const monitorInterval = 30 * 1000; // 30秒
    
    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
    }
    
    this.connectionMonitorInterval = setInterval(async () => {
      try {
        // 尝试获取连接并执行简单查询
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        // 如果之前连接失败，现在恢复了，更新状态
        if (this.connectionFailed) {
          console.log('检测到数据库连接已恢复');
          this.connectionFailed = false;
          
          // 重新初始化数据检查
          await this.startDataIntegrityCheck();
        }
      } catch (error) {
        // 如果之前连接正常，现在失败了，启动重连
        if (!this.connectionFailed) {
          console.error('检测到数据库连接已断开:', error.message);
          this.connectionFailed = true;
          this.startReconnect();
        }
      }
    }, monitorInterval);
    
    console.log(`数据库连接监控已启动，间隔: ${monitorInterval/1000} 秒`);
  }
  
  // 停止数据库连接监控
  stopConnectionMonitoring() {
    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
      this.connectionMonitorInterval = null;
      console.log('数据库连接监控已停止');
    }
  }

  // 检测 PostgreSQL 客户端工具是否可用
  async detectPgTools() {
    if (this.pgToolsAvailable !== null) {
      return this.pgToolsAvailable;
    }

    try {
      const pgdumpPath = process.env.PGDUMP_PATH || 'pg_dump';
      const psqlPath = process.env.PSQL_PATH || 'psql';

      // 检测 pg_dump
      const pgdumpAvailable = await this.checkCommand(pgdumpPath, ['--version']);
      
      // 检测 psql
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
  }

  // 检查命令是否可用
  checkCommand(command, args = []) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'ignore' });
      
      const timeout = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 5000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code !== null); // 只要进程能启动就认为命令可用
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  async createTables() {
    const createImagesTable = `
      CREATE TABLE IF NOT EXISTS images (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        upload_time TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        storage TEXT NOT NULL DEFAULT 'local',
        format TEXT NOT NULL,
        url TEXT NOT NULL,
        html_code TEXT NOT NULL,
        markdown_code TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 新增：创建分类表
    const createCategoriesTable = `
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 新增：创建系统设置表
    const createSettingsTable = `
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value JSONB NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 新增：给 images 表添加 category_id 列，并建立外键与索引
    const addCategoryIdColumn = `
      ALTER TABLE images
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
    `;

    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_images_path ON images(path)',
      'CREATE INDEX IF NOT EXISTS idx_images_upload_time ON images(upload_time)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage ON images(storage)',
      'CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at)',
      // 新增：为分类建立索引
      'CREATE INDEX IF NOT EXISTS idx_images_category ON images(category_id)',
      // 新增：为父分类建立索引
      'CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)',
      // 新增：为系统设置建立索引
      'CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(key)',
      'CREATE INDEX IF NOT EXISTS idx_settings_updated_at ON system_settings(updated_at)',
      // Performance optimization indexes
      'CREATE INDEX IF NOT EXISTS idx_images_storage_created ON images(storage, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_category_created ON images(category_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_format ON images(format)',
      'CREATE INDEX IF NOT EXISTS idx_images_file_size ON images(file_size)',
      // Composite indexes for common queries
      'CREATE INDEX IF NOT EXISTS idx_images_category_null ON images(category_id) WHERE category_id IS NULL',
      'CREATE INDEX IF NOT EXISTS idx_categories_name_lower ON categories(LOWER(name))'
    ];

    try {
      const client = await this.pool.connect();
      try {
        // 创建 images 表
        await client.query(createImagesTable);
        // 创建 categories 表
        await client.query(createCategoriesTable);
        // 创建 system_settings 表
        await client.query(createSettingsTable);
        // 添加 images.category_id 列
        await client.query(addCategoryIdColumn);
        // 创建索引
        for (const indexSql of createIndexes) {
          await client.query(indexSql);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('创建表结构失败:', error);
      throw error;
    }
  }

  // 添加图片记录
  async addImage(imageData) {
    try {
      const client = await this.pool.connect();
      try {
        const insertQuery = `
          INSERT INTO images (filename, path, upload_time, file_size, storage, format, url, html_code, markdown_code, category_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `;
        
        const values = [
          imageData.filename,
          imageData.path,
          imageData.uploadTime,
          imageData.fileSize,
          imageData.storage,
          imageData.format,
          imageData.url,
          imageData.htmlCode,
          imageData.markdownCode,
          imageData.categoryId || null
        ];
        
        const result = await client.query(insertQuery, values);
        return result.rows[0].id;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('添加图片记录失败:', error);
      throw error;
    }
  }

  // 删除图片记录
  async removeImage(imagePath) {
    try {
      const client = await this.pool.connect();
      try {
        const deleteQuery = 'DELETE FROM images WHERE path = $1';
        const result = await client.query(deleteQuery, [imagePath]);
        return result.rowCount > 0;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('删除图片记录失败:', error);
      throw error;
    }
  }

  // 获取所有图片
  async getAllImages(limit = null, storageType = null) {
    try {
      const client = await this.pool.connect();
      try {
        // Optimized query with specific columns to reduce data transfer
        let sql = `SELECT id, filename, path, upload_time, file_size, storage, format, 
                         url, html_code, markdown_code, category_id, created_at FROM images`;
        const params = [];
        let paramIndex = 1;
        
        if (storageType) {
          sql += ` WHERE storage = $${paramIndex}`;
          params.push(storageType);
          paramIndex++;
        }
        
        // Use created_at for better index utilization
        sql += ' ORDER BY created_at DESC, id DESC';
        
        if (limit && limit > 0) {
          sql += ` LIMIT $${paramIndex}`;
          params.push(limit);
        }
        
        const result = await client.query(sql, params);
        
        // 转换为原有格式
        return result.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: row.upload_time,
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取图片列表失败:', error);
      throw error;
    }
  }

  // 分页获取图片
  async getImagesPaged(page = 1, limit = 50, storageType = null, categoryId = null) {
    try {
      const client = await this.pool.connect();
      try {
        let countSql = 'SELECT COUNT(*) as total FROM images';
        let dataSql = 'SELECT * FROM images';
        const params = [];
        let paramIndex = 1;
        
        if (storageType) {
          countSql += ` WHERE storage = $${paramIndex}`;
          dataSql += ` WHERE storage = $${paramIndex}`;
          params.push(storageType);
          paramIndex++;
        }
        if (categoryId !== null) {
          const clause = storageType ? ' AND' : ' WHERE';
          countSql += `${clause} category_id = $${paramIndex}`;
          dataSql += `${clause} category_id = $${paramIndex}`;
          params.push(categoryId);
          paramIndex++;
        }
        
        // 获取总数
        const countResult = await client.query(countSql, params);
        const total = parseInt(countResult.rows[0].total);
        
        // 获取分页数据
        dataSql += ' ORDER BY upload_time DESC, id ASC LIMIT $' + paramIndex + ' OFFSET $' + (paramIndex + 1);
        const offset = (page - 1) * limit;
        const dataParams = [...params, limit, offset];
        
        const dataResult = await client.query(dataSql, dataParams);
        
        // 转换为原有格式
        const images = dataResult.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: row.upload_time,
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
        
        return {
          images,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('分页获取图片失败:', error);
      throw error;
    }
  }

  // 根据路径查找图片
  async findImageByPath(imagePath) {
    try {
      const client = await this.pool.connect();
      try {
        const query = 'SELECT * FROM images WHERE path = $1';
        const result = await client.query(query, [imagePath]);
        
        if (result.rows.length > 0) {
          const row = result.rows[0];
          return {
            filename: row.filename,
            path: row.path,
            uploadTime: row.upload_time,
            fileSize: row.file_size,
            storage: row.storage,
            format: row.format,
            url: row.url,
            htmlCode: row.html_code,
            markdownCode: row.markdown_code,
            _id: row.id
          };
        }
        return null;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('查找图片失败:', error);
      throw error;
    }
  }

  // 获取存储统计
  async getStorageStats() {
    try {
      const client = await this.pool.connect();
      try {
        const totalQuery = 'SELECT COUNT(*) as count FROM images';
        const localQuery = 'SELECT COUNT(*) as count FROM images WHERE storage = $1';
        const r2Query = 'SELECT COUNT(*) as count FROM images WHERE storage = $1';
        
        const [totalResult, localResult, r2Result] = await Promise.all([
          client.query(totalQuery),
          client.query(localQuery, ['local']),
          client.query(r2Query, ['r2'])
        ]);
        
        return {
          total: parseInt(totalResult.rows[0].count),
          local: parseInt(localResult.rows[0].count),
          r2: parseInt(r2Result.rows[0].count)
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取存储统计失败:', error);
      throw error;
    }
  }

  // 新增: 获取存储空间使用情况（字节）
  async getStorageUsage() {
    try {
      const client = await this.pool.connect();
      try {
        const totalQuery = 'SELECT COALESCE(SUM(file_size), 0) AS size FROM images';
        const localQuery = 'SELECT COALESCE(SUM(file_size), 0) AS size FROM images WHERE storage = $1';
        const r2Query = 'SELECT COALESCE(SUM(file_size), 0) AS size FROM images WHERE storage = $1';

        const [totalResult, localResult, r2Result] = await Promise.all([
          client.query(totalQuery),
          client.query(localQuery, ['local']),
          client.query(r2Query, ['r2'])
        ]);

        return {
          total: parseInt(totalResult.rows[0].size),
          local: parseInt(localResult.rows[0].size),
          r2: parseInt(r2Result.rows[0].size)
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取存储空间使用情况失败:', error);
      throw error;
    }
  }

  // 从JSON文件导入数据
  async importFromJson(jsonPath) {
    try {
      if (!fs.existsSync(jsonPath)) {
        console.log('JSON文件不存在，跳过导入');
        return { imported: 0, skipped: 0, errors: 0 };
      }

      const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (!Array.isArray(jsonData)) {
        throw new Error('JSON文件格式无效');
      }

      let imported = 0;
      let skipped = 0;
      let errors = 0;

      const client = await this.pool.connect();
      try {
        // 使用事务批量插入
        await client.query('BEGIN');
        
        for (const image of jsonData) {
          try {
            // 检查是否已存在
            const existing = await this.findImageByPath(image.path);
            if (existing) {
              skipped++;
              continue;
            }

            await this.addImage(image);
            imported++;
          } catch (error) {
            console.error('导入图片失败:', image.path, error.message);
            errors++;
          }
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      console.log(`JSON导入完成: 导入${imported}条, 跳过${skipped}条, 错误${errors}条`);
      return { imported, skipped, errors };
    } catch (error) {
      console.error('从JSON导入失败:', error);
      throw error;
    }
  }

  // 备份到SQL文件
  async exportToSql(sqlPath = null) {
    try {
      // 确保备份目录存在
      const backupDir = path.join(__dirname, 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // 如果没有指定路径，生成默认路径
      if (!sqlPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        sqlPath = path.join(backupDir, `images_backup_${timestamp}.sql`);
      }

      // 检测 PostgreSQL 工具并选择备份方法
      await this.detectPgTools();

      if (this.pgToolsAvailable) {
        console.log('使用 pg_dump 进行备份...');
        return await this.exportToSqlWithPgDump(sqlPath);
      } else {
        console.log('使用 JavaScript 回退方案进行备份...');
        return await this.exportToSqlWithJavaScript(sqlPath);
      }
    } catch (error) {
      console.error('导出到SQL失败:', error);
      // 如果原生工具失败，尝试 JavaScript 回退
      if (this.pgToolsAvailable) {
        console.log('pg_dump 失败，尝试 JavaScript 回退方案...');
        return await this.exportToSqlWithJavaScript(sqlPath);
      }
      throw error;
    }
  }

  // 使用 pg_dump 备份（原有方法）
  async exportToSqlWithPgDump(sqlPath) {
    const pgdumpPath = process.env.PGDUMP_PATH || 'pg_dump';
    
    return new Promise((resolve, reject) => {
      const args = [
        '-h', this.config.host,
        '-p', this.config.port.toString(),
        '-U', this.config.user,
        '-d', this.config.database,
        '--no-password',
        '--table=images',
        '--data-only',
        '--inserts'
      ];

      // 设置环境变量包含密码
      const env = { ...process.env };
      if (this.config.password) {
        env.PGPASSWORD = this.config.password;
      }

      const pgdump = spawn(pgdumpPath, args, {
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let sqlData = '';
      let errorData = '';

      pgdump.stdout.on('data', (data) => {
        sqlData += data.toString();
      });

      pgdump.stderr.on('data', (data) => {
        errorData += data.toString();
      });

      pgdump.on('close', (code) => {
        if (code !== 0) {
          console.error('pg_dump错误:', errorData);
          reject(new Error(`pg_dump执行失败，退出码: ${code}\n错误信息: ${errorData}`));
          return;
        }

        try {
          // 写入SQL文件
          fs.writeFileSync(sqlPath, sqlData);
          console.log(`数据已备份到 ${sqlPath}`);
          
          // 获取记录数量
          const recordCount = (sqlData.match(/INSERT INTO/g) || []).length;
          resolve({ path: sqlPath, recordCount });
        } catch (writeError) {
          reject(new Error(`写入SQL文件失败: ${writeError.message}`));
        }
      });

      pgdump.on('error', (error) => {
        reject(new Error(`启动pg_dump失败: ${error.message}`));
      });
    });
  }

  // 使用 JavaScript 备份（回退方案）
  async exportToSqlWithJavaScript(sqlPath) {
    try {
      const client = await this.pool.connect();
      
      try {
        // 获取所有数据
        const result = await client.query('SELECT * FROM images ORDER BY id');
        const images = result.rows;
        
        if (images.length === 0) {
          // 创建空备份文件
          fs.writeFileSync(sqlPath, '-- 数据库备份 (JavaScript 生成)\n-- 备份时间: ' + new Date().toISOString() + '\n-- 记录数量: 0\n');
          return { path: sqlPath, recordCount: 0 };
        }

        // 生成 SQL 插入语句
        let sqlContent = '-- 数据库备份 (JavaScript 生成)\n';
        sqlContent += '-- 备份时间: ' + new Date().toISOString() + '\n';
        sqlContent += '-- 记录数量: ' + images.length + '\n\n';
        
        // 添加删除现有数据的语句，但注释掉，防止意外执行
        sqlContent += '-- 注意: 恢复备份时请谨慎使用下面的删除语句\n';
        sqlContent += '-- DELETE FROM images; -- 取消注释以清空现有数据\n\n';
        
        for (const image of images) {
          // 转义单引号
          const escapeString = (str) => str ? str.replace(/'/g, "''") : '';
          
          sqlContent += `INSERT INTO images (filename, path, upload_time, file_size, storage, format, url, html_code, markdown_code, created_at, updated_at) VALUES (`;
          sqlContent += `'${escapeString(image.filename)}', `;
          sqlContent += `'${escapeString(image.path)}', `;
          sqlContent += `'${escapeString(image.upload_time)}', `;
          sqlContent += `${image.file_size}, `;
          sqlContent += `'${escapeString(image.storage)}', `;
          sqlContent += `'${escapeString(image.format)}', `;
          sqlContent += `'${escapeString(image.url)}', `;
          sqlContent += `'${escapeString(image.html_code)}', `;
          sqlContent += `'${escapeString(image.markdown_code)}', `;
          sqlContent += `'${image.created_at ? image.created_at.toISOString() : new Date().toISOString()}', `;
          sqlContent += `'${image.updated_at ? image.updated_at.toISOString() : new Date().toISOString()}'`;
          sqlContent += `);\n`;
        }

        // 写入文件
        fs.writeFileSync(sqlPath, sqlContent);
        console.log(`数据已备份到 ${sqlPath} (使用 JavaScript 方案)`);
        
        return { path: sqlPath, recordCount: images.length };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('JavaScript 备份失败:', error);
      throw new Error(`JavaScript 备份失败: ${error.message}`);
    }
  }

  // 从SQL文件恢复数据
  async importFromSql(sqlPath) {
    try {
      // 首先检查数据库连接状态
      if (this.connectionFailed) {
        throw new Error('数据库连接失败，无法导入SQL数据');
      }
      
      if (!fs.existsSync(sqlPath)) {
        throw new Error('SQL文件不存在');
      }

      // 尝试重新验证连接状态
      try {
        const testClient = await this.pool.connect();
        testClient.release();
      } catch (connError) {
        this.connectionFailed = true;
        throw new Error(`数据库连接测试失败，无法导入: ${connError.message}`);
      }

      // 检测 PostgreSQL 工具并选择恢复方法
      await this.detectPgTools();

      if (this.pgToolsAvailable) {
        console.log('使用 psql 进行恢复...');
        return await this.importFromSqlWithPsql(sqlPath);
      } else {
        console.log('使用 JavaScript 回退方案进行恢复...');
        return await this.importFromSqlWithJavaScript(sqlPath);
      }
    } catch (error) {
      console.error('从SQL导入失败:', error);
      // 如果原生工具失败，尝试 JavaScript 回退
      if (!this.connectionFailed && this.pgToolsAvailable) {
        console.log('psql 失败，尝试 JavaScript 回退方案...');
        return await this.importFromSqlWithJavaScript(sqlPath);
      }
      throw error;
    }
  }

  // 使用 psql 恢复（原有方法）
  async importFromSqlWithPsql(sqlPath) {
    const psqlPath = process.env.PSQL_PATH || 'psql';
    
    return new Promise(async (resolve, reject) => {
      try {
        // 先检查SQL文件内容，查看是否有DELETE语句
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');
        const hasDeleteStatement = sqlContent.includes('DELETE FROM images;') && !sqlContent.includes('-- DELETE FROM images;');
        
        if (hasDeleteStatement) {
          console.warn('⚠️ 警告: SQL文件包含未注释的DELETE语句，这可能会清空数据库');
        }
        
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
          // 注意：不再自动执行删除操作，而是通过SQL文件中的DELETE语句(如果有)决定是否清空
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        const args = [
          '-h', this.config.host,
          '-p', this.config.port.toString(),
          '-U', this.config.user,
          '-d', this.config.database,
          '--no-password',
          '-f', sqlPath
        ];

        // 设置环境变量包含密码
        const env = { ...process.env };
        if (this.config.password) {
          env.PGPASSWORD = this.config.password;
        }

        const psql = spawn(psqlPath, args, {
          env: env,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let outputData = '';
        let errorData = '';

        psql.stdout.on('data', (data) => {
          outputData += data.toString();
        });

        psql.stderr.on('data', (data) => {
          errorData += data.toString();
        });

        psql.on('close', (code) => {
          if (code !== 0) {
            console.error('psql错误:', errorData);
            reject(new Error(`psql执行失败，退出码: ${code}\n错误信息: ${errorData}`));
            return;
          }

          console.log(`SQL文件导入完成: ${sqlPath}`);
          // 计算导入的记录数（这是一个估算）
          const insertCount = (fs.readFileSync(sqlPath, 'utf8').match(/INSERT INTO/g) || []).length;
          resolve({ imported: insertCount, message: `成功从SQL文件导入数据` });
        });

        psql.on('error', (error) => {
          reject(new Error(`启动psql失败: ${error.message}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // 使用 JavaScript 恢复（回退方案）
  async importFromSqlWithJavaScript(sqlPath) {
    try {
      // 再次验证数据库连接状态
      if (this.connectionFailed) {
        throw new Error('数据库连接已失败，无法使用JavaScript方案导入数据');
      }
      
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      
      // 检查是否有未注释的DELETE语句
      const hasDeleteStatement = sqlContent.includes('DELETE FROM images;') && !sqlContent.includes('-- DELETE FROM images;');
      
      // 解析 SQL 文件中的 INSERT 语句
      const insertRegex = /INSERT INTO images \([^)]+\) VALUES \(([^;]+)\);/gi;
      const matches = [];
      let match;
      
      while ((match = insertRegex.exec(sqlContent)) !== null) {
        matches.push(match[1]);
      }

      if (matches.length === 0) {
        console.log('SQL 文件中未找到有效的 INSERT 语句');
        return { imported: 0, message: '未找到可导入的数据' };
      }

      // 再次尝试连接数据库并检查连接状态
      let client;
      try {
        client = await this.pool.connect();
      } catch (connError) {
        this.connectionFailed = true;
        throw new Error(`数据库连接失败，无法导入数据: ${connError.message}`);
      }

      let imported = 0;
      let errors = 0;

      try {
        await client.query('BEGIN');

        // 仅当SQL文件中有未注释的DELETE语句时才执行删除
        if (hasDeleteStatement) {
          console.warn('⚠️ 执行DELETE FROM images语句清空数据表');
          await client.query('DELETE FROM images');
        } else {
          console.log('保留现有数据，仅添加新记录');
        }

        for (const valuesPart of matches) {
          try {
            // 解析 VALUES 部分
            const values = this.parseInsertValues(valuesPart);
            
            if (values && values.length >= 9) {
              // 检查记录是否已存在
              const existingCheck = await client.query(
                'SELECT id FROM images WHERE path = $1',
                [values[1]] // path 字段
              );

              if (existingCheck.rows.length === 0) {
                // 插入新记录
                const insertQuery = `
                  INSERT INTO images (filename, path, upload_time, file_size, storage, format, url, html_code, markdown_code, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `;

                await client.query(insertQuery, [
                  values[0], // filename
                  values[1], // path
                  values[2], // upload_time
                  parseInt(values[3]) || 0, // file_size
                  values[4], // storage
                  values[5], // format
                  values[6], // url
                  values[7], // html_code
                  values[8], // markdown_code
                  values[9] ? new Date(values[9]) : new Date(), // created_at
                  values[10] ? new Date(values[10]) : new Date() // updated_at
                ]);
                imported++;
              }
            }
          } catch (insertError) {
            console.error('插入记录失败:', insertError.message);
            errors++;
          }
        }

        await client.query('COMMIT');
        console.log(`SQL 文件导入完成: ${sqlPath} (使用 JavaScript 方案)`);
        console.log(`成功导入 ${imported} 条记录，错误 ${errors} 条`);
        
        return { 
          imported, 
          errors,
          message: `成功从SQL文件导入数据 (JavaScript 解析)` 
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('JavaScript导入方法失败:', error);
      throw error;
    }
  }

  // 解析 INSERT VALUES 部分
  parseInsertValues(valuesPart) {
    try {
      // 简单的值解析，处理单引号字符串和数字
      const values = [];
      let current = '';
      let inQuotes = false;
      let i = 0;

      while (i < valuesPart.length) {
        const char = valuesPart[i];
        
        if (char === "'" && (i === 0 || valuesPart[i - 1] !== '\\')) {
          if (inQuotes) {
            // 检查是否是转义的单引号
            if (i + 1 < valuesPart.length && valuesPart[i + 1] === "'") {
              current += "'";
              i += 2; // 跳过两个单引号
              continue;
            } else {
              inQuotes = false;
            }
          } else {
            inQuotes = true;
          }
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else if (!inQuotes && char === ' ') {
          // 跳过引号外的空格
        } else {
          current += char;
        }
        i++;
      }
      
      // 添加最后一个值
      if (current.trim()) {
        values.push(current.trim());
      }

      return values;
    } catch (error) {
      console.error('解析 INSERT 值失败:', error);
      return null;
    }
  }

  // 获取备份目录中的SQL文件列表
  async getBackupFiles() {
    try {
      const backupDir = path.join(__dirname, 'backups');
      if (!fs.existsSync(backupDir)) {
        return [];
      }

      const files = fs.readdirSync(backupDir)
        .filter(file => file.endsWith('.sql'))
        .map(file => {
          const filePath = path.join(backupDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            size: stats.size,
            created: stats.mtime.toISOString(),
            created_readable: stats.mtime.toLocaleString('zh-CN')
          };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));

      return files;
    } catch (error) {
      console.error('获取备份文件列表失败:', error);
      return [];
    }
  }

  // 设置自动备份
  setAutoBackup(intervalHours = 24) {
    // 清除现有的定时器
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
    }

    if (intervalHours <= 0) {
      console.log('自动备份已禁用');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000; // 转换为毫秒
    
    this.autoBackupInterval = setInterval(async () => {
      try {
        console.log('开始执行自动备份...');
        
        // 备份前检查数据库状态
        const beforeStatus = await this.getStatus();
        console.log(`备份前数据库记录数量: ${beforeStatus.dbImageCount}`);
        
        // 只有在有数据的情况下才进行备份
        if (beforeStatus.dbImageCount > 0) {
          const result = await this.exportToSql();
          console.log(`自动备份完成: ${result.path}, 备份了 ${result.recordCount} 条记录`);
          
          // 验证备份文件
          if (result.recordCount !== beforeStatus.dbImageCount) {
            console.warn(`⚠️ 警告: 备份记录数 (${result.recordCount}) 与数据库记录数 (${beforeStatus.dbImageCount}) 不匹配`);
          }
          
          // 清理旧备份文件（保留最近10个备份）
          const keepCount = parseInt(process.env.AUTO_BACKUP_KEEP_COUNT) || 10;
          await this.cleanOldBackups(keepCount);
        } else {
          console.log('数据库为空，跳过备份操作');
        }
        
        // 备份后再次检查数据库状态，确保数据没有丢失
        const afterStatus = await this.getStatus();
        if (afterStatus.dbImageCount !== beforeStatus.dbImageCount) {
          console.error(`❌ 错误: 备份操作后数据库记录数量发生变化 (${beforeStatus.dbImageCount} -> ${afterStatus.dbImageCount})`);
        } else {
          console.log(`✅ 备份后数据库记录数量校验通过: ${afterStatus.dbImageCount}`);
        }
      } catch (error) {
        console.error('自动备份失败:', error);
      }
    }, intervalMs);

    console.log(`自动备份已设置，间隔: ${intervalHours} 小时`);
  }

  // 清理旧备份文件
  async cleanOldBackups(keepCount = 10) {
    try {
      const backupFiles = await this.getBackupFiles();
      if (backupFiles.length <= keepCount) {
        return;
      }

      // 删除超出保留数量的旧备份
      const filesToDelete = backupFiles.slice(keepCount);
      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path);
          console.log(`已删除旧备份文件: ${file.name}`);
        } catch (error) {
          console.error(`删除备份文件失败: ${file.name}`, error);
        }
      }
    } catch (error) {
      console.error('清理旧备份失败:', error);
    }
  }

  // 停止自动备份
  stopAutoBackup() {
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
      this.autoBackupInterval = null;
      console.log('自动备份已停止');
    }
  }

  // 备份到JSON文件（向后兼容）
  async exportToJson(jsonPath) {
    try {
      const images = await this.getAllImages();
      // 转换为原JSON格式（移除_id字段）
      const exportData = images.map(img => {
        const { _id, ...imageData } = img;
        return imageData;
      });
      
      fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
      console.log(`数据已备份到 ${jsonPath}`);
      return exportData.length;
    } catch (error) {
      console.error('导出到JSON失败:', error);
      throw error;
    }
  }

  // 获取数据库状态
  async getStatus() {
    // 如果初始化时已经失败，直接返回未连接状态
    if (this.connectionFailed) {
      // 提供连接失败的原因
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
      // 使用较短的超时时间，以便快速检测连接问题
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
      
      // 更新连接失败状态并启动重连
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
  }

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
  }

  // 关闭数据库连接
  async close() {
    // 停止自动备份
    this.stopAutoBackup();
    
    // 停止数据完整性检查
    this.stopDataIntegrityCheck();
    
    // 停止重连
    this.stopReconnect();
    
    // 停止连接监控
    this.stopConnectionMonitoring();
    
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  // 启动数据完整性定期检查
  async startDataIntegrityCheck(intervalMinutes = 30) {
    // 如果数据库连接已经失败，不启动检查
    if (this.connectionFailed) {
      console.warn('数据库连接失败，不启动数据完整性检查');
      return;
    }
    
    // 首先获取当前记录数
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

    // 清除现有的定时器
    if (this.dataCheckInterval) {
      clearInterval(this.dataCheckInterval);
    }

    // 设置新的定时器
    const intervalMs = intervalMinutes * 60 * 1000; // 转换为毫秒
    this.dataCheckInterval = setInterval(async () => {
      try {
        // 检查连接状态
        if (this.connectionFailed) {
          console.warn('数据库连接已失败，跳过数据完整性检查');
          return;
        }
        
        // 检查当前记录数
        const status = await this.getStatus();
        
        if (!status.isConnected) {
          console.warn('数据库未连接，跳过数据完整性检查');
          this.connectionFailed = true;
          return;
        }
        
        const currentCount = status.dbImageCount;
        
        // 检查是否有显著减少
        if (this.lastKnownRecordCount > 0 && currentCount === 0) {
          console.error(`❌ 严重警告: 数据库记录数从 ${this.lastKnownRecordCount} 减少到 0，可能存在数据丢失!`);
          
          // 再次检查数据库连接状态
          const connStatus = await this.getStatus();
          if (!connStatus.isConnected) {
            console.error('数据库未连接，无法执行自动恢复');
            return;
          }
          
          // 尝试从最新备份恢复
          const backupFiles = await this.getBackupFiles();
          if (backupFiles.length > 0) {
            const latestBackup = backupFiles[0];
            console.log(`尝试从最新备份自动恢复: ${latestBackup.name}`);
            
            try {
              // 创建恢复操作的备份
              const recoveryLogPath = path.join(__dirname, 'backups', `recovery_log_${Date.now()}.txt`);
              fs.writeFileSync(recoveryLogPath, `自动恢复日志\n时间: ${new Date().toISOString()}\n原记录数: ${this.lastKnownRecordCount}\n当前记录数: ${currentCount}\n使用备份: ${latestBackup.name}\n`);
              
              // 执行恢复
              const result = await this.importFromSql(latestBackup.path);
              
              // 记录恢复结果
              fs.appendFileSync(recoveryLogPath, `恢复结果: 导入 ${result.imported} 条记录\n`);
              
              console.log(`自动恢复完成，导入了 ${result.imported} 条记录`);
              
              // 更新记录数
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
        // 检查是否有显著减少但不为0
        else if (this.lastKnownRecordCount > 10 && currentCount < this.lastKnownRecordCount / 2) {
          console.warn(`⚠️ 警告: 数据库记录数从 ${this.lastKnownRecordCount} 减少到 ${currentCount}，减少超过一半`);
          
          // 创建警告日志
          const warningLogPath = path.join(__dirname, 'backups', `data_reduction_warning_${Date.now()}.txt`);
          fs.writeFileSync(warningLogPath, `数据减少警告\n时间: ${new Date().toISOString()}\n原记录数: ${this.lastKnownRecordCount}\n当前记录数: ${currentCount}\n`);
        } 
        // 正常情况下更新记录数
        else {
          this.lastKnownRecordCount = currentCount;
        }
      } catch (error) {
        console.error('数据完整性检查失败:', error);
      }
    }, intervalMs);

    console.log(`数据完整性检查已启动，间隔: ${intervalMinutes} 分钟`);
  }

  // 停止数据完整性检查
  stopDataIntegrityCheck() {
    if (this.dataCheckInterval) {
      clearInterval(this.dataCheckInterval);
      this.dataCheckInterval = null;
      console.log('数据完整性检查已停止');
    }
  }

  // 新增：获取指定分类的全部图片（不分页）
  async getImagesByCategory(categoryId) {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'SELECT * FROM images WHERE category_id = $1 ORDER BY upload_time DESC';
        const result = await client.query(sql, [categoryId]);
        return result.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: row.upload_time,
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('根据分类获取图片失败:', error);
      throw error;
    }
  }

  // 新增：获取指定分类的图片（分页版本）
  async getImagesByCategoryPaged(categoryId, page = 1, limit = 50) {
    try {
      // 确保参数类型正确
      const parsedCategoryId = parseInt(categoryId);
      if (isNaN(parsedCategoryId)) {
        console.error(`无效的分类ID: ${categoryId}`);
        throw new Error(`无效的分类ID: ${categoryId}`);
      }

      const client = await this.pool.connect();
      try {
        // 首先检查分类是否存在
        const checkCatSql = 'SELECT id, name, parent_id FROM categories WHERE id = $1';
        const catResult = await client.query(checkCatSql, [parsedCategoryId]);
        
        if (catResult.rows.length === 0) {
          console.log(`尝试加载不存在的分类: ID=${parsedCategoryId}`);
          // 即使分类不存在，仍然尝试查询图片
        } else {
          const catInfo = catResult.rows[0];
          console.log(`加载分类图片: ID=${catInfo.id}, 名称=${catInfo.name}, 父ID=${catInfo.parent_id || 'NULL'}`);
        }
        
        // 获取总数
        const countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id = $1';
        const countResult = await client.query(countSql, [parsedCategoryId]);
        const total = parseInt(countResult.rows[0].total);
        
        console.log(`分类 ${parsedCategoryId} 共有 ${total} 张图片`);
        
        // 获取分页数据
        const offset = (page - 1) * limit;
        const dataSql = 'SELECT * FROM images WHERE category_id = $1 ORDER BY upload_time DESC LIMIT $2 OFFSET $3';
        const dataResult = await client.query(dataSql, [parsedCategoryId, limit, offset]);
        
        console.log(`成功获取 ${dataResult.rows.length} 张图片`);
        
        // 转换为前端格式
        const images = dataResult.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: new Date(row.upload_time).toLocaleString(),
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
        
        return {
          images,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`分页获取分类图片失败，分类ID: ${categoryId}:`, error);
      throw error;
    }
  }

  // 新增：获取未分类图片（分页版本）
  async getImagesWithoutCategoryPaged(page = 1, limit = 50) {
    try {
      const client = await this.pool.connect();
      try {
        // 获取总数
        const countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id IS NULL';
        const countResult = await client.query(countSql);
        const total = parseInt(countResult.rows[0].total);
        
        // 获取分页数据
        const offset = (page - 1) * limit;
        const dataSql = 'SELECT * FROM images WHERE category_id IS NULL ORDER BY upload_time DESC LIMIT $1 OFFSET $2';
        const dataResult = await client.query(dataSql, [limit, offset]);
        
        // 转换为前端格式
        const images = dataResult.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: new Date(row.upload_time).toLocaleString(),
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
        
        return {
          images,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('分页获取未分类图片失败:', error);
      throw error;
    }
  }

  // 新增：分类相关操作
  async addCategory(name, parentId = null) {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id';
        const result = await client.query(sql, [name, parentId]);
        return result.rows[0].id;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('添加分类失败:', error);
      throw error;
    }
  }

  async updateCategory(id, name, parentId = undefined) {
    try {
      const client = await this.pool.connect();
      try {
        // 检查是否需要同时更新父分类ID
        let sql;
        let params;
        if (parentId !== undefined) {
          sql = 'UPDATE categories SET name = $2, parent_id = $3 WHERE id = $1';
          params = [id, name, parentId];
        } else {
          sql = 'UPDATE categories SET name = $2 WHERE id = $1';
          params = [id, name];
        }
        const result = await client.query(sql, params);
        return result.rowCount > 0;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('更新分类失败:', error);
      throw error;
    }
  }

  async deleteCategory(id) {
    try {
      const client = await this.pool.connect();
      try {
        // 删除分类记录，images 表中对应的 category_id 将因外键约束被置空
        const sql = 'DELETE FROM categories WHERE id = $1';
        const result = await client.query(sql, [id]);
        return result.rowCount > 0;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('删除分类失败:', error);
      throw error;
    }
  }

  async getAllCategories() {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'SELECT id, name, parent_id, created_at FROM categories ORDER BY name ASC';
        const result = await client.query(sql);
        return result.rows;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取分类列表失败:', error);
      throw error;
    }
  }

  // 根据ID获取分类信息
  async getCategoryById(id) {
    try {
      // 确保ID是数字类型
      const categoryId = parseInt(id);
      if (isNaN(categoryId)) {
        console.error(`无效的分类ID: ${id}`);
        throw new Error(`无效的分类ID: ${id}`);
      }

      const client = await this.pool.connect();
      try {
        console.log(`查询分类ID: ${categoryId}`);
        const sql = 'SELECT id, name, parent_id, created_at FROM categories WHERE id = $1';
        const result = await client.query(sql, [categoryId]);
        
        if (result.rows.length === 0) {
          console.log(`未找到ID为${categoryId}的分类`);
          return null;
        }
        
        return result.rows[0];
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`获取分类详情失败, ID=${id}:`, error);
      throw error;
    }
  }

  async updateImageCategory(imageId, categoryId) {
    try {
      const client = await this.pool.connect();
      try {
        const imgId = parseInt(imageId);
        
        // 增强类型检查，处理更多边缘情况
        let catId = null;
        if (categoryId === null || categoryId === '' || categoryId === 'null' || categoryId === 'undefined' || categoryId === undefined) {
          catId = null;
          console.log('数据库层: 分类ID被设置为null');
        } else {
          catId = parseInt(categoryId, 10);
          console.log('数据库层: 分类ID解析为:', catId);
          if (isNaN(catId)) {
            console.error('数据库层: 无效的分类ID:', categoryId, '类型:', typeof categoryId);
            throw new Error('无效的分类ID');
          }
        }
        
        if (isNaN(imgId)) {
          console.error('数据库层: 无效的图片ID:', imageId);
          throw new Error('无效的图片ID');
        }
        
        console.log('数据库层: 执行更新', { imgId, catId, 原始categoryId: categoryId });
        const sql = 'UPDATE images SET category_id = $2 WHERE id = $1';
        const result = await client.query(sql, [imgId, catId]);
        return result.rowCount > 0;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('数据库层: 更新图片分类失败:', error);
      throw error;
    }
  }

  // 新增：支持一级分类的"未分类"状态
  async updateImageCategoryWithParent(imageId, categoryId, parentCategoryId) {
    try {
      const client = await this.pool.connect();
      try {
        const imgId = parseInt(imageId);
        
        if (isNaN(imgId)) {
          console.error('数据库层: 无效的图片ID:', imageId);
          throw new Error('无效的图片ID');
        }
        
        // 首先验证父分类是否存在且是一级分类
        if (parentCategoryId) {
          const parentId = parseInt(parentCategoryId);
          
          if (isNaN(parentId)) {
            console.error('数据库层: 无效的父分类ID:', parentCategoryId);
            throw new Error('无效的父分类ID');
          }
          
          // 查询父分类
          const parentSql = 'SELECT * FROM categories WHERE id = $1';
          const parentResult = await client.query(parentSql, [parentId]);
          
          if (parentResult.rows.length === 0) {
            console.error('数据库层: 父分类不存在:', parentId);
            throw new Error(`ID为${parentId}的父分类不存在`);
          }
          
          const parentCategory = parentResult.rows[0];
          if (parentCategory.parent_id !== null) {
            console.error('数据库层: 指定的分类不是一级分类:', parentId);
            throw new Error(`ID为${parentId}的分类不是一级分类`);
          }
          
          // 设置分类ID为父分类ID，表示图片属于该一级分类但不属于任何二级分类
          // 在UI层面，这会将图片显示在该一级分类的"未分类"部分
          // 实际上，它在数据库中保存的是一级分类的ID作为分类ID
          console.log('数据库层: 图片设置为父分类的未分类状态', { imgId, parentId });
          const sql = 'UPDATE images SET category_id = $2 WHERE id = $1';
          const result = await client.query(sql, [imgId, parentId]);
          return result.rowCount > 0;
        } else {
          // 如果没有提供父分类ID，则退回到普通的更新分类操作
          // 这种情况下，如果categoryId为null，图片将被设置为顶级未分类状态
          return await this.updateImageCategory(imageId, categoryId);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('数据库层: 更新图片父分类失败:', error);
      throw error;
    }
  }

  async getImagesWithoutCategory() {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'SELECT * FROM images WHERE category_id IS NULL ORDER BY upload_time DESC';
        const result = await client.query(sql);
        return result.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: new Date(row.upload_time).toLocaleString(),
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取未分类图片失败:', error);
      throw error;
    }
  }

  // 新增：获取特定父分类下未归类到子分类的图片（分页版本）
  async getImagesInCategoryWithoutSubcategoryPaged(parentCategoryId, page = 1, limit = 50) {
    try {
      // 确保parentCategoryId是有效的数字
      const parsedParentId = parseInt(parentCategoryId);
      if (isNaN(parsedParentId)) {
        console.error('无效的父分类ID:', parentCategoryId);
        throw new Error('无效的父分类ID');
      }

      const client = await this.pool.connect();
      try {
        // 计算分页偏移量
        const offset = (page - 1) * limit;
        
        // 获取当前父分类下的所有子分类ID
        const subCategoriesSql = 'SELECT id FROM categories WHERE parent_id = $1';
        const subCategoriesResult = await client.query(subCategoriesSql, [parsedParentId]);
        const subCategoryIds = subCategoriesResult.rows.map(row => row.id);
        
        console.log(`父分类 ${parsedParentId} 有 ${subCategoryIds.length} 个子分类`);
        
        // 构建查询条件
        let sql;
        let params;
        
        if (subCategoryIds.length === 0) {
          // 无子分类的情况，直接返回该分类下所有图片
          sql = `
            SELECT * FROM images 
            WHERE category_id = $1
            ORDER BY upload_time DESC 
            LIMIT $2 OFFSET $3
          `;
          params = [parsedParentId, limit, offset];
          
          // 获取总数
          const countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id = $1';
          const countResult = await client.query(countSql, [parsedParentId]);
          var total = parseInt(countResult.rows[0].total);
        } else {
          // 有子分类的情况，需要排除属于子分类的图片
          // 构建参数占位符 $2, $3, ...
          const placeholders = subCategoryIds.map((_, i) => `$${i + 2}`).join(',');
          
          sql = `
            SELECT * FROM images 
            WHERE category_id = $1 
            AND id NOT IN (
              SELECT id FROM images WHERE category_id IN (${placeholders})
            )
            ORDER BY upload_time DESC 
            LIMIT $${subCategoryIds.length + 2} OFFSET $${subCategoryIds.length + 3}
          `;
          
          params = [parsedParentId, ...subCategoryIds, limit, offset];
          
          // 获取总数
          const countSql = `
            SELECT COUNT(*) as total FROM images 
            WHERE category_id = $1 
            AND id NOT IN (
              SELECT id FROM images WHERE category_id IN (${placeholders})
            )
          `;
          
          const countParams = [parsedParentId, ...subCategoryIds];
          const countResult = await client.query(countSql, countParams);
          var total = parseInt(countResult.rows[0].total);
        }
        
        // 执行查询
        console.log('执行SQL查询:', sql);
        console.log('参数:', params);
        const dataResult = await client.query(sql, params);
        
        // 转换为前端格式
        const images = dataResult.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: new Date(row.upload_time).toLocaleString(),
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
        
        return {
          images,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取分类下未归类到子分类的图片失败:', error);
      throw error;
    }
  }

  // 新增：获取一级分类及其所有子分类中的所有图片（分页版本）
  async getImagesInParentCategoryPaged(parentCategoryId, page = 1, limit = 50) {
    try {
      // 确保parentCategoryId是有效的数字
      const parsedParentId = parseInt(parentCategoryId);
      if (isNaN(parsedParentId)) {
        console.error('无效的父分类ID:', parentCategoryId);
        throw new Error('无效的父分类ID');
      }

      const client = await this.pool.connect();
      try {
        // 首先验证这是一个一级分类（没有父分类）
        const parentSql = 'SELECT parent_id FROM categories WHERE id = $1';
        const parentResult = await client.query(parentSql, [parsedParentId]);
        
        if (parentResult.rows.length === 0) {
          console.error('指定的父分类不存在:', parsedParentId);
          throw new Error(`ID为${parsedParentId}的分类不存在`);
        }
        
        if (parentResult.rows[0].parent_id !== null) {
          console.error('指定的分类不是一级分类:', parsedParentId);
          throw new Error(`ID为${parsedParentId}的分类不是一级分类`);
        }
        
        // 获取该一级分类下的所有子分类ID
        const subCategoriesSql = 'SELECT id FROM categories WHERE parent_id = $1';
        const subCategoriesResult = await client.query(subCategoriesSql, [parsedParentId]);
        const subCategoryIds = subCategoriesResult.rows.map(row => row.id);
        
        console.log(`父分类 ${parsedParentId} 有 ${subCategoryIds.length} 个子分类`);
        
        // 计算分页偏移量
        const offset = (page - 1) * limit;
        
        // 构建查询条件：获取父分类自身及其所有子分类中的图片
        let sql, params, countSql;
        
        if (subCategoryIds.length === 0) {
          // 无子分类的情况，只返回该父分类下的图片
          sql = `
            SELECT * FROM images 
            WHERE category_id = $1
            ORDER BY upload_time DESC 
            LIMIT $2 OFFSET $3
          `;
          params = [parsedParentId, limit, offset];
          
          countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id = $1';
          const countResult = await client.query(countSql, [parsedParentId]);
          var total = parseInt(countResult.rows[0].total);
        } else {
          // 构建包含父分类及所有子分类的ID列表
          const allCategoryIds = [parsedParentId, ...subCategoryIds];
          
          // 构建参数占位符 $1, $2, ...
          const placeholders = allCategoryIds.map((_, i) => `$${i + 1}`).join(',');
          
          sql = `
            SELECT * FROM images 
            WHERE category_id IN (${placeholders})
            ORDER BY upload_time DESC 
            LIMIT $${allCategoryIds.length + 1} OFFSET $${allCategoryIds.length + 2}
          `;
          
          params = [...allCategoryIds, limit, offset];
          
          // 获取总数
          countSql = `SELECT COUNT(*) as total FROM images WHERE category_id IN (${placeholders})`;
          const countResult = await client.query(countSql, allCategoryIds);
          var total = parseInt(countResult.rows[0].total);
        }
        
        // 执行查询
        console.log('执行SQL查询:', sql);
        console.log('参数:', params);
        const dataResult = await client.query(sql, params);
        
        // 转换为前端格式
        const images = dataResult.rows.map(row => ({
          filename: row.filename,
          path: row.path,
          uploadTime: new Date(row.upload_time).toLocaleString(),
          fileSize: row.file_size,
          storage: row.storage,
          format: row.format,
          url: row.url,
          htmlCode: row.html_code,
          markdownCode: row.markdown_code,
          categoryId: row.category_id,
          _id: row.id
        }));
        
        return {
          images,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取一级分类及其子分类图片失败:', error);
      throw error;
    }
  }

  // 新增：获取指定父分类下的子分类
  async getSubCategories(parentId) {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'SELECT id, name, parent_id, created_at FROM categories WHERE parent_id = $1 ORDER BY name ASC';
        const result = await client.query(sql, [parentId]);
        return result.rows;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取子分类列表失败:', error);
      throw error;
    }
  }

  // 新增：获取所有顶级分类（没有父分类的分类）
  async getTopLevelCategories() {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'SELECT id, name, parent_id, created_at FROM categories WHERE parent_id IS NULL ORDER BY name ASC';
        const result = await client.query(sql);
        return result.rows;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取顶级分类列表失败:', error);
      throw error;
    }
  }

  // 新增：检查并创建"api上传"默认分类
  async ensureApiUploadCategory() {
    try {
      const client = await this.pool.connect();
      try {
        // 检查是否已存在"api上传"分类
        const checkSql = "SELECT id FROM categories WHERE name = 'api上传' AND parent_id IS NULL";
        const checkResult = await client.query(checkSql);
        
        if (checkResult.rows.length > 0) {
          console.log('已存在"api上传"分类，ID:', checkResult.rows[0].id);
          return checkResult.rows[0].id;
        }
        
        // 创建"api上传"分类
        console.log('创建默认"api上传"分类...');
        const insertSql = "INSERT INTO categories (name, parent_id) VALUES ('api上传', NULL) RETURNING id";
        const insertResult = await client.query(insertSql);
        
        console.log('成功创建"api上传"分类，ID:', insertResult.rows[0].id);
        return insertResult.rows[0].id;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('确保"api上传"分类存在时出错:', error);
      throw error;
    }
  }

  // 更新图片的URL（用于域名配置变更时）
  async updateImageUrls(imageId, url, htmlCode, markdownCode) {
    try {
      const client = await this.pool.connect();
      try {
        const query = `
          UPDATE images 
          SET url = $1, html_code = $2, markdown_code = $3, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $4
        `;
        const result = await client.query(query, [url, htmlCode, markdownCode, imageId]);
        return result.rowCount > 0;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('更新图片URL失败:', error);
      throw error;
    }
  }

  // ==================== 系统设置相关方法 ====================
  
  // 获取系统设置
  async getSetting(key) {
    try {
      const client = await this.pool.connect();
      try {
        const query = 'SELECT value FROM system_settings WHERE key = $1';
        const result = await client.query(query, [key]);
        
        if (result.rows.length > 0) {
          return result.rows[0].value;
        }
        return null;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取系统设置失败:', error);
      throw error;
    }
  }

  // 设置系统设置
  async setSetting(key, value, description = null) {
    try {
      const client = await this.pool.connect();
      try {
        const query = `
          INSERT INTO system_settings (key, value, description, updated_at)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
          ON CONFLICT (key)
          DO UPDATE SET 
            value = EXCLUDED.value,
            description = COALESCE(EXCLUDED.description, system_settings.description),
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `;
        const result = await client.query(query, [key, JSON.stringify(value), description]);
        return result.rows[0].id;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('设置系统设置失败:', error);
      throw error;
    }
  }

  // 获取多个系统设置
  async getSettings(keys) {
    try {
      const client = await this.pool.connect();
      try {
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
        const query = `SELECT key, value FROM system_settings WHERE key IN (${placeholders})`;
        const result = await client.query(query, keys);
        
        const settings = {};
        result.rows.forEach(row => {
          settings[row.key] = row.value;
        });
        return settings;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取多个系统设置失败:', error);
      throw error;
    }
  }

  // 删除系统设置
  async deleteSetting(key) {
    try {
      const client = await this.pool.connect();
      try {
        const query = 'DELETE FROM system_settings WHERE key = $1';
        const result = await client.query(query, [key]);
        return result.rowCount > 0;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('删除系统设置失败:', error);
      throw error;
    }
  }

  // 获取所有系统设置
  async getAllSettings() {
    try {
      const client = await this.pool.connect();
      try {
        const query = 'SELECT key, value, description, updated_at FROM system_settings ORDER BY key';
        const result = await client.query(query);
        
        const settings = {};
        result.rows.forEach(row => {
          settings[row.key] = {
            value: row.value,
            description: row.description,
            updatedAt: row.updated_at
          };
        });
        return settings;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取所有系统设置失败:', error);
      throw error;
    }
  }
}

module.exports = ImageDatabase;