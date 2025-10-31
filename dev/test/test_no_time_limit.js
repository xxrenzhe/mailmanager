const EmailService = require('./server/emailService.js');
const Database = require('./server/database.js');

async function testNoTimeLimitExtraction() {
    console.log('=== 测试无时间限制的验证码提取 ===\n');

    const db = new Database();
    await db.init();

    const emailService = new EmailService();
    emailService.setDatabase(db);

    try {
        // 获取几个测试账户
        const accounts = await db.all('SELECT id, email FROM accounts WHERE status = "authorized" LIMIT 3');

        console.log(`📧 测试 ${accounts.length} 个账户...`);

        for (const account of accounts) {
            console.log(`\n--- ${account.email} ---`);

            try {
                // 获取access token
                const accessToken = await emailService.getAccessToken(
                    account.id,
                    account.refresh_token_enc,
                    account.client_id
                );

                if (!accessToken) {
                    console.log('❌ 无法获取access token');
                    continue;
                }

                // 使用修改后的API（无时间限制，获取最近5封邮件）
                const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
                const endpoint = `https://outlook.office.com/api/v2.0/me/messages?$orderby=ReceivedDateTime desc&$top=5`;

                console.log('🔗 请求无时间限制的API...');

                const response = await fetch(endpoint, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    }
                });

                if (!response.ok) {
                    throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                const messages = data.value || [];

                console.log(`📬 获取到 ${messages.length} 封邮件（无时间限制）`);

                if (messages.length > 0) {
                    console.log('📅 邮件时间范围:');
                    console.log(`   最新: ${messages[0].ReceivedDateTime}`);
                    console.log(`   最旧: ${messages[messages.length - 1].ReceivedDateTime}`);

                    // 计算时间跨度
                    const latest = new Date(messages[0].ReceivedDateTime);
                    const oldest = new Date(messages[messages.length - 1].ReceivedDateTime);
                    const timeSpan = Math.floor((latest - oldest) / (1000 * 60 * 60 * 24)); // 天数

                    console.log(`   时间跨度: ${timeSpan} 天`);

                    // 提取验证码
                    const extractedCodes = emailService.extractVerificationCodes(messages);
                    console.log(`✅ 提取到 ${extractedCodes.length} 个验证码:`);

                    extractedCodes.forEach((code, index) => {
                        console.log(`   ${index + 1}. ${code.code} (${code.received_at})`);
                    });

                    // 更新数据库
                    if (extractedCodes.length > 0) {
                        // 删除旧的验证码记录
                        await db.run('DELETE FROM codes WHERE account_id = ?', [account.id]);

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

                        console.log(`🔄 已更新数据库: 最新验证码 ${latestCode.code}`);
                    }

                } else {
                    console.log('📭 该账户没有邮件');
                }

            } catch (error) {
                console.error(`❌ 处理 ${account.email} 失败:`, error.message);
            }
        }

        // 显示更新后的统计
        console.log('\n📊 更新后统计:');
        const totalAccounts = await db.get('SELECT COUNT(*) as count FROM accounts WHERE status = "authorized"');
        const accountsWithCodes = await db.get('SELECT COUNT(DISTINCT account_id) as count FROM codes WHERE account_id IN (SELECT id FROM accounts WHERE status = "authorized")');
        const totalCodes = await db.get('SELECT COUNT(*) as count FROM codes');

        console.log(`已授权账户: ${totalAccounts.count}`);
        console.log(`有验证码的账户: ${accountsWithCodes.count}`);
        console.log(`验证码总数: ${totalCodes.count}`);

        console.log('\n✅ 修改效果:');
        console.log('1. 取消了"最近24小时"的时间限制');
        console.log('2. 只保留"获取最近5封邮件"的限制');
        console.log('3. 现在可以获取更长时间范围内的验证码');
        console.log('4. 仍然按时间排序，优先最新的验证码');

    } finally {
        await db.close();
    }
}

// 运行测试
testNoTimeLimitExtraction().catch(console.error);