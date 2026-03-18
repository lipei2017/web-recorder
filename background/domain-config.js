/**
 * 域名配置管理器
 * 管理自动录制/回放的域名匹配规则
 */

class DomainConfigManager {
  constructor() {
    this.configKey = 'domainConfigs';
    this.globalConfigKey = 'globalDomainConfig';
  }

  /**
   * 获取所有域名配置
   */
  async getConfigs() {
    const result = await chrome.storage.local.get([this.configKey, this.globalConfigKey]);
    return {
      domains: result[this.configKey] || [],
      global: result[this.globalConfigKey] || {
        enabled: false,
        mode: 'record', // 'record' | 'playback' | 'disabled'
        autoStart: false
      }
    };
  }

  /**
   * 保存域名配置列表
   */
  async saveConfigs(domains) {
    await chrome.storage.local.set({
      [this.configKey]: domains
    });
  }

  /**
   * 保存全局配置
   */
  async saveGlobalConfig(config) {
    await chrome.storage.local.set({
      [this.globalConfigKey]: config
    });
  }

  /**
   * 添加域名配置
   * @param {Object} config - { domain, mode, sessionId, autoRecord, autoPlayback }
   */
  async addConfig(config) {
    const { domains } = await this.getConfigs();
    
    // 检查是否已存在
    const existingIndex = domains.findIndex(d => d.domain === config.domain);
    if (existingIndex >= 0) {
      domains[existingIndex] = { ...domains[existingIndex], ...config, updatedAt: Date.now() };
    } else {
      domains.push({
        ...config,
        id: this.generateId(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    
    await this.saveConfigs(domains);
    return domains;
  }

  /**
   * 删除域名配置
   */
  async removeConfig(domainId) {
    const { domains } = await this.getConfigs();
    const filtered = domains.filter(d => d.id !== domainId);
    await this.saveConfigs(filtered);
    return filtered;
  }

  /**
   * 匹配域名
   * @param {string} url - 当前页面URL
   * @returns {Object|null} - 匹配到的配置或null
   */
  async matchDomain(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;
      
      const { domains, global } = await this.getConfigs();
      
      // 检查全局配置
      if (global.enabled) {
        return {
          type: 'global',
          config: global,
          match: hostname
        };
      }
      
      // 查找匹配的域名配置
      for (const config of domains) {
        if (this.isMatch(hostname, pathname, config)) {
          return {
            type: 'domain',
            config: config,
            match: config.domain
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('[DomainConfig] 匹配域名失败:', error);
      return null;
    }
  }

  /**
   * 检查是否匹配
   * 支持通配符 * 和 ?
   */
  isMatch(hostname, pathname, config) {
    const domainPattern = config.domain;
    
    // 简单字符串匹配
    if (domainPattern === hostname) {
      return true;
    }
    
    // 通配符匹配
    if (domainPattern.includes('*') || domainPattern.includes('?')) {
      const regex = new RegExp(
        '^' + domainPattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') + '$'
      );
      if (regex.test(hostname)) {
        return true;
      }
    }
    
    // 检查路径匹配（如果配置了路径）
    if (config.pathPattern) {
      const pathRegex = new RegExp(
        config.pathPattern
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
      );
      if (!pathRegex.test(pathname)) {
        return false;
      }
    }
    
    return false;
  }

  /**
   * 生成唯一ID
   */
  generateId() {
    return 'domain_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 获取域名配置示例
   */
  getExampleConfigs() {
    return [
      {
        domain: '*.example.com',
        mode: 'record',
        description: '录制 example.com 所有子域名',
        autoRecord: true,
        urlFilters: ['/api/auth/*']
      },
      {
        domain: 'test.local',
        mode: 'playback',
        sessionId: 'session_xxx',
        description: '在 test.local 回放指定会话',
        autoPlayback: true
      }
    ];
  }
}

// 导出单例
const domainManager = new DomainConfigManager();

export { DomainConfigManager, domainManager };