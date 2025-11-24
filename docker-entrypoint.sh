#!/bin/sh
set -e

echo "====================================="
echo "Image Hosting Service - Starting..."
echo "====================================="

# 等待 PostgreSQL 准备就绪
echo "Waiting for PostgreSQL to be ready..."
max_retries=30
retry_count=0

until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" > /dev/null 2>&1; do
  retry_count=$((retry_count + 1))
  if [ $retry_count -ge $max_retries ]; then
    echo "Error: PostgreSQL is not available after $max_retries attempts"
    exit 1
  fi
  echo "PostgreSQL is unavailable - waiting... (attempt $retry_count/$max_retries)"
  sleep 2
done

echo "PostgreSQL is ready!"

# 等待 Redis 准备就绪（如果启用）
if [ "$REDIS_ENABLED" = "true" ]; then
  echo "Waiting for Redis to be ready..."
  retry_count=0

  until redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; do
    retry_count=$((retry_count + 1))
    if [ $retry_count -ge $max_retries ]; then
      echo "Warning: Redis is not available after $max_retries attempts, continuing anyway..."
      break
    fi
    echo "Redis is unavailable - waiting... (attempt $retry_count/$max_retries)"
    sleep 2
  done

  if [ $retry_count -lt $max_retries ]; then
    echo "Redis is ready!"
  fi
fi

# 创建必要的目录（如果不存在）
echo "Creating necessary directories..."
mkdir -p /app/uploads
mkdir -p /app/sessions
mkdir -p /app/backups
mkdir -p /app/logs

# 创建 config.json 如果不存在
if [ ! -f /app/config.json ]; then
  echo "Creating default config.json..."
  cat > /app/config.json <<EOF
{
  "username": "",
  "password": "",
  "apiTokens": [],
  "storageType": "local",
  "imageQuality": {
    "webp": 80,
    "avif": 75,
    "pngOptimize": false
  },
  "redis": {
    "enabled": true
  },
  "domains": {
    "allowedDomains": [],
    "imageDomain": "",
    "domainSecurityEnabled": false
  }
}
EOF
fi

# 设置目录和文件权限（尝试修改权限，如果失败则继续）
echo "Setting permissions..."
chmod -R 755 /app/uploads /app/sessions /app/backups /app/logs 2>/dev/null || true
chmod 644 /app/config.json 2>/dev/null || true

# 如果无法修改权限（只读挂载），警告用户但继续启动
if [ ! -w /app/config.json ]; then
  echo "WARNING: /app/config.json is not writable. Configuration changes will not be saved."
  echo "Please ensure the file has correct permissions on the host system."
fi

# 尝试修复文件所有权（如果以 root 运行）
if [ "$(id -u)" = "0" ]; then
  echo "Running as root, fixing ownership..."
  chown -R node:node /app/uploads /app/sessions /app/backups /app/logs 2>/dev/null || true
  chown node:node /app/config.json 2>/dev/null || true
fi

echo "====================================="
echo "Starting application..."
echo "Port: $PORT"
echo "Node Environment: $NODE_ENV"
echo "Database: $DB_HOST:$DB_PORT/$DB_NAME"
echo "Redis: ${REDIS_ENABLED:-false}"
echo "Storage Type: ${STORAGE_TYPE:-local}"
echo "====================================="

# 如果以 root 运行，切换到 node 用户执行命令
if [ "$(id -u)" = "0" ]; then
  echo "Switching to node user..."
  exec su-exec node "$@"
else
  # 否则直接执行命令
  exec "$@"
fi
