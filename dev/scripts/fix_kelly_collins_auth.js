/**
 * 修复 KellyCollinsjn@outlook.com 账户授权问题
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class KellyCollinsAuthFix {
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

    async checkAndFixAuth() {
        console.log('\n=== 修复 KellyCollinsjn@outlook.com 授权问题 ===');

        try {
            const targetEmail = 'KellyCollinsjn@outlook.com';

            // 1. 查询账户信息
            const account = await this.db.getAccountByEmail(targetEmail);
            if (!account) {
                console.log('❌ 未找到该账户');
                return;
            }

            console.log('\n📋 账户当前状态:');
            console.log(`   ID: ${account.id}`);
            console.log(`   邮箱: ${account.email}`);
            console.log(`   状态: ${account.status}`);
            console.log(`   最后活跃时间: ${account.last_active_at}`);

            // 2. 检查token有效性
            console.log('\n🔐 检查授权状态...');
            try {
                const authResult = await this.emailService.validateAuthorization(account);

                if (authResult.authorized) {
                    console.log('✅ 授权验证成功');
                } else {
                    console.log(`❌ 授权验证失败: ${authResult.error}`);
                    console.log('💡 建议: 需要重新授权该账户');
                    console.log('   操作步骤:');
                    console.log('   1. 在Web界面中删除该账户');
                    console.log('   2. 重新添加该账户并完成OAuth授权');
                    console.log('   3. 系统将自动获取新的refresh_token');
                }
            } catch (error) {
                console.log(`❌ 授权验证异常: ${error.message}`);
                console.log('💡 建议: refresh token可能已过期，需要重新授权');
            }

            // 3. 检查access token缓存
            console.log('\n🎫 检查access token缓存...');
            try {
                const cachedToken = await this.db.getValidAccessToken(account.id);
                if (cachedToken) {
                    console.log('✅ 找到有效的缓存的access token');
                    console.log(`   过期时间: ${cachedToken.expires_at}`);
                } else {
                    console.log('❌ 没有有效的缓存的access token');
                }
            } catch (error) {
                console.log('⚠️  无法检查access token缓存');
            }

            // 4. 尝试强制刷新token
            console.log('\n🔄 尝试强制刷新access token...');
            try {
                const newToken = await this.emailService.getAccessToken(
                    account.id,
                    account.refresh_token_enc,
                    account.client_id
                );

                if (newToken) {
                    console.log('✅ 成功获取新的access token');

                    // 立即测试新token
                    console.log('\n🧪 测试新token...');
                    const testCodes = await this.emailService.checkEmails(
                        account.id,
                        account.refresh_token_enc,
                        account.client_id,
                        1
                    );

                    console.log(`   测试结果: 获取到 ${testCodes.length} 个验证码`);
                    if (testCodes.length > 0) {
                        console.log('   最新验证码:', testCodes[0].code);
                    }
                } else {
                    console.log('❌ 无法获取新的access token');
                }
            } catch (error) {
                console.log(`❌ 刷新token失败: ${error.message}`);
                console.log('💡 这证实了refresh token已过期或无效');
            }

            // 5. 总结和建议
            console.log('\n📝 问题总结和解决方案:');
            console.log('   问题根因: refresh token过期或无效');
            console.log('   解决方案: 重新进行OAuth授权');
            console.log('');
            console.log('   推荐操作步骤:');
            console.log('   1. 访问邮件管理系统Web界面');
            console.log('   2. 找到 "KellyCollinsjn@outlook.com" 账户');
            console.log('   3. 删除该账户');
            console.log('   4. 重新添加该账户');
            console.log('   5. 完成Microsoft OAuth授权流程');
            console.log('   6. 系统将自动获取新的refresh_token');

        } catch (error) {
            console.error('❌ 修复过程失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const fixer = new KellyCollinsAuthFix();
    await fixer.init();
    await fixer.checkAndFixAuth();
    await fixer.close();
}

// 运行修复
if (require.main === module) {
    main().catch(error => {
        console.error('修复执行失败:', error);
        process.exit(1);
    });
}