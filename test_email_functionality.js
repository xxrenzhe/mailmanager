#!/usr/bin/env node

/**
 * 邮箱管理功能自动化测试脚本
 * 测试真实邮箱的完整功能流程
 */

const https = require('https');
const WebSocket = require('ws');

// 测试配置
const CONFIG = {
    baseUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3002/ws',
    testEmail: {
        email: 'RuthMoorekx@outlook.com',
        clientId: 'Ofzmbis1',
        refreshToken: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
        fullToken: 'M.C552_BAY.0.U.-Cg1AvNkQOKRWWkdxOkQq!!HlQamoacgw3a*d25kPBSBatxb26406phBl!PzqIsXvudBOKZ2!wfweyMmmcEr8WBpuN*w4ZxJj5bjdOhPCwzBQOWhpaBEewJgl3uADdidXnz8ZhaGQ5RXxK!w07zsUoZaMJbBKrwCZa0VE7y0wJ0*qW!YbaAYcSYLe0abtOE*EXkECVu!0O7pUXZHcPRwbQ9lOjU*AnQhsikjVNdxtdnEULRcFQCx7zGqL0!5!O2ryNyiJK4cYp248l71z7eudbleGtuAOF7XPSefzY2Tney6twKJjxTCbgU0548r4vzz1!213wxvoE4hxaiENcEnQ2T4GFVepkU7EDz0FKi5CDygNjVSbGYuvyfXANYDqtkrIgg$$'
    },
    timeout: 30000 // 30秒超时
};

// 测试结果记录
const testResults = {
    passed: 0,
    failed: 0,
    details: []
};

// 日志记录
function log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

// 测试断言
function assert(condition, message) {
    if (condition) {
        testResults.passed++;
        testResults.details.push(`✅ ${message}`);
        log('PASS', message);
    } else {
        testResults.failed++;
        testResults.details.push(`❌ ${message}`);
        log('FAIL', message);
    }
}

// HTTP请求封装
async function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? require('https') : require('http');
        const req = protocol.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });
        req.on('error', reject);
        req.setTimeout(CONFIG.timeout, () => {
            req.abort();
            reject(new Error('Request timeout'));
        });

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// WebSocket连接
function connectWebSocket() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(CONFIG.wsUrl);

        ws.on('open', () => {
            log('WS', 'WebSocket连接成功');
            // ��阅事件
            ws.send(JSON.stringify({
                type: 'subscribe',
                events: [
                    'verification_code_found',
                    'account_status_changed',
                    'manual_fetch_complete',
                    'manual_fetch_error',
                    'bulk_import_progress',
                    'import_progress',
                    'monitoring_started',
                    'monitoring_ended'
                ]
            }));
            resolve(ws);
        });

        ws.on('error', (error) => {
            log('WS_ERROR', `WebSocket连接失败: ${error.message}`);
            reject(error);
        });

        ws.on('close', () => {
            log('WS', 'WebSocket连接关闭');
        });

        ws.on('message', (data) => {
            try {
                const event = JSON.parse(data);
                log('WS_EVENT', `收到事件: ${event.type}`);

                // 记录重要事件
                if (event.type === 'account_status_changed') {
                    testResults.details.push(`🔔 账户状态变更: ${event.email} -> ${event.status}`);
                } else if (event.type === 'verification_code_found') {
                    testResults.details.push(`📧 发现验证码: ${event.code} (发件人: ${event.sender})`);
                } else if (event.type === 'manual_fetch_complete') {
                    testResults.details.push(`📨 取件完成: ${event.email}`);
                }
            } catch (error) {
                log('WS_ERROR', `解析WebSocket消息失败: ${error.message}`);
            }
        });
    });
}

// 测试1: 导入邮箱
async function testImportEmail() {
    log('TEST', '🚀 开始测试: 导入邮箱');

    const importData = `${CONFIG.testEmail.email}----${CONFIG.testEmail.clientId}----${CONFIG.testEmail.refreshToken}----${CONFIG.testEmail.fullToken}`;

    try {
        const response = await makeRequest(`${CONFIG.baseUrl}/api/accounts/batch-validate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: 'test_session_' + Date.now(),
                accounts: [{
                    id: 'test_account',
                    email: CONFIG.testEmail.email,
                    client_id: CONFIG.testEmail.clientId,
                    refresh_token: CONFIG.testEmail.refreshToken,
                    access_token: CONFIG.testEmail.fullToken
                }]
            })
        });

        const result = JSON.parse(response.body);
        log('IMPORT', `导入响应: ${JSON.stringify(result, null, 2)}`);

        assert(response.statusCode === 200, '邮箱导入请求成功');
        assert(result.success, '邮箱导入成功');

        // 等待导入完成
        await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
        log('IMPORT_ERROR', `导入失败: ${error.message}`);
        assert(false, `邮箱导入失败: ${error.message}`);
    }
}

// 测试2: 检查账户状态
async function testAccountStatus() {
    log('TEST', '🔍 开始测试: 检查账户状态');

    try {
        const response = await makeRequest(`${CONFIG.baseUrl}/api/accounts/check-tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                accounts: [{
                    id: 'test_account',
                    email: CONFIG.testEmail.email,
                    client_id: CONFIG.testEmail.clientId,
                    refresh_token: CONFIG.testEmail.refresh_token
                }],
                sessionId: 'test_session_' + Date.now()
            })
        });

        const result = JSON.parse(response.body);
        log('STATUS', `Token检查结果: ${JSON.stringify(result, null, 2)}`);

        assert(response.statusCode === 200, 'Token检查请求成功');
        assert(result.success, 'Token检查成功');

        // 等待状态更新
        await new Promise(resolve => setTimeout(resolve, 3000));

    } catch (error) {
        log('STATUS_ERROR', `状态检查失败: ${error.message}`);
        assert(false, `状态检查失败: ${error.message}`);
    }
}

// 测试3: 手动取件
async function testManualFetch() {
    log('TEST', '📨 开始测试: 手动取件');

    try {
        const response = await makeRequest(`${CONFIG.baseUrl}/api/manual-fetch-emails`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                account_id: 'test_account',
                email: CONFIG.testEmail.email,
                client_id: CONFIG.testEmail.clientId,
                refresh_token: CONFIG.testEmail.refreshToken,
                access_token: CONFIG.testEmail.fullToken,
                current_status: 'authorized',
                session_id: 'test_session_' + Date.now()
            })
        });

        const result = JSON.parse(response.body);
        log('FETCH', `取件响应: ${JSON.stringify(result, null, 2)}`);

        assert(response.statusCode === 200, '手动取件请求成功');
        assert(result.success, '手动取件成功');

        // 等待取件完成
        await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error) {
        log('FETCH_ERROR', `手动取件失败: ${error.message}`);
        assert(false, `手动取件失败: ${error.message}`);
    }
}

// 测试4: 验证健康检查
async function testHealthCheck() {
    log('TEST', '💚️ 开始测试: 健康检查');

    try {
        const response = await makeRequest(`${CONFIG.baseUrl}/api/health`);

        assert(response.statusCode === 200, '健康检查通过');
        assert(response.body.includes('healthy'), '服务健康状态正常');

        log('HEALTH', '健康检查通过');

    } catch (error) {
        log('HEALTH_ERROR', `健康检查失败: ${error.message}`);
        assert(false, `健康检查失败: ${error.message}`);
    }
}

// 主测试函数
async function runTests() {
    log('START', '🧪 开始自动化功能测试');
    log('INFO', `测试邮箱: ${CONFIG.testEmail.email}`);
    log('INFO', `测试服务器: ${CONFIG.baseUrl}`);

    try {
        // 测试服务器健康状态
        await testHealthCheck();

        // 连接WebSocket
        const ws = await connectWebSocket();

        // 执行核心功能测试
        await testImportEmail();
        await testAccountStatus();
        await testManualFetch();

        // 等待最终事件处理
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 关闭WebSocket
        ws.close();

        // 输出测试结果
        log('RESULTS', '\n📊 测试结果汇总:');
        testResults.details.forEach(detail => log('RESULT', detail));
        log('SUMMARY', `总测试数: ${testResults.passed + testResults.failed}`);
        log('SUMMARY', `✅ 通过: ${testResults.passed}`);
        log('SUMMARY', `❌ 失败: ${testResults.failed}`);
        log('SUMMARY', `成功率: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

        if (testResults.failed === 0) {
            log('SUCCESS', '🎉 所有测试通过！邮箱管理功能正常工作');
            process.exit(0);
        } else {
            log('ERROR', '❌ 部分测试失败，请检查服务器日志');
            process.exit(1);
        }

    } catch (error) {
        log('FATAL_ERROR', `测试执行失败: ${error.message}`);
        process.exit(1);
    }
}

// 启动测试
if (require.main === module) {
    runTests().catch(error => {
        console.error('测试启动失败:', error);
        process.exit(1);
    });
}