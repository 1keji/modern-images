/**
 * 数据库优化扩展
 * 提供批量操作、并发控制和性能优化功能
 */

const pLimit = require('p-limit');

/**
 * 数据库优化类
 * 扩展原有的数据库类，添加批量操作功能
 */
class DatabaseOptimized {
  constructor(imageDb) {
    this.imageDb = imageDb;
    this.pool = imageDb.pool;
  }

  /**
   * 批量添加图片记录（使用事务）
   * 性能提升：批量插入比逐个插入快 10-100 倍
   */
  async addImagesBatch(imagesData) {
    if (!Array.isArray(imagesData) || imagesData.length === 0) {
      return [];
    }

    const client = await this.pool.connect();

    try {
      // 开始事务
      await client.query('BEGIN');

      const insertQuery = `
        INSERT INTO images (filename, path, upload_time, file_size, storage, format, url, html_code, markdown_code, category_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `;

      const insertedIds = [];

      // 使用 Promise.all 并发插入（在事务内）
      const insertPromises = imagesData.map(async (imageData) => {
        const values = [
          imageData.filename,
          imageData.path,
          imageData.uploadTime || imageData.upload_time,
          imageData.fileSize || imageData.file_size,
          imageData.storage,
          imageData.format,
          imageData.url,
          imageData.htmlCode || imageData.html_code,
          imageData.markdownCode || imageData.markdown_code,
          imageData.categoryId || imageData.category_id || null
        ];

        const result = await client.query(insertQuery, values);
        return result.rows[0].id;
      });

      const ids = await Promise.all(insertPromises);
      insertedIds.push(...ids);

      // 提交事务
      await client.query('COMMIT');

      console.log(`✅ 批量插入成功: ${insertedIds.length} 条记录`);
      return insertedIds;

    } catch (error) {
      // 回滚事务
      await client.query('ROLLBACK');
      console.error('批量插入图片记录失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 批量添加图片记录（使用单条SQL）
   * 性能最优：使用 VALUES 批量插入
   */
  async addImagesBatchOptimized(imagesData) {
    if (!Array.isArray(imagesData) || imagesData.length === 0) {
      return [];
    }

    const client = await this.pool.connect();

    try {
      // 构建批量插入SQL
      // INSERT INTO images (...) VALUES ($1,$2,...), ($11,$12,...), ...
      const columns = 'filename, path, upload_time, file_size, storage, format, url, html_code, markdown_code, category_id';

      const valuePlaceholders = [];
      const allValues = [];
      let paramIndex = 1;

      for (const imageData of imagesData) {
        const placeholders = [];
        for (let i = 0; i < 10; i++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valuePlaceholders.push(`(${placeholders.join(', ')})`);

        allValues.push(
          imageData.filename,
          imageData.path,
          imageData.uploadTime || imageData.upload_time,
          imageData.fileSize || imageData.file_size,
          imageData.storage,
          imageData.format,
          imageData.url,
          imageData.htmlCode || imageData.html_code,
          imageData.markdownCode || imageData.markdown_code,
          imageData.categoryId || imageData.category_id || null
        );
      }

      const insertQuery = `
        INSERT INTO images (${columns})
        VALUES ${valuePlaceholders.join(', ')}
        RETURNING id
      `;

      const result = await client.query(insertQuery, allValues);
      const insertedIds = result.rows.map(row => row.id);

      console.log(`✅ 批量插入成功（优化版）: ${insertedIds.length} 条记录`);
      return insertedIds;

    } catch (error) {
      console.error('批量插入图片记录失败（优化版）:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 批量更新图片记录
   */
  async updateImagesBatch(updates) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return 0;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      let updatedCount = 0;

      for (const update of updates) {
        const { id, data } = update;

        // 动态构建 SET 子句
        const setClause = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(data)) {
          setClause.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }

        values.push(id); // id 放在最后

        const updateQuery = `
          UPDATE images
          SET ${setClause.join(', ')}
          WHERE id = $${paramIndex}
        `;

        const result = await client.query(updateQuery, values);
        updatedCount += result.rowCount;
      }

      await client.query('COMMIT');

      console.log(`✅ 批量更新成功: ${updatedCount} 条记录`);
      return updatedCount;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('批量更新图片记录失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 批量删除图片记录
   */
  async deleteImagesBatch(imagePaths) {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      return 0;
    }

    const client = await this.pool.connect();

    try {
      // 使用 IN 子句批量删除
      const placeholders = imagePaths.map((_, index) => `$${index + 1}`).join(', ');
      const deleteQuery = `DELETE FROM images WHERE path IN (${placeholders})`;

      const result = await client.query(deleteQuery, imagePaths);
      console.log(`✅ 批量删除成功: ${result.rowCount} 条记录`);
      return result.rowCount;

    } catch (error) {
      console.error('批量删除图片记录失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 批量查询图片记录（使用 IN 子句）
   */
  async getImagesByIds(imageIds) {
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return [];
    }

    const client = await this.pool.connect();

    try {
      const placeholders = imageIds.map((_, index) => `$${index + 1}`).join(', ');
      const selectQuery = `
        SELECT id, filename, path, upload_time, file_size, storage, format,
               url, html_code, markdown_code, category_id, created_at
        FROM images
        WHERE id IN (${placeholders})
        ORDER BY created_at DESC
      `;

      const result = await client.query(selectQuery, imageIds);
      return result.rows;

    } catch (error) {
      console.error('批量查询图片记录失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 批量更新存储类型（用于迁移）
   */
  async updateStorageTypeBatch(imageIds, newStorageType, newStorageData) {
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return 0;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const limit = pLimit(10); // 限制并发数

      const updatePromises = imageIds.map((id) =>
        limit(async () => {
          const updateQuery = `
            UPDATE images
            SET storage = $1, path = $2, url = $3, html_code = $4, markdown_code = $5
            WHERE id = $6
          `;

          const data = newStorageData[id] || {};
          const values = [
            newStorageType,
            data.path || null,
            data.url || null,
            data.htmlCode || null,
            data.markdownCode || null,
            id
          ];

          const result = await client.query(updateQuery, values);
          return result.rowCount;
        })
      );

      const results = await Promise.all(updatePromises);
      const totalUpdated = results.reduce((sum, count) => sum + count, 0);

      await client.query('COMMIT');

      console.log(`✅ 批量更新存储类型成功: ${totalUpdated} 条记录`);
      return totalUpdated;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('批量更新存储类型失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 获取按存储类型分组的图片数量
   */
  async getImageCountByStorage() {
    const client = await this.pool.connect();

    try {
      const query = `
        SELECT storage, COUNT(*) as count
        FROM images
        GROUP BY storage
      `;

      const result = await client.query(query);

      const counts = {};
      for (const row of result.rows) {
        counts[row.storage] = parseInt(row.count, 10);
      }

      return counts;

    } catch (error) {
      console.error('获取图片数量统计失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 分页查询图片（优化版）
   */
  async getImagesPaginated(options = {}) {
    const {
      page = 1,
      pageSize = 30,
      storageType = null,
      categoryId = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const client = await this.pool.connect();

    try {
      const offset = (page - 1) * pageSize;
      const params = [];
      let paramIndex = 1;

      // 构建WHERE子句
      const whereConditions = [];
      if (storageType) {
        whereConditions.push(`storage = $${paramIndex++}`);
        params.push(storageType);
      }
      if (categoryId !== null) {
        whereConditions.push(`category_id = $${paramIndex++}`);
        params.push(categoryId);
      }

      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      // 查询总数
      const countQuery = `SELECT COUNT(*) FROM images ${whereClause}`;
      const countResult = await client.query(countQuery, params.slice(0, paramIndex - 1));
      const total = parseInt(countResult.rows[0].count, 10);

      // 查询数据
      const dataQuery = `
        SELECT id, filename, path, upload_time, file_size, storage, format,
               url, html_code, markdown_code, category_id, created_at
        FROM images
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      params.push(pageSize, offset);
      const dataResult = await client.query(dataQuery, params);

      return {
        data: dataResult.rows,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      };

    } catch (error) {
      console.error('分页查询图片失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 清理孤立的图片记录（文件不存在但数据库有记录）
   */
  async cleanOrphanRecords(fileExistsChecker) {
    const client = await this.pool.connect();

    try {
      // 获取所有本地存储的图片
      const query = `SELECT id, path FROM images WHERE storage = 'local'`;
      const result = await client.query(query);

      const orphanIds = [];

      // 检查文件是否存在
      for (const row of result.rows) {
        const exists = await fileExistsChecker(row.path);
        if (!exists) {
          orphanIds.push(row.id);
        }
      }

      if (orphanIds.length > 0) {
        // 批量删除
        const deleteQuery = `DELETE FROM images WHERE id = ANY($1)`;
        const deleteResult = await client.query(deleteQuery, [orphanIds]);

        console.log(`✅ 清理孤立记录: ${deleteResult.rowCount} 条`);
        return deleteResult.rowCount;
      }

      return 0;

    } catch (error) {
      console.error('清理孤立记录失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 批量获取图片统计信息
   */
  async getImageStats() {
    const client = await this.pool.connect();

    try {
      const query = `
        SELECT
          COUNT(*) as total_count,
          SUM(file_size) as total_size,
          AVG(file_size) as avg_size,
          MAX(file_size) as max_size,
          MIN(file_size) as min_size,
          COUNT(DISTINCT storage) as storage_types,
          COUNT(DISTINCT format) as format_types,
          COUNT(DISTINCT category_id) as category_count
        FROM images
      `;

      const result = await client.query(query);
      const stats = result.rows[0];

      // 转换为数字类型
      return {
        totalCount: parseInt(stats.total_count, 10),
        totalSize: parseInt(stats.total_size || 0, 10),
        avgSize: parseFloat(stats.avg_size || 0),
        maxSize: parseInt(stats.max_size || 0, 10),
        minSize: parseInt(stats.min_size || 0, 10),
        storageTypes: parseInt(stats.storage_types, 10),
        formatTypes: parseInt(stats.format_types, 10),
        categoryCount: parseInt(stats.category_count, 10)
      };

    } catch (error) {
      console.error('获取图片统计信息失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 创建批量插入生成器（用于大数据量导入）
   * 分批插入，避免内存溢出
   */
  async *bulkInsertGenerator(imagesData, batchSize = 100) {
    for (let i = 0; i < imagesData.length; i += batchSize) {
      const batch = imagesData.slice(i, i + batchSize);

      try {
        const ids = await this.addImagesBatchOptimized(batch);
        yield {
          success: true,
          batch: i / batchSize + 1,
          totalBatches: Math.ceil(imagesData.length / batchSize),
          insertedCount: ids.length,
          insertedIds: ids
        };
      } catch (error) {
        yield {
          success: false,
          batch: i / batchSize + 1,
          error: error.message
        };
      }
    }
  }

  /**
   * 执行批量导入（带进度回调）
   */
  async bulkImport(imagesData, options = {}) {
    const {
      batchSize = 100,
      onProgress = null
    } = options;

    const generator = this.bulkInsertGenerator(imagesData, batchSize);
    const results = [];
    let totalInserted = 0;

    for await (const result of generator) {
      results.push(result);

      if (result.success) {
        totalInserted += result.insertedCount;
      }

      // 调用进度回调
      if (onProgress) {
        onProgress({
          ...result,
          totalInserted,
          totalRecords: imagesData.length,
          progress: Math.floor((totalInserted / imagesData.length) * 100)
        });
      }
    }

    return {
      success: true,
      totalInserted,
      totalRecords: imagesData.length,
      batches: results
    };
  }
}

/**
 * 为现有数据库实例添加优化方法
 */
function extendDatabase(imageDb) {
  const optimized = new DatabaseOptimized(imageDb);

  // 添加批量方法到原实例
  imageDb.addImagesBatch = optimized.addImagesBatch.bind(optimized);
  imageDb.addImagesBatchOptimized = optimized.addImagesBatchOptimized.bind(optimized);
  imageDb.updateImagesBatch = optimized.updateImagesBatch.bind(optimized);
  imageDb.deleteImagesBatch = optimized.deleteImagesBatch.bind(optimized);
  imageDb.getImagesByIds = optimized.getImagesByIds.bind(optimized);
  imageDb.updateStorageTypeBatch = optimized.updateStorageTypeBatch.bind(optimized);
  imageDb.getImageCountByStorage = optimized.getImageCountByStorage.bind(optimized);
  imageDb.getImagesPaginated = optimized.getImagesPaginated.bind(optimized);
  imageDb.cleanOrphanRecords = optimized.cleanOrphanRecords.bind(optimized);
  imageDb.getImageStats = optimized.getImageStats.bind(optimized);
  imageDb.bulkInsert = optimized.bulkImport.bind(optimized);

  console.log('✅ 数据库优化扩展已加载');

  return imageDb;
}

module.exports = {
  DatabaseOptimized,
  extendDatabase
};
