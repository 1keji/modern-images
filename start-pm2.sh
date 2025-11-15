#!/bin/bash

# 图床服务PM2启动脚本
# 使用方法: ./start-pm2.sh [端口号]

# 设置默认端口
DEFAULT_PORT=3000
PORT=${1:-$DEFAULT_PORT}

echo "=========================================="
echo "          图床服务 PM2 启动脚本"
echo "=========================================="
echo

# 检查PM2是否安装
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 未安装，请先安装PM2:"
    echo "   npm install -g pm2"
    exit 1
fi

echo "🔍 检查现有服务..."
pm2 describe image-hosting > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "⚠️  发现现有服务，正在重启..."
    PORT=$PORT pm2 restart image-hosting
else
    echo "🚀 启动新服务..."
    PORT=$PORT pm2 start server.js --name image-hosting
fi

if [ $? -eq 0 ]; then
    echo
    echo "✅ 服务启动成功！"
    echo "📊 访问地址: http://localhost:$PORT"
    echo
    echo "📋 常用命令:"
    echo "   查看状态: pm2 status"
    echo "   查看日志: pm2 logs image-hosting"
    echo "   停止服务: pm2 stop image-hosting"
    echo "   重启服务: pm2 restart image-hosting"
    echo "   删除服务: pm2 delete image-hosting"
    echo
else
    echo "❌ 服务启动失败，请检查日志: pm2 logs image-hosting"
    exit 1
fi 