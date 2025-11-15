#!/bin/bash

echo "=========================================="
echo "图床系统 Docker 启动脚本"
echo "=========================================="
echo ""

# 检查 .env 文件是否存在
if [ ! -f .env ]; then
    echo "⚠️  未找到 .env 文件，正在从 .env.example 创建..."
    cp .env.example .env
    echo "✅ .env 文件已创建"
    echo ""
    echo "⚠️  请编辑 .env 文件，修改以下配置："
    echo "   - SESSION_SECRET (改为随机字符串)"
    echo "   - DB_PASSWORD (改为强密码)"
    echo "   - REDIS_PASSWORD (改为强密码)"
    echo ""
    read -p "按回车继续（或 Ctrl+C 退出先修改配置）..."
fi

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker"
    exit 1
fi

echo "🔍 检查 Docker Compose 版本..."
if docker compose version > /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    echo "✅ 使用 Docker Compose V2"
    echo "   版本: $(docker compose version --short 2>/dev/null || echo 'unknown')"
elif docker-compose --version > /dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
    echo "✅ 使用 Docker Compose V1"
    echo "   版本: $(docker-compose --version 2>/dev/null || echo 'unknown')"
else
    echo "❌ 未找到 docker-compose 命令"
    echo "   请先安装 Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

echo ""
echo "🚀 启动服务..."
echo ""

# 停止旧容器（如果存在）
$COMPOSE_CMD down 2>/dev/null

# 构建并启动
$COMPOSE_CMD up -d --build

# 检查启动状态
echo ""
echo "⏳ 等待服务启动..."
sleep 5

echo ""
echo "📊 服务状态："
$COMPOSE_CMD ps

echo ""
echo "=========================================="
echo "🎉 启动完成！"
echo "=========================================="
echo ""
echo "📝 后续步骤："
echo "   1. 查看日志: $COMPOSE_CMD logs -f app"
echo "   2. 访问应用: http://localhost:3000"
echo "   3. 首次访问: http://localhost:3000/setup"
echo ""
echo "🛠️  常用命令："
echo "   停止服务: $COMPOSE_CMD down"
echo "   重启服务: $COMPOSE_CMD restart"
echo "   查看日志: $COMPOSE_CMD logs -f"
echo ""
