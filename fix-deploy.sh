#!/bin/bash
# 快速修复和部署脚本
# 使用方法: bash fix-deploy.sh

set -e

echo "======================================="
echo "图床服务修复和部署脚本"
echo "======================================="

# 检查是否在正确的目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在包含 docker-compose.yml 的目录中运行此脚本"
    exit 1
fi

echo ""
echo "步骤 1/6: 停止现有容器..."
docker-compose down || true

echo ""
echo "步骤 2/6: 删除旧镜像（强制重建）..."
docker rmi tci-app 2>/dev/null || echo "镜像不存在，跳过删除"

echo ""
echo "步骤 3/6: 修复文件权限..."
# 创建目录（如果不存在）
mkdir -p uploads sessions backups logs

# 设置权限
chmod -R 755 uploads sessions backups logs 2>/dev/null || {
    echo "警告: 无法修改权限，尝试使用 sudo..."
    sudo chmod -R 755 uploads sessions backups logs
    sudo chown -R 1000:1000 uploads sessions backups logs
}

# 处理 config.json
if [ -f config.json ]; then
    echo "config.json 已存在，修复权限..."
    chmod 644 config.json 2>/dev/null || sudo chmod 644 config.json
    chown 1000:1000 config.json 2>/dev/null || sudo chown 1000:1000 config.json
else
    echo "config.json 不存在，将在容器启动时自动创建"
fi

echo ""
echo "步骤 4/6: 确保 docker-entrypoint.sh 使用正确的换行符..."
if command -v dos2unix &> /dev/null; then
    dos2unix docker-entrypoint.sh 2>/dev/null || true
else
    sed -i 's/\r$//' docker-entrypoint.sh 2>/dev/null || true
fi

echo ""
echo "步骤 5/6: 重新构建镜像..."
docker-compose build --no-cache app

echo ""
echo "步骤 6/6: 启动服务..."
docker-compose up -d

echo ""
echo "======================================="
echo "部署完成！等待容器健康检查..."
echo "======================================="

# 等待并检查容器状态
echo ""
echo "等待 40 秒让容器启动..."
sleep 40

echo ""
echo "容器状态:"
docker ps | grep -E "CONTAINER ID|image-hosting"

echo ""
echo "应用日志（最后 30 行）:"
docker logs image-hosting-app --tail=30

echo ""
echo "======================================="
echo "检查要点:"
echo "1. 容器状态应该是 'healthy'"
echo "2. 日志中应该没有错误信息"
echo "3. 访问您的网站 URL 测试登录功能"
echo "======================================="
echo ""
echo "常用命令:"
echo "- 查看实时日志: docker-compose logs -f app"
echo "- 重启应用: docker-compose restart app"
echo "- 查看所有容器: docker ps"
echo "- 进入容器: docker exec -it image-hosting-app sh"
echo "======================================="
