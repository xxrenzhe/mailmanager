const EmailService = require('./server/emailService.js');
const Database = require('./server/database.js');

async function updateVerificationCodes() {
    console.log('=== 更新已有邮箱的验证码信息 ===\n');

    const db = new Database();
    await db.init();

    const emailService = new EmailService();
    emailService.setDatabase(db);

    try {
        // 获取所有已授权的账户
        const accounts = await db.getAccounts();
        const authorizedAccounts = accounts.filter(account => account.status === 'authorized');

        console.log(`📧 找到 ${authorizedAccounts.length} 个已授权账户`);

        let totalUpdated = 0;
        let totalErrors = 0;

        for (const account of authorizedAccounts) {
            console.log(`\n--- 处理账户: ${account.email} (ID: ${account.id}) ---`);

            try {
                // 重新获取最近24小时的邮件并提取验证码
                console.log('📬 获取最新邮件...');
                const extractedCodes = await emailService.extractRecentCodes(account);

                if (extractedCodes.length > 0) {
                    console.log(`✅ 提取到 ${extractedCodes.length} 个验证码:`);

                    // 删除该账户的旧验证码记录
                    await db.run('DELETE FROM codes WHERE account_id = ?', [account.id]);
                    console.log('🗑️ 已删除旧的验证码记录');

                    // 插入新的验证码记录
                    for (const codeData of extractedCodes) {
                        await db.createCode({
                            account_id: account.id,
                            code: codeData.code,
                            subject: codeData.subject,
                            sender: codeData.sender,
                            received_at: codeData.received_at,
                            created_at: new Date().toISOString()
                        });
                    }

                    // 更新账户的最后活跃时间
                    const latestCode = extractedCodes[0];
                    await db.updateAccount(account.id, {
                        last_active_at: latestCode.received_at,
                        updated_at: new Date().toISOString()
                    });

                    console.log(`🔄 最新验证码: ${latestCode.code}`);
                    console.log(`📅 收件时间: ${latestCode.received_at}`);
                    totalUpdated++;

                } else {
                    console.log('📭 未找到验证码');

                    // 清空该账户的验证码记录
                    await db.run('DELETE FROM codes WHERE account_id = ?', [account.id]);
                    console.log('🗑️ 已清空验证码记录');
                }

            } catch (error) {
                console.error(`❌ 处理账户 ${account.email} 失败:`, error.message);
                totalErrors++;
            }
        }

        console.log(`\n📊 更新完成统计:`);
        console.log(`✅ 成功更新: ${totalUpdated} 个账户`);
        console.log(`❌ 处理失败: ${totalErrors} 个账户`);

        // 显示更新后的统计信息
        console.log(`\n📈 更新后的验证码统计:`);

        // 手动查询统计信息
        const totalAccountsResult = await db.get('SELECT COUNT(*) as count FROM accounts WHERE status = "authorized"');
        const totalAccounts = totalAccountsResult.count;

        const accountsWithCodesResult = await db.get(`
            SELECT COUNT(DISTINCT account_id) as count
            FROM codes
            WHERE account_id IN (SELECT id FROM accounts WHERE status = "authorized")
        `);
        const accountsWithCodes = accountsWithCodesResult.count;

        const totalCodesResult = await db.get('SELECT COUNT(*) as count FROM codes');
        const totalCodes = totalCodesResult.count;

        console.log(`已授权账户数: ${totalAccounts}`);
        console.log(`有验证码的账户: ${accountsWithCodes}`);
        console.log(`总验证码数: ${totalCodes}`);

    } finally {
        await db.close();
    }
}

// 运行更新脚本
updateVerificationCodes().catch(console.error);