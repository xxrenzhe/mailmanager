/**
 * 测试重复邮件处理防护功能
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class DuplicatePreventionTest {
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

    async testDuplicateProcessing() {
        console.log('\n=== 测试重复邮件处理防护 ===');

        try {
            const testEmail = 'TerryYarberryyk@outlook.com';
            const account = await this.db.getAccountByEmail(testEmail);

            if (!account || !account.refresh_token_enc || !account.client_id) {
                console.log('   ⚠️  无法找到测试账户或缺少认证信息');
                return;
            }

            console.log(`   测试账户: ${account.email} (ID: ${account.id})`);

            // 第一次处理邮件
            console.log('\n--- 第一次处理邮件 ---');
            const startTime1 = Date.now();
            const codes1 = await this.emailService.checkEmails(
                account.id,
                account.refresh_token_enc,
                account.client_id,
                1
            );
            const time1 = Date.now() - startTime1;
            console.log(`   第一次处理耗时: ${time1}ms，找到 ${codes1.length} 个验证码`);

            // 获取第一次处理后的统计
            const stats1 = await this.db.getEmailProcessingStats(account.id, 1);
            console.log(`   第一次处理后统计: 已处理 ${stats1.total_processed} 封邮件`);

            // 等待一秒再进行第二次处理
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 第二次处理邮件（应该跳过已处理的邮件）
            console.log('\n--- 第二次处理邮件（测试去重） ---');
            const startTime2 = Date.now();
            const codes2 = await this.emailService.checkEmails(
                account.id,
                account.refresh_token_enc,
                account.client_id,
                1
            );
            const time2 = Date.now() - startTime2;
            console.log(`   第二次处理耗时: ${time2}ms，找到 ${codes2.length} 个验证码`);

            // 获取第二次处理后的统计
            const stats2 = await this.db.getEmailProcessingStats(account.id, 1);
            console.log(`   第二次处理后统计: 已处理 ${stats2.total_processed} 封邮件`);

            // 分析结果
            console.log('\n--- 去重效果分析 ---');
            console.log(`   第一次处理: ${time1}ms, ${codes1.length} 个验证码`);
            console.log(`   第二次处理: ${time2}ms, ${codes2.length} 个验证码`);
            console.log(`   处理时间变化: ${time1 - time2}ms (${time1 > time2 ? '变快' : '变慢'})`);
            console.log(`   总处理邮件数: ${stats2.total_processed} (应该没有显著增加)`);

            // 检查处理历史
            const history = await this.db.getRecentEmailProcessingHistory(account.id, 10);
            console.log(`   最近处理历史记录数: ${history.length}`);

            // 验证去重是否生效
            const timeImprovement = time1 - time2;
            if (timeImprovement > 100) { // 如果第二次处理快了至少100ms
                console.log('   ✅ 去重机制生效：第二次处理明显更快');
            } else {
                console.log('   ⚠️  去重效果不明显，可能没有重复邮件或API调用时间占主导');
            }

            if (stats2.total_processed <= stats1.total_processed + 2) { // 允许少量新增邮件
                console.log('   ✅ 邮件去重生效：没有重复处理相同邮件');
            } else {
                console.log('   ⚠️  可能存在重复处理，需要进一步检查');
            }

            console.log('\n🎯 去重测试完成');

        } catch (error) {
            console.error('❌ 去重测试失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const tester = new DuplicatePreventionTest();
    await tester.init();
    await tester.testDuplicateProcessing();
    await tester.close();
}

// 运行测试
if (require.main === module) {
    main().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}