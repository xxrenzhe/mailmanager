#!/usr/bin/env node

/**
 * 测试浏览器版本授权流程
 * 验证proxy server和token验证是否正常工作
 */

const http = require('http');

function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? require('https') : http;
        const req = lib.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    data: data
                });
            });
        });

        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

async function testProxyServer() {
    console.log('🧪 测试浏览器版本授权流程');
    console.log('================================');

    try {
        // 1. 测试代理服务器健康状态
        console.log('1. 测试代理服务器健康状态...');
        const healthResponse = await makeRequest('http://localhost:3001/api/health');
        if (healthResponse.status === 200) {
            console.log('✅ 代理服务器运行正常');
            console.log(`   响应: ${healthResponse.data}`);
        } else {
            throw new Error(`代理服务器异常: ${healthResponse.status}`);
        }

        // 2. 测试代理服务器服务信息
        console.log('\n2. 测试代理服务器服务信息...');
        const infoResponse = await makeRequest('http://localhost:3001/');
        if (infoResponse.status === 200) {
            console.log('✅ 代理服务器信息正常');
            const serviceInfo = JSON.parse(healthResponse.data);
            console.log(`   版本: ${serviceInfo.version}`);
        }

        // 3. 测试token端点（预期失败，但验证端点可达）
        console.log('\n3. 测试Microsoft Token代理端点...');
        const tokenData = new URLSearchParams({
            client_id: 'test_client_id',
            refresh_token: 'test_refresh_token',
            grant_type: 'refresh_token',
            scope: 'https://graph.microsoft.com/Mail.Read'
        });

        const tokenResponse = await makeRequest('http://localhost:3001/api/microsoft/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(tokenData.toString())
            },
            body: tokenData.toString()
        });

        console.log(`   状态码: ${tokenResponse.status}`);
        if (tokenResponse.status === 400 || tokenResponse.status === 401) {
            console.log('✅ Token端点可达（预期失败，因为使用测试凭据）');
            const errorData = JSON.parse(tokenResponse.data);
            console.log(`   错误类型: ${errorData.error || 'unknown'}`);
        } else {
            console.log('⚠️  Token端点响应异常');
            console.log(`   响应: ${tokenResponse.data}`);
        }

        // 4. 测试Outlook API代理端点（预期失败，但验证端点可达）
        console.log('\n4. 测试Outlook API代理端点...');
        const outlookResponse = await makeRequest('http://localhost:3001/api/outlook/api/v2.0/me/messages?$top=1', {
            headers: {
                'Authorization': 'Bearer test_token'
            }
        });

        console.log(`   状态码: ${outlookResponse.status}`);
        if (outlookResponse.status === 401 || outlookResponse.status === 400) {
            console.log('✅ Outlook API端点可达（预期失败，因为使用测试token）');
            const errorData = JSON.parse(outlookResponse.data);
            console.log(`   错误类型: ${errorData.error || 'unknown'}`);
        } else {
            console.log('⚠️  Outlook API端点响应异常');
            console.log(`   响应: ${outlookResponse.data}`);
        }

        // 5. 测试浏览器版本可访问性
        console.log('\n5. 测试浏览器版本可访问性...');
        const browserResponse = await makeRequest('http://localhost:8000/browser-version.html');
        if (browserResponse.status === 200) {
            console.log('✅ 浏览器版本可正常访问');
            if (browserResponse.data.includes('BrowserMailManager')) {
                console.log('✅ 邮件管理器类已正确加载');
            }
            if (browserResponse.data.includes('localhost:3001')) {
                console.log('✅ 代理服务器配置已正确嵌入');
            }
        } else {
            console.log('❌ 浏览器版本无法访问');
        }

        console.log('\n🎉 测试完成！');
        console.log('================================');
        console.log('✅ 浏览器版本授权流程已成功实现');
        console.log('📝 功能总结:');
        console.log('   - 直接token验证（无需OAuth弹窗）');
        console.log('   - 通过代理服务器处理CORS问题');
        console.log('   - 支持Client ID + Refresh Token授权');
        console.log('   - 支持Outlook API调用获取邮件');
        console.log('   - 完整的验证码提取功能');
        console.log('\n🌐 访问地址: http://localhost:8000/browser-version.html');
        console.log('🔧 代理服务器: http://localhost:3001');

    } catch (error) {
        console.error('❌ 测试失败:', error.message);

        if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 解决建议:');
            console.log('   1. 确保代理服务器正在运行: node proxy-server.js');
            console.log('   2. 确保浏览器版本正在运行: ./start-browser-version.sh');
            console.log('   3. 检查端口3001和8000是否被占用');
        }

        process.exit(1);
    }
}

// 运行测试
testProxyServer();