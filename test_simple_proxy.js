/**
 * 测试简化版proxy-server.js
 * 验证KISS原则的核心功能
 */

const http = require('http');
const WebSocket = require('ws');

const CONFIG = {
    baseUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3002',
    testEmails: [
        {
            email: 'simple1@example.com',
            password: 'password1',
            client_id: 'client_id_1',
            refresh_token: 'refresh_token_1'
        },
        {
            email: 'simple2@example.com',
            password: 'password2',
            client_id: 'client_id_2',
            refresh_token: 'refresh_token_2'
        }
    ]
};

class SimpleProxyTest {
    constructor() {
        this.testResults = [];
    }

    async runTest(testName, testFunction) {
        console.log(`\n🧪 开始测试: ${testName}`);
        console.log('='.repeat(50));

        try {
            const startTime = Date.now();
            const result = await testFunction();
            const endTime = Date.now();
            const duration = endTime - startTime;

            this.testResults.push({
                name: testName,
                status: 'PASSED',
                duration,
                result
            });

            console.log(`✅ ${testName} - 通过 (${duration}ms)`);
            console.log(`📊 结果:`, result);

        } catch (error) {
            this.testResults.push({
                name: testName,
                status: 'FAILED',
                error: error.message
            });

            console.log(`❌ ${testName} - 失败`);
            console.log(`🔍 错误:`, error.message);
        }
    }

    async testHealth() {
        const response = await this.httpRequest('GET', '/api/health');
        return response;
    }

    async testInfo() {
        const response = await this.httpRequest('GET', '/api/info');
        return response;
    }

    async testEmailProcess() {
        const response = await this.httpRequest('POST', '/api/emails', {
            emails: CONFIG.testEmails
        });
        return response;
    }

    async testSequenceQuery() {
        const email = CONFIG.testEmails[0].email;
        const response = await this.httpRequest('GET', `/api/sequence/${encodeURIComponent(email)}`);
        return response;
    }

    async testStats() {
        const response = await this.httpRequest('GET', '/api/stats');
        return response;
    }

    async testToken() {
        const response = await this.httpRequest('POST', '/api/microsoft/token', {
            client_id: 'test_client_id',
            code: 'test_code',
            redirect_uri: 'http://localhost:3000'
        });
        return response;
    }

    async testMonitor() {
        const response = await this.httpRequest('POST', '/api/monitor', {
            email: 'test@example.com',
            action: 'start'
        });
        return response;
    }

    async testWebSocket() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(CONFIG.wsUrl);

            ws.on('open', () => {
                console.log('🔌 WebSocket连接已建立');

                // 发送ping消息
                ws.send(JSON.stringify({ type: 'ping' }));

                // 设置超时
                setTimeout(() => {
                    ws.close();
                    resolve({ success: true, message: 'WebSocket连接测试成功' });
                }, 1000);
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log('📨 收到WebSocket消息:', message);

                    if (message.type === 'pong') {
                        resolve({ success: true, message: 'WebSocket pong响应正常', data: message });
                    }
                } catch (error) {
                    reject(new Error('WebSocket消息解析失败'));
                }
            });

            ws.on('error', (error) => {
                reject(new Error(`WebSocket连接失败: ${error.message}`));
            });

            // 超时处理
            setTimeout(() => {
                ws.close();
                reject(new Error('WebSocket连接超时'));
            }, 5000);
        });
    }

    async httpRequest(method, path, data = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'localhost',
                port: CONFIG.baseUrl.replace('http://', '').split(':')[1] || 3001,
                path: path,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                }
            };

            const req = http.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsedData = JSON.parse(responseData);
                        resolve(parsedData);
                    } catch (error) {
                        reject(new Error(`JSON解析失败: ${error.message} | 原始数据: ${responseData}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    async runAllTests() {
        console.log('🚀 简化版proxy-server.js功能测试');
        console.log('='.repeat(60));

        // 测试列表
        const tests = [
            { name: '健康检查', fn: () => this.testHealth() },
            { name: '服务信息', fn: () => this.testInfo() },
            { name: '邮箱处理', fn: () => this.testEmailProcess() },
            { name: '序列查询', fn: () => this.testSequenceQuery() },
            { name: '基本统计', fn: () => this.testStats() },
            { name: 'Token获取', fn: () => this.testToken() },
            { name: '监控触发', fn: () => this.testMonitor() },
            { name: 'WebSocket通信', fn: () => this.testWebSocket() }
        ];

        // 执行所有测试
        for (const test of tests) {
            await this.runTest(test.name, test.fn);
        }

        // 生成测试报告
        this.generateReport();
    }

    generateReport() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 测试报告');
        console.log('='.repeat(60));

        const passed = this.testResults.filter(r => r.status === 'PASSED').length;
        const failed = this.testResults.filter(r => r.status === 'FAILED').length;
        const total = this.testResults.length;

        console.log(`\n📈 测试统计:`);
        console.log(`   总测试数: ${total}`);
        console.log(`   通过: ${passed} ✅`);
        console.log(`   失败: ${failed} ❌`);
        console.log(`   成功率: ${((passed / total) * 100).toFixed(1)}%`);

        console.log(`\n📋 详细结果:`);
        this.testResults.forEach((result, index) => {
            const icon = result.status === 'PASSED' ? '✅' : '❌';
            const duration = result.duration ? ` (${result.duration}ms)` : '';
            console.log(`   ${index + 1}. ${icon} ${result.name}${duration}`);
            if (result.error) {
                console.log(`      🔍 错误: ${result.error}`);
            }
        });

        if (failed === 0) {
            console.log(`\n🎉 所有测试通过！简化版proxy-server.js功能正常`);
            console.log(`✨ KISS原则验证成功 - 简单、直接、有效`);
        } else {
            console.log(`\n⚠️  有 ${failed} 个测试失败，请检查相关功能`);
        }

        console.log('\n' + '='.repeat(60));
    }
}

// 检查服务器是否运行
async function checkServer() {
    try {
        const response = await fetch(CONFIG.baseUrl + '/api/health');
        if (response.ok) {
            console.log('✅ 服务器运行正常');
            return true;
        }
    } catch (error) {
        console.error('❌ 服务器连接失败');
        console.log('请确保简化版proxy-server.js正在运行:');
        console.log('   node simple-proxy-server.js');
        return false;
    }
}

// 主函数
async function main() {
    console.log('🔍 检查服务器状态...');
    const serverRunning = await checkServer();

    if (serverRunning) {
        console.log('🚀 开始功能测试...');
        const tester = new SimpleProxyTest();
        await tester.runAllTests();
    } else {
        process.exit(1);
    }
}

// 执行测试
main().then(() => {
    console.log('\n✨ 测试脚本执行完毕');
    process.exit(0);
}).catch(error => {
    console.error('💥 测试脚本执行失败:', error);
    process.exit(1);
});