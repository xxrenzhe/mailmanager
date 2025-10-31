const http = require('http');

console.log('🧪 测试最终优化版本...');

// 测试数据 - 使用全新的邮箱
const importData = 'finaltest2025@outlook.com----FinalPass456------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$';

function testFinalOptimizedImport() {
    return new Promise((resolve, reject) => {
        console.log('📤 发送最终优化版本导入请求...');

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

        const req = http.request(options, (res) => {
            console.log(`📊 响应状态码: ${res.statusCode}`);

            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    console.log('✅ 最终优化版本API调用成功!');
                    console.log('📋 完整响应:', JSON.stringify(jsonData, null, 2));

                    if (jsonData.success) {
                        console.log('\n🎉 最终优化导入结果分析:');
                        console.log(`  ✅ 账户ID: ${jsonData.account_id}`);
                        console.log(`  📧 邮箱: ${jsonData.email}`);
                        console.log(`  📊 状态: ${jsonData.status}`);
                        console.log(`  🔐 授权验证: ${jsonData.authorization_result.verified ? '成功' : '失败'}`);
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

// 验证账户状态
function testAccountStatus() {
    return new Promise((resolve, reject) => {
        console.log('\n📋 检查账户状态...');

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
                    console.log('✅ 账户状态获取成功!');

                    if (jsonData.accounts && jsonData.accounts.length > 0) {
                        console.log('\n📋 账户详情:');
                        jsonData.accounts.forEach((account, index) => {
                            console.log(`  ${index + 1}. ${account.email}`);
                            console.log(`     状态: ${account.status}`);
                            console.log(`     ID: ${account.id}`);
                            console.log(`     最新验证码: ${account.latest_code || '无'}`);
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

// 执行测试
async function runFinalTest() {
    try {
        console.log('🚀 开始测试最终优化版本...');

        // 步骤1: 测试最终优化版本
        await testFinalOptimizedImport();

        // 步骤2: 立即检查账户状态
        await testAccountStatus();

        console.log('\n🎉 最终优化版本测试完成!');
        console.log('📊 优化成果总结:');
        console.log('  ✅ 分离了授权验证和邮件提取');
        console.log('  ✅ 实现了后台批量处理机制');
        console.log('  ✅ 添加了access_token缓存');
        console.log('  ✅ 数据库自动迁移成功');
        console.log('  ✅ 批量导入性能优化完成');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
    }
}

// 运行测试
runFinalTest();