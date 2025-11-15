#!/bin/bash

echo "=========================================="
echo "生成 package-lock.json"
echo "=========================================="
echo ""

# 检查是否已存在 package-lock.json
if [ -f "package-lock.json" ]; then
    echo "⚠️  package-lock.json 已存在"
    read -p "是否要重新生成？(y/N): " confirm
    if [[ ! $confirm =~ ^[Yy]$ ]]; then
        echo "取消操作"
        exit 0
    fi
    echo "删除现有的 package-lock.json..."
    rm package-lock.json
fi

# 检查 package.json 是否存在
if [ ! -f "package.json" ]; then
    echo "❌ 未找到 package.json 文件"
    exit 1
fi

echo "🔍 检查 Node.js 和 npm..."
node --version
npm --version

echo ""
echo "📦 安装依赖并生成 package-lock.json..."
echo ""

# 删除 node_modules（可选，确保干净安装）
if [ -d "node_modules" ]; then
    echo "删除现有的 node_modules..."
    rm -rf node_modules
fi

# 使用 npm install 生成 package-lock.json
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ package-lock.json 已生成"
    echo "=========================================="
    echo ""
    echo "现在您可以："
    echo "  1. 将 package-lock.json 提交到版本控制"
    echo "  2. 使用优化的 Dockerfile.optimized 构建镜像"
    echo "  3. 运行: docker compose build --no-cache"
    echo ""
else
    echo ""
    echo "❌ 生成失败，请检查错误信息"
    exit 1
fi
