/**
 * 数据库备份和恢复模块
 * 处理 SQL 备份、恢复、JSON 导入导出
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BackupMixin = {
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
        await client.query('BEGIN');

        for (const image of jsonData) {
          try {
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
  },

  // 备份到SQL文件
  async exportToSql(sqlPath = null) {
    try {
      const backupDir = path.join(__dirname, '..', 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      if (!sqlPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        sqlPath = path.join(backupDir, `images_backup_${timestamp}.sql`);
      }

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
      if (this.pgToolsAvailable) {
        console.log('pg_dump 失败，尝试 JavaScript 回退方案...');
        return await this.exportToSqlWithJavaScript(sqlPath);
      }
      throw error;
    }
  },

  // 使用 pg_dump 备份
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
          fs.writeFileSync(sqlPath, sqlData);
          console.log(`数据已备份到 ${sqlPath}`);

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
  },

  // 使用 JavaScript 备份（回退方案）
  async exportToSqlWithJavaScript(sqlPath) {
    try {
      const client = await this.pool.connect();

      try {
        const result = await client.query('SELECT * FROM images ORDER BY id');
        const images = result.rows;

        if (images.length === 0) {
          fs.writeFileSync(sqlPath, '-- 数据库备份 (JavaScript 生成)\n-- 备份时间: ' + new Date().toISOString() + '\n-- 记录数量: 0\n');
          return { path: sqlPath, recordCount: 0 };
        }

        let sqlContent = '-- 数据库备份 (JavaScript 生成)\n';
        sqlContent += '-- 备份时间: ' + new Date().toISOString() + '\n';
        sqlContent += '-- 记录数量: ' + images.length + '\n\n';

        sqlContent += '-- 注意: 恢复备份时请谨慎使用下面的删除语句\n';
        sqlContent += '-- DELETE FROM images; -- 取消注释以清空现有数据\n\n';

        for (const image of images) {
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
  },

  // 从SQL文件恢复数据
  async importFromSql(sqlPath) {
    try {
      if (this.connectionFailed) {
        throw new Error('数据库连接失败，无法导入SQL数据');
      }

      if (!fs.existsSync(sqlPath)) {
        throw new Error('SQL文件不存在');
      }

      try {
        const testClient = await this.pool.connect();
        testClient.release();
      } catch (connError) {
        this.connectionFailed = true;
        throw new Error(`数据库连接测试失败，无法导入: ${connError.message}`);
      }

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
      if (!this.connectionFailed && this.pgToolsAvailable) {
        console.log('psql 失败，尝试 JavaScript 回退方案...');
        return await this.importFromSqlWithJavaScript(sqlPath);
      }
      throw error;
    }
  },

  // 使用 psql 恢复
  async importFromSqlWithPsql(sqlPath) {
    const psqlPath = process.env.PSQL_PATH || 'psql';

    return new Promise(async (resolve, reject) => {
      try {
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');
        const hasDeleteStatement = sqlContent.includes('DELETE FROM images;') && !sqlContent.includes('-- DELETE FROM images;');

        if (hasDeleteStatement) {
          console.warn('⚠️ 警告: SQL文件包含未注释的DELETE语句，这可能会清空数据库');
        }

        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
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
  },

  // 使用 JavaScript 恢复（回退方案）
  async importFromSqlWithJavaScript(sqlPath) {
    try {
      if (this.connectionFailed) {
        throw new Error('数据库连接已失败，无法使用JavaScript方案导入数据');
      }

      const sqlContent = fs.readFileSync(sqlPath, 'utf8');

      const hasDeleteStatement = sqlContent.includes('DELETE FROM images;') && !sqlContent.includes('-- DELETE FROM images;');

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

        if (hasDeleteStatement) {
          console.warn('⚠️ 执行DELETE FROM images语句清空数据表');
          await client.query('DELETE FROM images');
        } else {
          console.log('保留现有数据，仅添加新记录');
        }

        for (const valuesPart of matches) {
          try {
            const values = this.parseInsertValues(valuesPart);

            if (values && values.length >= 9) {
              const existingCheck = await client.query(
                'SELECT id FROM images WHERE path = $1',
                [values[1]]
              );

              if (existingCheck.rows.length === 0) {
                const insertQuery = `
                  INSERT INTO images (filename, path, upload_time, file_size, storage, format, url, html_code, markdown_code, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `;

                await client.query(insertQuery, [
                  values[0],
                  values[1],
                  values[2],
                  parseInt(values[3]) || 0,
                  values[4],
                  values[5],
                  values[6],
                  values[7],
                  values[8],
                  values[9] ? new Date(values[9]) : new Date(),
                  values[10] ? new Date(values[10]) : new Date()
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
  },

  // 获取备份目录中的SQL文件列表
  async getBackupFiles() {
    try {
      const backupDir = path.join(__dirname, '..', 'backups');
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
  },

  // 设置自动备份
  setAutoBackup(intervalHours = 24) {
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
    }

    if (intervalHours <= 0) {
      console.log('自动备份已禁用');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    this.autoBackupInterval = setInterval(async () => {
      try {
        console.log('开始执行自动备份...');

        const beforeStatus = await this.getStatus();
        console.log(`备份前数据库记录数量: ${beforeStatus.dbImageCount}`);

        if (beforeStatus.dbImageCount > 0) {
          const result = await this.exportToSql();
          console.log(`自动备份完成: ${result.path}, 备份了 ${result.recordCount} 条记录`);

          if (result.recordCount !== beforeStatus.dbImageCount) {
            console.warn(`⚠️ 警告: 备份记录数 (${result.recordCount}) 与数据库记录数 (${beforeStatus.dbImageCount}) 不匹配`);
          }

          const keepCount = parseInt(process.env.AUTO_BACKUP_KEEP_COUNT) || 10;
          await this.cleanOldBackups(keepCount);
        } else {
          console.log('数据库为空，跳过备份操作');
        }

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
  },

  // 清理旧备份文件
  async cleanOldBackups(keepCount = 10) {
    try {
      const backupFiles = await this.getBackupFiles();
      if (backupFiles.length <= keepCount) {
        return;
      }

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
  },

  // 停止自动备份
  stopAutoBackup() {
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
      this.autoBackupInterval = null;
      console.log('自动备份已停止');
    }
  },

  // 备份到JSON文件（向后兼容）
  async exportToJson(jsonPath) {
    try {
      const images = await this.getAllImages();
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
};

module.exports = BackupMixin;
