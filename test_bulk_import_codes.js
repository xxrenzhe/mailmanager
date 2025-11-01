#!/usr/bin/env node

/**
 * 批量导入验证码提取测试
 * 模拟真实用户批量导入场景，验证验证码提取功能
 */

const WebSocket = require('ws');
const https = require('https');
const http = require('http');

// 配置
const CONFIG = {
    wsUrl: 'ws://localhost:3002',
    baseUrl: 'http://localhost:3001',
    testAccounts: [
        {
            id: 'test_1',
            email: 'StephanieEntrikenkw@outlook.com',
            client_id: 'd8a1a5a0-1234-5678-9abc-123456789012',
            refresh_token: 'M.R3_BAY.-m9vPHN3Jp1KwQ...test_token_1',
            access_token: 'EwBoA8l6BAAAR...test_access_1'
        },
        {
            id: 'test_2',
            email: 'NatalieJordanmv@outlook.com',
            client_id: 'd8a1a5a0-1234-5678-9abc-123456789012',
            refresh_token: 'M.R3_BAY.-m9vPHN3Jp1KwQ...test_token_2',
            access_token: 'EwBoA8l6BAAAR...test_access_2'
        }
    ]
};

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
                    body: data,
                    headers: res.headers
                });
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// WebSocket客户端
class BatchImportTestClient {
    constructor() {
        this.ws = null;
        this.receivedEvents = [];
        this.testResults = {
            connectionEstablished: false,
            bulkImportProgress: false,
            verificationCodeFound: false,
            accountStatusChanged: false
        };
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`[WS] 连接到 WebSocket: ${CONFIG.wsUrl}`);

            this.ws = new WebSocket(CONFIG.wsUrl);

            this.ws.on('open', () => {
                console.log('[WS] WebSocket连接已建立');

                // 发送订阅事件
                this.ws.send(JSON.stringify({
                    type: 'subscribe',
                    events: [
                        'verification_code_found',
                        'account_status_changed',
                        'bulk_import_progress',
                        'import_progress'
                    ]
                }));

                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    this.handleEvent(event);
                } catch (error) {
                    console.error('[WS] 事件解析错误:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('[WS] WebSocket错误:', error);
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('[WS] WebSocket连接已关闭');
            });
        });
    }

    handleEvent(event) {
        console.log(`[WS] 收到事件: ${event.type}`, event);
        this.receivedEvents.push(event);

        switch (event.type) {
            case 'connection_established':
                this.testResults.connectionEstablished = true;
                console.log('[WS] ✅ 连接确认事件已收到');
                break;

            case 'bulk_import_progress':
                this.testResults.bulkImportProgress = true;
                console.log('[WS] ✅ 批量导入进度事件:', event.message);
                break;

            case 'verification_code_found':
                this.testResults.verificationCodeFound = true;
                console.log('[WS] 🎯 验证码发现事件:', {
                    account: event.email,
                    code: event.code,
                    sender: event.sender
                });
                break;

            case 'account_status_changed':
                this.testResults.accountStatusChanged = true;
                console.log('[WS] 📊 账户状态变更事件:', {
                    account: event.email,
                    status: event.status,
                    message: event.message
                });
                break;
        }
    }

    async testBatchImport() {
        console.log('\n[TEST] 🚀 开始批量导入测试');

        try {
            const response = await makeRequest(`${CONFIG.baseUrl}/api/accounts/batch-validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sessionId: 'test_batch_session_' + Date.now(),
                    accounts: CONFIG.testAccounts
                })
            });

            const result = JSON.parse(response.body);
            console.log('[TEST] 批量导入响应:', JSON.stringify(result, null, 2));

            return result;
        } catch (error) {
            console.error('[TEST] 批量导入失败:', error);
            throw error;
        }
    }

    async waitForEvents(timeout = 30000) {
        console.log(`\n[TEST] ⏳ 等待事件响应 (超时: ${timeout}ms)`);

        return new Promise((resolve) => {
            const checkEvents = () => {
                const hasEvents = this.receivedEvents.length > 0;
                const hasExpectedEvents = this.testResults.bulkImportProgress ||
                                         this.testResults.verificationCodeFound ||
                                         this.testResults.accountStatusChanged;

                if (hasExpectedEvents) {
                    console.log(`[TEST] ✅ 收到预期事件: ${this.receivedEvents.length} 个`);
                    resolve(this.receivedEvents);
                    return;
                }

                setTimeout(checkEvents, 1000);
            };

            checkEvents();

            // 超时处理
            setTimeout(() => {
                console.log(`[TEST] ⏰ 等待超时，已收到 ${this.receivedEvents.length} 个事件`);
                resolve(this.receivedEvents);
            }, timeout);
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    getTestResults() {
        return {
            testResults: this.testResults,
            eventCount: this.receivedEvents.length,
            events: this.receivedEvents
        };
    }
}

// 主测试函数
async function runBatchImportTest() {
    console.log('🧪 开始批量导入验证码提取测试');
    console.log('=' .repeat(60));

    const client = new BatchImportTestClient();

    try {
        // 1. 连接WebSocket
        await client.connect();
        console.log('✅ WebSocket连接成功');

        // 2. 执行批量导入
        const importResult = await client.testBatchImport();

        // 3. 等待事件响应
        const events = await client.waitForEvents(15000); // 15秒超时

        // 4. 分析结果
        const results = client.getTestResults();
        console.log('\n📊 测试结果分析:');
        console.log('- 连接确认:', results.testResults.connectionEstablished ? '✅' : '❌');
        console.log('- 批量导入进度:', results.testResults.bulkImportProgress ? '✅' : '❌');
        console.log('- 验证码发现:', results.testResults.verificationCodeFound ? '✅' : '❌');
        console.log('- 账户状态变更:', results.testResults.accountStatusChanged ? '✅' : '❌');
        console.log('- 总事件数:', results.eventCount);

        // 5. 详细事件分析
        if (events.length > 0) {
            console.log('\n📋 收到的事件详情:');
            events.forEach((event, index) => {
                console.log(`${index + 1}. ${event.type}:`, {
                    account: event.email || 'N/A',
                    message: event.message || 'N/A',
                    code: event.code || 'N/A'
                });
            });
        }

        // 6. 总结
        const success = importResult.success || false;
        const codesFound = importResult.results?.some(r => r.verification_codes && r.verification_codes.length > 0);

        console.log('\n🎯 测试结论:');
        if (success && codesFound) {
            console.log('✅ 批量导入成功并提取到验证码');
        } else if (success) {
            console.log('⚠️ 批量导入成功但未提取到验证码 (可能是Token过期)');
        } else {
            console.log('❌ 批量导入失败');
        }

        console.log('\n📝 建议:');
        if (!results.testResults.verificationCodeFound) {
            console.log('- 检查测试账户的Token是否有效');
            console.log('- 确认邮箱中有验证码邮件');
            console.log('- 验证WebSocket事件处理逻辑');
        }

    } catch (error) {
        console.error('❌ 测试执行失败:', error);
    } finally {
        client.disconnect();
    }
}

// 运行测试
if (require.main === module) {
    runBatchImportTest().catch(console.error);
}

module.exports = { BatchImportTestClient, runBatchImportTest };