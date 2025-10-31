/**
 * 调试账户信息脚本
 */

const SimpleDB = require('./server/database');

async function debugAccounts() {
    const db = new SimpleDB('./data/mailmanager.db');
    await db.init();

    try {
        console.log('=== 调试账户信息 ===');

        // 获取所有账户
        const allAccounts = await db.getAccounts({ pageSize: 10 });
        console.log(`总账户数: ${allAccounts.length}`);

        console.log('\n前10个账户详情:');
        allAccounts.forEach((account, index) => {
            console.log(`${index + 1}. ID: ${account.id}`);
            console.log(`   Email: ${account.email}`);
            console.log(`   Client ID: ${account.client_id ? '有' : '无'}`);
            console.log(`   Refresh Token: ${account.refresh_token_enc ? `有(${account.refresh_token_enc.length}字符)` : '无'}`);
            console.log(`   Status: ${account.status}`);
            console.log(`   Latest Code: ${account.latest_code || '无'}`);
            console.log(`   Last Active: ${account.last_active_at || '无'}`);
            console.log('');
        });

        // 找出有认证信息的账户
        const authorizedAccounts = allAccounts.filter(account =>
            account.refresh_token_enc && account.client_id
        );
        console.log(`有完整认证信息的账户: ${authorizedAccounts.length}`);

        if (authorizedAccounts.length > 0) {
            console.log('\n有认证信息的账户:');
            authorizedAccounts.forEach(account => {
                console.log(`- ${account.email} (ID: ${account.id})`);
            });
        }

        // 查看有验证码的账户
        const accountsWithCodes = allAccounts.filter(account => account.latest_code);
        console.log(`\n有验证码的账户: ${accountsWithCodes.length}`);

        if (accountsWithCodes.length > 0) {
            console.log('\n有验证码的账户详情:');
            accountsWithCodes.forEach(account => {
                console.log(`- ${account.email}: ${account.latest_code} (${account.latest_code_received_at})`);
            });
        }

    } catch (error) {
        console.error('调试失败:', error);
    } finally {
        await db.close();
    }
}

debugAccounts();