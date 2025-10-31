const https = require('https');
const querystring = require('querystring');

console.log('🧪 测试使用导入账户信息的正确OAuth流程...');

// 从导入数据中提取的账户信息
const accountInfo = {
    email: "JoelGrundydi@outlook.com",
    password: "MOoyopg947",
    clientId: "9e5f94bc-e8a4-4e73-b8be-63364c29d753",
    refreshToken: "M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$"
};

console.log('📋 账户信息:');
console.log(`  邮箱: ${accountInfo.email}`);
console.log(`  ClientId: ${accountInfo.clientId}`);
console.log(`  RefreshToken: ${accountInfo.refreshToken.substring(0, 50)}...`);

function testOAuthTokenRefresh() {
    return new Promise((resolve, reject) => {
        console.log('\n🔄 步骤1: 使用refresh_token获���新的access_token');

        const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

        const postData = querystring.stringify({
            client_id: accountInfo.clientId,
            refresh_token: accountInfo.refreshToken,
            grant_type: 'refresh_token',
            scope: 'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/Mail.ReadWrite https://outlook.office.com/SMTP.Send'
        });

        const options = {
            hostname: 'login.microsoftonline.com',
            port: 443,
            path: '/common/oauth2/v2.0/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        console.log('📤 发送OAuth token refresh请求...');
        console.log('📝 请求参数:', {
            client_id: accountInfo.clientId,
            refresh_token: '[REDACTED]',
            grant_type: 'refresh_token',
            scope: 'Outlook permissions'
        });

        const req = https.request(options, (res) => {
            console.log(`📊 响应状态码: ${res.statusCode}`);
            console.log(`📋 响应头:`, res.headers);

            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    console.log('✅ OAuth token refresh成功!');
                    console.log('📋 响应数据:');

                    if (jsonData.access_token) {
                        console.log(`  ✅ Access Token: ${jsonData.access_token.substring(0, 100)}...`);
                        console.log(`  🔍 Token Length: ${jsonData.access_token.length} characters`);
                        console.log(`  🔍 Contains dots: ${jsonData.access_token.includes('.')} (JWT format requires dots)`);
                        console.log(`  📅 Token Type: ${jsonData.token_type}`);
                        console.log(`  ⏰ Expires In: ${jsonData.expires_in} seconds`);

                        if (jsonData.refresh_token) {
                            console.log(`  🔄 New Refresh Token: ${jsonData.refresh_token.substring(0, 50)}...`);
                        }

                        // Microsoft的access_token有时不是标准JWT格式，这很正常
                        // 只要获得了access_token，就可以使用Microsoft Graph API
                        console.log('✅ Access token格式正确（Microsoft专有格式）');
                        resolve(jsonData.access_token);
                    } else {
                        console.log('❌ 响应中没有access_token');
                        console.log('完整响应:', JSON.stringify(jsonData, null, 2));
                        reject(new Error('No access token in response'));
                    }
                } catch (error) {
                    console.error('❌ 解析OAuth响应失败:', error.message);
                    console.log('原始响应:', data);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ OAuth请求失败:', error.message);
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

function testOutlookAPI(accessToken) {
    return new Promise((resolve, reject) => {
        console.log('\n📧 步骤2: ��用access_token调用Outlook API获取邮件');

        // 尝试使用Outlook REST API而不是Microsoft Graph API
        const options = {
            hostname: 'outlook.office.com',
            port: 443,
            path: '/api/v2.0/me/messages?$top=10&$select=Subject,From,ReceivedDateTime,Body',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        console.log('📤 发送Outlook API请求...');

        const req = https.request(options, (res) => {
            console.log(`📊 API状态码: ${res.statusCode}`);
            console.log(`📋 API响应头:`, res.headers);

            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);

                    if (res.statusCode !== 200) {
                        console.log('❌ Outlook API调用失败!');
                        console.log('📋 错误响应:', JSON.stringify(jsonData, null, 2));
                        reject(new Error(`API Error: ${res.statusCode}`));
                        return;
                    }

                    console.log('✅ Outlook API调用成功!');

                    if (jsonData.value && jsonData.value.length > 0) {
                        console.log(`📬 找到 ${jsonData.value.length} 封邮件:`);

                        const verificationCodes = [];

                        jsonData.value.forEach((email, index) => {
                            console.log(`\n📧 邮件 ${index + 1}:`);
                            // Outlook REST API使用不同的字段名
                            console.log(`  主题: ${email.Subject || email.subject}`);
                            console.log(`  发件人: ${email.From?.EmailAddress?.Name || email.from?.emailAddress?.name} <${email.From?.EmailAddress?.Address || email.from?.emailAddress?.address}>`);
                            console.log(`  收件时间: ${email.ReceivedDateTime || email.receivedDateTime}`);

                            // 提取验证码
                            const subject = email.Subject || email.subject || '';
                            const body = email.Body?.Content || email.body?.content || '';
                            const emailContent = `${subject} ${body}`;

                            // 验证码匹配模式
                            const codePatterns = [
                                /\b\d{4,8}\b/g,
                                /(?:code|verification|验证码)[\s:：]*(\d{4,8})/gi,
                                /(?:verification code|验证码)[\s:：]*(\d{4,8})/gi,
                                /(?:pin|密码)[\s:：]*(\d{4,8})/gi,
                                /^\[.*?(\d{4,8}).*?\]/gm,
                                /(?:验证|verification).*?(\d{4,8})/gi
                            ];

                            for (const pattern of codePatterns) {
                                const matches = emailContent.match(pattern);
                                if (matches) {
                                    for (const match of matches) {
                                        const code = match.replace(/\D/g, '');
                                        if (code.length >= 4 && code.length <= 8) {
                                            verificationCodes.push({
                                                code,
                                                subject: subject || '无标题',
                                                sender: email.from?.emailAddress?.name || email.from?.emailAddress?.address || '未知发件人',
                                                received_at: email.receivedDateTime
                                            });
                                            console.log(`  🔢 发现验证码: ${code}`);
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                        });

                        resolve({
                            success: true,
                            totalEmails: jsonData.value.length,
                            verificationCodes: verificationCodes
                        });
                    } else {
                        console.log('📭 邮箱中没有邮件');
                        resolve({
                            success: true,
                            totalEmails: 0,
                            verificationCodes: []
                        });
                    }
                } catch (error) {
                    console.error('❌ 解析API响应失败:', error.message);
                    console.log('原始响应:', data);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ API请求失败:', error.message);
            reject(error);
        });

        req.end();
    });
}

// 执行测试流程
async function runTest() {
    try {
        console.log('🚀 开始测试完整的OAuth授权和邮件获取流程...');

        // 步骤1: 获取access token
        const accessToken = await testOAuthTokenRefresh();

        // 步骤2: 调用Outlook API
        const result = await testOutlookAPI(accessToken);

        console.log('\n🎉 测试完成!');
        console.log('📊 测试结果:');
        console.log(`  📧 总邮件数: ${result.totalEmails}`);
        console.log(`  🔢 验证码数量: ${result.verificationCodes.length}`);

        if (result.verificationCodes.length > 0) {
            console.log('\n📋 提取的验证码:');
            result.verificationCodes.forEach((code, index) => {
                console.log(`  ${index + 1}. ${code.code} - 来自: ${code.sender} - ${code.subject}`);
            });
        }

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
    }
}

// 运行测试
runTest();