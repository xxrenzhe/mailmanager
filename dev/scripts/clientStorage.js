/**
 * 浏览器本地存储管理器
 * 使用 IndexedDB 存储主要数据，LocalStorage 存储配置
 */

class ClientStorage {
    constructor() {
        this.dbName = 'MailManagerDB';
        this.dbVersion = 1;
        this.db = null;
        this.isInitialized = false;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                console.log('[ClientStorage] IndexedDB 初始化成功');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建账户表
                if (!db.objectStoreNames.contains('accounts')) {
                    const accountStore = db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
                    accountStore.createIndex('email', 'email', { unique: true });
                    accountStore.createIndex('status', 'status');
                    accountStore.createIndex('created_at', 'created_at');
                }

                // 创建验证码表
                if (!db.objectStoreNames.contains('codes')) {
                    const codeStore = db.createObjectStore('codes', { keyPath: 'id', autoIncrement: true });
                    codeStore.createIndex('account_id', 'account_id');
                    codeStore.createIndex('received_at', 'received_at');
                }

                // 创建设置表
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                console.log('[ClientStorage] 数据库结构创建完成');
            };
        });
    }

    // === 账户管理 ===
    async saveAccount(account) {
        if (!this.isInitialized) await this.init();

        account.created_at = account.created_at || new Date().toISOString();
        account.updated_at = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');
            const request = store.put(account);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAccount(id) {
        if (!this.isInitialized) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAccountByEmail(email) {
        if (!this.isInitialized) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');
            const index = store.index('email');
            const request = index.get(email);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllAccounts() {
        if (!this.isInitialized) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteAccount(id) {
        if (!this.isInitialized) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts', 'codes'], 'readwrite');

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

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async updateAccountStatus(id, status) {
        const account = await this.getAccount(id);
        if (account) {
            account.status = status;
            account.updated_at = new Date().toISOString();
            return this.saveAccount(account);
        }
    }

    // === 验证码管理 ===
    async saveCode(code) {
        if (!this.isInitialized) await this.init();

        code.created_at = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['codes'], 'readwrite');
            const store = transaction.objectStore('codes');
            const request = store.add(code);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getLatestCodes(accountId, limit = 5) {
        if (!this.isInitialized) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['codes'], 'readonly');
            const store = transaction.objectStore('codes');
            const index = store.index('account_id');
            const request = index.openCursor(
                IDBKeyRange.only(accountId),
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

    async deleteOldCodes(accountId, keepCount = 10) {
        if (!this.isInitialized) await this.init();

        const allCodes = await this.getLatestCodes(accountId, 100);
        const codesToKeep = allCodes.slice(0, keepCount);
        const codesToDelete = allCodes.slice(keepCount);

        return new Promise((resolve, reject) => {
            if (codesToDelete.length === 0) {
                resolve(0);
                return;
            }

            const transaction = this.db.transaction(['codes'], 'readwrite');
            const store = transaction.objectStore('codes');
            let deletedCount = 0;

            transaction.oncomplete = () => resolve(deletedCount);
            transaction.onerror = () => reject(transaction.error);

            codesToDelete.forEach(code => {
                const request = store.delete(code.id);
                request.onsuccess = () => deletedCount++;
            });
        });
    }

    // === 设置管理 ===
    async saveSetting(key, value) {
        try {
            localStorage.setItem(`mailmanager_${key}`, JSON.stringify(value));
        } catch (error) {
            console.warn('[ClientStorage] localStorage写入失败:', error);
        }
    }

    async getSetting(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(`mailmanager_${key}`);
            return value ? JSON.parse(value) : defaultValue;
        } catch (error) {
            console.warn('[ClientStorage] localStorage读取失败:', error);
            return defaultValue;
        }
    }

    // === 数据统计 ===
    async getStats() {
        const accounts = await this.getAllAccounts();
        const statusCounts = {};

        accounts.forEach(account => {
            statusCounts[account.status] = (statusCounts[account.status] || 0) + 1;
        });

        // 获取存储大小估算
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
            storageSize: storageSize,
            storageSizeKB: Math.round(storageSize / 1024 * 100) / 100
        };
    }

    // === 数据导出/导入 ===
    async exportData() {
        const accounts = await this.getAllAccounts();
        const codes = [];

        // 获取所有验证码
        for (const account of accounts) {
            const accountCodes = await this.getLatestCodes(account.id, 100);
            codes.push(...accountCodes);
        }

        const settings = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('mailmanager_')) {
                const settingKey = key.replace('mailmanager_', '');
                settings[settingKey] = await this.getSetting(settingKey);
            }
        }

        return {
            accounts,
            codes,
            settings,
            exportTime: new Date().toISOString(),
            version: '1.0'
        };
    }

    async importData(data) {
        if (!data.accounts || !Array.isArray(data.accounts)) {
            throw new Error('无效的导入数据格式');
        }

        // 清空现有数据
        await this.clearAllData();

        // 导入账户
        for (const account of data.accounts) {
            await this.saveAccount(account);
        }

        // 导入验证码
        if (data.codes && Array.isArray(data.codes)) {
            for (const code of data.codes) {
                await this.saveCode(code);
            }
        }

        // 导入设置
        if (data.settings && typeof data.settings === 'object') {
            for (const [key, value] of Object.entries(data.settings)) {
                await this.saveSetting(key, value);
            }
        }

        return {
            importedAccounts: data.accounts.length,
            importedCodes: data.codes ? data.codes.length : 0,
            importedSettings: Object.keys(data.settings).length
        };
    }

    async clearAllData() {
        if (!this.isInitialized) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts', 'codes'], 'readwrite');

            const accountStore = transaction.objectStore('accounts');
            accountStore.clear();

            const codeStore = transaction.objectStore('codes');
            codeStore.clear();

            transaction.oncomplete = () => {
                // 清空 localStorage设置
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
}

// 单例模式
const clientStorage = new ClientStorage();

module.exports = clientStorage;