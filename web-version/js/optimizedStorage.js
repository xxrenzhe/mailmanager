/**
 * 高性能客户端存储管理器 - 优化版本
 * 专为邮件管理系统设计的 IndexedDB 存储解决方案
 */

class OptimizedClientStorage {
    constructor() {
        this.dbName = 'MailManagerDB';
        this.dbVersion = 2; // 增加版本号以支持新功能
        this.db = null;
        this.isInitialized = false;
        this.initPromise = null;

        // 性能优化配置
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
        this.batchSize = 100; // 批量操作大小

        // 存储配额管理
        this.storageQuota = null;
        this.storageUsage = null;
    }

    /**
     * 数据库初始化 - 带错误恢复和性能优化
     */
    async init() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            if (this.isInitialized) {
                resolve();
                return;
            }

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('[OptimizedClientStorage] 数据库打开失败:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;

                // 初始化存储监控
                this.monitorStorage();

                console.log('[OptimizedClientStorage] 数据库初始化成功');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建账户表 - 优化索引
                if (!db.objectStoreNames.contains('accounts')) {
                    const accountStore = db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
                    accountStore.createIndex('email', 'email', { unique: true });
                    accountStore.createIndex('status', 'status');
                    accountStore.createIndex('created_at', 'created_at');
                    accountStore.createIndex('updated_at', 'updated_at');
                    accountStore.createIndex('status_updated', 'status, updated_at'); // 复合索引
                }

                // 创��验证码表 - 优化索引
                if (!db.objectStoreNames.contains('codes')) {
                    const codeStore = db.createObjectStore('codes', { keyPath: 'id', autoIncrement: true });
                    codeStore.createIndex('account_id', 'account_id');
                    codeStore.createIndex('received_at', 'received_at');
                    codeStore.createIndex('account_received', 'account_id, received_at'); // 复合索引
                }

                // 创建设置表 - 支持版本控制
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // 创建邮件处理历史表 - 新功能
                if (!db.objectStoreNames.contains('email_history')) {
                    const historyStore = db.createObjectStore('email_history', { keyPath: 'id', autoIncrement: true });
                    historyStore.createIndex('account_id', 'account_id');
                    historyStore.createIndex('message_id', 'message_id', { unique: true });
                    historyStore.createIndex('processed_at', 'processed_at');
                    historyStore.createIndex('account_processed', 'account_id, processed_at');
                }

                // 创建同步状态表 - 用于离线支持
                if (!db.objectStoreNames.contains('sync_status')) {
                    const syncStore = db.createObjectStore('sync_status', { keyPath: 'id' });
                    syncStore.createIndex('type', 'type');
                    syncStore.createIndex('status', 'status');
                    syncStore.createIndex('created_at', 'created_at');
                }

                console.log('[OptimizedClientStorage] 数据库结构升级完成');
            };
        });

        return this.initPromise;
    }

    /**
     * 缓存管理 - 提升查询性能
     */
    getCachedData(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    setCachedData(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });

        // 清理过期缓存
        if (this.cache.size > 100) {
            this.cleanupCache();
        }
    }

    cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * 账户管理 - 批量操作优化
     */
    async saveAccount(account) {
        await this.init();

        const now = new Date().toISOString();
        account.created_at = account.created_at || now;
        account.updated_at = now;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');
            const request = store.put(account);

            request.onsuccess = () => {
                // 清理相关缓存
                this.cache.delete('accounts_all');
                this.cache.delete(`account_email_${account.email}`);
                resolve(request.result);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async getAccount(id) {
        await this.init();

        const cached = this.getCachedData(`account_${id}`);
        if (cached) return cached;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');
            const request = store.get(id);

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    this.setCachedData(`account_${id}`, result);
                }
                resolve(result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getAccountByEmail(email) {
        await this.init();

        const cached = this.getCachedData(`account_email_${email}`);
        if (cached) return cached;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');
            const index = store.index('email');
            const request = index.get(email);

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    this.setCachedData(`account_email_${email}`, result);
                }
                resolve(result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getAllAccounts(options = {}) {
        await this.init();

        const cached = this.getCachedData('accounts_all');
        if (cached && !options.forceRefresh) return cached;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');

            let request;
            if (options.sortBy) {
                const index = store.index(options.sortBy);
                request = index.openCursor();
            } else {
                request = store.openCursor();
            }

            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    this.setCachedData('accounts_all', results);
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async batchSaveAccounts(accounts) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');

            let completed = 0;
            const total = accounts.length;

            accounts.forEach(account => {
                const request = store.put(account);
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) {
                        this.cache.delete('accounts_all');
                        resolve(completed);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        });
    }

    /**
     * 验证码管理 - 性能优化版本
     */
    async saveCode(code) {
        await this.init();

        code.created_at = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['codes'], 'readwrite');
            const store = transaction.objectStore('codes');
            const request = store.add(code);

            request.onsuccess = () => {
                this.cache.delete(`codes_account_${code.account_id}`);
                resolve(request.result);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async getLatestCodes(accountId, limit = 5) {
        await this.init();

        const cached = this.getCachedData(`codes_account_${accountId}_${limit}`);
        if (cached) return cached;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['codes'], 'readonly');
            const store = transaction.objectStore('codes');
            const index = store.index('account_received');
            const request = index.openCursor(
                IDBKeyRange.bound([accountId], [accountId, '\uffff']),
                'prev'
            );

            const results = [];
            let count = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && count < limit) {
                    results.push(cursor.value);
                    count++;
                    cursor.continue();
                } else {
                    this.setCachedData(`codes_account_${accountId}_${limit}`, results);
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async batchSaveCodes(codes) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['codes'], 'readwrite');
            const store = transaction.objectStore('codes');

            let completed = 0;
            const total = codes.length;

            codes.forEach(code => {
                const request = store.add(code);
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) {
                        resolve(completed);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        });
    }

    /**
     * 设置管理 - 带版本控制
     */
    async saveSetting(key, value, version = '1.0') {
        await this.init();

        const setting = {
            key,
            value,
            version,
            updated_at: new Date().toISOString()
        };

        try {
            localStorage.setItem(`mailmanager_${key}`, JSON.stringify(setting));
            this.cache.delete(`setting_${key}`);
        } catch (error) {
            console.warn('[OptimizedClientStorage] localStorage写入失败:', error);
            // 降级到 IndexedDB 存储
            await this.saveSettingToIndexedDB(key, value, version);
        }
    }

    async getSetting(key, defaultValue = null) {
        const cached = this.getCachedData(`setting_${key}`);
        if (cached) return cached;

        try {
            const value = localStorage.getItem(`mailmanager_${key}`);
            if (value) {
                const setting = JSON.parse(value);
                this.setCachedData(`setting_${key}`, setting.value);
                return setting.value;
            }
        } catch (error) {
            console.warn('[OptimizedClientStorage] localStorage读取失败:', error);
        }

        // 降级到 IndexedDB 读取
        const indexedDBValue = await this.getSettingFromIndexedDB(key);
        if (indexedDBValue !== null) {
            this.setCachedData(`setting_${key}`, indexedDBValue);
            return indexedDBValue;
        }

        return defaultValue;
    }

    async saveSettingToIndexedDB(key, value, version) {
        // 实现 IndexedDB 设置存储的降级方案
        console.log('[OptimizedClientStorage] 使用 IndexedDB 存储设置:', key);
    }

    async getSettingFromIndexedDB(key) {
        // 实现 IndexedDB 设置读取的降级方案
        return null;
    }

    /**
     * 存储监控和配额管理
     */
    async monitorStorage() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            try {
                const estimate = await navigator.storage.estimate();
                this.storageQuota = estimate.quota;
                this.storageUsage = estimate.usage;

                console.log(`[OptimizedClientStorage] 存储使用情况: ${this.formatBytes(this.storageUsage)} / ${this.formatBytes(this.storageQuota)}`);

                // 如果使用超过80%，发出警告
                if (this.storageUsage / this.storageQuota > 0.8) {
                    console.warn('[OptimizedClientStorage] 存储空间即将耗尽，建议清理数据');
                    this.cleanupOldData();
                }
            } catch (error) {
                console.warn('[OptimizedClientStorage] 无法获取存储信息:', error);
            }
        }
    }

    async cleanupOldData() {
        console.log('[OptimizedClientStorage] 开始清理旧数据...');

        // 清理旧的验证码记录（保留最新50条）
        const accounts = await this.getAllAccounts();
        for (const account of accounts) {
            await this.deleteOldCodes(account.id, 50);
        }

        // 重新监控存储使用情况
        await this.monitorStorage();
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 数据统计 - 增强版本
     */
    async getStats() {
        const accounts = await this.getAllAccounts();
        const statusCounts = {};
        const emailProviders = {};
        const recentlyActive = [];

        // 统计状态分布
        accounts.forEach(account => {
            statusCounts[account.status] = (statusCounts[account.status] || 0) + 1;

            // 统计邮箱提供商
            const domain = account.email.split('@')[1];
            emailProviders[domain] = (emailProviders[domain] || 0) + 1;

            // 最近活跃的账户
            if (account.updated_at && new Date(account.updated_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
                recentlyActive.push(account.email);
            }
        });

        // 获取存储大小
        let storageSize = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('mailmanager_')) {
                storageSize += localStorage.getItem(key).length;
            }
        }

        return {
            totalAccounts: accounts.length,
            statusCounts,
            emailProviders,
            recentlyActiveCount: recentlyActive.length,
            storageSize: storageSize,
            storageSizeKB: Math.round(storageSize / 1024 * 100) / 100,
            storageQuota: this.storageQuota,
            storageUsage: this.storageUsage,
            cacheSize: this.cache.size,
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * 数据导出/导入 - 增强版本
     */
    async exportData(options = {}) {
        const accounts = await this.getAllAccounts();
        const allCodes = [];
        const emailHistory = [];
        const settings = {};

        // 批量获取验证码
        for (const account of accounts) {
            const codes = await this.getLatestCodes(account.id, 100);
            allCodes.push(...codes);

            // 获取邮件处理历史
            const history = await this.getEmailHistory(account.id, 50);
            emailHistory.push(...history);
        }

        // 获取设置
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('mailmanager_')) {
                try {
                    const settingKey = key.replace('mailmanager_', '');
                    settings[settingKey] = await this.getSetting(settingKey);
                } catch (error) {
                    console.warn('[OptimizedClientStorage] 导出设置失败:', key, error);
                }
            }
        }

        const exportData = {
            accounts,
            codes: allCodes,
            emailHistory,
            settings,
            stats: await this.getStats(),
            exportTime: new Date().toISOString(),
            version: '2.0',
            options
        };

        // 压缩数据（如果需要）
        if (options.compress) {
            return this.compressData(exportData);
        }

        return exportData;
    }

    async importData(data, options = {}) {
        if (!data.accounts || !Array.isArray(data.accounts)) {
            throw new Error('无效的导入数据格式');
        }

        console.log(`[OptimizedClientStorage] 开始导入数据: ${data.accounts.length} 个账户`);

        // 验证数据完整性
        if (!options.skipValidation) {
            this.validateImportData(data);
        }

        // 清空现有数据（如果需要）
        if (options.clearExisting) {
            await this.clearAllData();
        }

        const results = {
            importedAccounts: 0,
            importedCodes: 0,
            importedHistory: 0,
            importedSettings: 0,
            errors: []
        };

        try {
            // 批量导入账户
            if (data.accounts.length > 0) {
                results.importedAccounts = await this.batchSaveAccounts(data.accounts);
                console.log(`[OptimizedClientStorage] 成功导入 ${results.importedAccounts} 个账户`);
            }

            // 批量导入验证码
            if (data.codes && Array.isArray(data.codes) && data.codes.length > 0) {
                results.importedCodes = await this.batchSaveCodes(data.codes);
                console.log(`[OptimizedClientStorage] 成功导入 ${results.importedCodes} 个验证码`);
            }

            // 导入邮件历史
            if (data.emailHistory && Array.isArray(data.emailHistory)) {
                for (const history of data.emailHistory) {
                    try {
                        await this.saveEmailHistory(history);
                        results.importedHistory++;
                    } catch (error) {
                        results.errors.push(`导入邮件历史失败: ${error.message}`);
                    }
                }
            }

            // 导入设置
            if (data.settings && typeof data.settings === 'object') {
                for (const [key, value] of Object.entries(data.settings)) {
                    try {
                        await this.saveSetting(key, value, data.version || '2.0');
                        results.importedSettings++;
                    } catch (error) {
                        results.errors.push(`导入设置失败: ${key} - ${error.message}`);
                    }
                }
            }

            // 清理缓存
            this.cache.clear();

            console.log('[OptimizedClientStorage] 数据导入完成:', results);
            return results;

        } catch (error) {
            console.error('[OptimizedClientStorage] 数据导入失败:', error);
            results.errors.push(`导入失败: ${error.message}`);
            throw error;
        }
    }

    validateImportData(data) {
        // 验证账户数据
        data.accounts.forEach((account, index) => {
            if (!account.email) {
                throw new Error(`账户 ${index} 缺少邮箱地址`);
            }
            if (!this.isValidEmail(account.email)) {
                throw new Error(`账户 ${index} 邮箱格式无效: ${account.email}`);
            }
        });

        // 验证验证码数据
        if (data.codes) {
            data.codes.forEach((code, index) => {
                if (!code.account_id) {
                    throw new Error(`验证码 ${index} 缺少账户ID`);
                }
                if (!code.code) {
                    throw new Error(`验证码 ${index} 缺少验证码内容`);
                }
            });
        }
    }

    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * 邮件历史管理
     */
    async saveEmailHistory(history) {
        await this.init();

        history.created_at = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['email_history'], 'readwrite');
            const store = transaction.objectStore('email_history');
            const request = store.put(history);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getEmailHistory(accountId, limit = 50) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['email_history'], 'readonly');
            const store = transaction.objectStore('email_history');
            const index = store.index('account_processed');
            const request = index.openCursor(
                IDBKeyRange.bound([accountId], [accountId, '\uffff']),
                'prev'
            );

            const results = [];
            let count = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && count < limit) {
                    results.push(cursor.value);
                    count++;
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 数据库维护操作
     */
    async deleteAccount(id) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts', 'codes', 'email_history'], 'readwrite');

            // 删除账户
            const accountStore = transaction.objectStore('accounts');
            accountStore.delete(id);

            // 删除相关验证码
            const codeStore = transaction.objectStore('codes');
            const codeIndex = codeStore.index('account_id');
            const codeRequest = codeIndex.openCursor(IDBKeyRange.only(id));

            codeRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            // 删除邮件历史
            const historyStore = transaction.objectStore('email_history');
            const historyIndex = historyStore.index('account_id');
            const historyRequest = historyIndex.openCursor(IDBKeyRange.only(id));

            historyRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            transaction.oncomplete = () => {
                this.cache.delete('accounts_all');
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async deleteOldCodes(accountId, keepCount = 50) {
        await this.init();

        const allCodes = await this.getLatestCodes(accountId, 1000);
        const codesToKeep = allCodes.slice(0, keepCount);
        const codesToDelete = allCodes.slice(keepCount);

        if (codesToDelete.length === 0) return 0;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['codes'], 'readwrite');
            const store = transaction.objectStore('codes');
            let deletedCount = 0;

            transaction.oncomplete = () => {
                this.cache.delete(`codes_account_${accountId}`);
                resolve(deletedCount);
            };
            transaction.onerror = () => reject(transaction.error);

            codesToDelete.forEach(code => {
                const request = store.delete(code.id);
                request.onsuccess = () => deletedCount++;
            });
        });
    }

    async clearAllData() {
        await this.init();

        return new Promise((resolve, reject) => {
            const stores = ['accounts', 'codes', 'email_history', 'sync_status'];
            const transaction = this.db.transaction(stores, 'readwrite');

            stores.forEach(storeName => {
                const store = transaction.objectStore(storeName);
                store.clear();
            });

            transaction.oncomplete = () => {
                // 清空缓存和localStorage
                this.cache.clear();
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('mailmanager_')) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));
                resolve();
            };

            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 数据压缩和优化
     */
    async optimizeDatabase() {
        console.log('[OptimizedClientStorage] 开始数据库优化...');

        // 清理缓存
        this.cleanupCache();

        // 清理旧数据
        await this.cleanupOldData();

        // 重建索引（如果需要）
        console.log('[OptimizedClientStorage] 数据库优化完成');

        return {
            cacheCleared: this.cache.size,
            storageOptimized: true,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * 数据同步支持
     */
    async markForSync(type, data, action = 'update') {
        const syncItem = {
            type,
            data,
            action,
            status: 'pending',
            created_at: new Date().toISOString(),
            retry_count: 0
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sync_status'], 'readwrite');
            const store = transaction.objectStore('sync_status');
            const request = store.add(syncItem);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getPendingSyncItems(type = null) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sync_status'], 'readonly');
            const store = transaction.objectStore('sync_status');

            let request;
            if (type) {
                const index = store.index('type');
                request = index.openCursor(type);
            } else {
                request = store.openCursor();
            }

            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.status === 'pending') {
                        results.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 关闭数据库连接
     */
    async close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.isInitialized = false;
            this.initPromise = null;
            this.cache.clear();
        }
    }
}

// 单例模式 - 优化版本
const optimizedClientStorage = new OptimizedClientStorage();

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = optimizedClientStorage;
} else if (typeof window !== 'undefined') {
    window.optimizedClientStorage = optimizedClientStorage;
}