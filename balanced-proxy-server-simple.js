/**
 * 简化版代理服务器 - 纯前端架构
 * 只提供API代理功能，不存储任何数据
 */

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const WebSocket = require('ws');
const https = require('https');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PROXY_PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// 基础中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// WebSocket服务器（仅用于前端事件通知）
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`🔌 WebSocket服务器已启动 - 端口: ${WS_PORT}`);

// WebSocket连接处理
wss.on('connection', (ws) => {
    console.log('📱 WebSocket客户端已连接');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 收到WebSocket消息:', data);

            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (error) {
            console.error('WebSocket消息处理错误:', error);
        }
    });

    ws.on('close', () => {
        console.log('📱 WebSocket客户端已断开');
    });

    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
    });
});

// ========== Microsoft OAuth 代理 ==========

// 1. OAuth授权页面代理
app.get('/oauth/authorize', (req, res) => {
    const { client_id, redirect_uri, scope, response_type, state } = req.query;

    if (!client_id) {
        return res.status(400).send('缺少client_id参数');
    }

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${querystring.stringify({
        client_id,
        redirect_uri,
        scope,
        response_type,
        state
    })}`;

    res.redirect(authUrl);
});

// 2. OAuth回调处理
app.get('/oauth/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).send(`授权失败: ${error}`);
    }

    if (!code) {
        return res.status(400).send('缺少授权码');
    }

    res.send(`
        <html>
        <head>
            <title>授权成功</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
                .success { color: #4CAF50; font-size: 18px; }
                .code { background: #f0f0f0; padding: 10px; border-radius: 5px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <h1 class="success">✅ 授权成功</h1>
            <p>您的授权��是：</p>
            <div class="code">${code}</div>
            <p>请复制此授权码并返回应用中完成授权流程。</p>
            <p><button onclick="window.close()">关闭窗口</button></p>
        </body>
        </html>
    `);
});

// 3. Token交换代理
app.post('/oauth/token', async (req, res) => {
    const { client_id, client_secret, code, redirect_uri, grant_type, refresh_token } = req.body;

    try {
        let tokenData;

        if (grant_type === 'authorization_code' && code) {
            // 授权码交换访问令牌
            tokenData = await exchangeCodeForToken(code, client_id, client_secret, redirect_uri);
        } else if (grant_type === 'refresh_token' && refresh_token) {
            // 刷新令牌
            tokenData = await refreshToken(refresh_token, client_id, client_secret);
        } else {
            return res.status(400).json({ error: '无效的grant_type或缺少必要参数' });
        }

        res.json(tokenData);

    } catch (error) {
        console.error('Token交换失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// Microsoft Graph API代理
app.use('/graph', createProxyMiddleware({
    target: 'https://graph.microsoft.com',
    changeOrigin: true,
    pathRewrite: {
        '^/graph': '/v1.0'
    },
    onProxyReq: (proxyReq, req, res) => {
        // 设置CORS头
        proxyReq.setHeader('Origin', 'https://graph.microsoft.com');
    },
    onError: (err, req, res) => {
        console.error('Graph API代理错误:', err);
        res.status(500).json({ error: 'Graph API请求失败' });
    }
}));

// ========== 辅助函数 ==========

// 授权码交换访问令牌
async function exchangeCodeForToken(code, clientId, clientSecret, redirectUri) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });

        const options = {
            hostname: 'login.microsoftonline.com',
            port: 443,
            path: '/common/oauth2/v2.0/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const tokenData = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(tokenData);
                    } else {
                        reject(new Error(`Token请求失败: ${res.statusCode} - ${tokenData.error_description || tokenData.error}`));
                    }
                } catch (error) {
                    reject(new Error(`Token响应解析失败: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.write(postData);
        req.end();
    });
}

// 刷新访问令牌
async function refreshToken(refreshToken, clientId, clientSecret) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        });

        const options = {
            hostname: 'login.microsoftonline.com',
            port: 443,
            path: '/common/oauth2/v2.0/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const tokenData = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(tokenData);
                    } else {
                        reject(new Error(`Token刷新失败: ${res.statusCode} - ${tokenData.error_description || tokenData.error}`));
                    }
                } catch (error) {
                    reject(new Error(`Token刷新响应解析失败: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.write(postData);
        req.end();
    });
}

// ========== 路由配置 ==========

// 根路由 - 提供主页面
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/simple-mail-manager.html');
});

// ========== 简化的API端点 ==========

// 简单的邮箱验证API
app.post('/api/validate-email', (req, res) => {
    const { email } = req.body;

    // 简单的邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(email);

    res.json({
        valid: isValid,
        email: email
    });
});

// 批量导入API - 完整处理版本（授权+取件+验证码提取）
app.post('/api/accounts/batch-import', async (req, res) => {
    try {
        const { emails, sessionId } = req.body;

        console.log(`[批量导入] 开始处理 ${emails ? emails.length : 0} 个邮箱的完整流程`);

        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({
                success: false,
                error: '请提供有效的邮箱数组'
            });
        }

        const AUTH_BATCH_SIZE = 10; // 10个并发授权（避免API限制）
        const results = [];
        let successCount = 0;
        let failureCount = 0;

        // 分批高并发处理邮箱授权和取件
        for (let i = 0; i < emails.length; i += AUTH_BATCH_SIZE) {
            const batch = emails.slice(i, i + AUTH_BATCH_SIZE);
            console.log(`[批量导入] 处理批次 ${Math.floor(i / AUTH_BATCH_SIZE) + 1}/${Math.ceil(emails.length / AUTH_BATCH_SIZE)} (${batch.length} 个邮箱)`);

            // 高并发处理当前批次的邮箱授权
            const authPromises = batch.map(async (emailData) => {
                try {
                    const { email, client_id, refresh_token } = emailData;

                    console.log(`[批量导入] 开始授权: ${email}`);

                    // 1. 验证授权凭证并获取access_token
                    const tokenResult = await refreshToken(refresh_token, client_id, '');
                    if (!tokenResult.access_token) {
                        throw new Error('Token刷新失败');
                    }

                    console.log(`[批量导入] 授权成功: ${email}`);

                    // 2. 获取邮件
                    console.log(`[批量导入] 获取邮件: ${email}`);
                    const emailsResult = await fetchEmailsFromMicrosoft(tokenResult.access_token);

                    // 3. 提取验证码
                    const verificationCodes = extractVerificationCodes(emailsResult);
                    const latestCode = verificationCodes.length > 0 ? verificationCodes[0] : null;

                    console.log(`[批量导入] 找到验证码: ${email} -> ${latestCode ? latestCode.code : '无'}`);

                    const accountData = {
                        id: 'account_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                        email: email,
                        client_id: client_id,
                        refresh_token: refresh_token,
                        access_token: tokenResult.access_token,
                        status: 'authorized',
                        created_at: new Date().toISOString(),
                        last_checked: new Date().toISOString(),
                        email_count: emailsResult.length,
                        verification_code: latestCode,
                        sequence: i + batch.indexOf(emailData) + 1,
                        monitoring_enabled: false,
                        emails: emailsResult // 包含邮件数据
                    };

                    successCount++;
                    return {
                        success: true,
                        email: email,
                        account_id: accountData.id,
                        status: 'authorized',
                        verification_code: latestCode,
                        email_count: emailsResult.length,
                        data: accountData
                    };

                } catch (error) {
                    console.error(`[批量导入] 处理失败 ${emailData.email}:`, error.message);
                    failureCount++;

                    return {
                        success: false,
                        email: emailData.email,
                        error: error.message,
                        status: 'failed'
                    };
                }
            });

            // 等待当前批次完成
            const batchResults = await Promise.allSettled(authPromises);
            batchResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    results.push({
                        success: false,
                        email: 'unknown',
                        error: result.reason.message,
                        status: 'failed'
                    });
                }
            });

            // 批次间短暂延迟，避免API限制
            if (i + AUTH_BATCH_SIZE < emails.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`[批量导入] 完成处理: ${successCount} 成功, ${failureCount} 失败`);

        res.json({
            success: true,
            message: `批量处理完成: ${successCount} 成功${failureCount > 0 ? `, ${failureCount} 失败` : ''}`,
            results: results,
            processed: results.length,
            success_count: successCount,
            failure_count: failureCount,
            sessionId: sessionId
        });

    } catch (error) {
        console.error('[批量导入] 处理失败:', error);
        res.status(500).json({
            success: false,
            error: '批量导入处理失败: ' + error.message
        });
    }
});

// 辅助函数：获取Microsoft邮件（使用现有的正确实现）
async function fetchEmailsFromMicrosoft(accessToken) {
    return new Promise((resolve, reject) => {
        // 使用现有的Outlook API实现（已验证可用）
        const OUTLOOK_API = 'https://outlook.office.com/api/v2.0';
        const url = `${OUTLOOK_API}/me/messages?$top=5&$orderby=ReceivedDateTime desc`;

        console.log(`[邮件获取] 获取最新5封邮件`);
        console.log(`[调试] URL: ${url}`);

        // 从完整URL中提取路径部分（与原实现保持一致）
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const result = JSON.parse(data);
                        resolve(result.value || []);
                    } else {
                        console.error(`[邮件获取错误] HTTP ${res.statusCode} - URL: ${url}`);
                        console.error(`[邮件获取错误] 响应体:`, data);

                        if (res.statusCode === 400) {
                            reject(new Error(`邮件获取失败: 400 - 权限不足或token无效`));
                        } else if (res.statusCode === 401) {
                            reject(new Error(`邮件获取失败: 401 - 未授权，token已过期`));
                        } else if (res.statusCode === 403) {
                            reject(new Error(`邮件获取失败: 403 - 禁止访问，权限不足`));
                        } else {
                            reject(new Error(`邮件获取失败: ${res.statusCode}`));
                        }
                    }
                } catch (error) {
                    console.error(`[邮件解析错误] URL: ${url}`);
                    console.error(`[邮件解析错误] 原始数据: ${data}`);
                    reject(new Error(`邮件响应解析失败: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('邮件获取超时'));
        });
        req.end();
    });
}

// 辅助函数：提取验证码
function extractVerificationCodes(emails) {
    const codes = [];
    emails.forEach(email => {
        const body = email.body?.content || '';
        const subject = email.subject || '';

        // 多种验证码匹配模式
        const patterns = [
            /(?:验证码|verification code|code|验证)[\s:：]*(\d{4,8})/i,
            /(\d{6})/i,
            /(\d{4,8})/
        ];

        for (const pattern of patterns) {
            const match = body.match(pattern) || subject.match(pattern);
            if (match) {
                codes.push({
                    code: match[1],
                    sender: email.from?.emailAddress?.address || 'unknown',
                    received_time: email.receivedDateTime,
                    subject: subject
                });
                break; // 找到第一个匹配就停止
            }
        }
    });
    return codes;
}

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0-simple'
    });
});

// 启动服务器
const server = app.listen(PORT, () => {
    console.log('🚀 简化版代理服务器已启动');
    console.log(`📍 代理端口: ${PORT}`);
    console.log(`🔌 WebSocket端口: ${WS_PORT}`);
    console.log('✅ 纯前端架构 - 无数据存储');
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，正在关闭服务器...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('收到SIGINT信号，正在关闭服务器...');
    server.close(() => process.exit(0));
});