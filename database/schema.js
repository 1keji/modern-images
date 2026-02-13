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

    const createCategoriesTable = `
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    const addCategoryIdColumn = `
      ALTER TABLE images
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
    `;

    const addIsAnimatedColumn = `
      ALTER TABLE images
      ADD COLUMN IF NOT EXISTS is_animated BOOLEAN DEFAULT false
    `;

    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_images_path ON images(path)',
      'CREATE INDEX IF NOT EXISTS idx_images_upload_time ON images(upload_time DESC)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage ON images(storage)',
      'CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_category ON images(category_id)',
      'CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)',
      'CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(key)',
      'CREATE INDEX IF NOT EXISTS idx_settings_updated_at ON system_settings(updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage_created ON images(storage, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_category_created ON images(category_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_format ON images(format)',
      'CREATE INDEX IF NOT EXISTS idx_images_file_size ON images(file_size)',
      'CREATE INDEX IF NOT EXISTS idx_images_category_null ON images(category_id) WHERE category_id IS NULL',
      'CREATE INDEX IF NOT EXISTS idx_categories_name_lower ON categories(LOWER(name))',
      'CREATE INDEX IF NOT EXISTS idx_images_hot_path_covering ON images(created_at DESC, storage, category_id) INCLUDE (id, filename, path, url, markdown_code, file_size, format)',
      'CREATE INDEX IF NOT EXISTS idx_images_created_id_desc ON images(created_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_images_uncategorized_created ON images(created_at DESC) WHERE category_id IS NULL',
      'CREATE INDEX IF NOT EXISTS idx_images_storage_created_covering ON images(storage, created_at DESC) INCLUDE (id, filename, path, url, category_id)',
      'CREATE INDEX IF NOT EXISTS idx_images_upload_time_desc_id ON images(upload_time DESC, id ASC)',
      'CREATE INDEX IF NOT EXISTS idx_images_category_upload_time ON images(category_id, upload_time DESC) INCLUDE (id, filename, path, url, markdown_code, html_code, file_size, format, storage)',
      'CREATE INDEX IF NOT EXISTS idx_images_storage_upload_time ON images(storage, upload_time DESC) INCLUDE (id, filename, path, url, category_id)',
      'CREATE INDEX IF NOT EXISTS idx_images_is_animated ON images(is_animated) WHERE is_animated = true'
    ];

    try {
      const client = await this.pool.connect();
      try {
        await client.query(createImagesTable);
        await client.query(createCategoriesTable);
        await client.query(createSettingsTable);
        await client.query(addCategoryIdColumn);
        await client.query(addIsAnimatedColumn);
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
