const express = require('express');
const { generateToken } = require('../services/image-processor');

/**
 * API令牌管理相关路由
 * 包括API启用状态、默认格式设置、令牌创建和删除等
 */
function createApiManagementRoutes(isAuthenticated, configLoader) {
  const router = express.Router();
  const config = configLoader.getConfig();

  /**
   * 获取所有API令牌和配置
   */
  router.get('/api/tokens', isAuthenticated, async (req, res) => {
    try {
      // 简化逻辑：直接使用内存中的配置
      // saveConfig() 已经确保配置同步到Redis和文件
      res.json({
        success: true,
        enabled: config.api.enabled,
        tokens: config.api.tokens,
        defaultFormat: config.api.defaultFormat
      });
    } catch (error) {
      console.error('获取API设置失败:', error);
      res.status(500).json({
        success: false,
        message: '获取API设置失败'
      });
    }
  });

  /**
   * 切换API启用状态
   */
  router.post('/api/toggle', isAuthenticated, async (req, res) => {
    try {
      config.api.enabled = !config.api.enabled;
      await configLoader.saveConfig();

      res.json({
        success: true,
        enabled: config.api.enabled
      });
    } catch (error) {
      console.error('切换API状态失败:', error);
      res.status(500).json({
        success: false,
        message: '保存设置失败'
      });
    }
  });

  /**
   * 设置API默认格式
   */
  router.post('/api/format', isAuthenticated, async (req, res) => {
    try {
      const { format } = req.body;

      if (!['original', 'webp', 'avif'].includes(format)) {
        return res.status(400).json({
          success: false,
          message: '无效的格式选项'
        });
      }

      config.api.defaultFormat = format;
      await configLoader.saveConfig();

      res.json({
        success: true,
        format: format
      });
    } catch (error) {
      console.error('设置API格式失败:', error);
      res.status(500).json({
        success: false,
        message: '保存设置失败'
      });
    }
  });

  /**
   * 创建新的API令牌
   */
  router.post('/api/tokens', isAuthenticated, async (req, res) => {
    try {
      const { name, expiresAt } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, message: '令牌名称不能为空' });
      }

      const newToken = {
        id: Date.now().toString(),
        name: name,
        token: generateToken(),
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt || null
      };

      config.api.tokens.push(newToken);
      await configLoader.saveConfig();

      res.json({
        success: true,
        token: newToken
      });
    } catch (error) {
      console.error('创建API令牌失败:', error);
      res.status(500).json({
        success: false,
        message: '保存令牌失败'
      });
    }
  });

  /**
   * 删除API令牌
   */
  router.delete('/api/tokens/:id', isAuthenticated, async (req, res) => {
    try {
      const tokenId = req.params.id;
      const tokenIndex = config.api.tokens.findIndex(t => t.id === tokenId);

      if (tokenIndex === -1) {
        return res.status(404).json({ success: false, message: '找不到指定的令牌' });
      }

      config.api.tokens.splice(tokenIndex, 1);
      await configLoader.saveConfig();

      res.json({
        success: true,
        message: '令牌已成功删除'
      });
    } catch (error) {
      console.error('删除API令牌失败:', error);
      res.status(500).json({
        success: false,
        message: '删除令牌失败'
      });
    }
  });

  return router;
}

module.exports = createApiManagementRoutes;
