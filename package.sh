#!/bin/bash

# WebRecorder 打包脚本
# 用于创建 Chrome 应用商店发布包

set -e

echo "🚀 开始打包 WebRecorder..."

# 版本号
VERSION="1.0.0"
OUTPUT_DIR="release"
OUTPUT_FILE="webrecorder-v${VERSION}.zip"

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

# 删除旧的打包文件
if [ -f "$OUTPUT_DIR/$OUTPUT_FILE" ]; then
    echo "📦 删除旧的打包文件..."
    rm "$OUTPUT_DIR/$OUTPUT_FILE"
fi

# 打包文件
echo "📦 打包扩展文件..."
zip -r "$OUTPUT_DIR/$OUTPUT_FILE" \
    manifest.json \
    background/ \
    content/ \
    icons/ \
    options/ \
    popup/ \
    storage/ \
    utils/ \
    README.md \
    PRIVACY_POLICY.md \
    -x "*.git*" \
    -x "*.vscode*" \
    -x "*node_modules*" \
    -x "*.DS_Store" \
    -x "EXPORT_TEST.md" \
    -x "OPTIMIZATION.md" \
    -x "BUILD.md" \
    -x "STORE_DESCRIPTION.md" \
    -x "package.sh"

# 显示打包信息
echo ""
echo "✅ 打包完成！"
echo "📦 文件位置: $OUTPUT_DIR/$OUTPUT_FILE"
echo "📊 文件大小: $(du -h "$OUTPUT_DIR/$OUTPUT_FILE" | cut -f1)"
echo ""
echo "📋 打包内容："
unzip -l "$OUTPUT_DIR/$OUTPUT_FILE" | tail -n +4 | head -n -2

echo ""
echo "🎉 准备发布到 Chrome 应用商店："
echo "1. 访问 https://chrome.google.com/webstore/devconsole"
echo "2. 点击 '新增项'"
echo "3. 上传 $OUTPUT_DIR/$OUTPUT_FILE"
echo "4. 填写商店信息（参考 STORE_DESCRIPTION.md）"
echo "5. 提交审核"
echo ""
echo "📖 详细说明请查看 BUILD.md"
