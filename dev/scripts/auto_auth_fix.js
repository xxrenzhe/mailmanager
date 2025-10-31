/**
 * 自动修复授权问题的KISS方案
 * 检测并标记需要重新授权的账户
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class AutoAuthFix {
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

    async scanAndFixAuthIssues() {
        console.log('\n=== 自动扫描和修复授权问题 ===');

        try {
            // 1. 获取所有已授权的账户
            const accounts = await this.db.getAccounts();
            const authorizedAccounts = accounts.filter(acc => acc.status === 'authorized');

            console.log(`找到 ${authorizedAccounts.length} 个已授权账户，开始检查...`);

            let needsReauth = [];
            let serviceUnavailable = 0;
            let working = 0;

            // 2. 逐个检查授权状态
            for (let i = 0; i < authorizedAccounts.length; i++) {
                const account = authorizedAccounts[i];
                console.log(`\n[${i+1}/${authorizedAccounts.length}] 检查账户: ${account.email}`);

                try {
                    const authResult = await this.emailService.validateAuthorization(account);

                    if (authResult.authorized) {
                        console.log('   ✅ 授权正常');
                        working++;
                    } else if (authResult.needsReauth) {
                        console.log(`   ❌ 需要重新授权: ${authResult.error}`);
                        needsReauth.push(account);

                        // 3. 自动标记账户状态为需要重新授权
                        await this.db.updateAccount(account.id, {
                            status: 'reauth_needed',
                            updated_at: new Date().toISOString()
                        });
                        console.log('   📝 已标记为需要重新授权');

                    } else {
                        console.log(`   ⚠️  服务问题: ${authResult.error}`);
                        serviceUnavailable++;
                    }

                    // 避免API频率限制
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (error) {
                    console.log(`   ❌ 检查失败: ${error.message}`);
                    needsReauth.push(account);

                    await this.db.updateAccount(account.id, {
                        status: 'reauth_needed',
                        updated_at: new Date().toISOString()
                    });
                }
            }

            // 4. 生成报告
            console.log('\n=== 扫描结果 ===');
            console.log(`✅ 授权正常: ${working} 个账户`);
            console.log(`❌ 需要重新授权: ${needsReauth.length} 个账户`);
            console.log(`⚠️  服务问题: ${serviceUnavailable} 个账户`);

            if (needsReauth.length > 0) {
                console.log('\n❌ 需要重新授权的账户:');
                needsReauth.forEach((account, index) => {
                    console.log(`   ${index + 1}. ${account.email} (ID: ${account.id})`);
                });

                console.log('\n💡 自动化建议:');
                console.log('1. 这些账户已被标记为 "reauth_needed" 状态');
                console.log('2. 在Web界面中，这些账户会显示为需要重新授权');
                console.log('3. 用户可以批量处理这些账户的重新授权');
                console.log('4. 系统会自动跳过这些账户的监控，避免错误');

                // 5. 可选：自动删除无效token（清理操作）
                console.log('\n🧹 清理无效token...');
                for (const account of needsReauth) {
                    try {
                        await this.db.updateAccessToken(account.id, null, 0);
                        console.log(`   已清理账户 ${account.email} 的无效token`);
                    } catch (error) {
                        console.log(`   清理失败: ${error.message}`);
                    }
                }
            }

            return {
                total: authorizedAccounts.length,
                working,
                needsReauth: needsReauth.length,
                serviceUnavailable,
                reauthList: needsReauth
            };

        } catch (error) {
            console.error('❌ 扫描失败:', error);
            return null;
        }
    }

    async createReauthGuide() {
        console.log('\n=== 创建重新授权指南 ===');

        const guide = `
# 📧 邮件账户重新授权指南

## 🔍 问题说明
系统检测到 ${this.needsReauthCount || 0} 个账户的授权已过期，需要重新授权。

## 💡 解决方案

### 方法1：批量重新授权（推荐）
1. 访问邮件管理系统: http://localhost:3000
2. 查找状态为 "需要重新授权" 的账户
3. 点击 "重新授权" 按钮
4. 完成Microsoft OAuth流程

### 方法2：删除后重新添加
1. 在账户列表中找到问题账户
2. 点击删除按钮
3. 重新添加该邮箱地址
4. 完成授权流程

## ⚡ 自动化功能
- 系统会自动检测授权问题
- 无效账户会被标记为 "reauth_needed" 状态
- 监控系统会自动跳过无效账户
- 清理无效token避免重复错误

## 🛡️ 预防措施
- 系统现在会进行真实的API测试
- 授权状态更加准确
- 错误检测更加及时

---
生成时间: ${new Date().toLocaleString('zh-CN')}
        `;

        require('fs').writeFileSync('REAUTH_GUIDE.md', guide);
        console.log('✅ 重新授权指南已保存到 REAUTH_GUIDE.md');
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const fixer = new AutoAuthFix();
    await fixer.init();

    const result = await fixer.scanAndFixAuthIssues();

    if (result) {
        fixer.needsReauthCount = result.needsReauth;
        await fixer.createReauthGuide();
    }

    await fixer.close();
    console.log('\n🎉 自动修复扫描完成');
}

// 运行自动修复
if (require.main === module) {
    main().catch(error => {
        console.error('自动修复执行失败:', error);
        process.exit(1);
    });
}