/**
 * 修复真实认证信息脚本
 * 恢复被模拟认证覆盖的真实Outlook认证信息
 */

const Database = require('./server/database');
const EmailService = require('./server/emailService');

class RealAuthFixer {
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

    async fixSimulatedAuths() {
        console.log('\n=== 修复模拟认证问题 ===');

        try {
            // 1. 找出所有使用模拟认证的账户
            const simulatedAccounts = await this.db.all(`
                SELECT id, email, refresh_token_enc, client_id, status
                FROM accounts
                WHERE refresh_token_enc LIKE 'simulated_%'
            `);

            console.log(`找到 ${simulatedAccounts.length} 个使用模拟认证的账户`);

            if (simulatedAccounts.length === 0) {
                console.log('✅ 没有需要修复的账户');
                return;
            }

            // 2. 显示需要修复的账户
            console.log('\n需要修复的账户:');
            simulatedAccounts.forEach((account, index) => {
                console.log(`   ${index + 1}. ${account.email} (ID: ${account.id})`);
                console.log(`      当前token: ${account.refresh_token_enc.substring(0, 30)}...`);
            });

            // 3. 尝试多种方法恢复真实认证
            for (const account of simulatedAccounts) {
                await this.attemptRealAuthRecovery(account);
            }

            // 4. 验证修复结果
            console.log('\n🔍 验证修复结果...');
            const remainingSimulated = await this.db.all(`
                SELECT COUNT(*) as count FROM accounts
                WHERE refresh_token_enc LIKE 'simulated_%'
            `);

            console.log(`修复后剩余模拟认证账户: ${remainingSimulated[0].count} 个`);

            if (remainingSimulated[0].count === 0) {
                console.log('✅ 所有模拟认证已修复为真实认证');
            } else {
                console.log('⚠️  部分账户未能恢复真实认证');
            }

        } catch (error) {
            console.error('❌ 修复过程失败:', error);
        }
    }

    async attemptRealAuthRecovery(account) {
        console.log(`\n🔧 修复账户: ${account.email}`);

        try {
            // 方法1: 检查是否有其他相同域名的真实token可以参考
            const domain = account.email.split('@')[1];
            const realTokenSample = await this.db.all(`
                SELECT refresh_token_enc, client_id
                FROM accounts
                WHERE email LIKE '%@${domain}'
                AND refresh_token_enc NOT LIKE 'simulated_%'
                AND refresh_token_enc LIKE 'M.C%'
                LIMIT 1
            `);

            if (realTokenSample.length > 0) {
                console.log(`   找到同域名真实token样本，尝试恢复...`);

                // 注意：这里我们不能直接使用其他账户的token，因为每个token都是唯一的
                // 但我们可以参考token的结构来判断是否需要重新授权
                console.log(`   参考token结构: ${realTokenSample[0].refresh_token_enc.substring(0, 50)}...`);
                console.log(`   需要重新获取真实授权`);

                // 标记为需要重新授权，而不是使用模拟token
                await this.db.updateAccount(account.id, {
                    refresh_token_enc: null,
                    client_id: null,
                    status: 'reauth_needed',
                    updated_at: new Date().toISOString()
                });

                console.log(`   ✅ 已标记为需要重新授权`);
                return;
            }

            // 方法2: 检查备份文件中是否有原始认证信息
            const backupData = await this.checkBackupFiles(account.email);
            if (backupData) {
                console.log(`   从备份中恢复认证信息...`);
                await this.db.updateAccount(account.id, {
                    refresh_token_enc: backupData.refresh_token,
                    client_id: backupData.client_id,
                    status: 'authorized',
                    updated_at: new Date().toISOString()
                });
                console.log(`   ✅ 从备份恢复成功`);
                return;
            }

            // 方法3: 清除模拟认证，标记为需要真实重新授权
            console.log(`   清除模拟认证，标记为需要真实重新授权`);
            await this.db.updateAccount(account.id, {
                refresh_token_enc: null,
                client_id: null,
                status: 'reauth_needed',
                updated_at: new Date().toISOString()
            });

            console.log(`   ✅ 已清除模拟认证，需要用户重新授权`);

        } catch (error) {
            console.error(`   ❌ 修复失败: ${error.message}`);
        }
    }

    async checkBackupFiles(email) {
        try {
            // 检查store.json备份文件
            const fs = require('fs');

            if (fs.existsSync('./data/store.json.backup')) {
                const backupData = JSON.parse(fs.readFileSync('./data/store.json.backup', 'utf8'));
                if (backupData[email] && backupData[email].refreshToken) {
                    return {
                        refresh_token: backupData[email].refreshToken,
                        client_id: backupData[email].clientId
                    };
                }
            }

            if (fs.existsSync('./data/store.json.bak')) {
                const backupData = JSON.parse(fs.readFileSync('./data/store.json.bak', 'utf8'));
                if (backupData[email] && backupData[email].refreshToken) {
                    return {
                        refresh_token: backupData[email].refreshToken,
                        client_id: backupData[email].clientId
                    };
                }
            }

            return null;
        } catch (error) {
            console.log(`   备份文件检查失败: ${error.message}`);
            return null;
        }
    }

    async validateRealAuths() {
        console.log('\n=== 验证真实认证有效性 ===');

        try {
            const realAuthAccounts = await this.db.all(`
                SELECT id, email, refresh_token_enc, client_id
                FROM accounts
                WHERE refresh_token_enc NOT LIKE 'simulated_%'
                AND refresh_token_enc IS NOT NULL
                LIMIT 5
            `);

            console.log(`测试 ${realAuthAccounts.length} 个真实认证的有效性...`);

            for (const account of realAuthAccounts) {
                try {
                    const validation = await this.emailService.validateAuthorization(account);
                    console.log(`   ${account.email}: ${validation.authorized ? '✅ 有效' : '❌ 无效'}`);
                } catch (error) {
                    console.log(`   ${account.email}: ❌ 验证失败 - ${error.message}`);
                }
            }

        } catch (error) {
            console.error('验证过程失败:', error);
        }
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const fixer = new RealAuthFixer();
    await fixer.init();

    await fixer.fixSimulatedAuths();
    await fixer.validateRealAuths();

    await fixer.close();
    console.log('\n🎉 真实认证修复完成');
}

// 运行修复
if (require.main === module) {
    main().catch(error => {
        console.error('修复执行失败:', error);
        process.exit(1);
    });
}