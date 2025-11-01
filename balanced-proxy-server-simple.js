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