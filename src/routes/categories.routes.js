const express = require('express');

/**
 * 分类管理相关路由
 * 处理分类的创建、更新、删除以及分类图片的查询
 */
function createCategoriesRoutes({ isAuthenticated, imageDb }) {
  const router = express.Router();

  // ==================== 分类相关 API ====================

  /**
   * 获取所有分类
   * GET /api/categories
   */
  router.get('/api/categories', isAuthenticated, async (req, res) => {
    try {
      const categories = await imageDb.getAllCategories();
      res.json({ success: true, categories });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || '获取分类失败' });
    }
  });

  /**
   * 获取顶级分类（没有父分类的）
   * GET /api/categories/top
   */
  router.get('/api/categories/top', isAuthenticated, async (req, res) => {
    try {
      const categories = await imageDb.getTopLevelCategories();
      res.json({ success: true, categories });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || '获取顶级分类失败' });
    }
  });

  /**
   * 获取子分类
   * GET /api/categories/:id/subcategories
   */
  router.get('/api/categories/:id/subcategories', isAuthenticated, async (req, res) => {
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

  /**
   * 添加分类
   * POST /api/categories
   */
  router.post('/api/categories', isAuthenticated, async (req, res) => {
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

  /**
   * 添加二级分类
   * POST /api/categories/subcategory
   */
  router.post('/api/categories/subcategory', isAuthenticated, async (req, res) => {
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

  /**
   * 更新分类
   * PUT /api/categories/:id
   */
  router.put('/api/categories/:id', isAuthenticated, async (req, res) => {
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

  /**
   * 删除分类
   * DELETE /api/categories/:id
   */
  router.delete('/api/categories/:id', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const ok = await imageDb.deleteCategory(id);
      res.json({ success: ok });
    } catch (err) {
      console.error('删除分类失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 获取指定分类下的图片
   * GET /api/categories/:id/images
   */
  router.get('/api/categories/:id/images', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const images = await imageDb.getImagesByCategory(id);
      res.json({ success: true, images });
    } catch (err) {
      console.error('获取分类图片失败:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 获取指定分类下的图片（分页版本）
   * GET /api/categories/:id/images/paged
   */
  router.get('/api/categories/:id/images/paged', isAuthenticated, async (req, res) => {
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

  /**
   * 获取一级分类及其所有子分类的所有图片（分页版本）
   * GET /api/categories/:id/allimages/paged
   */
  router.get('/api/categories/:id/allimages/paged', isAuthenticated, async (req, res) => {
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

  /**
   * 获取特定父分类下未归类到子分类的图片（分页版本）
   * GET /api/categories/:id/uncategorized/paged
   */
  router.get('/api/categories/:id/uncategorized/paged', isAuthenticated, async (req, res) => {
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

  return router;
}

module.exports = createCategoriesRoutes;
