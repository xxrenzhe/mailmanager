const http = require('http');

// 用户提供的导入数据
const importData = "JoelGrundydi@outlook.com----MOoyopg947------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$$";

// 解析导入数据
const parts = importData.split('----');
const [email, password, client_id, refresh_token_enc] = parts;

console.log('解析导入数据:');
console.log('邮箱:', email);
console.log('密码:', password);
console.log('Client ID:', client_id);
console.log('Refresh Token:', refresh_token_enc.substring(0, 50) + '...');

// 首先检查账户是否已存在，如果存在就删除
console.log('\n检查现有账户...');
const checkReq = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/accounts/paged',
    method: 'GET'
}, (checkRes) => {
    let checkBody = '';
    checkRes.on('data', (chunk) => checkBody += chunk);
    checkRes.on('end', () => {
        const accounts = JSON.parse(checkBody);
        const existingAccount = accounts.accounts.find(a => a.email === email);

        if (existingAccount) {
            console.log(`发现现有账户，删除: ${email} (ID: ${existingAccount.id})`);
            const deleteReq = http.request({
                hostname: 'localhost',
                port: 3000,
                path: `/api/accounts/${existingAccount.id}`,
                method: 'DELETE'
            }, (deleteRes) => {
                deleteRes.on('data', () => {});
                deleteRes.on('end', () => {
                    console.log('现有账户已删除');
                    importNewAccount();
                });
            });
            deleteReq.end();
        } else {
            console.log('账户不存在，直接导入');
            importNewAccount();
        }
    });
});
checkReq.end();

function importNewAccount() {
    console.log('\n开始导入新账户...');

    const postData = JSON.stringify({
        email: email.trim(),
        client_id: client_id.trim(),
        refresh_token_enc: refresh_token_enc.trim(),
        status: 'authorized'
    });

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/accounts/batch',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        console.log(`导入状态码: ${res.statusCode}`);

        res.setEncoding('utf8');
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            const result = JSON.parse(body);
            console.log('导入结果:', result);

            if (result.success) {
                console.log('\n✅ 账户导入成功，开始测试真实邮件API...');
                testRealEmailAPI(result.account_id);
            } else {
                console.log('❌ 账户导入失败:', result.message);
            }
        });
    });

    req.on('error', (e) => {
        console.error('导入请求失败:', e.message);
    });

    req.write(postData);
    req.end();
}

function testRealEmailAPI(accountId) {
    console.log('\n🚀 开始测试真实邮件API...');

    // 等待2秒让系统稳定
    setTimeout(() => {
        console.log('触发邮件监控...');
        const monitorReq = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/api/monitor/copy-trigger',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, (monitorRes) => {
            let monitorBody = '';
            monitorRes.on('data', (chunk) => monitorBody += chunk);
            monitorRes.on('end', () => {
                const monitorResult = JSON.parse(monitorBody);
                console.log('监控启动结果:', monitorResult);

                if (monitorResult.success) {
                    console.log('✅ 监控启动成功，等待邮件检查结果...');

                    // 等待5秒后检查结果
                    setTimeout(() => {
                        checkEmailResults(accountId);
                    }, 5000);
                }
            });
        });

        const monitorData = JSON.stringify({ account_id: accountId });
        monitorReq.write(monitorData);
        monitorReq.end();
    }, 2000);
}

function checkEmailResults(accountId) {
    console.log('\n📧 检查邮件收件结果...');

    const checkReq = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/accounts/paged',
        method: 'GET'
    }, (checkRes) => {
        let checkBody = '';
        checkRes.on('data', (chunk) => checkBody += chunk);
        checkRes.on('end', () => {
            const accounts = JSON.parse(checkBody);
            const account = accounts.accounts.find(a => a.id === accountId);

            if (account) {
                console.log(`\n📊 账户 ${account.email} 的状态:`);
                console.log(`  最后活跃时间: ${account.last_active_at}`);
                console.log(`  最新验证码: ${account.latest_code || '无'}`);
                console.log(`  验证码收件时间: ${account.latest_code_received_at || '无'}`);
                console.log(`  发件人: ${account.latest_code_sender || '无'}`);

                if (account.latest_code) {
                    console.log('\n🎉 成功！真实邮件API工作正常，已提取到验证码:', account.latest_code);
                } else {
                    console.log('\n⚠️  未发现验证码，可能是因为：');
                    console.log('  1. 账户的refresh token无效或已过期');
                    console.log('  2. 最近24小时内没有包含验证码的邮件');
                    console.log('  3. OAuth权限问题');
                }
            }

            console.log('\n🏁 测试完成！');
        });
    });
    checkReq.end();
}