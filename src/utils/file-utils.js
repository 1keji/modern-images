const fs = require('fs');
const path = require('path');

/**
 * 确保目录存在，不存在则创建
 * @param {string} dir - 目录路径
 */
function ensureDirExistence(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 递归获取目录下所有文件
 * 优化版本，支持文件缓存
 * @param {string} dir - 目录路径
 * @param {Array} fileList - 文件列表累积器
 * @param {Object} cache - 文件系统缓存对象（可选）
 * @returns {Array} 文件路径列表
 */
function getAllFiles(dir, fileList = [], cache = null) {
  const now = Date.now();
  const isRootCall = fileList.length === 0; // 判断是否为根调用

  // 只在根调用时使用缓存
  if (isRootCall && cache && cache.lastScan &&
      (now - cache.lastScan) < cache.cacheTimeout &&
      cache.files.length > 0) {
    return cache.files.slice(); // Return copy to prevent mutations
  }

  if (fs.existsSync(dir)) {
    try {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        try {
          if (fs.statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList, null); // 递归时不传递缓存
          } else {
            // Only include image files to improve performance
            const ext = path.extname(file).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext)) {
              fileList.push(filePath);
            }
          }
        } catch (statError) {
          console.warn(`Unable to stat file: ${filePath}`, statError.message);
        }
      });
    } catch (readError) {
      console.error(`Error reading directory: ${dir}`, readError.message);
    }
  }

  // 只在根调用时更新缓存
  if (isRootCall && cache) {
    cache.lastScan = now;
    cache.files = fileList.slice();
  }

  return fileList;
}

/**
 * 清理所有session文件
 * @param {string} sessionsDir - sessions目录路径
 */
function clearAllSessions(sessionsDir) {
  if (fs.existsSync(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir);
      for (const file of files) {
        if (file.startsWith('sess_')) {
          fs.unlinkSync(path.join(sessionsDir, file));
        }
      }
      console.log('所有session文件已清理');
    } catch (error) {
      console.error('清理session文件时发生错误:', error);
    }
  }
}

/**
 * 获取文件的Content-Type
 * @param {string} filename - 文件名
 * @returns {string} MIME类型
 */
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = {
  ensureDirExistence,
  getAllFiles,
  clearAllSessions,
  getContentType
};
