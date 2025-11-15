# 多阶段构建 - 生产环境优化
FROM node:18-alpine AS base

# 安装必要的系统依赖（Sharp 需要）
RUN apk add --no-cache \
    libc6-compat \
    postgresql-client \
    redis \
    su-exec \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 生产依赖安装阶段
FROM base AS production-deps
# 使用 npm install 而不是 npm ci（兼容没有 package-lock.json 的情况）
RUN npm install --omit=dev --no-audit --no-fund

# 开发依赖安装阶段（如果需要构建步骤）
FROM base AS build-deps
RUN npm install --no-audit --no-fund

# 最终生产镜像
FROM base AS production

# 设置环境变量
ENV NODE_ENV=production \
    PORT=3000

# 从生产依赖阶段复制 node_modules
COPY --from=production-deps /app/node_modules ./node_modules

# 先复制并设置 entrypoint 脚本（在复制所有文件之前）
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 复制应用代码
COPY . .

# 创建必要的目录并设置权限
RUN mkdir -p uploads sessions backups logs \
    && chown -R node:node /app

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 使用 entrypoint 脚本（以 root 身份运行以修复权限，然后切换到 node 用户）
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# 默认命令
CMD ["node", "server.js"]
