// 格式化工具函数

/**
 * 格式化字节大小
 * @param {number} bytes 
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化持续时间（毫秒）
 * @param {number} ms 
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 1000) {
    return ms + 'ms';
  }
  return (ms / 1000).toFixed(2) + 's';
}

/**
 * 格式化时间戳
 * @param {number} timestamp 
 * @returns {string}
 */
export function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 格式化 JSON，美化输出
 * @param {any} data 
 * @returns {string}
 */
export function formatJSON(data) {
  try {
    if (typeof data === 'string') {
      const parsed = JSON.parse(data);
      return JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * 截取字符串
 * @param {string} str 
 * @param {number} maxLength 
 * @returns {string}
 */
export function truncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

/**
 * 解析 URL 参数
 * @param {string} url 
 * @returns {Object}
 */
export function parseQueryString(url) {
  const query = {};
  const urlObj = new URL(url);
  urlObj.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

/**
 * 生成唯一 ID
 * @returns {string}
 */
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 深度克隆对象
 * @param {any} obj 
 * @returns {any}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (Array.isArray(obj)) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const cloned = {};
    Object.keys(obj).forEach(key => {
      cloned[key] = deepClone(obj[key]);
    });
    return cloned;
  }
  return obj;
}

/**
 * 防抖函数
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数
 * @param {Function} func 
 * @param {number} limit 
 * @returns {Function}
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
