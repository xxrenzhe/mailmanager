/**
 * 简单Token检查测试脚本
 * 测试KISS优化后的定时Token检查功能
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class SimpleTokenCheckTest {
    constructor() {
        this.db = new Database('./data/mailmanager.db');
        this.emailService = new EmailService();
        this.emailService.setDatabase(this.db);
    }

    async init() {
        try {
            await this.db.init();
        } catch (error) {
            console.log('Database initialization had issues, but continuing with existing tables...');
            this.db.db = new (require('sqlite3').Database)('./data/mailmanager.db');
        }
    }

    async testSimpleTokenCheck() {
        console.log('\n=== 测试简单Token检查功能 ===');

        try {
            // 1. 检查当前账户状态分布
            console.log('\n📊 检查账户状态分布...');
            const statusCounts = await this.db.all(`
                SELECT status, COUNT(*) as count
                FROM accounts
                GROUP BY status
                ORDER BY count DESC
            `);

            statusCounts.forEach(row => {
                console.log(`   ${row.status}: ${row.count} 个账户`);
            });

            // 2. 获取需要重新授权的账户
            console.log('\n🔍 获取需要重新授权的账户...');
            const reauthNeeded = await this.db.all(`
                SELECT id, email, status, refresh_token_enc
                FROM accounts
                WHERE status = 'reauth_needed'
                OR (refresh_token_enc IS NULL OR refresh_token_enc = '')
                ORDER BY email
                LIMIT 10
            `);

            if (reauthNeeded.length === 0) {
                console.log('✅ 没有需要重新授权的账户');
            } else {
                console.log(`找到 ${reauthNeeded.length} 个需要重新授权的账户:`);
                reauthNeeded.forEach((account, index) => {
                    console.log(`   ${index + 1}. ${account.email} (状态: ${account.status})`);
                    console.log(`      refresh_token: ${account.refresh_token_enc ? '有' : '无'}`);
                });

                // 3. 测试单个账户的授权验证
                console.log('\n🧪 测试第一个账户的授权验证...');
                const testAccount = reauthNeeded[0];
                const validationResult = await this.emailService.validateAuthorization(testAccount);

                console.log(`测试账户 ${testAccount.email}:`);
                console.log(`   授权状态: ${validationResult.authorized ? '✅ 有效' : '❌ 无效'}`);
                if (validationResult.accessToken) {
                    console.log(`   Access Token: ✅ 有效`);
                } else {
                    console.log(`   Access Token: ❌ 无效`);
                }
            }

            // 4. 检查正常的授权账户
            console.log('\n🔍 检查正常授权账户...');
            const authorizedAccounts = await this.db.all(`
                SELECT id, email, refresh_token_enc
                FROM accounts
                WHERE status = 'authorized'
                AND refresh_token_enc IS NOT NULL
                AND refresh_token_enc NOT LIKE 'simulated_%'
                ORDER BY RANDOM()
                LIMIT 3
            `);

            if (authorizedAccounts.length > 0) {
                console.log('随机测试3个正常授权账户:');
                for (const account of authorizedAccounts) {
                    const validation = await this.emailService.validateAuthorization(account);
                    console.log(`   ${account.email}: ${validation.authorized ? '✅ 有效' : '❌ 无效'}`);
                }
            }

            // 5. 模拟简单Token检查逻辑
            console.log('\n🚀 模拟简单Token检查逻辑...');
            await this.simulateSimpleTokenCheck();

            console.log('\n✅ 简单Token检查功能测试完成');

        } catch (error) {
            console.error('❌ 测试失败:', error);
        }
    }

    async simulateSimpleTokenCheck() {
        try {
            // 模拟 startSimpleTokenCheck 中的逻辑
            const reauthNeeded = await this.db.all(`
                SELECT id, email
                FROM accounts
                WHERE status = 'reauth_needed'
                OR (refresh_token_enc IS NULL OR refresh_token_enc = '')
                LIMIT 5
            `);

            if (reauthNeeded.length > 0) {
                console.log(`   模拟找到 ${reauthNeeded.length} 个账户需要处理`);

                let successCount = 0;
                for (const account of reauthNeeded) {
                    try {
                        const success = await this.emailService.validateAuthorization(account);
                        if (success.authorized) {
                            successCount++;
                            console.log(`   ✅ ${account.email} 授权恢复成功`);
                        } else {
                            console.log(`   ❌ ${account.email} 授权恢复失败`);
                        }
                    } catch (error) {
                        console.log(`   ❌ ${account.email} 处理异常: ${error.message}`);
                    }
                }

                console.log(`   处理结果: ${successCount}/${reauthNeeded.length} 成功`);
            } else {
                console.log('   模拟检查: 没有需要处理的账户');
            }

        } catch (error) {
            console.error('   模拟检查失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const tester = new SimpleTokenCheckTest();
    await tester.init();

    await tester.testSimpleTokenCheck();

    await tester.close();
    console.log('\n🎉 简单Token检查测试完成');
}

// 运行测试
if (require.main === module) {
    main().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}