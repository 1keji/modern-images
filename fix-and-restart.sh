#!/bin/bash

echo "=========================================="
echo "修复并重启 Docker 容器"
echo "=========================================="
echo ""

# 检测使用 docker compose 还是 docker-compose
if docker compose version > /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
elif docker-compose --version > /dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
else
    echo "❌ 未找到 docker-compose 命令"
    exit 1
fi

echo "📋 当前容器状态："
$COMPOSE_CMD ps
echo ""

echo "🛑 停止所有容器..."
$COMPOSE_CMD down

echo ""
echo "🗑️  清理旧镜像..."
docker rmi tc-app 2>/dev/null || true

echo ""
echo "🔨 重新构建镜像（不使用缓存）..."
$COMPOSE_CMD build --no-cache app

if [ $? -ne 0 ]; then
    echo "❌ 构建失败，请检查错误信息"
    exit 1
fi

echo ""
echo "🚀 启动所有服务..."
$COMPOSE_CMD up -d

echo ""
echo "⏳ 等待服务启动（30秒）..."
sleep 30

echo ""
echo "📊 服务状态："
$COMPOSE_CMD ps

echo ""
echo "📝 应用日志（最后 20 行）："
echo "=========================================="
$COMPOSE_CMD logs --tail=20 app

echo ""
echo "=========================================="
echo "✅ 修复完成！"
echo "=========================================="
echo ""
echo "检查应用状态："
echo "  docker compose ps"
echo ""
echo "查看实时日志："
echo "  docker compose logs -f app"
echo ""
echo "如果容器状态是 Up (healthy)，访问："
echo "  http://localhost:3000"
echo ""
