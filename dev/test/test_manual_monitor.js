/**
 * 手动测试 KellyCollinsjn@outlook.com 账户监控
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class ManualMonitorTest {
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

    async testManualMonitoring() {
        console.log('\n=== 手动测试 KellyCollinsjn@outlook.com 监控 ===');

        try {
            const targetEmail = 'KellyCollinsjn@outlook.com';
            const account = await this.db.getAccountByEmail(targetEmail);

            if (!account) {
                console.log('❌ 未找到该账户');
                return;
            }

            console.log(`\n📋 测试账户信息:`);
            console.log(`   ID: ${account.id}`);
            console.log(`   邮箱: ${account.email}`);
            console.log(`   状态: ${account.status}`);

            // 1. 检查授权状态
            console.log('\n🔐 检查授权状态...');
            try {
                const authResult = await this.emailService.validateAuthorization(account);
                console.log(`   授权状态: ${authResult.authorized ? '✅ 有效' : '❌ 无效'}`);
                if (!authResult.authorized) {
                    console.log(`   错误: ${authResult.error}`);
                    return;
                }
            } catch (error) {
                console.log(`   ❌ 授权验证失败: ${error.message}`);
                return;
            }

            // 2. 手动触发邮件检查（模拟复制邮箱地址的操作）
            console.log('\n🔍 手动触发邮件检查...');
            try {
                console.log('   开始检查邮件...');
                const startTime = Date.now();

                const codes = await this.emailService.checkEmails(
                    account.id,
                    account.refresh_token_enc,
                    account.client_id,
                    1
                );

                const processingTime = Date.now() - startTime;

                console.log(`   ✅ 邮件检查完成，耗时: ${processingTime}ms`);
                console.log(`   找到 ${codes.length} 个验证码:`);

                if (codes.length > 0) {
                    codes.forEach((code, index) => {
                        console.log(`     ${index + 1}. 验证码: ${code.code}`);
                        console.log(`        发件人: ${code.sender}`);
                        console.log(`        主题: ${code.subject}`);
                        console.log(`        时间: ${code.received_at}`);
                    });
                } else {
                    console.log('   ⚠️  没有找到验证码');

                    // 进一步分析：检查获取到的邮件数量
                    console.log('\n🔍 分析邮件获取情况...');
                    console.log('   可能原因:');
                    console.log('   1. 最近5封邮件中没有验证码');
                    console.log('   2. 验证码格式不符合识别规则');
                    console.log('   3. API调用受限或返回空结果');
                    console.log('   4. 邮件内容为图片或特殊格式');
                }

            } catch (error) {
                console.log(`   ❌ 邮件检查失败: ${error.message}`);

                if (error.message.includes('401')) {
                    console.log('   💡 这是授权问题，需要重新授权');
                } else if (error.message.includes('503')) {
                    console.log('   💡 这是Outlook服务不可用，请稍后重试');
                } else if (error.message.includes('429')) {
                    console.log('   💡 这是API调用频率限制，请稍后重试');
                }
            }

            // 3. 检查数据库中的记录变化
            console.log('\n📊 检查数据库记录...');
            try {
                const codes = await this.db.getCodes(account.id);
                console.log(`   数据库中现有验证码记录: ${codes.length} 条`);

                const accountAfter = await this.db.getAccountByEmail(targetEmail);
                console.log(`   账户最新验证码: ${accountAfter.latest_code || '无'}`);
                console.log(`   验证码收件时间: ${accountAfter.latest_code_received_at || '无'}`);

            } catch (error) {
                console.log(`   ⚠️  无法检查数据库记录: ${error.message}`);
            }

        } catch (error) {
            console.error('❌ 测试失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const tester = new ManualMonitorTest();
    await tester.init();
    await tester.testManualMonitoring();
    await tester.close();
}

// 运行测试
if (require.main === module) {
    main().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}