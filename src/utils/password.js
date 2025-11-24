const crypto = require('crypto');

/**
 * 生成随机盐值
 * @returns {string} 16字节的十六进制盐值
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 使用PBKDF2算法对密码进行哈希
 * @param {string} password - 明文密码
 * @param {string} salt - 盐值
 * @returns {string} 哈希后的密码
 */
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

module.exports = {
  generateSalt,
  hashPassword
};
