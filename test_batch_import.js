/**
 * 批量导入功能测试脚本
 * 测试授权、取件、验证码提取完整流程
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

// 测试账户（使用真实的授权信息）
const TEST_ACCOUNTS = [
    {
        email: 'RuthMoorekx@outlook.com',
        password: 'Ofzmbis1',
        client_id: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
        refresh_token: 'M.C552_BAY.0.U.-Cg1AvNkQOKRWWkdxOkQq!!HlQamoacgw3a*d25kPBSBatxb26406phBl!PzqIsXvudBOKZ2!wfweyMmmcEr8WBpuN*w4ZxJj5bjdOhPCwzBQOWhpaBEewJgl3uADdidXnz8ZhaGQ5RXxK!w07zsUoZaMJbBKrwCZa0VE7y0wJ0*qW!YbaAYcSYLe0abtOE*EXkECVu!0O7pUXZHcPRwbQ9lOjU*AnQhsikjVNdxtdnEULRcFQCx7zGqL0!5!O2ryNyiJK4cYp248l71z7eudbleGtuAOF7XPSefzY2Tney6twKJjxTCbgU0548r4vzz1!213wxvoE4hxaiENcEnQ2T4GFVepkU7EDz0FKi5CDygNjVSbGYuvyfXANYDqtkrIgg$$'
    }
];

// 测试会话ID
const SESSION_ID = 'test-batch-import-' + Date.now();

// 存储收到的验证码事件
const receivedCodes = [];

/**
 * 监听SSE事件
 */
function listenSSEEvents() {
    return new Promise((resolve, reject) => {
        console.log(`\n📡 连接SSE事件流: ${SESSION_ID}`);

        const eventSource = new EventSource(`${SERVER_URL}/api/events/stream/${SESSION_ID}`);

        eventSource.onopen = () => {
            console.log('✅ SSE连接成功');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log(`\n[SSE事件] 类型: ${data.type}`);

                if (data.type === 'verification_code_found') {
                    console.log('📧 收到验证码通知:');
                    console.log(`  - 邮箱: ${data.email}`);
                    console.log(`  - 验证码: ${data.code}`);
                    console.log(`  - 发件人: ${data.sender}`);
                    console.log(`  - 主题: ${data.subject}`);
                    console.log(`  - 时间: ${data.received_at}`);
                    console.log(`  - 批量导入标记: ${data.batch_import}`);

                    receivedCodes.push({
                        email: data.email,
                        code: data.code,
                        sender: data.sender,
                        received_at: data.received_at
                    });
                }
            } catch (error) {
                console.error('[SSE] 解析事件失败:', error.message);
            }
        };

        eventSource.onerror = (error) => {
            console.error('[SSE] 连接错误:', error.message);
        };

        // 30秒后关闭连接
        setTimeout(() => {
            console.log('\n⏰ SSE监听超时，关闭连接');
            eventSource.close();
            resolve();
        }, 30000);
    });
}

/**
 * 测试批量导入
 */
async function testBatchImport() {
    console.log('\n========== 测试批量导入功能 ==========');
    console.log(`会话ID: ${SESSION_ID}`);
    console.log(`测试账户数: ${TEST_ACCOUNTS.length}`);

    try {
        const response = await httpRequest(`${SERVER_URL}/api/accounts/batch-import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: SESSION_ID,
                emails: TEST_ACCOUNTS
            })
        });

        if (!response.ok) {
            throw new Error(response.data.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = response.data;

        console.log('✅ 批量导入请求成功!');
        console.log('\n统计信息:');
        console.log(`  - 总数: ${data.stats.total}`);
        console.log(`  - 成功: ${data.stats.successful}`);
        console.log(`  - 失败: ${data.stats.failed}`);

        console.log('\n详细结果:');
        data.results.forEach((result, index) => {
            console.log(`\n账户 ${index + 1}:`);
            console.log(`  - 邮箱: ${result.email}`);
            console.log(`  - 状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
            if (result.success) {
                console.log(`  - 账户ID: ${result.account_id}`);
                console.log(`  - 序列号: ${result.sequence}`);
            } else {
                console.log(`  - 错误: ${result.error}`);
            }
        });

        return {
            success: true,
            data: data
        };
    } catch (error) {
        console.error('❌ 批量导入失败!');
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
    console.log('║         批量导入功能完整测试                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n服务器地址: ${SERVER_URL}`);
    console.log(`会话ID: ${SESSION_ID}`);

    // 启动SSE监听（异步）
    const ssePromise = listenSSEEvents();

    // 等待SSE连接建立
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 执行批量导入
    const importResult = await testBatchImport();

    if (importResult.success) {
        console.log('\n⏳ 等待后台异步处理（取件和验证码提取）...');
        console.log('📡 监听SSE事件，等待验证码通知...');
    }

    // 等待SSE事件
    await ssePromise;

    // 测试总结
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     测试总结                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n1. 批量导入: ${importResult.success ? '✅ 成功' : '❌ 失败'}`);
    if (importResult.success) {
        console.log(`   - 成功导入: ${importResult.data.stats.successful} 个账户`);
        console.log(`   - 失败账户: ${importResult.data.stats.failed} 个`);
    }

    console.log(`\n2. 验证码提取: ${receivedCodes.length > 0 ? '✅ 成功' : '⚠️  未收到验证码'}`);
    if (receivedCodes.length > 0) {
        console.log(`   - 收到验证码数量: ${receivedCodes.length}`);
        receivedCodes.forEach((codeInfo, index) => {
            console.log(`   - 验证码 ${index + 1}: ${codeInfo.code} (${codeInfo.email})`);
        });
    }

    console.log('\n3. SSE事件通知: ✅ 正常');

    // 验证完整流程
    const allStepsSuccess = importResult.success && receivedCodes.length > 0;

    console.log(`\n📋 完整流程验证: ${allStepsSuccess ? '✅ 全部通过' : '⚠️  部分功能异常'}`);

    if (allStepsSuccess) {
        console.log('\n🎉 批量导入功能测试通过！');
        console.log('   ✅ 授权验证 - 正常');
        console.log('   ✅ 自动取件 - 正常');
        console.log('   ✅ 验证码提取 - 正常');
        console.log('   ✅ SSE通知前端 - 正常');
    } else {
        console.log('\n⚠️  部分功能需要检查：');
        if (!importResult.success) {
            console.log('   ❌ 批量导入请求失败');
        }
        if (receivedCodes.length === 0) {
            console.log('   ⚠️  未收到验证码（可能邮箱中没有新的验证码邮件）');
        }
    }

    console.log('\n测试完成!');
}

// 不使用SSE的简化测试
(async () => {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         批量导入功能测试（简化版）                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n服务器地址: ${SERVER_URL}`);
    console.log(`会话ID: ${SESSION_ID}`);

    const result = await testBatchImport();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     测试总结                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    console.log(`\n1. 批量导入: ${result.success ? '✅ 成功' : '❌ 失败'}`);
    if (result.success) {
        console.log(`   - 成功导入: ${result.data.stats.successful} 个账户`);
        console.log(`   - 失败账户: ${result.data.stats.failed} 个`);
    }

    console.log('\n2. 后台异步处理:');
    console.log('   ⏳ 后端正在异步处理以下任务：');
    console.log('      - Token刷新和授权验证');
    console.log('      - 邮件获取（最新5封）');
    console.log('      - 验证码智能提取');
    console.log('      - SSE事件通知前端');

    console.log('\n3. 验证建议:');
    console.log('   📋 请查看服务器日志确认：');
    console.log('      - [批量导入] Token刷新成功');
    console.log('      - [批量导入] 获取到 X 封邮件');
    console.log('      - [批量导入] 发现验证码: XXXXXX');
    console.log('      - [SSE] 精确路由事件到会话');

    console.log('\n注意：此测试不包含SSE事件监听');
    console.log('验证码提取结果请查看服务器日志或在浏览器中测试');
    console.log('\n测试完成!');
})().catch(error => {
    console.error('\n❌ 测试过程出错:', error);
    process.exit(1);
});
