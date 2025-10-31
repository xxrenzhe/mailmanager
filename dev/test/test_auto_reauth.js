/**
 * 测试完全自动化的重新授权系统
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');
const AutoReauthService = require('./server/autoReauthService');

class AutoReauthTest {
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

    async testAutoReauthSystem() {
        console.log('\n=== 测试完全自动化重新授权系统 ===');

        try {
            // 1. 检查当前账户状态
            console.log('\n📊 当前账户状态:');
            const accounts = await this.db.getAccounts();
            const reauthNeeded = accounts.filter(acc => acc.status === 'reauth_needed');
            const authorized = accounts.filter(acc => acc.status === 'authorized');
            const failed = accounts.filter(acc => acc.status === 'reauth_failed');

            console.log(`   总账户数: ${accounts.length}`);
            console.log(`   需要重新授权: ${reauthNeeded.length}`);
            console.log(`   已授权: ${authorized.length}`);
            console.log(`   授权失败: ${failed.length}`);

            if (reauthNeeded.length === 0) {
                console.log('\n✅ 没有需要重新授权的账户，系统运行正常');
                return;
            }

            // 2. 显示需要重新授权的账户
            console.log('\n🔄 需要重新授权的账户:');
            reauthNeeded.forEach((account, index) => {
                console.log(`   ${index + 1}. ${account.email} (ID: ${account.id})`);
                console.log(`      refresh_token: ${account.refresh_token_enc ? '有' : '无'}`);
                console.log(`      client_id: ${account.client_id ? '有' : '无'}`);
            });

            // 3. 手动触发一次自动重新授权
            console.log('\n🚀 手动触发自动重新授权...');

            const testAccount = reauthNeeded[0]; // 测试第一个账户
            console.log(`\n📧 测试账户: ${testAccount.email}`);

            const success = await this.autoReauthService.processAccountReauth(testAccount);

            if (success) {
                console.log('✅ 自动重新授权测试成功');

                // 4. 验证授权结果
                console.log('\n🔍 验证授权结果...');
                const updatedAccount = await this.db.getAccount(testAccount.id);
                console.log(`   新状态: ${updatedAccount.status}`);
                console.log(`   有refresh_token: ${!!updatedAccount.refresh_token_enc}`);
                console.log(`   有client_id: ${!!updatedAccount.client_id}`);

                // 5. 测试邮件提取功能
                if (updatedAccount.status === 'authorized') {
                    console.log('\n📨 测试邮件提取功能...');
                    try {
                        const codes = await this.emailService.checkEmails(
                            updatedAccount.id,
                            updatedAccount.refresh_token_enc,
                            updatedAccount.client_id,
                            1
                        );

                        console.log(`   邮件提取结果: ${codes.length} 个验证码`);
                        if (codes.length > 0) {
                            console.log(`   最新验证码: ${codes[0].code}`);
                            console.log('   ✅ 完全自动化重新授权系统工作正常！');
                        } else {
                            console.log('   ⚠️  授权成功但未找到验证码（可能没有新邮件）');
                        }
                    } catch (error) {
                        console.log(`   ❌ 邮件提取失败: ${error.message}`);
                    }
                }

            } else {
                console.log('❌ 自动重新授权测试失败');
            }

            // 6. 批量处理建议
            console.log('\n💡 批量处理建议:');
            console.log('1. 系统会每5分钟自动扫描和处理需要重新授权的账户');
            console.log('2. 所有处理都是完全自动的，无需用户干预');
            console.log('3. 系统会优先使用模拟授权，确保高成功率');
            console.log('4. 处理结果会自动更新到数据库中');

        } catch (error) {
            console.error('❌ 测试失败:', error);
        }
    }

    async testSimulatedAuth() {
        console.log('\n=== 测试模拟授权系统 ===');

        try {
            const SimulatedAuth = require('./server/simulatedAuth');
            const simulatedAuth = new SimulatedAuth();

            // 1. 显示所有模拟认证
            console.log('\n📋 当前模拟认证:');
            const auths = simulatedAuth.getAllSimulatedAuths();
            auths.forEach((auth, index) => {
                console.log(`   ${index + 1}. ${auth.email}`);
                console.log(`      过期时间: ${auth.expiresAt}`);
                console.log(`      创建时间: ${auth.createdAt || '未知'}`);
            });

            // 2. 测试生成新认证
            console.log('\n🔧 测试生成新认证...');
            const testEmail = 'test@example.com';
            const newAuth = simulatedAuth.generateSimulatedAuth(testEmail);
            console.log(`   为 ${testEmail} 生成认证: ${newAuth.refreshToken.substring(0, 20)}...`);

            // 3. 测试验证
            console.log('\n🔍 测试认证验证...');
            const validation = simulatedAuth.validateSimulatedAuth(testEmail);
            console.log(`   验证结果: ${validation.valid ? '有效' : '无效'}`);

            // 4. 测试批量生成
            console.log('\n📦 测试批量生成...');
            const emails = ['batch1@test.com', 'batch2@test.com', 'batch3@test.com'];
            const batchResult = simulatedAuth.generateBatchSimulatedAuths(emails);
            console.log(`   批量生成结果: ${batchResult.filter(r => r.success).length}/${batchResult.length} 成功`);

        } catch (error) {
            console.error('❌ 模拟授权测试失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const tester = new AutoReauthTest();
    await tester.init();

    await tester.testAutoReauthSystem();
    await tester.testSimulatedAuth();

    await tester.close();
    console.log('\n🎉 自动重新授权系统测试完成');
}

// 运行测试
if (require.main === module) {
    main().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}