# WebRecorder - Chrome 网页记录器

一个功能强大的 Chrome 扩展，用于捕获网页的网络请求和应用状态，支持导出和回放。

## 功能特性

### 网络请求捕获
- ✅ 拦截 XMLHttpRequest (XHR) 请求
- ✅ 拦截 Fetch API 请求
- ✅ 拦截 WebSocket 消息（发送和接收）
- ✅ 记录完整的请求/响应头、状态码、时间戳
- ✅ 支持跨域请求捕获

### 存储数据捕获
- ✅ 捕获 LocalStorage 数据
- ✅ 捕获 SessionStorage 数据
- ✅ 捕获 Cookies
- ✅ 定时自动快照（每 5 秒）
- ✅ 实时监听存储变化

### 数据导出
- ✅ JSON 格式导出（完整数据）
- ✅ HAR 格式导出（兼容 Chrome DevTools）
- ✅ 支持选择性导出

### 请求回放
- ✅ 拦截并 mock 网络请求
- ✅ 恢复存储数据状态
- ✅ 模拟网络延迟
- ✅ 支持混合模式（部分 mock + 部分真实请求）

## 项目结构

```
web-recorder/
├── manifest.json              # Chrome 扩展配置（Manifest V3）
├── icons/                     # 图标文件
├── background/
│   └── service-worker.js      # Service Worker 主逻辑
├── content/
│   ├── content.js             # 内容脚本入口
│   ├── injected.js            # 注入的网络拦截器
│   ├── storage-capture.js     # 存储数据捕获
│   └── playback.js            # 回放脚本
├── popup/
│   ├── popup.html             # 弹出窗口 UI
│   ├── popup.js               # Popup 逻辑
│   └── popup.css              # Popup 样式
├── options/
│   ├── options.html           # 选项页面
│   ├── options.js             # Options 逻辑
│   └── options.css            # Options 样式
├── storage/
│   └── indexeddb.js           # IndexedDB 数据库封装
└── utils/
    ├── constants.js           # 常量定义
    └── formatters.js          # 格式化工具函数
```

## 技术实现

### 网络请求拦截
由于 Chrome 扩展的 `webRequest` API 无法获取响应体，我们采用了**注入脚本重写原生 API**的方案：

1. **内容脚本** (`content.js`) 注入到页面
2. **注入脚本** (`injected.js`) 通过 `postMessage` 与内容脚本通信
3. 重写 `XMLHttpRequest`、`fetch`、`WebSocket` 的原生实现
4. 在拦截器中捕获完整的请求和响应数据

### 存储数据捕获
通过**代理模式**捕获存储操作：
- 定时捕获（每 5 秒）完整快照
- 重写 `localStorage.setItem/removeItem/clear` 等方法，实时监听变化
- 监听 `storage` 事件捕获跨标签页变化

### 数据持久化
使用 **IndexedDB** 存储：
- `sessions` 表：录制会话信息
- `requests` 表：网络请求数据
- `snapshots` 表：存储快照数据

### 回放机制
在页面加载前注入回放脚本：
- 构建 URL + 方法 → 响应数据的映射表
- 重写 `fetch` 和 `XMLHttpRequest`，匹配请求后返回录制数据
- 恢复 LocalStorage 和 SessionStorage 到录制时的状态

## 安装方法

### 1. 下载项目

将 `web-recorder` 文件夹下载到本地。

### 2. 加载到 Chrome

1. 打开 Chrome 浏览器，进入扩展管理页面：
   ```
   chrome://extensions/
   ```

2. 开启右上角的 **"开发者模式"**

3. 点击 **"加载已解压的扩展程序"**

4. 选择 `web-recorder` 文件夹

5. 扩展已安装，可以在工具栏看到图标

### 3. 添加图标（可选）

为了获得最佳体验，建议添加图标文件：

在 `icons/` 文件夹中放入以下尺寸的图标：
- `icon16.png` - 16x16 像素
- `icon48.png` - 48x48 像素
- `icon128.png` - 128x128 像素

以及录制状态的图标：
- `icon-recording16.png`
- `icon-recording48.png`
- `icon-recording128.png`

可以使用在线图标生成工具创建。

## 使用指南

### 开始录制

1. 打开需要录制的网页
2. 点击工具栏的 WebRecorder 图标
3. 点击 **"开始录制"** 按钮
4. 在页面上进行正常操作（访问接口、使用功能）
5. 图标会变为红色，表示正在录制

### 停止录制

1. 再次点击 WebRecorder 图标
2. 点击 **"停止录制"** 按钮
3. 记录已自动保存

### 查看记录

1. 点击扩展图标，选择 **"查看记录"**
2. 或在选项页面查看所有历史记录
3. 可以查看每条记录的：
   - 基本信息（标题、URL、时间）
   - 网络请求列表
   - 存储快照数量

### 导出数据

1. 在记录详情页面点击 **"导出 JSON"** 或 **"导出 HAR"**
2. JSON 格式包含完整数据（请求、响应、存储）
3. HAR 格式可在 Chrome DevTools 中打开分析

### 回放记录

1. 在记录详情页面点击 **"回放"**
2. 刷新目标页面
3. 页面发出的请求将被拦截并返回录制的数据
4. LocalStorage 和 SessionStorage 会自动恢复

**注意**：
- 回放时只会拦截匹配的 URL 和 HTTP 方法
- 未匹配的请求会正常发出
- 建议在测试环境使用回放功能

## 技术细节

### 为什么使用注入脚本？

Chrome 扩展的内容脚本运行在**独立环境**中，无法直接访问页面的 JavaScript 上下文。为了拦截页面内部的 `fetch` 和 `XMLHttpRequest`，我们必须将代码注入到页面的主执行环境中。

### WebSocket 捕获

WebSocket 捕获通过重写全局 `WebSocket` 构造函数实现：
- 拦截 `send()` 方法捕获发送的消息
- 监听 `message` 事件捕获接收的消息

### Manifest V3 兼容性

项目使用 Manifest V3：
- 使用 Service Worker 替代后台页面
- 使用 `chrome.scripting.executeScript` 动态注入脚本
- 使用 `chrome.storage` 存储配置（可选）

## 限制与注意事项

1. **CSP 限制**：某些网站设置了严格的内容安全策略（CSP），可能阻止脚本注入
2. **跨域限制**：无法捕获其他域名的请求详情（如请求头、响应体）
3. **性能影响**：录制大量数据可能影响页面性能，建议定期清理旧记录
4. **WebSocket**：WebSocket 捕获仅支持文本消息，不支持二进制数据
5. **大文件上传**：大文件上传可能导致内存占用过高

## 开发计划

- [ ] 支持录制 DOM 操作和用户行为
- [ ] 支持录制页面截图
- [ ] 团队协作和云端存储
- [ ] 与 Postman、Charles 等工具集成
- [ ] 自动化测试脚本生成

## 技术栈

- **Manifest**: V3
- **UI**: 原生 HTML/CSS/JavaScript
- **Storage**: IndexedDB
- **Communication**: Chrome Extension Message Passing
- **Script Injection**: `chrome.scripting.executeScript`

## 贡献指南

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 联系方式

如有问题或建议，请在 GitHub 上提交 Issue。

---

**WebRecorder** - 让网页调试更简单！
