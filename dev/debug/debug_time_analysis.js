/**
 * 邮箱时间分析调试脚本
 * 分析 "TerryYarberryyk@outlook.com" 的邮件收件时间和验证码更新时间
 */

const Database = require('./server/database');

class TimeAnalyzer {
    constructor() {
        this.db = new Database('./data/mailmanager.db');
    }

    async init() {
        await this.db.init();
    }

    async analyzeEmailTime(email) {
        console.log(`\n=== 分析邮箱: ${email} ===`);

        try {
            // 1. 查询账户基本信息
            const account = await this.db.getAccountByEmail(email);
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
            console.log(`   创建时间: ${account.created_at}`);
            console.log(`   更新时间: ${account.updated_at}`);

            // 2. 查询所有验证码记录（按时间倒序）
            const codes = await this.db.getCodes(account.id);
            console.log(`\n📨 验证码记录 (${codes.length} 条):`);

            if (codes.length === 0) {
                console.log('   无验证码记录');
            } else {
                codes.forEach((code, index) => {
                    const receivedTime = new Date(code.received_at);
                    const createdTime = new Date(code.created_at);
                    const timeDiff = createdTime.getTime() - receivedTime.getTime();

                    console.log(`\n   ${index + 1}. 验证码: ${code.code}`);
                    console.log(`      邮件收件时间: ${receivedTime.toISOString()}`);
                    console.log(`      验证码记录时间: ${createdTime.toISOString()}`);
                    console.log(`      时间差: ${timeDiff}ms (${(timeDiff/1000).toFixed(2)}秒)`);
                    console.log(`      发件人: ${code.sender || '未知'}`);
                    console.log(`      主题: ${code.subject || '无'}`);
                });
            }

            // 3. 如果有验证码，分析最新一条的时间差
            if (account.latest_code && account.latest_code_received_at) {
                const receivedTime = new Date(account.latest_code_received_at);
                const updatedTime = new Date(account.updated_at);
                const timeDiff = updatedTime.getTime() - receivedTime.getTime();

                console.log('\n⏰ 最新验证码时间分析:');
                console.log(`   邮件收件时间: ${receivedTime.toISOString()}`);
                console.log(`   账户更新时间: ${updatedTime.toISOString()}`);
                console.log(`   时间差: ${timeDiff}ms (${(timeDiff/1000).toFixed(2)}秒)`);

                // 分析时间差是否合理
                if (timeDiff < 0) {
                    console.log('   ⚠️  警告: 时间差为负数，可能存在时钟问题');
                } else if (timeDiff > 300000) { // 5分钟
                    console.log('   ⚠️  警告: 时间差超过5分钟，可能存在延迟');
                } else if (timeDiff > 60000) { // 1分钟
                    console.log('   ⚠️  注意: 时间差超过1分钟');
                } else {
                    console.log('   ✅ 时间差在正常范围内');
                }
            }

            // 4. 查询最近的API调用时间
            console.log('\n🔍 当前时间分析:');
            const now = new Date();
            console.log(`   当前时间: ${now.toISOString()}`);

            if (account.last_active_at) {
                const lastActive = new Date(account.last_active_at);
                const inactiveTime = now.getTime() - lastActive.getTime();
                console.log(`   最后活跃时间: ${lastActive.toISOString()}`);
                console.log(`   距今时间: ${inactiveTime}ms (${(inactiveTime/1000/60).toFixed(1)}分钟)`);
            }

        } catch (error) {
            console.error('❌ 分析失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const analyzer = new TimeAnalyzer();
    await analyzer.init();

    // 分析指定的邮箱
    await analyzer.analyzeEmailTime('TerryYarberryyk@outlook.com');

    await analyzer.close();
}

// 运行脚本
if (require.main === module) {
    main().catch(error => {
        console.error('程序执行失败:', error);
        process.exit(1);
    });
}

module.exports = TimeAnalyzer;