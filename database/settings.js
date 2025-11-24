/**
 * 系统设置管理模块
 * 处理系统设置的 CRUD 操作
 */

const SettingsMixin = {
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
  },

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
  },

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
  },

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
  },

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
};

module.exports = SettingsMixin;
