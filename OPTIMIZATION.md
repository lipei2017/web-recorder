// P0 优化清单 - 错误处理与XSS防护

## P0-1: 错误处理完善

### 已修复文件：
1. ✅ content.js - 所有空 catch 块已添加日志

### 待修复文件（按优先级）：

#### High Priority (关键路径)
- [ ] service-worker.js: sendMessage catch 块
- [ ] injected.js: 核心拦截器中的 catch 块
- [ ] popup.js: 用户交互相关的 catch 块

#### Medium Priority
- [ ] options.js: 设置相关的 catch 块
- [ ] storage/indexeddb.js: 数据库操作 catch 块

## P0-2: XSS 防护

### 需要修复的位置：
1. options.js: 
   - 第1322行: `item.innerHTML = ...`
   - 第1431行: `item.innerHTML = ...`
   - 第1625行: `domainList.innerHTML = ...`

2. injected.js:
   - showPlaybackIndicator 函数中的 innerHTML

### 修复方案：
使用 textContent 或 createElement 代替 innerHTML

## 优化脚本模板

### 错误处理模板：
```javascript
catch (error) {
  console.error('[ModuleName] 操作失败:', error);
  // 可选：降级处理或上报
}
```

### XSS 防护模板：
```javascript
// 原代码（不安全）
element.innerHTML = `<span>${userInput}</span>`;

// 修复后（安全）
const span = document.createElement('span');
span.textContent = userInput;
element.appendChild(span);
```
