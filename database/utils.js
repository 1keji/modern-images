/**
 * 数据库工具函数模块
 */

const UtilsMixin = {
  // 解析 INSERT VALUES 部分
  parseInsertValues(valuesPart) {
    try {
      const values = [];
      let current = '';
      let inQuotes = false;
      let i = 0;

      while (i < valuesPart.length) {
        const char = valuesPart[i];

        if (char === "'" && (i === 0 || valuesPart[i - 1] !== '\\')) {
          if (inQuotes) {
            if (i + 1 < valuesPart.length && valuesPart[i + 1] === "'") {
              current += "'";
              i += 2;
              continue;
            } else {
              inQuotes = false;
            }
          } else {
            inQuotes = true;
          }
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else if (!inQuotes && char === ' ') {
          // 跳过引号外的空格
        } else {
          current += char;
        }
        i++;
      }

      if (current.trim()) {
        values.push(current.trim());
      }

      return values;
    } catch (error) {
      console.error('解析 INSERT 值失败:', error);
      return null;
    }
  }
};

module.exports = UtilsMixin;
