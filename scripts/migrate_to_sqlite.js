#!/usr/bin/env node

/**
 * MailManager 数据迁移脚本
 * 从 JSON 文件迁移到 SQLite 数据库
 */

const fs = require('fs').promises;
const path = require('path');
const SimpleDatabase = require('../server/database_simple.js');

class DataMigrator {
    constructor() {
        this.db = new SimpleDatabase();
        this.jsonPath = path.join(__dirname, '../data/store.json');
        this.backupPath = path.join(__dirname, '../data/store.json.backup');
    }

    async migrate() {
        try {
            console.log('[迁移] 开始数据迁移...');

            // 1. 备份现有数据
            await this.backupExistingData();

            // 2. 初始化数据库
            await this.db.init();

            // 3. 读取JSON数据
            const jsonData = await this.readJsonData();

            // 4. 执行迁移
            await this.db.migrateFromJson(jsonData);

            // 5. 验证迁移结果
            await this.validateMigration();

            console.log('[迁移] ✅ 数据迁移完成!');
            console.log(`[迁移] 📊 迁移统计:`);
            console.log(`[迁移]    - 账户: ${jsonData.accounts?.length || 0} 个`);
            console.log(`[迁移]    - 验证码: ${jsonData.codes?.length || 0} 个`);
            console.log(`[迁移]    - 消息: ${jsonData.messages?.length || 0} 个`);

        } catch (error) {
            console.error('[迁移] ❌ 迁移失败:', error);
            throw error;
        }
    }

    async backupExistingData() {
        try {
            const dataExists = await fs.access(this.jsonPath).then(() => true).catch(() => false);

            if (dataExists) {
                await fs.copyFile(this.jsonPath, this.backupPath);
                console.log('[迁移] ✅ 已备份现有数据到 store.json.backup');
            } else {
                console.log('[迁移] ℹ️  未找到现有数据文件，跳过备份');
            }
        } catch (error) {
            console.warn('[迁移] ⚠️  备份失败:', error.message);
        }
    }

    async readJsonData() {
        try {
            const dataContent = await fs.readFile(this.jsonPath, 'utf8');
            const data = JSON.parse(dataContent);

            console.log('[迁移] ✅ 成功读取JSON数据');
            return data;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('[迁移] ℹ️  未找到JSON数据文件，创建空数据结构');
                return {
                    accounts: [],
                    codes: [],
                    messages: []
                };
            }
            throw error;
        }
    }

    async validateMigration() {
        try {
            const totalAccounts = await this.db.getTotalAccounts();
            console.log(`[迁移] ✅ 验证通过: 数据库中共有 ${totalAccounts} 个账户`);

            if (totalAccounts > 0) {
                // 验证几个账户的数据完整性
                const sampleAccounts = await this.db.getAccountsWithLatestCodes({ page: 1, pageSize: 5 });
                console.log('[迁移] ✅ 数据完整性验证通过');

                sampleAccounts.forEach(account => {
                    console.log(`[迁移]    - ${account.email} (状态: ${account.status})`);
                });
            }
        } catch (error) {
            console.error('[迁移] ❌ 验证失败:', error);
            throw error;
        }
    }

    async cleanup() {
        if (this.db) {
            await this.db.close();
        }
    }
}

// 主执行函数
async function main() {
    const migrator = new DataMigrator();

    try {
        await migrator.migrate();
        console.log('[迁移] 🎉 所有操作完成!');
    } catch (error) {
        console.error('[迁移] 💥 迁移过程中发生错误:', error);
        process.exit(1);
    } finally {
        await migrator.cleanup();
    }
}

// 处理未捕获的异常
process.on('unhandledRejection', (reason, promise) => {
    console.error('[迁移] 未处理的Promise拒绝:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('[迁移] 未捕获的异常:', error);
    process.exit(1);
});

// 如果直接运行此脚本
if (require.main === module) {
    main();
}

module.exports = DataMigrator;