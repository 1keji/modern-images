/**
 * 相册管理路由模块
 */

const express = require('express');

function createAlbumsRoutes({ isAuthenticated, imageDb }) {
  const router = express.Router();

  // 获取系统相册信息（未分类相册ID等）
  router.get('/api/albums/system-info', isAuthenticated, async (req, res) => {
    try {
      const uncategorizedId = await imageDb.getSetting('uncategorized_album_id');
      res.json({ success: true, uncategorized_album_id: uncategorizedId });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 获取所有相册
  router.get('/api/albums', isAuthenticated, async (req, res) => {
    try {
      const albums = await imageDb.getAllAlbums();
      const uncategorizedId = await imageDb.getSetting('uncategorized_album_id');
      res.json({ success: true, albums, uncategorized_album_id: uncategorizedId });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 获取单个相册信息
  router.get('/api/albums/:id', isAuthenticated, async (req, res) => {
    try {
      const album = await imageDb.getAlbumById(parseInt(req.params.id));
      if (!album) return res.status(404).json({ success: false, error: '相册不存在' });
      res.json({ success: true, album });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 创建相册
  router.post('/api/albums', isAuthenticated, async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: '相册名称不能为空' });
      }
      const album = await imageDb.createAlbum(name.trim(), (description || '').trim());
      res.json({ success: true, album });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 更新相册
  router.put('/api/albums/:id', isAuthenticated, async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: '相册名称不能为空' });
      }
      const album = await imageDb.updateAlbum(
        parseInt(req.params.id),
        name.trim(),
        (description || '').trim()
      );
      if (!album) return res.status(404).json({ success: false, error: '相册不存在' });
      res.json({ success: true, album });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 删除相册（不允许删除「未分类」系统相册）
  router.delete('/api/albums/:id', isAuthenticated, async (req, res) => {
    try {
      const albumId = parseInt(req.params.id);
      const uncategorizedId = await imageDb.getSetting('uncategorized_album_id');
      if (String(albumId) === String(uncategorizedId)) {
        return res.status(403).json({ success: false, error: '「未分类」系统相册不可删除' });
      }
      // 删除前将该相册图片移至「未分类」
      await imageDb.migrateAlbumImagesToUncategorized(albumId, uncategorizedId);
      const ok = await imageDb.deleteAlbum(albumId);
      if (!ok) return res.status(404).json({ success: false, error: '相册不存在' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 设置相册封面
  router.post('/api/albums/:id/cover', isAuthenticated, async (req, res) => {
    try {
      const { image_id } = req.body;
      const ok = await imageDb.setAlbumCover(parseInt(req.params.id), image_id || null);
      if (!ok) return res.status(404).json({ success: false, error: '相册不存在' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 获取相册中的图片（分页）
  router.get('/api/albums/:id/images', isAuthenticated, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const data = await imageDb.getImagesByAlbumPaged(parseInt(req.params.id), page, limit);
      res.json({ success: true, ...data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 移动图片到相册
  router.put('/api/images/:id/album', isAuthenticated, async (req, res) => {
    try {
      const imageId = parseInt(req.params.id);
      const albumId = req.body.album_id ? parseInt(req.body.album_id) || null : null;
      const ok = await imageDb.updateImageAlbum(imageId, albumId);
      if (!ok) return res.status(404).json({ success: false, error: '图片不存在' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 批量移动图片到相册
  router.put('/api/albums/:id/images', isAuthenticated, async (req, res) => {
    try {
      const albumId = parseInt(req.params.id);
      const { image_ids } = req.body;
      if (!Array.isArray(image_ids) || image_ids.length === 0) {
        return res.status(400).json({ success: false, error: '请提供图片ID列表' });
      }
      await Promise.all(image_ids.map(id => imageDb.updateImageAlbum(parseInt(id), albumId)));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createAlbumsRoutes;
