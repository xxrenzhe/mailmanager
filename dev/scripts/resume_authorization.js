/**
 * 恢复授权队列处理脚本
 * 手动触发剩余pending账户的授权处理
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const SimpleDB = require('./server/database');
const EmailService = require('./server/emailService');

class ResumeAuthorizationProcessor {
    constructor() {
        this.db = new SimpleDB('./data/mailmanager.db');
        this.emailService = new EmailService();
        this.processing = false;
        this.stats = {
            total: 0,
            processed: 0,
            successful: 0,
            failed: 0
        };

        // 处理配置
        this.config = {
            batchSize: 10,           // 每批处理10个账户
            batchDelay: 2000,        // 批次间隔2秒
            authDelay: 200,          // 账户间隔200ms
            maxRetries: 2
        };
    }

    async init() {
        await this.db.init();
        this.emailService.setDatabase(this.db);
    }

    /**
     * 获取待处理的账户
     */
    async getPendingAccounts(limit = 100) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT id, email, client_id, refresh_token_enc, status
                FROM accounts
                WHERE status = 'pending'
                AND refresh_token_enc IS NOT NULL
                AND client_id IS NOT NULL
                ORDER BY id
                LIMIT ?
            `;

            this.db.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * 处理单个账户的授权
     */
    async processAccountAuthorization(account) {
        try {
            console.log(`[ResumeAuth] 处理账户授权: ${account.email} (ID: ${account.id})`);

            // 验证授权状态
            const authorizationResult = await this.emailService.validateAuthorization(account);

            if (authorizationResult.authorized) {
                // 更新为已授权状态
                await this.db.updateAccount(account.id, {
                    status: 'authorized',
                    updated_at: new Date().toISOString()
                });

                console.log(`[ResumeAuth] ✅ 账户授权成功: ${account.email}`);
                this.stats.successful++;

                // 安排邮件提取
                await this.extractEmailsForAccount(account.id);

                return {
                    accountId: account.id,
                    email: account.email,
                    status: 'success',
                    message: '授权验证成功'
                };

            } else {
                // 授权失败
                console.log(`[ResumeAuth] ❌ 账户授权失败: ${account.email} - ${authorizationResult.error}`);
                this.stats.failed++;

                return {
                    accountId: account.id,
                    email: account.email,
                    status: 'failed',
                    error: authorizationResult.error
                };
            }

        } catch (error) {
            console.error(`[ResumeAuth] ❌ 处理账户 ${account.email} 时出错:`, error.message);
            this.stats.failed++;

            return {
                accountId: account.id,
                email: account.email,
                status: 'error',
                error: error.message
            };
        }
    }

    /**
     * 为账户提取邮件
     */
    async extractEmailsForAccount(accountId) {
        try {
            const account = await this.db.getAccount(accountId);
            if (!account || !account.refresh_token_enc || !account.client_id) {
                return;
            }

            const codes = await this.emailService.checkEmails(
                accountId,
                account.refresh_token_enc,
                account.client_id,
                24 // 24小时内的邮件
            );

            if (codes.length > 0) {
                console.log(`[ResumeAuth] 📧 为账户 ${account.email} 提取到 ${codes.length} 个验证码`);
            }

        } catch (error) {
            console.error(`[ResumeAuth] 为账户 ${accountId} 提取邮件失败:`, error.message);
        }
    }

    /**
     * 处理一批账户
     */
    async processBatch(accounts) {
        console.log(`[ResumeAuth] 处理批次: ${accounts.length} 个账户`);

        const promises = accounts.map(async (account, index) => {
            // 账户间延迟
            await new Promise(resolve => setTimeout(resolve, this.config.authDelay * index));
            return await this.processAccountAuthorization(account);
        });

        const results = await Promise.allSettled(promises);
        this.stats.processed += accounts.length;

        // 统计结果
        const successful = results.filter(r => r.value?.status === 'success').length;
        const failed = results.filter(r => r.value?.status === 'failed' || r.value?.status === 'error').length;

        console.log(`[ResumeAuth] 批次完成: 成功 ${successful}, 失败 ${failed}`);

        return results;
    }

    /**
     * 开始恢复授权处理
     */
    async startResumeProcessing(limit = 100) {
        if (this.processing) {
            console.log('[ResumeAuth] 已经在处理中...');
            return;
        }

        this.processing = true;
        console.log(`[ResumeAuth] 🚀 开始恢复授权处理...`);

        try {
            // 获取总pending数量
            const totalPending = await this.getPendingAccountCount();
            this.stats.total = Math.min(totalPending, limit);

            console.log(`[ResumeAuth] 📊 待处理账户总数: ${totalPending}, 本次处理: ${this.stats.total}`);

            let processedCount = 0;

            while (processedCount < this.stats.total && this.processing) {
                // 获取下一批账户
                const accounts = await this.getPendingAccounts(this.config.batchSize);

                if (accounts.length === 0) {
                    console.log('[ResumeAuth] ✅ 所有待处理账户已完成');
                    break;
                }

                // 处理批次
                await this.processBatch(accounts);
                processedCount += accounts.length;

                console.log(`[ResumeAuth] 📈 进度: ${this.stats.processed}/${this.stats.total} (成功率: ${(this.stats.successful/this.stats.processed*100).toFixed(1)}%)`);

                // 批次间延迟
                if (accounts.length === this.config.batchSize && processedCount < this.stats.total) {
                    console.log(`[ResumeAuth] ⏱️  等待 ${this.config.batchDelay}ms 后处理下一批...`);
                    await new Promise(resolve => setTimeout(resolve, this.config.batchDelay));
                }
            }

            console.log(`[ResumeAuth] 🎉 授权处理完成!`);
            console.log(`[ResumeAuth] 📊 最终统计: 总计 ${this.stats.total}, 成功 ${this.stats.successful}, 失败 ${this.stats.failed}`);

        } catch (error) {
            console.error('[ResumeAuth] ❌ 处理过程中发生错误:', error);
        } finally {
            this.processing = false;
        }
    }

    /**
     * 获取待处理账户总数
     */
    async getPendingAccountCount() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT COUNT(*) as count
                FROM accounts
                WHERE status = 'pending'
                AND refresh_token_enc IS NOT NULL
                AND client_id IS NOT NULL
            `;

            this.db.db.get(sql, [], (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result.count);
                }
            });
        });
    }

    /**
     * 停止处理
     */
    stopProcessing() {
        this.processing = false;
        console.log('[ResumeAuth] ⏹️  停止授权处理');
    }

    /**
     * 获取当前统计
     */
    getStats() {
        return { ...this.stats };
    }
}

// 主函数
async function main() {
    const processor = new ResumeAuthorizationProcessor();
    await processor.init();

    const limit = process.argv[2] ? parseInt(process.argv[2]) : 50;

    console.log(`[ResumeAuth] 📋 将处理 ${limit} 个pending账户的授权`);

    // 处理Ctrl+C中断
    process.on('SIGINT', () => {
        console.log('\n[ResumeAuth] 收到中断信号，正在停止处理...');
        processor.stopProcessing();
        setTimeout(() => {
            console.log('[ResumeAuth] 程序已退出');
            process.exit(0);
        }, 2000);
    });

    await processor.startResumeProcessing(limit);
    await processor.db.close();
}

// 运行脚本
if (require.main === module) {
    main().catch(error => {
        console.error('[ResumeAuth] 程序执行失败:', error);
        process.exit(1);
    });
}

module.exports = ResumeAuthorizationProcessor;