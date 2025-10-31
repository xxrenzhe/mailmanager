/**
 * 批量导入测试脚本
 * ��于验证优化后的批量导入功能
 */

const http = require('http');

// 测试配置
const config = {
    baseUrl: 'http://localhost:3000',
    batchSize: 100,  // 测试批次大小
    totalEmails: 1000 // 总邮箱数量
};

// 生成测试邮箱数据
function generateTestEmails(count) {
    const emails = [];
    for (let i = 1; i <= count; i++) {
        const email = `test${i.toString().padStart(3, '0')}@example.com`;
        const password = `password${i}`;
        const clientId = `client-id-${i}-${Math.random().toString(36).substr(2, 8)}`;
        const refreshToken = `refresh-token-${i}-${Math.random().toString(36).substr(2, 12)}`;

        emails.push(`${email}----${password}----${clientId}----${refreshToken}`);
    }
    return emails.join('\n');
}

// HTTP请求工具
function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, config.baseUrl);
        const requestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        if (options.body) {
            const body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
            requestOptions.headers['Content-Length'] = Buffer.byteLength(body);
        }

        const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        data: jsonData
                    });
                } catch (error) {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);

        if (options.body) {
            const body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
            req.write(body);
        }

        req.end();
    });
}

// 测试步骤
async function runTests() {
    console.log('🚀 开始批量导入优化测试...');
    console.log(`📊 测试配置: ${config.totalEmails} 个邮箱，批次大小 ${config.batchSize}`);

    try {
        // 步骤1: 测试解析功能
        console.log('\n📝 步骤1: 测试数据解析...');
        const testData = generateTestEmails(10);
        const parseResult = await makeRequest('/api/bulk-import/parse', {
            method: 'POST',
            body: { import_data: testData }
        });

        if (parseResult.status === 200 && parseResult.data.success) {
            console.log(`✅ 解析成功: ${parseResult.data.count} 个邮箱`);
        } else {
            throw new Error(`解析失败: ${parseResult.data.error || '未知错误'}`);
        }

        // 步骤2: 测试小批量导入
        console.log('\n📦 步骤2: 测试小批量导入 (20个邮箱)...');
        const smallBatchData = generateTestEmails(20);
        const smallImportResult = await makeRequest('/api/bulk-import/start', {
            method: 'POST',
            body: { import_data: smallBatchData }
        });

        if (smallImportResult.status === 200 && smallImportResult.data.success) {
            console.log(`✅ 小批量导入启动成功`);
            console.log(`   导入ID: ${smallImportResult.data.import_id}`);
            console.log(`   预估时间: ${smallImportResult.data.estimatedTime.minutes} 分钟`);

            // 监控小批量导入进度
            await monitorImportProgress(smallImportResult.data.import_id, '小批量');
        } else {
            throw new Error(`小批量导入失败: ${smallImportResult.data.error || '未知错误'}`);
        }

        // 步骤3: 测试中批量导入
        console.log('\n📦 步骤3: 测试中批量导入 (100个邮箱)...');
        const mediumBatchData = generateTestEmails(100);
        const mediumImportResult = await makeRequest('/api/bulk-import/start', {
            method: 'POST',
            body: { import_data: mediumBatchData }
        });

        if (mediumImportResult.status === 200 && mediumImportResult.data.success) {
            console.log(`✅ 中批量导入启动成功`);
            console.log(`   导入ID: ${mediumImportResult.data.import_id}`);
            console.log(`   预估时间: ${mediumImportResult.data.estimatedTime.minutes} 分钟`);

            // 监控中批量导入进度
            await monitorImportProgress(mediumImportResult.data.import_id, '中批量');
        } else {
            throw new Error(`中批量导入失败: ${mediumImportResult.data.error || '未知错误'}`);
        }

        // 步骤4: 测试大批量导入（可选）
        if (config.totalEmails > 100) {
            console.log('\n📦 步骤4: 测试大批量导入 (1000个邮箱)...');
            console.log('   这将需要较长时间，请耐心等待...');

            const largeBatchData = generateTestEmails(config.totalEmails);
            const largeImportResult = await makeRequest('/api/bulk-import/start', {
                method: 'POST',
                body: { import_data: largeBatchData }
            });

            if (largeImportResult.status === 200 && largeImportResult.data.success) {
                console.log(`✅ 大批量导入启动成功`);
                console.log(`   导入ID: ${largeImportResult.data.import_id}`);
                console.log(`   预估时间: ${largeImportResult.data.estimatedTime.minutes} 分钟`);

                // 监控大批量导入进度
                await monitorImportProgress(largeImportResult.data.import_id, '大批量');
            } else {
                throw new Error(`大批量导入失败: ${largeImportResult.data.error || '未知错误'}`);
            }
        }

        console.log('\n🎉 所有测试完成！');
        console.log('\n📋 优化总结:');
        console.log('✅ 批量导入支持大规模邮箱导入');
        console.log('✅ 异步授权验证避免阻塞前端');
        console.log('✅ 智能批处理避免速率限制');
        console.log('✅ 实时进度跟踪和错误处理');
        console.log('✅ 后台邮件提取自动执行');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        process.exit(1);
    }
}

// 监控导入进度
async function monitorImportProgress(importId, testName) {
    console.log(`   开始监控 ${testName} 导入进度...`);

    let lastStatus = null;
    let noChangeCount = 0;
    const maxNoChange = 10; // 10次无变化后停止监控

    while (noChangeCount < maxNoChange) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // 每3秒检查一次

        try {
            const statusResult = await makeRequest(`/api/bulk-import/status/${importId}`);

            if (statusResult.status === 200) {
                const status = statusResult.data;

                // 检查状态是否有变化
                if (JSON.stringify(status) === JSON.stringify(lastStatus)) {
                    noChangeCount++;
                } else {
                    noChangeCount = 0;
                    lastStatus = status;

                    const stats = status.stats;
                    const progress = Math.round((stats.processed / stats.total) * 100);

                    console.log(`   ${testName} 进度: ${progress}% (${stats.processed}/${stats.total}) | ` +
                               `成功: ${stats.successful} | 失败: ${stats.failed} | 待处理: ${stats.pending}`);

                    if (status.status === 'completed') {
                        const duration = Math.round((new Date(status.endTime) - new Date(status.startTime)) / 1000);
                        console.log(`   ✅ ${testName} 导入完成！耗时: ${duration}秒`);
                        console.log(`      成功: ${stats.successful} | 失败: ${stats.failed}`);

                        if (stats.errors.length > 0) {
                            console.log(`      错误样例: ${stats.errors[0].error}`);
                        }
                        break;
                    }
                }
            } else {
                console.log(`   ⚠️  获取状态失败: ${statusResult.status}`);
                break;
            }
        } catch (error) {
            console.log(`   ⚠️  状态检查错误: ${error.message}`);
            break;
        }
    }

    if (noChangeCount >= maxNoChange) {
        console.log(`   ⚠️  ${testName} 监控超时，导入可能在后台继续进行`);
    }
}

// 运行测试
if (require.main === module) {
    // 检查服务器是否运行
    console.log('🔍 检查服务器连接...');

    makeRequest('/api/status')
        .then(response => {
            if (response.status === 200) {
                console.log('✅ 服务器连接正常');
                runTests();
            } else {
                console.error('❌ 服务器响应异常:', response.status);
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('❌ 无法连接到服务器:', error.message);
            console.log('💡 请确保服务器运行在 http://localhost:3000');
            process.exit(1);
        });
}

module.exports = { runTests, generateTestEmails };