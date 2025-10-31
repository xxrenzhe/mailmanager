/**
 * 邮箱序列编号管理器
 * 确保相同邮箱获得相同编号，且编号按导入顺序递增
 */

class EmailSequenceManager {
    constructor(database) {
        this.db = database;
        this.sequenceCache = new Map(); // 缓存邮箱->编号映射
        this.maxSequenceCache = 0; // 缓存当前最大编号
        this.initialized = false;
    }

    /**
     * 初始化序列管理器
     */
    async initialize() {
        if (this.initialized) return;

        console.log('[EmailSequence] 初始化邮箱序列管理器...');

        // 预加载现有邮箱的编号映射
        await this.loadExistingSequences();

        // 获取当前最大编号
        this.maxSequenceCache = await this.getMaxSequence();

        this.initialized = true;
        console.log(`[EmailSequence] 初始化完成，当前最大编号: ${this.maxSequenceCache}`);
    }

    /**
     * 加载现有的邮箱编号映射
     */
    async loadExistingSequences() {
        try {
            const query = `
                SELECT email, import_seq
                FROM accounts
                WHERE import_seq IS NOT NULL
                ORDER BY import_seq ASC
            `;

            const accounts = await this.db.all(query);

            this.sequenceCache.clear();
            accounts.forEach(account => {
                if (account.import_seq) {
                    this.sequenceCache.set(account.email.toLowerCase(), account.import_seq);
                }
            });

            console.log(`[EmailSequence] 加载了 ${this.sequenceCache.size} 个邮箱编号映射`);
        } catch (error) {
            console.error('[EmailSequence] 加载现有编号映射失败:', error);
            throw error;
        }
    }

    /**
     * 获取当前最大编号
     */
    async getMaxSequence() {
        try {
            const result = await this.db.get(
                'SELECT MAX(import_seq) as max_seq FROM accounts WHERE import_seq IS NOT NULL'
            );
            return result.max_seq || 0;
        } catch (error) {
            console.error('[EmailSequence] 获取最大编号失败:', error);
            return 0;
        }
    }

    /**
     * 为邮箱分配编号
     * @param {string} email 邮箱地址
     * @returns {number} 分配的编号
     */
    async assignSequence(email) {
        await this.initialize();

        const normalizedEmail = email.toLowerCase().trim();

        // 检查缓存中是否已有编号
        if (this.sequenceCache.has(normalizedEmail)) {
            const existingSequence = this.sequenceCache.get(normalizedEmail);
            console.log(`[EmailSequence] 邮箱 ${email} 使用现有编号: ${existingSequence}`);
            return existingSequence;
        }

        // 分配新编号
        const newSequence = this.maxSequenceCache + 1;

        try {
            // 更新缓存
            this.sequenceCache.set(normalizedEmail, newSequence);
            this.maxSequenceCache = newSequence;

            console.log(`[EmailSequence] 邮箱 ${email} 分配新编号: ${newSequence}`);
            return newSequence;

        } catch (error) {
            console.error('[EmailSequence] 分配编号失败:', error);
            throw error;
        }
    }

    /**
     * 批量分配编号 - 优化版本
     * @param {string[]} emails 邮箱地址数组
     * @returns {Map<string, number>} 邮箱到编号的映射
     */
    async assignSequencesBatch(emails) {
        await this.initialize();

        const result = new Map();
        const newAssignments = [];

        // 第一遍：检查已有编号
        for (const email of emails) {
            const normalizedEmail = email.toLowerCase().trim();

            if (this.sequenceCache.has(normalizedEmail)) {
                const existingSequence = this.sequenceCache.get(normalizedEmail);
                result.set(email, existingSequence);
            } else {
                // 需要分配新编号
                newAssignments.push(email);
            }
        }

        // 第二遍：批量分配新编号（避免逐个调用assignSequence）
        if (newAssignments.length > 0) {
            const startSequence = this.maxSequenceCache + 1;

            for (let i = 0; i < newAssignments.length; i++) {
                const email = newAssignments[i];
                const newSequence = startSequence + i;
                const normalizedEmail = email.toLowerCase().trim();

                // 直接更新缓存，避免调用assignSequence方法
                this.sequenceCache.set(normalizedEmail, newSequence);
                result.set(email, newSequence);
            }

            // 更新最大编号缓存
            this.maxSequenceCache = startSequence + newAssignments.length - 1;

            // 只打印一条汇总日志，而不是每个邮箱都打印
            console.log(`[EmailSequence] 批量分配 ${newAssignments.length} 个新编号: ${startSequence}-${this.maxSequenceCache}`);
        }

        console.log(`[EmailSequence] 批量分配完成: ${emails.length} 个邮箱，${newAssignments.length} 个新编号`);
        return result;
    }

    /**
     * 更新数据库中的邮箱编号
     * @param {number} accountId 账户ID
     * @param {number} sequence 编号
     */
    async updateAccountSequence(accountId, sequence) {
        try {
            await this.db.run(
                'UPDATE accounts SET import_seq = ?, updated_at = ? WHERE id = ?',
                [sequence, new Date().toISOString(), accountId]
            );
        } catch (error) {
            console.error('[EmailSequence] 更新账户编号失败:', error);
            throw error;
        }
    }

    /**
     * 获取邮箱的编号
     * @param {string} email 邮箱地址
     * @returns {number|null} 编号或null
     */
    async getEmailSequence(email) {
        await this.initialize();

        const normalizedEmail = email.toLowerCase().trim();
        return this.sequenceCache.get(normalizedEmail) || null;
    }

    /**
     * 重建编号序列（用于修复数据不一致）
     */
    async rebuildSequence() {
        console.log('[EmailSequence] 开始重建编号序列...');

        try {
            // 按创建时间排序所有账户
            const accounts = await this.db.all(`
                SELECT id, email, created_at
                FROM accounts
                ORDER BY created_at ASC
            `);

            let currentSequence = 0;
            const updates = [];

            for (const account of accounts) {
                const normalizedEmail = account.email.toLowerCase().trim();

                if (!this.sequenceCache.has(normalizedEmail)) {
                    currentSequence++;
                    this.sequenceCache.set(normalizedEmail, currentSequence);
                    updates.push({ id: account.id, sequence: currentSequence });
                }
            }

            // 批量更新数据库
            for (const update of updates) {
                await this.updateAccountSequence(update.id, update.sequence);
            }

            this.maxSequenceCache = currentSequence;
            console.log(`[EmailSequence] 重建完成，处理了 ${updates.length} 个新编号，当前最大编号: ${currentSequence}`);

        } catch (error) {
            console.error('[EmailSequence] 重建编号序列失败:', error);
            throw error;
        }
    }

    /**
     * 获取编号统计信息
     */
    async getSequenceStats() {
        try {
            const stats = await this.db.get(`
                SELECT
                    COUNT(*) as total_accounts,
                    COUNT(import_seq) as accounts_with_sequence,
                    MAX(import_seq) as max_sequence,
                    MIN(import_seq) as min_sequence
                FROM accounts
            `);

            return {
                totalAccounts: stats.total_accounts || 0,
                accountsWithSequence: stats.accounts_with_sequence || 0,
                maxSequence: stats.max_sequence || 0,
                minSequence: stats.min_sequence || 0,
                cacheSize: this.sequenceCache.size,
                maxCacheSequence: this.maxSequenceCache
            };
        } catch (error) {
            console.error('[EmailSequence] 获取统计信息失败:', error);
            return {
                totalAccounts: 0,
                accountsWithSequence: 0,
                maxSequence: 0,
                minSequence: 0,
                cacheSize: this.sequenceCache.size,
                maxCacheSequence: this.maxSequenceCache
            };
        }
    }

    /**
     * 清理缓存
     */
    clearCache() {
        this.sequenceCache.clear();
        this.maxSequenceCache = 0;
        this.initialized = false;
        console.log('[EmailSequence] 缓存已清理');
    }

    /**
     * 导出编号映射
     */
    exportSequenceMapping() {
        const mapping = {};
        for (const [email, sequence] of this.sequenceCache.entries()) {
            mapping[email] = sequence;
        }
        return mapping;
    }

    /**
     * 导入编号映射
     */
    importSequenceMapping(mapping) {
        this.sequenceCache.clear();

        let maxSequence = 0;
        for (const [email, sequence] of Object.entries(mapping)) {
            this.sequenceCache.set(email.toLowerCase(), sequence);
            if (sequence > maxSequence) {
                maxSequence = sequence;
            }
        }

        this.maxSequenceCache = maxSequence;
        console.log(`[EmailSequence] 导入了 ${Object.keys(mapping).length} 个编号映射，最大编号: ${maxSequence}`);
    }
}

module.exports = EmailSequenceManager;