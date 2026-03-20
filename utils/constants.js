// 全局常量定义

// 时间相关 (毫秒)
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  AUTO_CLEANUP_DAYS: 3,  // 自动清理3天前的记录
  PLAYBACK_EXPIRY_MINUTES: 5,  // 回放状态5分钟后过期
  STORAGE_CAPTURE_INTERVAL: 5000,  // 存储捕获间隔5秒
};

// 存储限制
export const LIMITS = {
  MAX_WEBSOCKET_MESSAGES: 5,  // 每个WebSocket只保留最新5条消息
  MAX_PLAYBACK_STATS: 100,  // 回放统计最多保留100条
  MAX_STORAGE_SIZE: 4 * 1024 * 1024,  // 4MB sessionStorage限制
};

// LocalStorage/SessionStorage Keys
export const STORAGE_KEYS = {
  RECORDING: 'webrecorder_recording',
  PLAYBACK: 'webrecorder_playback',
  DOMAIN_CONFIGS: 'webrecorder_domain_configs',
  URL_FILTERS: 'urlFilters',
  LOCALSTORAGE_FILTERS: 'localStorageFilters',
  AUTO_CLEANUP: 'autoCleanupEnabled',
};

// 请求类型
export const REQUEST_TYPES = {
  XHR: 'xhr',
  FETCH: 'fetch',
  WEBSOCKET: 'websocket'
};

// 存储类型
export const STORAGE_TYPES = {
  LOCAL_STORAGE: 'localStorage',
  SESSION_STORAGE: 'sessionStorage',
  COOKIES: 'cookies'
};

// 导出格式
export const EXPORT_FORMATS = {
  JSON: 'json',
  HAR: 'har'
};

// 消息类型
export const MESSAGE_TYPES = {
  START_RECORDING: 'START_RECORDING',
  STOP_RECORDING: 'STOP_RECORDING',
  GET_STATUS: 'GET_STATUS',
  CAPTURE_REQUEST: 'CAPTURE_REQUEST',
  CAPTURE_STORAGE: 'CAPTURE_STORAGE',
  GET_SESSIONS: 'GET_SESSIONS',
  GET_SESSION: 'GET_SESSION',
  DELETE_SESSION: 'DELETE_SESSION',
  EXPORT_SESSION: 'EXPORT_SESSION',
  IMPORT_SESSION: 'IMPORT_SESSION',
  START_PLAYBACK: 'START_PLAYBACK',
  STOP_PLAYBACK: 'STOP_PLAYBACK',
  GET_DOMAIN_CONFIGS: 'GET_DOMAIN_CONFIGS',
  SAVE_DOMAIN_CONFIG: 'SAVE_DOMAIN_CONFIG',
  DELETE_DOMAIN_CONFIG: 'DELETE_DOMAIN_CONFIG',
  UPDATE_DOMAIN_CONFIG: 'UPDATE_DOMAIN_CONFIG',
  GET_DOMAIN_STATUS: 'GET_DOMAIN_STATUS',
};

// HTTP 状态码映射
export const HTTP_STATUS_TEXT = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

// 域名配置模式
export const DOMAIN_MODES = {
  BOTH: 'both',
  RECORD: 'record',
  PLAYBACK: 'playback',
};
