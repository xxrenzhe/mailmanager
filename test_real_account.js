/**
 * 真实账户测试脚本
 * 测试授权和邮件获取功能
 */

const http = require('http');
const https = require('https');

// HTTP请求封装
function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        const body = options.body || '';
        const headers = options.headers || {};

        // 如果有body，自动添加Content-Length
        if (body) {
            headers['Content-Length'] = Buffer.byteLength(body);
        }

        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: headers
        };

        const req = client.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, statusText: res.statusMessage, data: jsonData });
                } catch (e) {
                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: data });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(body);
        }

        req.end();
    });
}

// 服务器配置
const SERVER_URL = 'http://localhost:3001';

// 真实账户信息
const TEST_ACCOUNT = {
    email: 'RuthMoorekx@outlook.com',
    password: 'Ofzmbis1',
    client_id: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
    refresh_token: 'M.C552_BAY.0.U.-Cg1AvNkQOKRWWkdxOkQq!!HlQamoacgw3a*d25kPBSBatxb26406phBl!PzqIsXvudBOKZ2!wfweyMmmcEr8WBpuN*w4ZxJj5bjdOhPCwzBQOWhpaBEewJgl3uADdidXnz8ZhaGQ5RXxK!w07zsUoZaMJbBKrwCZa0VE7y0wJ0*qW!YbaAYcSYLe0abtOE*EXkECVu!0O7pUXZHcPRwbQ9lOjU*AnQhsikjVNdxtdnEULRcFQCx7zGqL0!5!O2ryNyiJK4cYp248l71z7eudbleGtuAOF7XPSefzY2Tney6twKJjxTCbgU0548r4vzz1!213wxvoE4hxaiENcEnQ2T4GFVepkU7EDz0FKi5CDygNjVSbGYuvyfXANYDqtkrIgg$$'
};

// 测试会话ID
const SESSION_ID = 'test-session-' + Date.now();

// 存储获取的access_token
let ACCESS_TOKEN = null;

/**
 * 测试1: Token刷新
 */
async function testTokenRefresh() {
    console.log('\n========== 测试1: Token刷新 ==========');
    console.log(`邮箱: ${TEST_ACCOUNT.email}`);
    console.log(`Client ID: ${TEST_ACCOUNT.client_id}`);

    try {
        const response = await httpRequest(`${SERVER_URL}/api/microsoft/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: TEST_ACCOUNT.client_id,
                refresh_token: TEST_ACCOUNT.refresh_token
            })
        });

        if (!response.ok) {
            throw new Error(response.data.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = response.data;

        console.log('✅ Token刷新成功!');
        console.log('响应数据:', {
            access_token: data.access_token ? `${data.access_token.substring(0, 50)}...` : null,
            refresh_token: data.refresh_token ? `${data.refresh_token.substring(0, 50)}...` : null,
            expires_in: data.expires_in,
            token_type: data.token_type,
            scope: data.scope
        });

        // 保存access_token供后续使用
        ACCESS_TOKEN = data.access_token;

        return {
            success: true,
            access_token: data.access_token,
            refresh_token: data.refresh_token || TEST_ACCOUNT.refresh_token
        };
    } catch (error) {
        console.error('❌ Token刷新失败!');
        console.error('错误信息:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 测试2: 手动获取邮件
 */
async function testFetchEmails(tokenData) {
    console.log('\n========== 测试2: 手动获取邮件 ==========');
    console.log(`邮箱: ${TEST_ACCOUNT.email}`);
    console.log(`会话ID: ${SESSION_ID}`);

    if (!tokenData.success) {
        console.log('⚠️  跳过邮件获取测试（Token刷新失败）');
        return;
    }

    try {
        const response = await httpRequest(`${SERVER_URL}/api/manual-fetch-emails`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                account_id: 'test-account-' + Date.now(),
                email: TEST_ACCOUNT.email,
                client_id: TEST_ACCOUNT.client_id,
                refresh_token: tokenData.refresh_token,
                access_token: tokenData.access_token,
                current_status: 'active',
                sessionId: SESSION_ID,
                codes: []
            })
        });

        if (!response.ok) {
            throw new Error(response.data.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = response.data;

        console.log('✅ 邮件获取成功!');
        console.log('响应数据:', {
            success: data.success,
            emails_count: data.emails_count,
            codes_count: data.codes_count,
            message: data.message
        });

        // 如果有找到验证码，显示详情
        if (data.codes && data.codes.length > 0) {
            console.log('\n📧 发现的验证码:');
            data.codes.forEach((codeInfo, index) => {
                console.log(`\n验证码 ${index + 1}:`);
                console.log(`  - 验证码: ${codeInfo.code}`);
                console.log(`  - 发件人: ${codeInfo.sender}`);
                console.log(`  - 主题: ${codeInfo.subject}`);
                console.log(`  - 接收时间: ${codeInfo.received_at}`);
            });
        } else {
            console.log('\n📭 未发现新的验证码');
        }

        return {
            success: true,
            data: data
        };
    } catch (error) {
        console.error('❌ 邮件获取失败!');
        console.error('错误信息:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 测试3: 直接调用Outlook API获取邮件（验证token有效性）
 */
async function testDirectOutlookAPI(accessToken) {
    console.log('\n========== 测试3: 直接调用Outlook API ==========');

    if (!accessToken) {
        console.log('⚠️  跳过直接API调用测试（没有access_token）');
        return;
    }

    try {
        const url = new URL('https://outlook.office.com/api/v2.0/me/messages');
        url.searchParams.append('$top', '5');
        url.searchParams.append('$select', 'Subject,From,ReceivedDateTime');
        url.searchParams.append('$orderby', 'ReceivedDateTime desc');

        const response = await httpRequest(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(response.data.error ? JSON.stringify(response.data.error) : `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = response.data;

        console.log('✅ 直接API调用成功!');
        console.log(`获取到 ${data.value ? data.value.length : 0} 封邮件`);

        if (data.value && data.value.length > 0) {
            console.log('\n最近的邮件:');
            data.value.forEach((email, index) => {
                console.log(`\n邮件 ${index + 1}:`);
                console.log(`  - 主题: ${email.Subject}`);
                console.log(`  - 发件人: ${email.From.EmailAddress.Address}`);
                console.log(`  - 接收时间: ${email.ReceivedDateTime}`);
            });
        }

        return {
            success: true,
            emails_count: data.value ? data.value.length : 0
        };
    } catch (error) {
        console.error('❌ 直接API调用失败!');
        console.error('错误信息:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 主测试流程
 */
async function runTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         真实账户授权和取件功能测试                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n测试账户: ${TEST_ACCOUNT.email}`);
    console.log(`服务器地址: ${SERVER_URL}`);
    console.log(`会话ID: ${SESSION_ID}`);

    // 测试1: Token刷新
    const tokenResult = await testTokenRefresh();

    // 等待一秒
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 测试2: 手动获取邮件
    const fetchResult = await testFetchEmails(tokenResult);

    // 等待一秒
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 测试3: 直接调用Outlook API
    const apiResult = await testDirectOutlookAPI(ACCESS_TOKEN);

    // 测试总结
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     测试总结                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n1. Token刷新: ${tokenResult.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`2. 邮件获取: ${fetchResult && fetchResult.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`3. 直接API调用: ${apiResult && apiResult.success ? '✅ 成功' : '❌ 失败'}`);

    if (!tokenResult.success) {
        console.log('\n⚠️  Token刷新失败，可能的原因:');
        console.log('  1. Refresh token已过期或无效');
        console.log('  2. Client ID配置错误');
        console.log('  3. 网络连接问题');
        console.log('  4. Microsoft服务器问题');
    }

    console.log('\n测试完成!');
}

// 运行测试
runTests().catch(error => {
    console.error('\n❌ 测试过程出错:', error);
    process.exit(1);
});
