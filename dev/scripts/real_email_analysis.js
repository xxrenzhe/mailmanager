const EmailService = require('./server/emailService.js');
const Database = require('./server/database.js');

async function analyzeRealEmails() {
    console.log('=== 分析真实邮件验证码提取问题 ===\n');

    const db = new Database();
    await db.init();

    const emailService = new EmailService();
    emailService.setDatabase(db);

    try {
        // 获取这两个账户的完整信息
        const account1 = await db.getAccount(1); // JoseGunteruk
        const account4 = await db.getAccount(4); // NormanBarrerasij

        console.log('📧 账户信息:');
        console.log('1. JoseGunteruk (ID: 1):', account1?.email);
        console.log('2. NormanBarrerasij (ID: 4):', account4?.email);

        if (!account1 || !account4) {
            console.log('❌ 账户信息不完整');
            return;
        }

        console.log('\n🔍 重新获取最新邮件进行分析...');

        // 为每个账户重新获取邮件
        for (const account of [account1, account4]) {
            console.log(`\n--- 分析 ${account.email} ---`);

            try {
                // 获取最近24小时的邮件
                const emails = await emailService.checkOutlookEmails(
                    await emailService.getAccessToken(account.id, account.refresh_token_enc, account.client_id),
                    24
                );

                console.log(`获取到 ${emails.length} 封原始邮件`);

                if (emails.length > 0) {
                    emails.forEach((email, index) => {
                        console.log(`\n邮件 ${index + 1}:`);
                        console.log(`主题: ${email.Subject}`);
                        console.log(`发件人: ${email.From?.EmailAddress?.Name || '未知'}`);
                        console.log(`时间: ${email.ReceivedDateTime}`);

                        // 获取邮件正文内容
                        const bodyContent = email.Body?.Content || '';
                        const content = `${email.Subject} ${bodyContent}`;

                        console.log('\n邮件内容（前500字符）:');
                        console.log(bodyContent.substring(0, 500));

                        // 分析所有数字
                        const numbers = content.match(/\b\d{4,8}\b/g);
                        if (numbers) {
                            console.log(`\n所有4-8位数字: ${numbers.join(', ')}`);
                        }

                        // 使用当前算法提取验证码
                        const currentResults = emailService.extractVerificationCodes([email]);
                        console.log('\n当前算法提取结果:');
                        currentResults.forEach(result => {
                            console.log(`- 验证码: ${result.code}`);
                        });
                    });

                    // 使用改进算法重新分析
                    console.log('\n使用改进算法重新分析:');
                    const improvedResults = emailService.extractVerificationCodes(emails);
                    console.log('改进算法结果:', improvedResults);
                } else {
                    console.log('未获取到邮件');
                }

            } catch (error) {
                console.error(`获取 ${account.email} 邮件失败:`, error.message);
            }
        }

    } finally {
        await db.close();
    }
}

// 运行分析
analyzeRealEmails().catch(console.error);