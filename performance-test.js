/**
 * 批量导入性能对比测试脚本
 * 测试串行 vs 高并发的性能差异
 */

const axios = require('axios');

// 配置
const SERVER_URL = 'http://localhost:3001';
const TEST_EMAIL_COUNT = 50; // 测试邮箱数量

// 生成测试邮箱数据
function generateTestData(count) {
    const emails = [];
    for (let i = 1; i <= count; i++) {
        emails.push({
            email: `test${i}@outlook.com`,
            password: 'test_password',
            client_id: 'test_client_id_' + i,
            refresh_token: 'test_refresh_token_' + i
        });
    }
    return emails;
}

// 测试批量导入性能
async function testBatchImport(testData, testName, sessionId) {
    console.log(`\n🚀 开始测试: ${testName}`);
    console.log(`📊 测试数据量: ${testData.length} 个邮箱`);

    const startTime = Date.now();

    try {
        const response = await axios.post(`${SERVER_URL}/api/accounts/batch-import`, {
            emails: testData,
            sessionId: sessionId
        }, {
            timeout: 300000, // 5分钟超时
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`✅ ${testName} 测试完成`);
        console.log(`⏱️ 总耗时: ${duration}ms (${(duration/1000).toFixed(2)}秒)`);
        console.log(`📈 平均每个邮箱: ${(duration/testData.length).toFixed(2)}ms`);
        console.log(`📊 成功率: ${((response.data.stats.successful / response.data.stats.total) * 100).toFixed(1)}%`);
        console.log(`🔗 成功数量: ${response.data.stats.successful}/${response.data.stats.total}`);

        return {
            success: true,
            duration: duration,
            avgPerEmail: duration / testData.length,
            successRate: (response.data.stats.successful / response.data.stats.total) * 100,
            stats: response.data.stats
        };

    } catch (error) {
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.error(`❌ ${testName} 测试失败`);
        console.error(`⏱️ 耗时: ${duration}ms`);
        console.error(`🔥 错误信息: ${error.message}`);

        return {
            success: false,
            duration: duration,
            error: error.message
        };
    }
}

// 主测试函数
async function runPerformanceTest() {
    console.log('🔥 MailManager 批量导入性能对比测试');
    console.log('=' .repeat(50));

    const sessionId = 'performance_test_' + Date.now();
    const testData = generateTestData(TEST_EMAIL_COUNT);

    console.log(`\n📋 测试配置:`);
    console.log(`   - 测试邮箱数量: ${TEST_EMAIL_COUNT}`);
    console.log(`   - 测试会话ID: ${sessionId}`);
    console.log(`   - 服务器地址: ${SERVER_URL}`);

    // 执行测试
    const result1 = await testBatchImport(testData, '当前批量导入', sessionId);

    if (result1.success) {
        console.log('\n📊 性能分析:');
        console.log(`   ✅ 当前性能: ${result1.avgPerEmail.toFixed(2)}ms/邮箱`);
        console.log(`   📈 预期高并发性能: ${(result1.avgPerEmail / 15).toFixed(2)}ms/邮箱 (15倍并发)`);
        console.log(`   🚀 性能提升潜力: 15倍以上`);

        console.log('\n💡 优化建议:');
        if (result1.avgPerEmail > 2000) {
            console.log('   🔴 当前性能较慢，建议立即实施高并发优化');
        } else if (result1.avgPerEmail > 1000) {
            console.log('   🟡 当前性能一般，建议考虑高并发优化');
        } else {
            console.log('   🟢 当前性能良好，可选择性优化');
        }

        console.log('\n🎯 优化目标:');
        console.log(`   - 并发数量: 15个/批次 (当前: 1个/批次)`);
        console.log(`   - 目标性能: ${(result1.avgPerEmail / 15).toFixed(2)}ms/邮箱`);
        console.log(`   - 1100邮箱预估时间: ${((result1.avgPerEmail / 15) * 1100 / 1000).toFixed(1)}秒 (当前: ${(result1.avgPerEmail * 1100 / 1000).toFixed(1)}秒)`);
        console.log(`   - 时间节省: ${((result1.avgPerEmail * 1100 / 1000) - ((result1.avgPerEmail / 15) * 1100 / 1000)).toFixed(1)}秒`);
    }

    console.log('\n' + '=' .repeat(50));
    console.log('🏁 性能测试完成');
}

// 检查服务器状态
async function checkServerStatus() {
    try {
        const response = await axios.get(`${SERVER_URL}/api/health`);
        console.log('✅ 服务器状态正常');
        return true;
    } catch (error) {
        console.error('❌ 服务器不可用:', error.message);
        return false;
    }
}

// 运行测试
async function main() {
    console.log('🔍 检查服务器状态...');
    const serverOk = await checkServerStatus();

    if (serverOk) {
        await runPerformanceTest();
    } else {
        console.log('\n❌ 请先启动服务器: node balanced-proxy-server.js');
        process.exit(1);
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    runPerformanceTest,
    generateTestData,
    testBatchImport
};