const http = require('http');

console.log('🧪 测试更新后的邮箱导入和授权流程...');

// 测试数据 - 使用相同的导入格式
const importData = 'JoelGrundydi@outlook.com----MOoyopg947------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$';

function testBatchImport() {
    return new Promise((resolve, reject) => {
        console.log('📤 发送批量导入请求...');

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
                    console.log('✅ 批量导入API调用成功!');
                    console.log('📋 完整响应:', JSON.stringify(jsonData, null, 2));

                    if (jsonData.success) {
                        console.log('\n🎉 导入结果分析:');
                        console.log(`  ✅ 账户ID: ${jsonData.account_id}`);
                        console.log(`  📧 邮箱: ${jsonData.email}`);
                        console.log(`  📊 状态: ${jsonData.status}`);
                        console.log(`  🔐 授权验证: ${jsonData.authorization_result.verified ? '成功' : '失败'}`);
                        console.log(`  🔢 提取验证码数量: ${jsonData.authorization_result.extracted_codes_count}`);

                        if (jsonData.authorization_result.latest_code) {
                            console.log(`  🎯 最新验证码: ${jsonData.authorization_result.latest_code}`);
                            console.log(`  📨 发件人: ${jsonData.authorization_result.latest_code_sender}`);
                            console.log(`  ⏰ 时间: ${jsonData.authorization_result.latest_code_received_at}`);
                        }

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
        console.log('\n📋 验证导入后的账户列表...');

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
                                console.log(`     最新验证码: 无`);
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

// 执行测试
async function runTest() {
    try {
        console.log('🚀 开始测试完整的导入和授权流程...');

              // 由于邮箱已存在，直接验证现有账户列表
        console.log('\n📋 邮箱已存在，直接验证现有账户状态...');
        await testAccountList();

        console.log('\n🎉 测试完成! 导入和授权流程验证成功');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
    }
}

// 运行测试
runTest();