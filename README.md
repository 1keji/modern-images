**本次更新内容：**

- 去除分类设定
- 添加相册设定
- 如果不想使用相册的话，或者只想使用分类功能的话。请不要更新。（相册功能的使用体验个人觉得更好一些），个人测试兼容旧版本。
- 下载覆盖原文件，然后执行如下步骤。

---

## 更新后的操作

 修改源代码后，必须重新构建镜像：

  docker-compose down
  docker-compose build --no-cache
  docker-compose up -d

---



在网站搜索现代图床可以看到更多历史信息。

![image-20260214180958421](https://img.211200.xyz/i/api/2026/02/14/b5d1c9b73588f3a2001.webp)

---

# 现代图床 使用说明

## 项目简介

基于 Node.js + Express + PostgreSQL 的私有图床系统，支持本地存储与 Cloudflare R2 云存储，提供 Web 界面和 API 两种使用方式。

---

## 技术栈

| 组件     | 说明                          |
| -------- | ----------------------------- |
| 运行时   | Node.js + Express             |
| 数据库   | PostgreSQL 15                 |
| 图片处理 | Sharp（WebP / AVIF 转换）     |
| 云存储   | Cloudflare R2（兼容 S3 协议） |
| 缓存     | Redis（可选）                 |
| 进程管理 | PM2                           |
| 容器化   | Docker + Docker Compose       |

---

## 快速部署

### 方式一：Docker Compose（推荐）

```bash
# 1. 复制环境配置
cp .env.example .env

# 2. 编辑 .env，修改密码和密钥
#    SESSION_SECRET、DB_PASSWORD 必须修改

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f app

# 5. 停止服务
docker-compose down
```

首次访问 `http://服务器IP:3000` 会自动跳转到初始化设置页面，设置管理员账号密码。

### 方式二：直接运行

```bash
npm install

# 生产环境
npm start

# 开发模式
npm run dev

# PM2 守护进程
npm run pm2:start
```

---

## 环境变量配置（.env）

### 基础配置

| 变量             | 默认值       | 说明                                   |
| ---------------- | ------------ | -------------------------------------- |
| `PORT`           | `3000`       | 服务端口                               |
| `SESSION_SECRET` | —            | Session 加密密钥，**必须修改**         |
| `NODE_ENV`       | `production` | 运行环境                               |
| `DEBUG_MODE`     | `F`          | `T`=调试模式（禁用缓存），`F`=生产模式 |

### 数据库配置

| 变量          | 默认值          | 说明                                                   |
| ------------- | --------------- | ------------------------------------------------------ |
| `DB_HOST`     | `postgres`      | PostgreSQL 地址（Docker 用服务名，本地用 `localhost`） |
| `DB_PORT`     | `5432`          | 端口                                                   |
| `DB_NAME`     | `image_hosting` | 数据库名                                               |
| `DB_USER`     | `imghost`       | 用户名                                                 |
| `DB_PASSWORD` | `changeme123`   | 密码，**必须修改**                                     |
| `DB_SSL`      | `false`         | 是否启用 SSL                                           |

### 存储配置

| 变量           | 默认值  | 说明            |
| -------------- | ------- | --------------- |
| `STORAGE_TYPE` | `local` | `local` 或 `r2` |

**使用 R2 云存储时需额外配置：**

| 变量                   | 说明                |
| ---------------------- | ------------------- |
| `R2_ENABLED`           | 设为 `true`         |
| `R2_ACCESS_KEY_ID`     | R2 访问密钥 ID      |
| `R2_SECRET_ACCESS_KEY` | R2 访问密钥         |
| `R2_ENDPOINT`          | R2 端点 URL         |
| `R2_BUCKET`            | Bucket 名称         |
| `R2_REGION`            | 区域（默认 `auto`） |
| `R2_CUSTOM_DOMAIN`     | 自定义域名（可选）  |

### 图片处理配置

| 变量                         | 默认值  | 说明               |
| ---------------------------- | ------- | ------------------ |
| `IMAGE_QUALITY_WEBP`         | `80`    | WebP 质量（0-100） |
| `IMAGE_QUALITY_AVIF`         | `75`    | AVIF 质量（0-100） |
| `IMAGE_QUALITY_PNG_OPTIMIZE` | `false` | 是否优化 PNG       |

### 备份配置

| 变量                         | 默认值 | 说明             |
| ---------------------------- | ------ | ---------------- |
| `AUTO_BACKUP_ENABLED`        | `true` | 是否启用自动备份 |
| `AUTO_BACKUP_INTERVAL_HOURS` | `24`   | 备份间隔（小时） |
| `AUTO_BACKUP_KEEP_COUNT`     | `7`    | 保留备份数量     |

---

## 功能说明

### 1. 图片上传

- 支持批量上传多张图片
- 上传格式选项：
  - `original`：保持原格式
  - `webp`：转换为 WebP（体积更小）
  - `avif`：转换为 AVIF（压缩率更高）
- 文件自动重命名为 `{16位随机hex}{3位序号}.{ext}`，防止重名
- 本地存储路径按 `年/月` 分目录存放（`uploads/YYYY/MM/`）
- API 上传路径额外加 `api/` 前缀（`uploads/api/YYYY/MM/`）

### 2. 相册管理

- 创建、编辑、删除相册
- 为相册设置封面图片
- 将图片移入/移出相册
- 系统自动维护一个"未分类"相册

### 3. 图片库（Gallery）

- 分页浏览所有上传图片
- 支持删除图片（同时清除本地文件或 R2 对象）
- 支持设置动图自动播放
- 首页可配置是否显示最近上传

### 4. 存储管理

- 在本地存储和 Cloudflare R2 之间切换
- 查看存储统计信息
- 支持存储迁移（本地 ↔ R2）
- R2 上传失败时自动回退到本地存储

### 5. 数据库管理（管理中心）

- 手动触发数据库备份（生成 SQL 文件）
- 从备份文件恢复数据库
- 上传 SQL 文件恢复
- 从 SQLite 导入历史数据
- 查看数据库连接状态

### 6. API 管理

- 创建/删除 API Token
- 启用/禁用 API 访问
- 设置 API 默认上传格式（`original`/`webp`/`avif`）
- 设置 API 默认目标相册

### 7. Redis 缓存管理

- 查看 Redis 连接状态
- 刷新全部缓存
- 单独失效图片缓存 / 配置缓存
- 配置内存上限和 TTL 策略
- Redis 未连接时系统自动降级，不影响基本功能

### 8. 系统设置

- **图片质量**：调整 WebP/AVIF 压缩质量
- **图片域名**：设置自定义图片访问域名（CDN 加速）
- **域名安全**：限制只允许特定域名访问，防盗链
- **显示设置**：控制首页最近上传展示

---

## 页面路由

| 路径                | 说明                    |
| ------------------- | ----------------------- |
| `/`                 | 首页（上传入口）        |
| `/gallery`          | 图片库                  |
| `/albums`           | 相册列表                |
| `/albums/:id`       | 相册详情                |
| `/admin-center`     | 管理中心（数据库/备份） |
| `/settings`         | 系统设置                |
| `/api-management`   | API 管理                |
| `/redis-management` | Redis 管理              |
| `/login`            | 登录页                  |
| `/setup`            | 初始化设置（首次使用）  |

---

## API 接口

### 认证方式

在请求头中添加 Token：

```
Authorization: Bearer {your-api-token}
```

或通过 URL 参数：

```
?token={your-api-token}
```

Token 在 `/api-management` 页面创建。

### 上传图片

```
POST /api/upload
```

**请求**（`multipart/form-data`）：

| 参数       | 类型   | 说明                                                  |
| ---------- | ------ | ----------------------------------------------------- |
| `images`   | File[] | 图片文件（支持多张）                                  |
| `format`   | string | 格式：`original`/`webp`/`avif`（可选，默认用API设置） |
| `storage`  | string | 存储：`auto`/`local`/`r2`（可选）                     |
| `album_id` | number | 目标相册 ID（可选）                                   |

**响应示例**：

```json
{
  "success": true,
  "images": [
    {
      "url": "https://your-domain.com/i/2025/05/abc123001.webp",
      "filename": "abc123001.webp",
      "format": "webp",
      "storage": "r2"
    }
  ]
}
```

### 其他常用接口

| 方法   | 路径                   | 说明                |
| ------ | ---------------------- | ------------------- |
| `GET`  | `/api/health`          | 健康检查            |
| `GET`  | `/api/auth-status`     | 登录状态            |
| `GET`  | `/images`              | 获取图片列表        |
| `GET`  | `/images/paged`        | 分页获取图片        |
| `POST` | `/api/delete`          | 删除图片            |
| `GET`  | `/api/albums`          | 获取相册列表        |
| `POST` | `/api/albums`          | 创建相册            |
| `GET`  | `/api/storage-stats`   | 存储统计            |
| `GET`  | `/api/settings`        | 获取系统设置        |
| `POST` | `/api/settings`        | 更新系统设置        |
| `GET`  | `/api/tokens`          | 获取 API Token 列表 |
| `POST` | `/api/backup-database` | 触发数据库备份      |

---

## 持久化目录（Docker）

Docker 部署时以下目录会挂载到宿主机：

| 容器路径           | 说明                        |
| ------------------ | --------------------------- |
| `/app/uploads`     | 上传的图片文件              |
| `/app/sessions`    | 会话数据（不使用 Redis 时） |
| `/app/backups`     | 数据库备份文件              |
| `/app/logs`        | 应用日志                    |
| `/app/config.json` | 系统配置文件                |

---

## PM2 常用命令

```bash
npm run pm2:start    # 启动
npm run pm2:stop     # 停止
npm run pm2:restart  # 重启
npm run pm2:logs     # 查看日志
npm run pm2:status   # 查看状态
```

---

## 注意事项

1. **首次部署**：访问服务后会自动跳转到 `/setup` 完成管理员账号设置，设置完成后该页面关闭。
2. **Session 密钥**：`SESSION_SECRET` 必须设置为随机强密码，否则存在安全风险。
3. **数据库密码**：生产环境务必修改 `DB_PASSWORD` 默认值。
4. **R2 配置**：`STORAGE_TYPE` 改为 `r2` 后还需同时设置所有 `R2_*` 环境变量并在管理界面测试连接。
5. **域名安全**：启用域名安全功能后，非白名单域名的请求会被拦截，配置前请确认已添加所有合法域名。
6. **Redis 可选**：Redis 不是必需组件，未配置时系统自动使用文件会话和无缓存模式运行。
