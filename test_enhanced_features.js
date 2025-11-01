/**
 * 测试增强版proxy-server.js的新功能
 * 验证批量导入、序列管理、缓存系统等功能
 */

const http = require('http');

const CONFIG = {
    baseUrl: 'http://localhost:3001',
    testEmails: [
        {
            email: 'test1@example.com',
            password: 'password1',
            client_id: 'client_id_1',
            refresh_token: 'refresh_token_1'
        },
        {
            email: 'test2@example.com',
            password: 'password2',
            client_id: 'client_id_2',
            refresh_token: 'refresh_token_2'
        },
        {
            email: 'test3@example.com',
            password: 'password3',
            client_id: 'client_id_3',
            refresh_token: 'refresh_token_3'
        }
    ]
};

class EnhancedFeaturesTest {
    constructor() {
        this.testResults = [];
    }

    async runTest(testName, testFunction) {
        console.log(`\n🧪 开始测试: ${testName}`);
        console.log('='.repeat(60));

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

    async testServerInfo() {
        const response = await this.httpRequest('GET', '/api/info');
        return response;
    }

    async testEmailProcess() {
        const response = await this.httpRequest('POST', '/api/email/process', {
            emails: CONFIG.testEmails
        });

        return response;
    }

    async testEmailQueueStats() {
        const response = await this.httpRequest('GET', '/api/email/queue/stats');
        return response;
    }

    async testSequenceStats() {
        const response = await this.httpRequest('GET', '/api/sequence/stats');
        return response;
    }

    async testSequenceQuery() {
        const email = CONFIG.testEmails[0].email;
        const response = await this.httpRequest('GET', `/api/sequence/email/${encodeURIComponent(email)}`);
        return response;
    }

    async testCacheStats() {
        const response = await this.httpRequest('GET', '/api/cache/stats');
        return response;
    }

    async testCacheOperations() {
        // 测试缓存清理
        const clearResponse = await this.httpRequest('POST', '/api/cache/clear', {
            type: 'memory'
        });

        // 测试缓存统计
        const statsResponse = await this.httpRequest('GET', '/api/cache/stats');

        return { clearResponse, statsResponse };
    }

    async testAnalyticsStats() {
        const response = await this.httpRequest('GET', '/api/analytics/stats');
        return response;
    }

    async testTimeFilter() {
        const response = await this.httpRequest('POST', '/api/monitor/copy-trigger', {
            sessionId: 'test_session_' + Date.now(),
            account_id: 'test_account_123',
            email: 'test@example.com',
            client_id: 'test_client_id',
            refresh_token: 'test_refresh_token',
            current_status: 'authorized',
            access_token: 'test_access_token',
            // 传递历史邮件数据用于时间过滤
            codes: [
                {
                    code: '123456',
                    received_at: '2024-08-15T10:00:00.000Z',
                    sender: 'service@example.com'
                }
            ],
            emails: [
                {
                    received_at: '2024-08-15T10:05:00.000Z',
                    subject: 'Latest email'
                }
            ],
            latest_code_received_at: '2024-08-15T10:00:00.000Z',
            last_active_at: '2024-08-15T10:05:00.000Z'
        });

        return response;
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

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async runAllTests() {
        console.log('🚀 增强版proxy-server.js功能测试');
        console.log('='.repeat(80));

        // 测试列表
        const tests = [
            { name: '服务器信息查询', fn: () => this.testServerInfo() },
            { name: '邮箱处理功能', fn: () => this.testEmailProcess() },
            { name: '邮箱队列状态', fn: () => this.testEmailQueueStats() },
            { name: '邮箱序列统计', fn: () => this.testSequenceStats() },
            { name: '邮箱序列查询', fn: () => this.testSequenceQuery() },
            { name: '缓存统计查询', fn: () => this.testCacheStats() },
            { name: '缓存操作测试', fn: () => this.testCacheOperations() },
            { name: '系统统计分析', fn: () => this.testAnalyticsStats() },
            { name: '时间过滤功能', fn: () => this.testTimeFilter() }
        ];

        // 执行所有测试
        for (const test of tests) {
            await this.runTest(test.name, test.fn);
        }

        // 简化版无需清理测试数据
        console.log('\n✅ 测试完成');

        // 生成测试报告
        this.generateReport();
    }

    generateReport() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 测试报告');
        console.log('='.repeat(80));

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
            console.log(`\n🎉 所有测试通过！增强版proxy-server.js功能正常`);
        } else {
            console.log(`\n⚠️  有 ${failed} 个测试失败，请检查相关功能`);
        }

        console.log('\n' + '='.repeat(80));
    }
}

// 运行测试
async function runTests() {
    const tester = new EnhancedFeaturesTest();

    try {
        await tester.runAllTests();
    } catch (error) {
        console.error('💥 测试执行失败:', error);
        process.exit(1);
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
        console.log('请确保增强版proxy-server.js正在运行:');
        console.log('   node proxy-server.js');
        return false;
    }
}

// 主函数
async function main() {
    console.log('🔍 检查服务器状态...');
    const serverRunning = await checkServer();

    if (serverRunning) {
        console.log('🚀 开始功能测试...');
        await runTests();
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