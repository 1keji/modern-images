/**
 * 分类管理模块
 * 处理分类的 CRUD 操作和图片分类查询
 */

const CategoriesMixin = {
  // 添加分类
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
  },

  // 更新分类
  async updateCategory(id, name, parentId = undefined) {
    try {
      const client = await this.pool.connect();
      try {
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
  },

  // 删除分类
  async deleteCategory(id) {
    try {
      const client = await this.pool.connect();
      try {
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
  },

  // 获取所有分类
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
  },

  // 根据ID获取分类信息
  async getCategoryById(id) {
    try {
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
  },

  // 获取指定分类的全部图片（不分页）
  async getImagesByCategory(categoryId) {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'SELECT * FROM images WHERE category_id = $1 ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC';
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
          isAnimated: row.is_animated || false,
          _id: row.id
        }));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('根据分类获取图片失败:', error);
      throw error;
    }
  },

  // 获取指定分类的图片（分页版本）
  async getImagesByCategoryPaged(categoryId, page = 1, limit = 50) {
    try {
      const parsedCategoryId = parseInt(categoryId);
      if (isNaN(parsedCategoryId)) {
        console.error(`无效的分类ID: ${categoryId}`);
        throw new Error(`无效的分类ID: ${categoryId}`);
      }

      const client = await this.pool.connect();
      try {
        const checkCatSql = 'SELECT id, name, parent_id FROM categories WHERE id = $1';
        const catResult = await client.query(checkCatSql, [parsedCategoryId]);

        if (catResult.rows.length === 0) {
          console.log(`尝试加载不存在的分类: ID=${parsedCategoryId}`);
        } else {
          const catInfo = catResult.rows[0];
          console.log(`加载分类图片: ID=${catInfo.id}, 名称=${catInfo.name}, 父ID=${catInfo.parent_id || 'NULL'}`);
        }

        const countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id = $1';
        const countResult = await client.query(countSql, [parsedCategoryId]);
        const total = parseInt(countResult.rows[0].total);

        console.log(`分类 ${parsedCategoryId} 共有 ${total} 张图片`);

        const offset = (page - 1) * limit;
        const dataSql = 'SELECT * FROM images WHERE category_id = $1 ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC LIMIT $2 OFFSET $3';
        const dataResult = await client.query(dataSql, [parsedCategoryId, limit, offset]);

        console.log(`成功获取 ${dataResult.rows.length} 张图片`);

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
      console.error(`分页获取分类图片失败，分类ID: ${categoryId}:`, error);
      throw error;
    }
  },

  // 获取未分类图片（分页版本）
  async getImagesWithoutCategoryPaged(page = 1, limit = 50) {
    try {
      const client = await this.pool.connect();
      try {
        const countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id IS NULL';
        const countResult = await client.query(countSql);
        const total = parseInt(countResult.rows[0].total);

        const offset = (page - 1) * limit;
        const dataSql = 'SELECT * FROM images WHERE category_id IS NULL ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC LIMIT $1 OFFSET $2';
        const dataResult = await client.query(dataSql, [limit, offset]);

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
      console.error('分页获取未分类图片失败:', error);
      throw error;
    }
  },

  // 更新图片分类
  async updateImageCategory(imageId, categoryId) {
    try {
      const client = await this.pool.connect();
      try {
        const imgId = parseInt(imageId);

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
  },

  // 支持一级分类的"未分类"状态
  async updateImageCategoryWithParent(imageId, categoryId, parentCategoryId) {
    try {
      const client = await this.pool.connect();
      try {
        const imgId = parseInt(imageId);

        if (isNaN(imgId)) {
          console.error('数据库层: 无效的图片ID:', imageId);
          throw new Error('无效的图片ID');
        }

        if (parentCategoryId) {
          const parentId = parseInt(parentCategoryId);

          if (isNaN(parentId)) {
            console.error('数据库层: 无效的父分类ID:', parentCategoryId);
            throw new Error('无效的父分类ID');
          }

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

          console.log('数据库层: 图片设置为父分类的未分类状态', { imgId, parentId });
          const sql = 'UPDATE images SET category_id = $2 WHERE id = $1';
          const result = await client.query(sql, [imgId, parentId]);
          return result.rowCount > 0;
        } else {
          return await this.updateImageCategory(imageId, categoryId);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('数据库层: 更新图片父分类失败:', error);
      throw error;
    }
  },

  // 获取未分类图片
  async getImagesWithoutCategory() {
    try {
      const client = await this.pool.connect();
      try {
        const sql = 'SELECT * FROM images WHERE category_id IS NULL ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC';
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
          isAnimated: row.is_animated || false,
          _id: row.id
        }));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('获取未分类图片失败:', error);
      throw error;
    }
  },

  // 获取特定父分类下未归类到子分类的图片（分页版本）
  async getImagesInCategoryWithoutSubcategoryPaged(parentCategoryId, page = 1, limit = 50) {
    try {
      const parsedParentId = parseInt(parentCategoryId);
      if (isNaN(parsedParentId)) {
        console.error('无效的父分类ID:', parentCategoryId);
        throw new Error('无效的父分类ID');
      }

      const client = await this.pool.connect();
      try {
        const offset = (page - 1) * limit;

        const subCategoriesSql = 'SELECT id FROM categories WHERE parent_id = $1';
        const subCategoriesResult = await client.query(subCategoriesSql, [parsedParentId]);
        const subCategoryIds = subCategoriesResult.rows.map(row => row.id);

        console.log(`父分类 ${parsedParentId} 有 ${subCategoryIds.length} 个子分类`);

        let sql;
        let params;
        let total;

        if (subCategoryIds.length === 0) {
          sql = `
            SELECT * FROM images
            WHERE category_id = $1
            ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC
            LIMIT $2 OFFSET $3
          `;
          params = [parsedParentId, limit, offset];

          const countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id = $1';
          const countResult = await client.query(countSql, [parsedParentId]);
          total = parseInt(countResult.rows[0].total);
        } else {
          const placeholders = subCategoryIds.map((_, i) => `$${i + 2}`).join(',');

          sql = `
            SELECT * FROM images
            WHERE category_id = $1
            AND id NOT IN (
              SELECT id FROM images WHERE category_id IN (${placeholders})
            )
            ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC
            LIMIT $${subCategoryIds.length + 2} OFFSET $${subCategoryIds.length + 3}
          `;

          params = [parsedParentId, ...subCategoryIds, limit, offset];

          const countSql = `
            SELECT COUNT(*) as total FROM images
            WHERE category_id = $1
            AND id NOT IN (
              SELECT id FROM images WHERE category_id IN (${placeholders})
            )
          `;

          const countParams = [parsedParentId, ...subCategoryIds];
          const countResult = await client.query(countSql, countParams);
          total = parseInt(countResult.rows[0].total);
        }

        console.log('执行SQL查询:', sql);
        console.log('参数:', params);
        const dataResult = await client.query(sql, params);

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
      console.error('获取分类下未归类到子分类的图片失败:', error);
      throw error;
    }
  },

  // 获取一级分类及其所有子分类中的所有图片（分页版本）
  async getImagesInParentCategoryPaged(parentCategoryId, page = 1, limit = 50) {
    try {
      const parsedParentId = parseInt(parentCategoryId);
      if (isNaN(parsedParentId)) {
        console.error('无效的父分类ID:', parentCategoryId);
        throw new Error('无效的父分类ID');
      }

      const client = await this.pool.connect();
      try {
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

        const subCategoriesSql = 'SELECT id FROM categories WHERE parent_id = $1';
        const subCategoriesResult = await client.query(subCategoriesSql, [parsedParentId]);
        const subCategoryIds = subCategoriesResult.rows.map(row => row.id);

        console.log(`父分类 ${parsedParentId} 有 ${subCategoryIds.length} 个子分类`);

        const offset = (page - 1) * limit;

        let sql, params, countSql, total;

        if (subCategoryIds.length === 0) {
          sql = `
            SELECT * FROM images
            WHERE category_id = $1
            ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC
            LIMIT $2 OFFSET $3
          `;
          params = [parsedParentId, limit, offset];

          countSql = 'SELECT COUNT(*) as total FROM images WHERE category_id = $1';
          const countResult = await client.query(countSql, [parsedParentId]);
          total = parseInt(countResult.rows[0].total);
        } else {
          const allCategoryIds = [parsedParentId, ...subCategoryIds];
          const placeholders = allCategoryIds.map((_, i) => `$${i + 1}`).join(',');

          sql = `
            SELECT * FROM images
            WHERE category_id IN (${placeholders})
            ORDER BY upload_time DESC, CAST(SUBSTRING(filename FROM 17 FOR 3) AS INTEGER) ASC
            LIMIT $${allCategoryIds.length + 1} OFFSET $${allCategoryIds.length + 2}
          `;

          params = [...allCategoryIds, limit, offset];

          countSql = `SELECT COUNT(*) as total FROM images WHERE category_id IN (${placeholders})`;
          const countResult = await client.query(countSql, allCategoryIds);
          total = parseInt(countResult.rows[0].total);
        }

        console.log('执行SQL查询:', sql);
        console.log('参数:', params);
        const dataResult = await client.query(sql, params);

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
      console.error('获取一级分类及其子分类图片失败:', error);
      throw error;
    }
  },

  // 获取指定父分类下的子分类
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
  },

  // 获取所有顶级分类（没有父分类的分类）
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
  },

  // 检查并创建"api上传"默认分类
  async ensureApiUploadCategory() {
    try {
      const client = await this.pool.connect();
      try {
        const checkSql = "SELECT id FROM categories WHERE name = 'api上传' AND parent_id IS NULL";
        const checkResult = await client.query(checkSql);

        if (checkResult.rows.length > 0) {
          console.log('已存在"api上传"分类，ID:', checkResult.rows[0].id);
          return checkResult.rows[0].id;
        }

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
};

module.exports = CategoriesMixin;
