const path = require('path');

/**
 * 获取当前日期的年月日文件夹路径
 * @returns {string} 格式如 'YYYY/MM/DD'
 */
function getYearMonthPath() {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return path.join(year, month, day);
}

module.exports = {
  getYearMonthPath
};
