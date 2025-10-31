/**
 * 调试 KellyCollinsjn@outlook.com 账户验证码提取问题
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class KellyCollinsDebug {
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

    async debugKellyCollins() {
        console.log('\n=== 调试 KellyCollinsjn@outlook.com 账户 ===');

        try {
            const targetEmail = 'KellyCollinsjn@outlook.com';

            // 1. 查询账户基本信息
            const account = await this.db.getAccountByEmail(targetEmail);
            if (!account) {
                console.log('❌ 未找到该账户');
                return;
            }

            console.log('\n📋 账户基本信息:');
            console.log(`   ID: ${account.id}`);
            console.log(`   邮箱: ${account.email}`);
            console.log(`   状态: ${account.status}`);
            console.log(`   最新验证码: ${account.latest_code || '无'}`);
            console.log(`   验证码收件时间: ${account.latest_code_received_at || '无'}`);
            console.log(`   最后活跃时间: ${account.last_active_at}`);
            console.log(`   有refresh_token: ${!!account.refresh_token_enc}`);
            console.log(`   有client_id: ${!!account.client_id}`);

            // 2. 检查该账户的验证码历史记录
            console.log('\n📨 验证码历史记录:');
            const codes = await this.db.getCodes(account.id);
            console.log(`   总共 ${codes.length} 条验证码记录:`);

            codes.forEach((code, index) => {
                console.log(`   ${index + 1}. 验证码: ${code.code} | 发件人: ${code.sender || '未知'} | 时间: ${code.received_at}`);
            });

            // 3. 检查邮件处理历史
            console.log('\n🔄 邮件处理历史:');
            try {
                const history = await this.db.getRecentEmailProcessingHistory(account.id, 10);
                console.log(`   最近 ${history.length} 次处理记录:`);

                history.forEach((record, index) => {
                    console.log(`   ${index + 1}. ${record.processed_at} - ${record.message_id.substring(0, 20)}... - ${record.status} (${record.processing_time_ms}ms, ${record.codes_found}个验证码)`);
                });
            } catch (error) {
                console.log('   无法获取处理历史（可能是新功能）');
            }

            // 4. 尝试实时获取邮件（如果有认证信息）
            if (account.refresh_token_enc && account.client_id) {
                console.log('\n🔍 尝试实时获取邮件...');
                try {
                    console.log('   开始获取邮件...');
                    const codes = await this.emailService.checkEmails(
                        account.id,
                        account.refresh_token_enc,
                        account.client_id,
                        1
                    );
                    console.log(`   实时获取到 ${codes.length} 个验证码:`);

                    codes.forEach((code, index) => {
                        console.log(`     ${index + 1}. 验证码: ${code.code} | 发件人: ${code.sender} | 主题: ${code.subject} | 时间: ${code.received_at}`);
                    });

                    if (codes.length === 0) {
                        console.log('   ⚠️  实时获取也没有找到验证码');
                    }

                } catch (error) {
                    console.log(`   ❌ 实时获取失败: ${error.message}`);
                }
            } else {
                console.log('\n⚠️  账户缺少认证信息，无法进行实时获取');
            }

            // 5. 分析可能的原因
            console.log('\n🔍 问题分析:');

            if (!account.refresh_token_enc || !account.client_id) {
                console.log('   ❌ 缺少认证信息，无法获取邮件');
            } else if (codes.length === 0) {
                console.log('   ❌ 数据库中没有任何验证码记录');
                console.log('   💡 可能原因:');
                console.log('      - 邮件中的验证码格式不符合识别规则');
                console.log('      - 验证码被误认为是其他数字');
                console.log('      - 邮件内容为图片或特殊格式');
                console.log('      - API调用权限问题');
            } else {
                console.log('   ✅ 历史上有验证码记录，问题可能是:');
                console.log('      - 最近没有新的验证码邮件');
                console.log('      - 新邮件的验证码格式发生变化');
                console.log('      - 提取算法需要优化');
            }

        } catch (error) {
            console.error('❌ 调试失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const kellyDebugger = new KellyCollinsDebug();
    await kellyDebugger.init();
    await kellyDebugger.debugKellyCollins();
    await kellyDebugger.close();
}

// 运行调试
if (require.main === module) {
    main().catch(error => {
        console.error('调试执行失败:', error);
        process.exit(1);
    });
}