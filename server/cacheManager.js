const EventEmitter = require('events');

class CacheManager extends EventEmitter {
  constructor(options = {}) {
    super();

    // 多级缓存配置
    this.memoryCache = new Map(); // 内存缓存
    this.diskCache = new Map();    // 磁��缓存

    // 缓存配置
    this.maxMemoryItems = options.maxMemoryItems || 10000;
    this.maxDiskItems = options.maxDiskItems || 100000;
    this.memoryTTL = options.memoryTTL || 300000;     // 5分钟
    this.diskTTL = options.diskTTL || 3600000;        // 1小时

    // LRU缓存
    this.lruQueue = []; // 最近使用队列
    this.accessTimes = new Map(); // 访问时间记录

    // 缓存统计
    this.stats = {
      hits: 0,
      misses: 0,
      memoryHits: 0,
      diskHits: 0,
      evictions: 0,
      size: 0
    };

    // 定期清理
    this.cleanupInterval = options.cleanupInterval || 60000; // 1分钟
    this.cleanupTimer = null;

    this.init();
  }

  init() {
    // 启动定期清理
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    console.log('[CacheManager] 缓存管理器已初始化');
  }

  // 获取缓存
  async get(key) {
    const startTime = Date.now();

    // 1. 检查内存缓存
    const memoryResult = this.getFromMemory(key);
    if (memoryResult !== null) {
      this.stats.hits++;
      this.stats.memoryHits++;
      this.updateAccessTime(key);
      this.emit('cacheHit', { key, source: 'memory', latency: Date.now() - startTime });
      return memoryResult;
    }

    // 2. 检查磁盘缓存
    const diskResult = await this.getFromDisk(key);
    if (diskResult !== null) {
      this.stats.hits++;
      this.stats.diskHits++;

      // 将磁盘缓存的数据提升到内存缓存
      this.setToMemory(key, diskResult);
      this.updateAccessTime(key);

      this.emit('cacheHit', { key, source: 'disk', latency: Date.now() - startTime });
      return diskResult;
    }

    // 3. 缓存未命中
    this.stats.misses++;
    this.emit('cacheMiss', { key, latency: Date.now() - startTime });
    return null;
  }

  // 设置缓存
  async set(key, value, options = {}) {
    const ttl = options.ttl || this.memoryTTL;
    const persist = options.persist !== false;

    // 设置内存缓存
    this.setToMemory(key, value, ttl);

    // 设置磁盘缓存（如果需要持久化）
    if (persist) {
      await this.setToDisk(key, value, options.diskTTL || this.diskTTL);
    }

    this.updateAccessTime(key);
    this.emit('cacheSet', { key, size: this.calculateSize(value) });
  }

  // 内存缓存操作
  getFromMemory(key) {
    const item = this.memoryCache.get(key);
    if (item && Date.now() < item.expiresAt) {
      return item.value;
    }

    if (item) {
      // 过期，删除
      this.memoryCache.delete(key);
      this.lruQueue = this.lruQueue.filter(k => k !== key);
    }

    return null;
  }

  setToMemory(key, value, ttl = this.memoryTTL) {
    // 检查是否需要清理空间
    if (this.memoryCache.size >= this.maxMemoryItems) {
      this.evictLRU();
    }

    const item = {
      value,
      expiresAt: Date.now() + ttl,
      size: this.calculateSize(value)
    };

    this.memoryCache.set(key, item);
    this.stats.size = this.memoryCache.size;
  }

  // 磁盘缓存操作
  async getFromDisk(key) {
    const item = this.diskCache.get(key);
    if (item && Date.now() < item.expiresAt) {
      return item.value;
    }

    if (item) {
      // 过期，删除
      this.diskCache.delete(key);
    }

    return null;
  }

  async setToDisk(key, value, ttl = this.diskTTL) {
    // 检查是否需要清理空间
    if (this.diskCache.size >= this.maxDiskItems) {
      this.evictOldestDisk();
    }

    const item = {
      value,
      expiresAt: Date.now() + ttl,
      size: this.calculateSize(value)
    };

    this.diskCache.set(key, item);
  }

  // LRU淘汰
  evictLRU() {
    if (this.lruQueue.length === 0) return;

    const evictKey = this.lruQueue.shift();
    this.memoryCache.delete(evictKey);
    this.accessTimes.delete(evictKey);
    this.stats.evictions++;

    console.log(`[CacheManager] LRU淘汰: ${evictKey}`);
  }

  // 磁盘缓存淘汰（最旧的）
  evictOldestDisk() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, item] of this.diskCache.entries()) {
      if (item.createdAt < oldestTime) {
        oldestTime = item.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.diskCache.delete(oldestKey);
      console.log(`[CacheManager] 磁盘淘汰: ${oldestKey}`);
    }
  }

  // 更新访问时间
  updateAccessTime(key) {
    const now = Date.now();
    this.accessTimes.set(key, now);

    // 更新LRU队列
    this.lruQueue = this.lruQueue.filter(k => k !== key);
    this.lruQueue.push(key);
  }

  // 计算数据大小（估算）
  calculateSize(value) {
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16字符
    } else if (typeof value === 'object') {
      return JSON.stringify(value).length * 2;
    } else {
      return 8; // 基本类型
    }
  }

  // 批量操作
  async mget(keys) {
    const results = new Map();
    const promises = keys.map(async (key) => {
      const value = await this.get(key);
      if (value !== null) {
        results.set(key, value);
      }
    });

    await Promise.all(promises);
    return results;
  }

  async mset(entries, options = {}) {
    const promises = entries.map(([key, value]) =>
      this.set(key, value, options)
    );

    await Promise.all(promises);
  }

  // 删除缓存
  delete(key) {
    const memoryDeleted = this.memoryCache.delete(key);
    const diskDeleted = this.diskCache.delete(key);

    this.lruQueue = this.lruQueue.filter(k => k !== key);
    this.accessTimes.delete(key);

    return memoryDeleted || diskDeleted;
  }

  // 清空缓存
  clear() {
    this.memoryCache.clear();
    this.diskCache.clear();
    this.lruQueue = [];
    this.accessTimes.clear();
    this.stats.size = 0;

    console.log('[CacheManager] 缓存已清空');
  }

  // 定期清理
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    // 清理内存缓存
    for (const [key, item] of this.memoryCache.entries()) {
      if (now >= item.expiresAt) {
        this.memoryCache.delete(key);
        this.lruQueue = this.lruQueue.filter(k => k !== key);
        this.accessTimes.delete(key);
        cleanedCount++;
      }
    }

    // 清理磁盘缓存
    for (const [key, item] of this.diskCache.entries()) {
      if (now >= item.expiresAt) {
        this.diskCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[CacheManager] 清理过期缓存: ${cleanedCount} 项`);
      this.stats.size = this.memoryCache.size;
    }

    this.emit('cleanup', { cleanedCount });
  }

  // 获取缓存统计
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      memorySize: this.memoryCache.size,
      diskSize: this.diskCache.size,
      totalSize: this.memoryCache.size + this.diskCache.size,
      memoryUsage: this.calculateMemoryUsage()
    };
  }

  // 估算内存使用
  calculateMemoryUsage() {
    let totalSize = 0;

    // 内存缓存大小
    for (const [key, item] of this.memoryCache.entries()) {
      totalSize += key.length * 2 + item.size + 64; // key + value + 开销
    }

    // 磁盘缓存大小（仅在内存中的元数据）
    for (const [key, item] of this.diskCache.entries()) {
      totalSize += key.length * 2 + 64; // key + 元数据开销
    }

    // LRU队列
    totalSize += this.lruQueue.length * 8;

    // 访问时间记录
    totalSize += this.accessTimes.size * 16;

    return Math.round(totalSize / 1024); // KB
  }

  // 缓存预热
  async warmup(dataLoader, keys) {
    console.log(`[CacheManager] 开始缓存预热: ${keys.length} 项`);
    const startTime = Date.now();

    const promises = keys.map(async (key) => {
      try {
        const value = await dataLoader(key);
        if (value !== null) {
          await this.set(key, value, { ttl: this.memoryTTL });
        }
      } catch (error) {
        console.warn(`[CacheManager] 预热失败: ${key}`, error.message);
      }
    });

    await Promise.all(promises);

    const duration = Date.now() - startTime;
    console.log(`[CacheManager] 缓存预热完成: ${duration}ms`);
  }

  // 缓存失效
  invalidate(pattern) {
    let invalidatedCount = 0;
    const regex = new RegExp(pattern);

    // 内存缓存失效
    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        invalidatedCount++;
      }
    }

    // 磁盘缓存失效
    for (const key of this.diskCache.keys()) {
      if (regex.test(key)) {
        this.diskCache.delete(key);
        invalidatedCount++;
      }
    }

    console.log(`[CacheManager] 缓存失效: ${invalidatedCount} 项 (模式: ${pattern})`);
    return invalidatedCount;
  }

  // 获取热门缓存
  getHotKeys(limit = 10) {
    const sorted = Array.from(this.accessTimes.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([key]) => key);

    return sorted;
  }

  // 缓存压缩（当内存压力大时）
  compress() {
    if (this.memoryCache.size < this.maxMemoryItems * 0.8) {
      return; // 不需要压缩
    }

    console.log('[CacheManager] 开始缓存压缩');

    // 将最久未访问的项目移到磁盘缓存
    const keysToMove = this.lruQueue.slice(0, Math.floor(this.maxMemoryItems * 0.2));

    keysToMove.forEach(key => {
      const item = this.memoryCache.get(key);
      if (item) {
        this.setToDisk(key, item.value);
        this.memoryCache.delete(key);
        this.lruQueue = this.lruQueue.filter(k => k !== key);
      }
    });

    console.log(`[CacheManager] 缓存压缩完成: 移动 ${keysToMove.length} 项到磁盘`);
  }

  // 导出缓存状态
  export() {
    return {
      memoryCache: Array.from(this.memoryCache.entries()),
      diskCache: Array.from(this.diskCache.entries()),
      lruQueue: [...this.lruQueue],
      accessTimes: Array.from(this.accessTimes.entries()),
      stats: this.getStats()
    };
  }

  // 导入缓存状态
  async import(data) {
    this.clear();

    // 导入内存缓存
    for (const [key, item] of data.memoryCache || []) {
      if (Date.now() < item.expiresAt) {
        this.memoryCache.set(key, item);
      }
    }

    // 导入磁盘缓存
    for (const [key, item] of data.diskCache || []) {
      if (Date.now() < item.expiresAt) {
        this.diskCache.set(key, item);
      }
    }

    // 恢复LRU队列和访问时间
    this.lruQueue = data.lruQueue || [];
    this.accessTimes = new Map(data.accessTimes || []);

    console.log(`[CacheManager] 缓存导入完成: 内存 ${this.memoryCache.size} 项, 磁盘 ${this.diskCache.size} 项`);
  }

  // 销毁
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.clear();
    console.log('[CacheManager] 缓存管理器已销毁');
  }
}

module.exports = CacheManager;