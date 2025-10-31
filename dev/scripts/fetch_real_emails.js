const EmailService = require('./server/emailService.js');
const Database = require('./server/database.js');

async function fetchRealEmailsWithContent() {
    console.log('=== 获取真实邮箱的最近5封邮件 ===\n');

    const db = new Database();
    await db.init();

    const emailService = new EmailService();
    emailService.setDatabase(db);

    try {
        // 获取这两个账户的信息
        const account1 = await db.getAccount(1); // JoseGunteruk
        const account4 = await db.getAccount(4); // NormanBarrerasij

        console.log('📧 账户信息:');
        console.log(`1. ${account1?.email}`);
        console.log(`2. ${account4?.email}`);

        for (const account of [account1, account4]) {
            if (!account) {
                console.log('❌ 账户信息缺失');
                continue;
            }

            console.log(`\n--- ${account.email} 的最近5封邮件 ---`);

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

                // 使用Outlook REST API获取最近5封邮件
                const sinceTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 最近7天
                const endpoint = `https://outlook.office.com/api/v2.0/me/messages?$filter=ReceivedDateTime ge ${sinceTime}&$orderby=ReceivedDateTime desc&$top=5`;

                console.log(`🔗 请求: ${endpoint}`);

                const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

                const response = await fetch(endpoint, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    }
                });

                if (!response.ok) {
                    throw new Error(`Outlook API调用失败: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                const messages = data.value || [];

                console.log(`📬 获取到 ${messages.length} 封邮件\n`);

                messages.forEach((email, index) => {
                    console.log(`=== 邮件 ${index + 1} ===`);
                    console.log(`主题: ${email.Subject || '无标题'}`);
                    console.log(`发件人: ${email.From?.EmailAddress?.Name || '未知'} (${email.From?.EmailAddress?.Address || ''})`);
                    console.log(`时间: ${email.ReceivedDateTime}`);
                    console.log(`邮件ID: ${email.Id}`);

                    const bodyContent = email.Body?.Content || '';
                    console.log(`正文长度: ${bodyContent.length} 字符`);

                    // 显示正文前200字符
                    if (bodyContent) {
                        const cleanBody = bodyContent.replace(/<[^>]*>/g, '').trim();
                        console.log(`正文预览: ${cleanBody.substring(0, 200)}${cleanBody.length > 200 ? '...' : ''}`);
                    }

                    // 提取所有数字
                    if (bodyContent) {
                        const content = `${email.Subject} ${bodyContent}`;
                        const numbers = content.match(/\b\d{4,8}\b/g);
                        if (numbers) {
                            console.log(`所有4-8位数字: ${numbers.join(', ')}`);
                        } else {
                            console.log('未找到4-8位数字');
                        }
                    }

                    console.log('---\n');
                });

                // 使用改进算法重新提取验证码
                console.log('🔍 使用改进算法提取验证码:');
                const extractedCodes = emailService.extractVerificationCodes(messages);

                if (extractedCodes.length > 0) {
                    extractedCodes.forEach((code, index) => {
                        console.log(`${index + 1}. 验证码: ${code.code}, 主题: ${code.subject}, 时间: ${code.received_at}`);
                    });
                } else {
                    console.log('未提取到验证码');
                }

            } catch (error) {
                console.error(`获取 ${account.email} 邮件失败:`, error.message);
            }
        }

    } finally {
        await db.close();
    }
}

// 运行脚本
fetchRealEmailsWithContent().catch(console.error);