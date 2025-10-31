/**
 * 测试新的邮件处理去重功能
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class DeduplicationTest {
    constructor() {
        this.db = new Database('./data/mailmanager.db');
        this.emailService = new EmailService();
        this.emailService.setDatabase(this.db);
    }

    async init() {
        // Skip full initialization since tables already exist
        try {
            await this.db.init();
        } catch (error) {
            console.log('Database initialization had issues, but continuing with existing tables...');
            // Just establish connection
            this.db.db = new (require('sqlite3').Database)('./data/mailmanager.db');
        }
    }

    async testEmailProcessingHistory() {
        console.log('\n=== 测试邮件处理历史功能 ===');

        try {
            // 测试数据
            const testAccountId = 1024; // TerryYarberryyk@outlook.com
            const testMessageId = 'test_message_' + Date.now();

            // 1. 检查邮件是否已处理
            console.log('\n1. 检查新邮件的处理状态...');
            const isProcessed = await this.db.isEmailProcessed(testAccountId, testMessageId);
            console.log(`   新邮件处理状态: ${isProcessed ? '已处理' : '未处理'}`);

            // 2. 记录邮件处理历史
            console.log('\n2. 记录邮件处理历史...');
            await this.db.createEmailProcessingHistory({
                account_id: testAccountId,
                message_id: testMessageId,
                processed_at: new Date().toISOString(),
                processing_time_ms: 150,
                codes_found: 1,
                status: 'success'
            });
            console.log('   处理历史记录成功');

            // 3. 再次检查处理状态
            console.log('\n3. 再次检查邮件处理状态...');
            const isProcessedAfter = await this.db.isEmailProcessed(testAccountId, testMessageId);
            console.log(`   处理后状态: ${isProcessedAfter ? '已处理' : '未处理'}`);

            // 4. 获取处理统计
            console.log('\n4. 获取最近处理统计...');
            const stats = await this.db.getEmailProcessingStats(testAccountId, 24);
            console.log(`   最近24小时处理统计:`, stats);

            // 5. 获取最近处理历史
            console.log('\n5. 获取最近处理历史...');
            const history = await this.db.getRecentEmailProcessingHistory(testAccountId, 5);
            console.log(`   最近5条处理历史:`);
            history.forEach((record, index) => {
                console.log(`     ${index + 1}. ${record.processed_at} - ${record.message_id} - ${record.status} (${record.processing_time_ms}ms)`);
            });

            console.log('\n✅ 邮件处理历史功能测试完成');

        } catch (error) {
            console.error('❌ 测试失败:', error);
        }
    }

    async testPerformanceMonitoring() {
        console.log('\n=== 测试性能监控功能 ===');

        try {
            const testAccountId = 1024;

            // 模拟性能数据
            const performanceData = {
                account_id: testAccountId,
                message_id: 'perf_test_' + Date.now(),
                processed_at: new Date().toISOString(),
                processing_time_ms: 3200, // 3.2秒 - 应该触发警告
                codes_found: 0,
                status: 'success'
            };

            // 记录性能数据
            await this.db.createEmailProcessingHistory(performanceData);
            console.log('   性能测试数据记录成功');

            // 检查统计信息
            const stats = await this.db.getEmailProcessingStats(testAccountId, 1);
            console.log(`   最近1小时统计:`, stats);

            if (stats.avg_processing_time > 5000) {
                console.log('   ⚠️  检测到处理时间超过5秒');
            } else {
                console.log('   ✅ 处理时间在正常范围内');
            }

            console.log('\n✅ 性能监控功能测试完成');

        } catch (error) {
            console.error('❌ 性能测试失败:', error);
        }
    }

    async testRealAccountProcessing() {
        console.log('\n=== 测试真实账户处理（如果可能）===');

        try {
            // 获取测试账户信息
            const testEmail = 'TerryYarberryyk@outlook.com';
            const account = await this.db.getAccountByEmail(testEmail);

            if (!account) {
                console.log(`   ⚠️  未找到测试账户: ${testEmail}`);
                return;
            }

            console.log(`   找到测试账户: ${account.email} (ID: ${account.id})`);

            // 检查是否有有效的认证信息
            if (!account.refresh_token_enc || !account.client_id) {
                console.log('   ⚠️  账户缺���认证信息，无法进行真实邮件处理测试');
                return;
            }

            console.log('   开始真实邮件处理测试...');

            // 使用新的去重功能处理邮件
            const startTime = Date.now();
            const codes = await this.emailService.checkEmails(
                account.id,
                account.refresh_token_enc,
                account.client_id,
                1
            );
            const totalTime = Date.now() - startTime;

            console.log(`   处理完成，耗时: ${totalTime}ms`);
            console.log(`   提取到 ${codes.length} 个验证码`);

            if (codes.length > 0) {
                console.log('   最新验证码信息:');
                console.log(`     验证码: ${codes[0].code}`);
                console.log(`     发件人: ${codes[0].sender}`);
                console.log(`     收件时间: ${codes[0].received_at}`);
            }

            console.log('   ✅ 真实账户处理测试完成');

        } catch (error) {
            console.error('   ❌ 真实账户测试失败:', error.message);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const tester = new DeduplicationTest();
    await tester.init();

    await tester.testEmailProcessingHistory();
    await tester.testPerformanceMonitoring();
    await tester.testRealAccountProcessing();

    await tester.close();
    console.log('\n🎉 所有测试完成');
}

// 运行测试
if (require.main === module) {
    main().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}

module.exports = DeduplicationTest;