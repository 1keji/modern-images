/**
 * 数据库模块 - 向后兼容包装器
 *
 * 此文件现在从模块化的 database/ 目录导出 ImageDatabase 类
 * 原始代码已拆分为以下模块：
 * - database/connection.js  - 连接池管理、重连机制
 * - database/schema.js      - 表结构定义、索引创建
 * - database/images.js      - 图片 CRUD 操作
 * - database/categories.js  - 分类管理操作
 * - database/backup.js      - 备份/恢复功能
 * - database/settings.js    - 系统设置管理
 * - database/integrity.js   - 数据完整性检查
 * - database/utils.js       - 工具函数
 * - database/index.js       - 主入口，组合所有模块
 *
 * 旧代码备份在 database.js.backup
 */

module.exports = require('./database/');
