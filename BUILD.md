# 打包发布指南

## 准备工作

### 1. 检查文件

确保以下文件存在且正确：
- ✅ manifest.json
- ✅ 所有图标文件（icons/icon16.png, icon48.png, icon128.png）
- ✅ 所有源代码文件
- ✅ README.md
- ✅ PRIVACY_POLICY.md

### 2. 清理项目

删除不需要的文件：
```bash
# 删除开发文件
rm -rf .git
rm -rf .vscode
rm -f EXPORT_TEST.md
rm -f OPTIMIZATION.md
rm -f BUILD.md
rm -f STORE_DESCRIPTION.md
```

### 3. 测试扩展

在 Chrome 中加载未打包的扩展进行测试：
1. 打开 Chrome，访问 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目文件夹
5. 测试所有功能

## 打包步骤

### 方法 1：使用 Chrome 打包

1. 在 `chrome://extensions/` 页面
2. 点击"打包扩展程序"
3. 选择扩展根目录
4. 点击"打包扩展程序"
5. 生成 `.crx` 文件和 `.pem` 私钥文件

**注意**：保存好 `.pem` 文件，用于后续更新！

### 方法 2：手动打包 ZIP

```bash
# 创建发布目录
mkdir -p release

# 打包所有必要文件
zip -r release/webrecorder-v1.0.0.zip \
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
  -x "*.git*" -x "*.vscode*" -x "*node_modules*"
```

## 发布到 Chrome 应用商店

### 1. 注册开发者账号

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 支付一次性注册费用（$5 USD）
3. 完成开发者信息填写

### 2. 上传扩展

1. 点击"新增项"
2. 上传 ZIP 文件
3. 填写商店信息：

#### 基本信息
- **名称**：WebRecorder - 网页记录器
- **简短描述**：专业的网页请求录制与回放工具，支持 HTTP/WebSocket 请求捕获、数据导出和智能回放功能。
- **详细描述**：参考 STORE_DESCRIPTION.md

#### 图标和截图
- **应用图标**：128x128 PNG（已有 icons/icon128.png）
- **截图**：至少 1 张，最多 5 张（1280x800 或 640x400）
  - 建议截图：
    1. 主界面（popup）
    2. 录制中的状态
    3. 记录管理页面
    4. 回放功能演示
    5. 域名配置页面

#### 分类和语言
- **类别**：开发者工具
- **语言**：中文（简体）

#### 隐私
- **隐私政策 URL**：上传 PRIVACY_POLICY.md 到 GitHub Pages 或其他托管服务
- **权限说明**：
  - activeTab: 访问当前标签页以注入录制脚本
  - storage: 本地存储录制数据
  - tabs: 管理标签页状态
  - scripting: 注入内容脚本捕获请求
  - downloads: 导出录制数据
  - unlimitedStorage: 存储大量录制数据
  - host_permissions: 在所有网站捕获请求

#### 定价和分发
- **定价**：免费
- **分发地区**：所有地区

### 3. 提交审核

1. 检查所有信息
2. 点击"提交审核"
3. 等待审核（通常 1-3 个工作日）

## 版本更新

### 更新版本号

编辑 `manifest.json`：
```json
{
  "version": "1.0.1"
}
```

### 上传新版本

1. 打包新版本 ZIP
2. 在开发者控制台上传新版本
3. 填写更新说明
4. 提交审核

## 注意事项

### 审核要点

1. **权限说明**：清楚说明为什么需要 `<all_urls>` 权限
2. **隐私政策**：必须提供隐私政策链接
3. **功能演示**：提供清晰的截图和描述
4. **代码质量**：确保没有混淆代码（除非必要）

### 常见拒绝原因

- 权限说明不清楚
- 缺少隐私政策
- 截图不清晰或不足
- 功能描述不准确
- 代码中有恶意行为

### 最佳实践

- 定期更新扩展
- 及时回复用户评论
- 修复报告的 Bug
- 添加新功能
- 保持代码质量

## 推广建议

1. 在 GitHub 上创建仓库
2. 编写详细的 README
3. 录制使用视频教程
4. 在开发者社区分享
5. 收集用户反馈

## 支持

如有问题，请访问：
- Chrome Web Store 开发者文档：https://developer.chrome.com/docs/webstore/
- Chrome 扩展开发文档：https://developer.chrome.com/docs/extensions/
