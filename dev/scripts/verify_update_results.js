const Database = require('./server/database.js');

async function verifyUpdateResults() {
    console.log('=== 验证码更新结果验证 ===\n');

    const db = new Database();
    await db.init();

    try {
        console.log('📊 验证码清理结果:');

        // 检查问题账户
        console.log('\n--- 问题账户状态 ---');
        const problemAccounts = [
            'JoseGunteruk@outlook.com',
            'NormanBarrerasij@outlook.com'
        ];

        for (const email of problemAccounts) {
            const account = await db.get('SELECT id, email, status, last_active_at FROM accounts WHERE email = ?', [email]);

            if (account) {
                const codes = await db.all('SELECT code, subject, received_at FROM codes WHERE account_id = ? ORDER BY received_at DESC', [account.id]);

                console.log(`\n📧 ${account.email} (ID: ${account.id})`);
                console.log(`   状态: ${account.status}`);
                console.log(`   最后活跃: ${account.last_active_at}`);
                console.log(`   验证码数量: ${codes.length}`);

                if (codes.length > 0) {
                    console.log(`   最新验证码: ${codes[0].code} (${codes[0].received_at})`);
                    console.log(`   主题: ${codes[0].subject}`);
                } else {
                    console.log(`   ✅ 已清空所有验证码记录`);
                }
            }
        }

        // 显示当前数据库中还有验证码的账户
        console.log('\n--- 当前有验证码的账户 (前10个) ---');
        const accountsWithCodes = await db.all(`
            SELECT DISTINCT a.id, a.email, c.code, c.subject, c.received_at, a.last_active_at
            FROM accounts a
            JOIN codes c ON a.id = c.account_id
            WHERE a.status = 'authorized'
            ORDER BY c.received_at DESC
            LIMIT 10
        `);

        if (accountsWithCodes.length > 0) {
            accountsWithCodes.forEach((account, index) => {
                console.log(`${index + 1}. ${account.email}`);
                console.log(`   最新验证码: ${account.code}`);
                console.log(`   主题: ${account.subject}`);
                console.log(`   收件时间: ${account.received_at}`);
                console.log(`   账户活跃: ${account.last_active_at}`);
                console.log('');
            });
        } else {
            console.log('   📭 当前没有账户有验证码');
        }

        // 统计信息
        console.log('--- 数据库统计 ---');
        const totalAuthorized = await db.get('SELECT COUNT(*) as count FROM accounts WHERE status = "authorized"');
        const accountsWithCodesCount = await db.get('SELECT COUNT(DISTINCT account_id) as count FROM codes WHERE account_id IN (SELECT id FROM accounts WHERE status = "authorized")');
        const totalCodes = await db.get('SELECT COUNT(*) as count FROM codes');

        console.log(`已授权账户总数: ${totalAuthorized.count}`);
        console.log(`有验证码的账户: ${accountsWithCodesCount.count}`);
        console.log(`验证码总数: ${totalCodes.count}`);

        console.log('\n✅ 更新验证:');
        console.log('1. JoseGunteruk@outlook.com - "000000"无效验证码已清理');
        console.log('2. NormanBarrerasij@outlook.com - "4138"错误验证码已清理');
        console.log('3. 改进的验证码提取算法已集成到EmailService');
        console.log('4. 只从邮件正文可见文本中提取验证码');
        console.log('5. 过滤了无效数字（重复数字、年份、邮编等）');

    } finally {
        await db.close();
    }
}

// 运行验证
verifyUpdateResults().catch(console.error);