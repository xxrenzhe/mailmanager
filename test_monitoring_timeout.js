#!/usr/bin/env node

/**
 * 监控超时测试脚本
 * 测试1分钟监控超时后"监控中"指标是否正确更新
 */

const WebSocket = require('ws');

// 配置
const CONFIG = {
    wsUrl: 'ws://localhost:3002',
    testEmail: 'test@outlook.com', // 使用测试邮箱
    sessionId: 'test_monitoring_session_' + Date.now()
};

// WebSocket客户端
class MonitoringTimeoutTest {
    constructor() {
        this.ws = null;
        this.receivedEvents = [];
        this.testResults = {
            monitoringStarted: false,
            monitoringEnded: false,
            monitoringDuration: null
        };
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`[测试] 连接到 WebSocket: ${CONFIG.wsUrl}`);

            this.ws = new WebSocket(CONFIG.wsUrl + '?sessionId=' + CONFIG.sessionId);

            this.ws.on('open', () => {
                console.log('[测试] WebSocket连接已建立');

                // 发送订阅事件
                this.ws.send(JSON.stringify({
                    type: 'subscribe',
                    events: [
                        'monitoring_started',
                        'monitoring_ended',
                        'monitoring_progress',
                        'verification_code_found'
                    ]
                }));

                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    this.handleEvent(event);
                } catch (error) {
                    console.error('[测试] 事件解析错误:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('[测试] WebSocket错误:', error);
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('[测试] WebSocket连接已关闭');
            });
        });
    }

    handleEvent(event) {
        console.log(`[测试] 收到事件: ${event.type}`, event);
        this.receivedEvents.push(event);

        switch (event.type) {
            case 'monitoring_started':
                this.testResults.monitoringStarted = true;
                this.testResults.monitoringStartedTime = new Date();
                console.log('[测试] ✅ 监控开始事件已收到');
                break;

            case 'monitoring_ended':
                this.testResults.monitoringEnded = true;
                this.testResults.monitoringEndedTime = new Date();

                if (this.testResults.monitoringStartedTime) {
                    this.testResults.monitoringDuration =
                        this.testResults.monitoringEndedTime - this.testResults.monitoringStartedTime;
                }

                console.log('[测试] ✅ 监控结束事件已收到');
                console.log('[测试] 📊 监控持续时间:',
                    this.testResults.monitoringDuration ?
                    `${(this.testResults.monitoringDuration / 1000).toFixed(1)}秒` :
                    '未知');
                console.log('[测试] 📊 停止原因:', event.reason || event.message || '未指定');
                break;

            case 'monitoring_progress':
                console.log('[测试] 📈 监控进度:', event.message);
                break;

            case 'verification_code_found':
                console.log('[测试] 🎯 发现验证码:', event.code);
                break;
        }
    }

    async triggerMonitoring() {
        console.log('\n[测试] 🚀 触发监控测试');

        try {
            // 模拟复制邮箱触发监控
            const response = await fetch('http://localhost:3001/api/monitor/copy-trigger', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sessionId: CONFIG.sessionId,
                    account_id: 'test_account_id',
                    email: CONFIG.testEmail,
                    client_id: 'test_client_id',
                    refresh_token: 'test_refresh_token',
                    current_status: 'authorized',
                    access_token: 'test_access_token'
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log('[测试] 监控触发响应:', result);
                return true;
            } else {
                console.error('[测试] 监控触发失败:', response.status);
                return false;
            }
        } catch (error) {
            console.error('[测试] 监控触发异常:', error);
            return false;
        }
    }

    async waitForMonitoringEnd(timeout = 70000) { // 70秒超时，比监控时间长
        console.log(`\n[测试] ⏳ 等待监控结束 (超时: ${timeout}ms)`);

        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.testResults.monitoringEnded) {
                    clearInterval(checkInterval);
                    resolve(this.receivedEvents);
                    return;
                }
            }, 1000);

            // 超时处理
            setTimeout(() => {
                clearInterval(checkInterval);
                console.log(`[测试] ⏰ 等待超时，未收到监控结束事件`);
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
            events: this.receivedEvents,
            success: this.testResults.monitoringStarted && this.testResults.monitoringEnded
        };
    }
}

// 主测试函数
async function runMonitoringTimeoutTest() {
    console.log('🧪 开始监控超时测试');
    console.log('=' .repeat(60));

    const tester = new MonitoringTimeoutTest();

    try {
        // 1. 连接WebSocket
        await tester.connect();
        console.log('✅ WebSocket连接成功');

        // 2. 触发监控
        const triggerSuccess = await tester.triggerMonitoring();
        if (!triggerSuccess) {
            throw new Error('监控触发失败');
        }
        console.log('✅ 监控触发成功');

        // 3. 等待监控结束
        const events = await tester.waitForMonitoringEnd(70000); // 70秒

        // 4. 分析结果
        const results = tester.getTestResults();
        console.log('\n📊 测试结果分析:');
        console.log('- 监控开始:', results.testResults.monitoringStarted ? '✅' : '❌');
        console.log('- 监控结束:', results.testResults.monitoringEnded ? '✅' : '❌');
        console.log('- 总事件数:', results.eventCount);
        console.log('- 监控持续时间:',
            results.testResults.monitoringDuration ?
            `${(results.testResults.monitoringDuration / 1000).toFixed(1)}秒` :
            '未知');

        // 5. 检查是否超时结束
        if (results.testResults.monitoringDuration) {
            const durationSeconds = results.testResults.monitoringDuration / 1000;
            if (durationSeconds >= 55 && durationSeconds <= 65) {
                console.log('✅ 监控持续时间符合预期 (约60秒)');
            } else {
                console.log('⚠️ 监控持续时间异常:', durationSeconds.toFixed(1) + '秒');
            }
        }

        // 6. 检查监控结束事件
        const endEvent = results.events.find(e => e.type === 'monitoring_ended');
        if (endEvent) {
            console.log('✅ 监控结束事件格式正常');
            console.log('  - 账户ID:', endEvent.account_id);
            console.log('  - 邮箱:', endEvent.email);
            console.log('  - 停止原因:', endEvent.reason || endEvent.message);
            console.log('  - 时间戳:', endEvent.timestamp);
        } else {
            console.log('❌ 未收到监控结束事件');
        }

        // 7. 总结
        console.log('\n🎯 测试结论:');
        if (results.success) {
            console.log('✅ 监控超时功能正常工作');
            console.log('✅ 前端应该能正确更新"监控中"指标');
        } else {
            console.log('❌ 监控超时功能存在问题');
            console.log('❌ 前端"监控中"指标可能无法正确更新');
        }

        console.log('\n📝 建议:');
        if (!results.testResults.monitoringEnded) {
            console.log('- 检查1分钟超时逻辑是否正确发送事件');
            console.log('- 检查前端是否正确处理monitoring_ended事件');
            console.log('- 检查前端updateStats()函数是否被调用');
        }

    } catch (error) {
        console.error('❌ 测试执行失败:', error);
    } finally {
        tester.disconnect();
    }
}

// 运行测试
if (require.main === module) {
    runMonitoringTimeoutTest().catch(console.error);
}

module.exports = { MonitoringTimeoutTest, runMonitoringTimeoutTest };