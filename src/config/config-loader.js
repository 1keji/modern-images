const fs = require('fs');
const path = require('path');
const { clearAllSessions } = require('../utils/file-utils');

/**
 * 配置加载和管理模块
 */
class ConfigLoader {
  constructor() {
    this.configPath = path.join(process.cwd(), 'config.json');
    this.config = null;
    this.loadConfig();
    this.watchConfig();
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        delete require.cache[this.configPath];
        this.config = require(this.configPath);
      } else {
        this.config = this.getDefaultConfig();
        this.saveConfig();
      }
    } catch (error) {
      console.error('加载配置文件失败:', error);
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return {
      auth: {
        isConfigured: false,
        username: '',
        hashedPassword: '',
        salt: ''
      },
      api: {
        enabled: true,
        tokens: [],
        defaultFormat: 'original'
      },
      storage: {
        type: 'local'
      },
      imageQuality: {
        webp: 80,
        avif: 75,
        pngOptimize: false
      }
    };
  }

  /**
   * 检查认证配置是否已重置
   */
  isAuthReset(authConfig) {
    return (!authConfig.username || authConfig.username.trim() === '') &&
           (!authConfig.hashedPassword || authConfig.hashedPassword.trim() === '');
  }

  /**
   * 监听配置文件变化
   */
  watchConfig() {
    fs.watchFile(this.configPath, async (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        try {
          // 检查文件是否存在
          if (fs.existsSync(this.configPath)) {
            // 保存当前的API配置
            const currentApiConfig = this.config.api;

            // 重新读取配置文件
            delete require.cache[this.configPath];
            const newConfig = require(this.configPath);

            // 检查认证信息是否被重置
            if (this.isAuthReset(newConfig.auth)) {
              console.log('检测到认证信息被重置');
              // 清理所有session文件
              const sessionsDir = path.join(process.cwd(), 'sessions');
              clearAllSessions(sessionsDir);
              // 重置认证信息，但保留其他配置
              this.config = {
                auth: {
                  isConfigured: false,
                  username: '',
                  hashedPassword: '',
                  salt: ''  // 为了安全，当认证信息重置时，也重置salt
                },
                api: currentApiConfig,  // 保留原有的API配置
                storage: {
                  type: 'local'
                },
                imageQuality: {
                  webp: 80,
                  avif: 75,
                  pngOptimize: false
                }
              };
              // 保存更新后的配置
              await this.saveConfig();
              console.log('认证信息已重置，所有登录session已清理，其他配置保持不变');
            } else {
              // 如果认证信息没有被重置，直接使用新的配置
              this.config = newConfig;
              console.log('配置文件已更新');
            }
          } else {
            // 如果文件不存在，创建默认配置
            this.config = this.getDefaultConfig();
            // 保存默认配置
            await this.saveConfig();
            console.log('配置文件已重置为默认状态');
          }
        } catch (error) {
          console.error('更新配置文件时发生错误:', error);
        }
      }
    });
  }

  /**
   * 保存配置文件
   */
  async saveConfig() {
    try {
      // 保存到配置文件
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('保存配置失败:', error);
    }
  }

  /**
   * 获取配置
   */
  getConfig() {
    return this.config;
  }

  /**
   * 设置配置
   */
  setConfig(newConfig) {
    this.config = newConfig;
  }
}

module.exports = ConfigLoader;
