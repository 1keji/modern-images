/**
 * 数据库表结构模块
 * 处理表创建和索引定义
 */

const SchemaMixin = {
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

    const addIsAnimatedColumn = `
      ALTER TABLE images
      ADD COLUMN IF NOT EXISTS is_animated BOOLEAN DEFAULT false
    `;

    const createAlbumsTable = `
      CREATE TABLE IF NOT EXISTS albums (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        cover_image_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const addAlbumIdColumn = `
      ALTER TABLE images
      ADD COLUMN IF NOT EXISTS album_id INTEGER
    `;

    const addAlbumsForeignKey = `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_albums_cover_image'
        ) THEN
          ALTER TABLE albums ADD CONSTRAINT fk_albums_cover_image
            FOREIGN KEY (cover_image_id) REFERENCES images(id) ON DELETE SET NULL;
        END IF;
      END $$
    `;

    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_images_path ON images(path)',
      'CREATE INDEX IF NOT EXISTS idx_images_upload_time ON images(upload_time DESC)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage ON images(storage)',
      'CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(key)',
      'CREATE INDEX IF NOT EXISTS idx_settings_updated_at ON system_settings(updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage_created ON images(storage, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_format ON images(format)',
      'CREATE INDEX IF NOT EXISTS idx_images_file_size ON images(file_size)',
      'CREATE INDEX IF NOT EXISTS idx_images_hot_path_covering ON images(created_at DESC, storage) INCLUDE (id, filename, path, url, markdown_code, file_size, format)',
      'CREATE INDEX IF NOT EXISTS idx_images_created_id_desc ON images(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage_created_covering ON images(storage, created_at DESC) INCLUDE (id, filename, path, url)',
      'CREATE INDEX IF NOT EXISTS idx_images_upload_time_desc_id ON images(upload_time DESC, id ASC)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage_upload_time ON images(storage, upload_time DESC) INCLUDE (id, filename, path, url)',
      'CREATE INDEX IF NOT EXISTS idx_images_is_animated ON images(is_animated) WHERE is_animated = true',
      'CREATE INDEX IF NOT EXISTS idx_images_album ON images(album_id)',
      'CREATE INDEX IF NOT EXISTS idx_albums_created_at ON albums(created_at DESC)'
    ];

    try {
      const client = await this.pool.connect();
      try {
        await client.query(createImagesTable);
        await client.query(createSettingsTable);
        await client.query(addIsAnimatedColumn);
        await client.query(createAlbumsTable);
        await client.query(addAlbumIdColumn);
        await client.query(addAlbumsForeignKey);
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
};

module.exports = SchemaMixin;
