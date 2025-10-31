/**
 * 批量自动重新授权脚本
 * 一次性处理所有需要重新授权的账户
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');
const AutoReauthService = require('./server/autoReauthService');

class BatchAutoReauth {
    constructor() {
        this.db = new Database('./data/mailmanager.db');
        this.emailService = new EmailService();
        this.emailService.setDatabase(this.db);
        this.autoReauthService = new AutoReauthService(this.db, this.emailService);
    }

    async init() {
        try {
            await this.db.init();
        } catch (error) {
            console.log('Database initialization had issues, but continuing with existing tables...');
            this.db.db = new (require('sqlite3').Database)('./data/mailmanager.db');
        }
    }

    async batchProcessAllAccounts() {
        console.log('\n=== 批量自动重新授权所有账户 ===');

        try {
            // 1. 获取所有需要重新授权的账户
            const accounts = await this.db.getAccounts();
            const reauthNeeded = accounts.filter(acc => acc.status === 'reauth_needed');

            console.log(`找到 ${reauthNeeded.length} 个需要重新授权的账户`);

            if (reauthNeeded.length === 0) {
                console.log('✅ 没有需要处理的账户');
                return;
            }

            // 2. 批量处理（限制并发数为5）
            const concurrency = 5;
            const chunks = this.chunkArray(reauthNeeded, concurrency);

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`\n处理批次 ${i + 1}/${chunks.length} (${chunk.length} 个账户)`);

                // 并发处理当前批次
                const promises = chunk.map(async (account) => {
                    try {
                        const success = await this.autoReauthService.processAccountReauth(account);
                        if (success) {
                            successCount++;
                            console.log(`✅ ${account.email} - 重新授权成功`);
                        } else {
                            failCount++;
                            console.log(`❌ ${account.email} - 重新授权失败`);
                        }
                        return { account, success };
                    } catch (error) {
                        failCount++;
                        console.log(`❌ ${account.email} - 处理异常: ${error.message}`);
                        return { account, success: false, error: error.message };
                    }
                });

                await Promise.all(promises);

                // 批次间延迟，避免API限流
                if (i < chunks.length - 1) {
                    console.log('等待3秒后处理下一批次...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            // 3. 显示结果统计
            console.log('\n=== 批量处理结果 ===');
            console.log(`✅ 成功: ${successCount} 个账户`);
            console.log(`❌ 失败: ${failCount} 个账户`);
            console.log(`📊 成功率: ${((successCount / (successCount + failCount)) * 100).toFixed(1)}%`);

            // 4. 验证处理结果
            console.log('\n🔍 验证处理结果...');
            const finalAccounts = await this.db.getAccounts();
            const finalAuthorized = finalAccounts.filter(acc => acc.status === 'authorized').length;
            const finalReauthNeeded = finalAccounts.filter(acc => acc.status === 'reauth_needed').length;
            const finalFailed = finalAccounts.filter(acc => acc.status === 'reauth_failed').length;

            console.log(`最终状态:`);
            console.log(`   已授权: ${finalAuthorized} 个`);
            console.log(`   需要重新授权: ${finalReauthNeeded} 个`);
            console.log(`   授权失败: ${finalFailed} 个`);

            // 5. 测试几个成功的账户
            if (successCount > 0) {
                console.log('\n📨 测试邮件提取功能...');
                const testAccounts = finalAccounts
                    .filter(acc => acc.status === 'authorized' && acc.refresh_token_enc)
                    .slice(0, 3); // 测试前3个

                for (const testAccount of testAccounts) {
                    try {
                        console.log(`测试 ${testAccount.email}...`);
                        const codes = await this.emailService.checkEmails(
                            testAccount.id,
                            testAccount.refresh_token_enc,
                            testAccount.client_id,
                            1
                        );

                        console.log(`   找到 ${codes.length} 个验证码`);
                        if (codes.length > 0) {
                            console.log(`   最新验证码: ${codes[0].code}`);
                        }
                    } catch (error) {
                        console.log(`   邮件提取失败: ${error.message}`);
                    }

                    // 测试间隔
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            return {
                total: reauthNeeded.length,
                success: successCount,
                failed: failCount,
                successRate: (successCount / (successCount + failCount)) * 100
            };

        } catch (error) {
            console.error('❌ 批量处理失败:', error);
            return null;
        }
    }

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const processor = new BatchAutoReauth();
    await processor.init();

    const result = await processor.batchProcessAllAccounts();

    if (result) {
        console.log(`\n🎉 批量自动重新授权完成！`);
        console.log(`成功处理 ${result.success} 个账户，成功率 ${result.successRate.toFixed(1)}%`);
    }

    await processor.close();
}

// 运行批量处理
if (require.main === module) {
    main().catch(error => {
        console.error('批量处理执行失败:', error);
        process.exit(1);
    });
}