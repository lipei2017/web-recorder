# WebRecorder - Chrome 网页记录器

一个功能强大的 Chrome 扩展，用于捕获网页的网络请求和应用状态，支持导出和回放。适用于 API 调试、接口 mock、问题复现等场景。

## 功能特性

### 网络请求捕获
- 拦截 XMLHttpRequest (XHR) 请求
- 拦截 Fetch API 请求
- 拦截 WebSocket 消息（发送和接收）
- 记录完整的请求/响应头、状态码、时间戳、请求体、响应体
- 支持跨域请求捕获

### 存储数据捕获
- 捕获 LocalStorage 数据
- 捕获 SessionStorage 数据
- 定时自动快照（每 5 秒）
- 实时监听存储变化

### 数据导出
- **JSON 格式** - 完整数据，包含所有请求、响应、WebSocket 消息和存储快照
- **HAR 格式** - 兼容 Chrome DevTools、Postman、Charles、Fiddler 等工具
- **文件名优化** - 使用会话标题 + 日期自动生成文件名

### 数据导入
- 支持导入 JSON 和 HAR 格式文件
- 导入的数据标记为 📥，显示导入时间
- 使用文件名作为会话标题（去掉扩展名）

### 请求回放
- 拦截并 mock 网络请求（XHR/Fetch）
- WebSocket 消息回放
- 恢复 LocalStorage 和 SessionStorage 状态
- 模拟网络延迟
- 混合模式（匹配的请求 mock，未匹配的请求正常发出）

### 域名配置管理
- 基于域名的访问控制
- 支持通配符匹配（如 `*.example.com`）
- 可为不同域名配置不同模式：
  - **仅录制** - 只支持录制，不显示回放选项
  - **仅回放** - 只支持回放，隐藏录制按钮
  - **全部** - 支持录制和回放
- 当前页面域名匹配状态实时显示
- chrome-extension:// 页面支持查看会话列表（不可录制/回放）

### 界面特性
- **紧凑的 Popup 界面** - 录制控制按钮在顶部标题栏
- **状态呼吸灯** - 录制/回放时状态点显示呼吸灯效果
- **会话列表** - 支持筛选（全部/录制/导入）和搜索
- **会话标记** - 📹 录制数据 / 📥 导入数据

## 项目结构

```
web-recorder/
├── manifest.json              # Chrome 扩展配置（Manifest V3）
├── icons/                     # 图标文件（16x16, 48x48, 128x128）
├── background/
│   ├── service-worker.js      # Service Worker 主逻辑
│   └── domain-config.js       # 域名配置管理器
├── content/
│   ├── content.js             # 内容脚本入口，协调通信
│   ├── injected.js            # 注入的网络拦截器（XHR/Fetch/WebSocket）
│   └── storage-capture.js     # 存储数据捕获
├── popup/
│   ├── popup.html             # 弹出窗口 UI
│   ├── popup.js               # Popup 逻辑
│   └── popup.css              # Popup 样式
├── options/
│   ├── options.html           # 选项页面（记录管理、设置）
│   ├── options.js             # Options 逻辑
│   └── options.css            # Options 样式
├── storage/
│   └── indexeddb.js           # IndexedDB 数据库封装
└── utils/
    ├── constants.js           # 常量定义
    └── formatters.js          # 格式化工具函数
```

## 安装方法

### 从 Chrome 应用商店安装（推荐）

1. 访问 [Chrome 应用商店](https://chrome.google.com/webstore)
2. 搜索 "WebRecorder"
3. 点击"添加至 Chrome"

### 手动安装（开发版）

#### 1. 下载项目

将 `web-recorder` 文件夹下载到本地。

#### 2. 加载到 Chrome

1. 打开 Chrome 浏览器，进入扩展管理页面：
   ```
   chrome://extensions/
   ```

2. 开启右上角的 **"开发者模式"**

3. 点击 **"加载已解压的扩展程序"**

4. 选择 `web-recorder` 文件夹

5. 扩展已安装，可以在工具栏看到图标

## 使用指南

### 首次使用

1. 点击工具栏的 WebRecorder 图标
2. 点击 **"⚙️"** 进入选项页面
3. 在 **"域名配置"** 选项卡中添加允许录制的域名
4. 返回目标页面开始使用

### 添加域名配置

1. 进入设置页面的 **"域名配置"** 选项卡
2. 点击 **"添加域名配置"**
3. 输入域名模式（如 `localhost`、`*.example.com`）
4. 选择模式：
   - **仅录制** - 只支持录制功能
   - **仅回放** - 只支持回放功能
   - **全部** - 支持录制和回放
5. 点击 **"添加"**

### 界面说明

**Popup 界面：**
```
┌─────────────────────────────────────────┐
│ WebRecorder v1.0.0    [🔴 录制] [⚙️]    │  ← 顶部控制栏
├─────────────────────────────────────────┤
│ ● 就绪                    ● 已配置      │  ← 状态栏
├─────────────────────────────────────────┤
│ 会话列表                          导入  │  ← 导入按钮
│ [全部] [📹 录制] [📥 导入]               │  ← 筛选标签
│ 🔍 搜索会话...                          │  ← 搜索框
│                                         │
│ 📹 会话标题1               [▶️] [👁️]   │  ← 回放/查看
│   今天 10:30            12 请求         │
│                                         │
│ 📥 导入的会话              [▶️] [👁️]   │  ← 导入数据标记
│   昨天 15:20             8 请求         │
│                                         │
│ 查看全部 →                              │
├─────────────────────────────────────────┤
│              使用帮助                   │
└─────────────────────────────────────────┘
```

**状态说明：**
- **● 就绪** - 绿色静态，可以开始录制
- **● 录制中** - 红色呼吸灯，正在录制
- **● 回放中** - 绿色呼吸灯，正在回放

### 开始录制

1. 打开已配置的网页
2. 点击工具栏的 WebRecorder 图标
3. 确认状态栏显示 **● 就绪** 且域名显示 **● 已配置**
4. 点击 **"🔴 录制"** 按钮
5. 按钮变为 **"⏹ 停止"**（红色，带呼吸灯效果），表示正在录制
6. 在页面上进行正常操作
7. 点击 **"⏹ 停止"** 结束录制

### 查看记录

1. 点击 **"👁️ 查看"** 按钮打开详情页
2. 或点击 **"查看全部 →"** 进入记录管理页面
3. 记录列表显示：
   - 📹 录制数据 / 📥 导入数据标记
   - 标题（导入数据使用文件名）
   - 时间（录制数据用录制时间，导入数据用导入时间）
   - 请求数量

### 导出数据

在记录详情页面点击 **"导出 JSON"** 或 **"导出 HAR"**。

**JSON 导出（推荐）**
- 支持选择导出内容：网络请求、存储快照、会话信息
- 支持过滤请求：全部/仅 XHR/仅 Fetch/仅成功/仅失败
- 支持 URL 路径过滤（支持通配符）
- 可选择美化或压缩格式
- 可自定义文件名，或自动生成（标题_日期.json）
- 支持复制到剪贴板

**HAR 导出**
- 兼容 Chrome DevTools、Postman、Charles 等工具
- 标准 HAR 1.2 格式，仅包含 HTTP 请求
- 可用于在其他工具中分析网络请求详情

### 回放记录

1. 在记录列表中找到要回放的记录
2. 点击 **"▶️ 回放"** 按钮
3. 系统会提示 **"回放已启动！刷新页面查看效果"**
4. 刷新目标页面
5. 页面发出的请求将被拦截并返回录制的数据
6. WebSocket 消息会按录制时的顺序和时间间隔推送
7. LocalStorage 和 SessionStorage 会自动恢复

**停止回放：**
- 点击 WebRecorder 图标
- 点击 **"⏹ 停止"** 按钮（绿色）

**注意：**
- 回放时只拦截匹配的 URL 和 HTTP 方法
- 未匹配的请求会正常发出
- 建议在测试环境使用回放功能

### 导入数据

1. 点击 WebRecorder 图标
2. 点击 **"📥 导入"** 按钮
3. 选择 JSON 或 HAR 文件
4. 导入成功后会话显示在列表中，标记为 📥
5. 标题使用文件名（去掉扩展名）
6. 时间显示为导入时间

### URL 过滤规则

1. 进入设置页面的 **"过滤设置"** 选项卡
2. 添加 URL 模式（如 `*/api/auth/*`、`*.analytics.com`）
3. 匹配的 URL 在录制时会被跳过

### LocalStorage 过滤

1. 进入设置页面的 **"过滤设置"** 选项卡
2. 添加 LocalStorage key 模式（如 `token*`、`analytics_*`）
3. 匹配的 key 在回放时会被跳过

## 技术实现

### 网络请求拦截

由于 Chrome 扩展的 `webRequest` API 无法获取响应体，我们采用**注入脚本重写原生 API** 的方案：

1. **内容脚本** (`content.js`) 在页面加载早期注入
2. **注入脚本** (`injected.js`) 通过 `postMessage` 与内容脚本通信
3. 重写 `XMLHttpRequest`、`fetch`、`WebSocket` 的原生实现
4. 在拦截器中捕获完整的请求和响应数据
5. WebSocket 支持双向消息捕获和回放

### 数据导出

**JSON 格式（推荐）**
- 完整数据，包含所有请求、响应、WebSocket 消息和存储快照
- 支持自定义导出内容（请求/快照/会话信息）
- 支持过滤导出（按类型、状态码、URL 路径）
- 支持美化/压缩格式选择
- 可导入回 WebRecorder 进行回放

**HAR 格式**
- 兼容 Chrome DevTools、Postman、Charles 等第三方工具
- 标准 HTTP Archive 1.2 格式
- 仅包含 HTTP 请求（XHR/Fetch）
- 可用于在其他工具中分析网络请求

### 存储数据捕获

通过**代理模式**捕获存储操作：
- 定时捕获（每 5 秒）完整快照
- 重写 `localStorage.setItem/removeItem/clear` 等方法，实时监听变化
- 监听 `storage` 事件捕获跨标签页变化

### 数据持久化

使用 **IndexedDB** 存储：
- `sessions` 表：录制会话信息
- `requests` 表：网络请求数据（含 WebSocket 消息）
- `snapshots` 表：存储快照数据

### 回放机制

1. 构建 URL + 方法 → 响应数据的映射表（支持路径模式匹配）
2. 重写 `fetch` 和 `XMLHttpRequest`，匹配请求后返回录制数据
3. WebSocket 回放：创建 Mock WebSocket，按时间顺序推送消息
4. 恢复 LocalStorage 和 SessionStorage 到录制时的状态
5. 通过 sessionStorage 标记在页面刷新后保持回放状态

### 域名配置

- 使用通配符模式匹配域名
- 支持 `*` 匹配任意字符序列，`?` 匹配单个字符
- 匹配成功后才能进行录制/回放操作

## 限制与注意事项

1. **CSP 限制**：某些网站设置了严格的内容安全策略（CSP），可能阻止脚本注入
2. **跨域限制**：捕获其他域名的请求时，某些信息可能不完整
3. **性能影响**：录制大量数据可能影响页面性能，建议定期清理旧记录
4. **WebSocket 限制**：WebSocket 消息仅支持文本，二进制数据会被忽略
5. **大文件**：大文件上传/下载可能导致内存占用过高
6. **回放精度**：动态生成的 ID 可能无法完全匹配，依赖路径模式匹配

## 开发计划

- [ ] 支持录制 DOM 操作和用户行为
- [ ] 支持录制页面截图
- [ ] 团队协作和云端存储
- [ ] 自动化测试脚本生成
- [ ] 请求篡改功能（修改请求参数）

## 技术栈

- **Manifest**: V3
- **UI**: 原生 HTML/CSS/JavaScript
- **Storage**: IndexedDB + chrome.storage
- **Communication**: Chrome Extension Message Passing
- **Script Injection**: `chrome.scripting.executeScript` + 动态脚本注入

## 浏览器兼容性

- Chrome 88+（Manifest V3 要求）
- Edge 88+（Chromium 内核）

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发环境设置

1. Clone 项目
2. 在 Chrome 中加载未打包的扩展
3. 修改代码后刷新扩展

### 打包发布

**Linux/Mac:**
```bash
./package.sh
```

**Windows:**
```bash
package.bat
```

详细发布流程请查看 [BUILD.md](BUILD.md)

## 许可证

MIT License

## 隐私政策

查看 [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

## 联系方式

- GitHub Issues: 报告问题和建议
- Email: [你的邮箱]

---

**WebRecorder** - 让网页调试更简单！