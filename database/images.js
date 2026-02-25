/**
 * 图片数据操作模块
 * 处理图片的 CRUD 操作和统计
 */

const ImagesMixin = {
  // 添加图片记录
  async addImage(imageData) {
    try {
      const client = await this.pool.connect();
      try {
        const insertQuery = `
          INSERT INTO images (filename, path, upload_time, file_size, storage, format, url, html_code, markdown_code, category_id, is_animated)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
          imageData.categoryId || null,
          imageData.format === 'gif' ? true : (imageData.isAnimated || false)
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
  },

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
  },

  // 获取所有图片
  async getAllImages(limit = null, storageType = null) {
    try {
      const client = await this.pool.connect();
      try {
        let sql = `SELECT id, filename, path, upload_time, file_size, storage, format,
                         url, html_code, markdown_code, category_id, is_animated, created_at FROM images`;
        const params = [];
        let paramIndex = 1;

        if (storageType) {
          sql += ` WHERE storage = $${paramIndex}`;
          params.push(storageType);
          paramIndex++;
        }

        sql += ' ORDER BY created_at DESC, id DESC';

        if (limit && limit > 0) {
          sql += ` LIMIT $${paramIndex}`;
          params.push(limit);
        }

        const result = await client.query(sql, params);

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
          isAnimated: row.is_animated || false,
          _id: row.id
        }));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取图片列表失败:', error);
      throw error;
    }
  },

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

        const countResult = await client.query(countSql, params);
        const total = parseInt(countResult.rows[0].total);

        // 同一批次图片 upload_time 相同，用文件名中嵌入的 orderIndex（第17-19位）作次级排序
        // 文件名格式：{16位hex}{3位orderIndex}.{ext}，orderIndex 在写入前同步计算，是唯一可靠的顺序依据
        dataSql += ' ORDER BY upload_time DESC, CASE WHEN SUBSTRING(filename FROM 17 FOR 3) ~ \'^[0-9]+$\' THEN CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ELSE 0 END ASC LIMIT $' + paramIndex + ' OFFSET $' + (paramIndex + 1);
        const offset = (page - 1) * limit;
        const dataParams = [...params, limit, offset];

        const dataResult = await client.query(dataSql, dataParams);

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
          isAnimated: row.is_animated || false,
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
  },

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
            isAnimated: row.is_animated || false,
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
  },

  // 仅获取所有图片的路径集合（轻量查询，用于与文件系统比对）
  async getAllImagePaths() {
    try {
      const client = await this.pool.connect();
      try {
        const result = await client.query('SELECT path FROM images');
        return new Set(result.rows.map(row => row.path));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取图片路径集合失败:', error);
      throw error;
    }
  },

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
  },

  // 获取存储空间使用情况（字节）
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
  },

  // 设置图片的动图标记
  async setImageAnimated(imageId, isAnimated) {
    try {
      const client = await this.pool.connect();
      try {
        const query = `
          UPDATE images
          SET is_animated = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `;
        const result = await client.query(query, [isAnimated, imageId]);
        return result.rowCount > 0;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('设置动图标记失败:', error);
      throw error;
    }
  },

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
};

module.exports = ImagesMixin;
