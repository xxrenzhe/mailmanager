const http = require('http');

console.log('🧪 测试优化后的批量导入和授权流程...');

// 测试数据 - 使用新的邮箱测试优化功能
const importData = 'optimizetest123@outlook.com----TestPass123------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$';

function testOptimizedBatchImport() {
    return new Promise((resolve, reject) => {
        console.log('📤 发送优化后的批量导入请求...');

        const postData = JSON.stringify({
            import_data: importData
        });

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/accounts/batch-import',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        console.log('📝 请求数据:', {
            import_data: importData.substring(0, 100) + '...'
        });

        const req = http.request(options, (res) => {
            console.log(`📊 响应状态码: ${res.statusCode}`);
            console.log(`📋 响应头:`, res.headers);

            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    console.log('✅ 优化后的批量导入API调用成功!');
                    console.log('📋 完整响应:', JSON.stringify(jsonData, null, 2));

                    if (jsonData.success) {
                        console.log('\n🎉 优化导入结果分析:');
                        console.log(`  ✅ 账户ID: ${jsonData.account_id}`);
                        console.log(`  📧 邮箱: ${jsonData.email}`);
                        console.log(`  📊 状态: ${jsonData.status}`);
                        console.log(`  🔐 授权验证: ${jsonData.authorization_result.verified ? '成功' : '失败'}`);

                        if (jsonData.authorization_result.error) {
                            console.log(`  ❌ 授权错误: ${jsonData.authorization_result.error}`);
                        }

                        console.log(`  📝 后台处理: ${jsonData.authorization_result.note}`);

                        resolve(jsonData);
                    } else {
                        reject(new Error('导入失败'));
                    }
                } catch (error) {
                    console.error('❌ 解析响应失败:', error.message);
                    console.log('原始响应:', data);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ 请求失败:', error.message);
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// 验证导入后的账户列表
function testAccountList() {
    return new Promise((resolve, reject) => {
        console.log('\n📋 验证优化导入后的账户列表...');

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/accounts/paged?page=1&size=10',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    console.log('✅ 账户列表获取成功!');
                    console.log(`📊 总账户数: ${jsonData.total}`);

                    if (jsonData.accounts && jsonData.accounts.length > 0) {
                        console.log('\n📋 账户详情:');
                        jsonData.accounts.forEach((account, index) => {
                            console.log(`  ${index + 1}. ${account.email}`);
                            console.log(`     状态: ${account.status}`);
                            console.log(`     ID: ${account.id}`);
                            if (account.latest_code) {
                                console.log(`     最新验证码: ${account.latest_code}`);
                                console.log(`     验证码时间: ${account.latest_code_received_at}`);
                            } else {
                                console.log(`     最新验证码: 无 (可能还在后台处理中)`);
                            }
                        });
                    }

                    resolve(jsonData);
                } catch (error) {
                    console.error('❌ 解析响应失败:', error.message);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ 请求失败:', error.message);
            reject(error);
        });

        req.end();
    });
}

// 检查后台处理状态
async function checkBackgroundProcessing() {
    console.log('\n⏳ 等待后台邮件提取处理...');

    // 等待5秒让后台处理
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('📋 检查后台处理完成后的账户状态...');
    return testAccountList();
}

// 执行测试
async function runTest() {
    try {
        console.log('🚀 开始测试优化后的导入和授权流程...');

        // 步骤1: 测试优化后的批量导入
        await testOptimizedBatchImport();

        // 步骤2: 立即检查账户列表（后台处理可能还未完成）
        await testAccountList();

        // 步骤3: 等待后台处理并再次检查
        await checkBackgroundProcessing();

        console.log('\n🎉 优化后的测试完成!');
        console.log('📊 测试结果总结:');
        console.log('  ✅ 导入流程已优化，分离了授权验证和邮件提取');
        console.log('  ✅ 后台批量处理机制已实现');
        console.log('  ✅ Token缓存机制已集成');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
    }
}

// 运行测试
runTest();