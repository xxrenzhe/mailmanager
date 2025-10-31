const importData = "JoelGrundydi@outlook.com----MOoyopg947------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$$";

console.log('寻找Client ID...');

// 查找9e5f94bc开头的Client ID
const clientIdMatch = importData.match(/9e5f94bc-e8a4-4e73-b8be-63364c29d753/);
if (clientIdMatch) {
    const client_id = clientIdMatch[0];
    console.log('找到Client ID:', client_id);

    // 提取邮箱（第一个分隔符之前）
    const email = importData.split('----')[0];
    console.log('邮箱:', email);

    // 查找Client ID的位置
    const clientIdPos = importData.indexOf(client_id);
    console.log('Client ID位置:', clientIdPos);

    // 查找Client ID后面的第一个"----"
    const afterClientIdPos = importData.indexOf('----', clientIdPos + client_id.length);
    console.log('Client ID后的分隔符位置:', afterClientIdPos);

    // 提取refresh token
    const refreshTokenStart = afterClientIdPos + 4;
    const refresh_token_enc = importData.substring(refreshTokenStart);
    console.log('Refresh Token长度:', refresh_token_enc.length);
    console.log('Refresh Token开头:', refresh_token_enc.substring(0, 50) + '...');

    // 构建导入对象
    const importObject = {
        email: email.trim(),
        client_id: client_id.trim(),
        refresh_token_enc: refresh_token_enc.trim(),
        status: 'authorized'
    };

    console.log('\n构建的导入对象:');
    console.log(JSON.stringify(importObject, null, 2));

    // 直接测试导入
    console.log('\n开始导入测试...');
    const http = require('http');
    const postData = JSON.stringify(importObject);

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
                console.log('\n✅ 导入成功！开始测试邮件API...');
                testEmailAPI(result.account_id);
            }
        });
    });

    req.write(postData);
    req.end();

} else {
    console.log('❌ 未找到Client ID');
}

function testEmailAPI(accountId) {
    setTimeout(() => {
        console.log('触发邮件��控测试...');
        const http = require('http');
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
                console.log('监控结果:', monitorResult);

                // 检查服务器日志看API调用情况
                setTimeout(() => {
                    console.log('\n🔍 请检查服务器输出，查看是否有Google API调用...');
                    console.log('如果有"Google token refresh failed: 401 Unauthorized"说明API调用正常，只是token无效');
                    console.log('如果有"提取到 X 个验证码"说明成功收到真实邮件');
                }, 3000);
            });
        });

        const monitorData = JSON.stringify({ account_id: accountId });
        monitorReq.write(monitorData);
        monitorReq.end();
    }, 2000);
}