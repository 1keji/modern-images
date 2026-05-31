/**
 * 相册管理模块
 * 处理相册的 CRUD 操作及图片归属管理
 */

const AlbumsMixin = {
  // 确保「未分类」系统相册存在，并将 album_id 为 NULL 的旧图片迁移进去
  async ensureUncategorizedAlbum() {
    const client = await this.pool.connect();
    try {
      // 先从 system_settings 读取已存储的 ID
      const settingRow = await client.query(
        "SELECT value FROM system_settings WHERE key = 'uncategorized_album_id'"
      );

      let albumId = null;
      if (settingRow.rows.length > 0) {
        albumId = settingRow.rows[0].value;
        // 验证相册还存在
        const check = await client.query('SELECT id FROM albums WHERE id = $1', [albumId]);
        if (check.rows.length === 0) albumId = null;
      }

      if (!albumId) {
        // 创建「未分类」相册
        const ins = await client.query(
          "INSERT INTO albums (name, description) VALUES ('未分类', '系统默认相册，存放未归类的图片') RETURNING id"
        );
        albumId = ins.rows[0].id;
        // 保存到 system_settings
        await client.query(`
          INSERT INTO system_settings (key, value, description)
          VALUES ('uncategorized_album_id', $1, '未分类系统相册ID')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, [albumId]);
        console.log(`创建「未分类」系统相册，ID: ${albumId}`);
      }

      // 将所有 album_id 为 NULL 的图片迁移到「未分类」相册
      const migrated = await client.query(
        'UPDATE images SET album_id = $1 WHERE album_id IS NULL',
        [albumId]
      );
      if (migrated.rowCount > 0) {
        console.log(`迁移 ${migrated.rowCount} 张旧图片到「未分类」相册`);
      }

      return albumId;
    } finally {
      client.release();
    }
  },


  async createAlbum(name, description = '') {
    const client = await this.pool.connect();
    try {
      const sql = `
        INSERT INTO albums (name, description)
        VALUES ($1, $2)
        RETURNING id, name, description, cover_image_id, created_at
      `;
      const result = await client.query(sql, [name, description]);
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  async updateAlbum(id, name, description) {
    const client = await this.pool.connect();
    try {
      const sql = `
        UPDATE albums SET name = $2, description = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, description, updated_at
      `;
      const result = await client.query(sql, [id, name, description]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  },

  async migrateAlbumImagesToUncategorized(albumId, uncategorizedId) {
    const client = await this.pool.connect();
    try {
      await client.query(
        'UPDATE images SET album_id = $2 WHERE album_id = $1',
        [albumId, uncategorizedId]
      );
    } finally {
      client.release();
    }
  },

  async deleteAlbum(id) {
    const client = await this.pool.connect();
    try {
      const result = await client.query('DELETE FROM albums WHERE id = $1', [id]);
      return result.rowCount > 0;
    } finally {
      client.release();
    }
  },

  async getAllAlbums() {
    const client = await this.pool.connect();
    try {
      const sql = `
        SELECT a.id, a.name, a.description, a.cover_image_id, a.created_at,
               COUNT(i.id)::int AS image_count,
               ci.url AS cover_url
        FROM albums a
        LEFT JOIN images i ON i.album_id = a.id
        LEFT JOIN images ci ON ci.id = a.cover_image_id
        GROUP BY a.id, a.name, a.description, a.cover_image_id, a.created_at, ci.url
        ORDER BY a.created_at DESC
      `;
      const result = await client.query(sql);
      return result.rows;
    } finally {
      client.release();
    }
  },

  async getAlbumById(id) {
    const client = await this.pool.connect();
    try {
      const sql = `
        SELECT a.id, a.name, a.description, a.cover_image_id, a.created_at,
               COUNT(i.id)::int AS image_count,
               ci.url AS cover_url
        FROM albums a
        LEFT JOIN images i ON i.album_id = a.id
        LEFT JOIN images ci ON ci.id = a.cover_image_id
        WHERE a.id = $1
        GROUP BY a.id, a.name, a.description, a.cover_image_id, a.created_at, ci.url
      `;
      const result = await client.query(sql, [id]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  },

  async setAlbumCover(albumId, imageId) {
    const client = await this.pool.connect();
    try {
      const sql = 'UPDATE albums SET cover_image_id = $2, updated_at = NOW() WHERE id = $1';
      const result = await client.query(sql, [albumId, imageId || null]);
      return result.rowCount > 0;
    } finally {
      client.release();
    }
  },

  async getImagesByAlbumPaged(albumId, page = 1, limit = 50) {
    const client = await this.pool.connect();
    try {
      const countResult = await client.query(
        'SELECT COUNT(*) AS total FROM images WHERE album_id = $1', [albumId]
      );
      const total = parseInt(countResult.rows[0].total);
      const offset = (page - 1) * limit;

      const sql = `
        SELECT * FROM images WHERE album_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3
      `;
      const result = await client.query(sql, [albumId, limit, offset]);

      const images = result.rows.map(row => ({
        _id: row.id,
        filename: row.filename,
        path: row.path,
        uploadTime: row.upload_time,
        fileSize: row.file_size,
        storage: row.storage,
        format: row.format,
        url: row.url,
        htmlCode: row.html_code,
        markdownCode: row.markdown_code,
        albumId: row.album_id,
        isAnimated: row.is_animated || false
      }));

      return {
        images,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 }
      };
    } finally {
      client.release();
    }
  },

  async updateImageAlbum(imageId, albumId) {
    const client = await this.pool.connect();
    try {
      const sql = 'UPDATE images SET album_id = $2 WHERE id = $1';
      const result = await client.query(sql, [imageId, albumId || null]);
      return result.rowCount > 0;
    } finally {
      client.release();
    }
  }
};

module.exports = AlbumsMixin;
