/**
 * 测试时间过滤功能
 * 验证复制邮箱触发监控时是否正确使用历史邮件时间作为过滤基准
 */

const WebSocket = require('ws');

const CONFIG = {
    wsUrl: 'ws://localhost:3002/ws',
    baseUrl: 'http://localhost:3001',
    testAccount: {
        id: 'test_time_filter_' + Date.now(),
        email: 'test@example.com',
        client_id: 'test_client_id',
        refresh_token: 'test_refresh_token',
        status: 'authorized',
        access_token: 'test_access_token',
        // 模拟历史邮件数据
        codes: [
            {
                code: '123456',
                received_at: '2024-08-15T10:00:00.000Z',
                sender: 'service@example.com'
            },
            {
                code: '789012',
                received_at: '2024-08-15T09:30:00.000Z',
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
    }
};

class TimeFilterTest {
    constructor() {
        this.ws = null;
        this.receivedEvents = [];
        this.testStartTime = new Date();
    }

    connect() {
        console.log('🔗 连接WebSocket...');
        this.ws = new WebSocket(CONFIG.wsUrl);

        return new Promise((resolve, reject) => {
            this.ws.on('open', () => {
                console.log('✅ WebSocket连接成功');
                resolve();
            });

            this.ws.on('message', (data) => {
                const event = JSON.parse(data.toString());
                this.handleEvent(event);
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket错误:', error);
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('🔌 WebSocket连接关闭');
            });
        });
    }

    handleEvent(event) {
        this.receivedEvents.push(event);
        const timestamp = new Date().toLocaleTimeString();

        console.log(`\n[${timestamp}] 📨 收到事件:`, event.type);

        switch (event.type) {
            case 'monitoring_started':
                console.log(`🚀 监控开始: ${event.email}`);
                console.log(`   操作: ${event.action}`);
                console.log(`   消息: ${event.message}`);
                break;

            case 'monitoring_progress':
                console.log(`📊 监控进度: ${event.email}`);
                console.log(`   检查次数: ${event.check_count}`);
                console.log(`   消息: ${event.message}`);
                if (event.account_status) {
                    console.log(`   账户状态: ${event.account_status}`);
                }
                break;

            case 'verification_code_found':
                console.log(`🎯 发现验证码: ${event.code}`);
                console.log(`   发件人: ${event.sender}`);
                console.log(`   收件时间: ${event.received_at}`);
                console.log(`   优先级: ${event.priority}`);
                break;

            case 'monitoring_stopped':
                console.log(`��️ 监控停止: ${event.email}`);
                console.log(`   原因: ${event.reason}`);
                console.log(`   持续时间: ${event.duration_ms}ms`);
                break;

            default:
                console.log('   事件数据:', JSON.stringify(event, null, 2));
        }
    }

    async testTimeFilter() {
        console.log('\n🧪 开始测试时间过滤功能...');
        console.log('=' .repeat(60));

        console.log('\n📋 测试配置:');
        console.log(`   账户: ${CONFIG.testAccount.email}`);
        console.log(`   最新验证码时间: ${CONFIG.testAccount.latest_code_received_at}`);
        console.log(`   历史验证码数量: ${CONFIG.testAccount.codes.length}`);
        console.log(`   历史邮件数量: ${CONFIG.testAccount.emails.length}`);

        try {
            // 1. 触发监控
            console.log('\n🎯 步骤1: 触发复制邮箱监控');
            const response = await fetch(`${CONFIG.baseUrl}/api/monitor/copy-trigger`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: 'test_session_' + Date.now(),
                    account_id: CONFIG.testAccount.id,
                    email: CONFIG.testAccount.email,
                    client_id: CONFIG.testAccount.client_id,
                    refresh_token: CONFIG.testAccount.refresh_token,
                    current_status: CONFIG.testAccount.status,
                    access_token: CONFIG.testAccount.access_token,
                    // 关键：传递历史邮件数据
                    codes: CONFIG.testAccount.codes,
                    emails: CONFIG.testAccount.emails,
                    latest_code_received_at: CONFIG.testAccount.latest_code_received_at,
                    last_active_at: CONFIG.testAccount.last_active_at
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ 监控触发成功');
                console.log(`   消息: ${result.message}`);
                console.log(`   监控ID: ${result.monitorId}`);
            } else {
                throw new Error(`触发失败: ${response.status}`);
            }

            // 2. 等待监控事件
            console.log('\n⏳ 步骤2: 等待监控事件（60秒）...');
            await this.waitForMonitoringEvents(60000);

            // 3. 分析结果
            console.log('\n📊 步骤3: 分析测试结果');
            this.analyzeResults();

        } catch (error) {
            console.error('❌ 测试失败:', error);
        }
    }

    async waitForMonitoringEvents(timeoutMs) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log('⏰ 监控等待超时');
                resolve();
            }, timeoutMs);

            // 监听监控停止事件
            this.ws.on('message', (data) => {
                const event = JSON.parse(data.toString());
                if (event.type === 'monitoring_stopped') {
                    clearTimeout(timeout);
                    setTimeout(resolve, 1000); // 额外等待1秒收集所有事件
                }
            });
        });
    }

    analyzeResults() {
        console.log('\n📈 测试结果分析:');
        console.log('=' .repeat(60));

        const events = this.receivedEvents;
        console.log(`总事件数: ${events.length}`);

        // 统计事件类型
        const eventTypes = {};
        events.forEach(event => {
            eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
        });

        console.log('\n事件类型统计:');
        Object.entries(eventTypes).forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
        });

        // 检查关键事件
        const monitoringStarted = events.find(e => e.type === 'monitoring_started');
        const verificationCodes = events.filter(e => e.type === 'verification_code_found');
        const monitoringStopped = events.find(e => e.type === 'monitoring_stopped');

        console.log('\n关键事件检查:');

        if (monitoringStarted) {
            console.log('✅ 监控启动事件: 收到');
            console.log(`   启动时间: ${monitoringStarted.timestamp}`);
        } else {
            console.log('❌ 监控启动事件: 未收到');
        }

        if (verificationCodes.length > 0) {
            console.log(`✅ 验证码发现事件: ${verificationCodes.length}个`);
            verificationCodes.forEach((code, index) => {
                console.log(`   ${index + 1}. ${code.code} (${code.received_at})`);
            });
        } else {
            console.log('ℹ️ 验证码发现事件: 无（可能时间过滤生效或测试环境限制）');
        }

        if (monitoringStopped) {
            console.log('✅ 监控停止事件: 收到');
            console.log(`   停止原因: ${monitoringStopped.reason}`);
            console.log(`   监控时长: ${monitoringStopped.duration_ms}ms`);
        } else {
            console.log('ℹ️ 监控停止事件: 未收到（可能仍在运行）');
        }

        // 时间过滤效果验证
        console.log('\n🎯 时间过滤效果验证:');
        console.log(`测试开始时间: ${this.testStartTime.toISOString()}`);
        console.log(`历史最新验证码: ${CONFIG.testAccount.latest_code_received_at}`);

        const timeDiff = new Date(this.testStartTime) - new Date(CONFIG.testAccount.latest_code_received_at);
        console.log(`时间差距: ${Math.round(timeDiff / 1000 / 60)} 分钟`);

        if (verificationCodes.length > 0) {
            const latestCode = verificationCodes[0];
            const codeTime = new Date(latestCode.received_at);
            const baseTime = new Date(CONFIG.testAccount.latest_code_received_at);

            if (codeTime > baseTime) {
                console.log('✅ 时间过滤生效：只获取了比历史基准更新的验证码');
            } else {
                console.log('⚠️ 时间过滤可能未生效：获取的验证码时间早于或等于历史基准');
            }
        } else {
            console.log('ℹ️ 无新验证码：时间过滤可能阻止了历史邮件重复获取');
        }

        console.log('\n🏁 测试完成！');
    }

    async cleanup() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

async function runTest() {
    const test = new TimeFilterTest();

    try {
        await test.connect();
        await test.testTimeFilter();
    } catch (error) {
        console.error('测试执行失败:', error);
    } finally {
        await test.cleanup();
    }
}

console.log('🚀 邮件监控时间过滤功能测试');
console.log('=' .repeat(60));
console.log('测试目标：验证复制邮箱触发监控时正确使用历史邮件时间作为过滤基准');
console.log('');

runTest().then(() => {
    console.log('\n✨ 测试脚本执行完毕');
    process.exit(0);
}).catch(error => {
    console.error('💥 测试脚本执行失败:', error);
    process.exit(1);
});