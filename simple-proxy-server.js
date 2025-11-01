/**
 * 简化版邮件管理代理服务器 - KISS原则
 * 保留核心功能和WebSocket，简化其他所有复杂特性
 */

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PROXY_PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// 基础中间件
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ========== 核心数据存储 (KISS原则：简单Map) ==========
const emailStore = new Map(); // 存储邮箱信息
const sequenceStore = new Map(); // 存储序列号
let maxSequence = 0; // 简单序列计数器

// WebSocket服务器
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`🔌 WebSocket服务器已启动 - 端口: ${WS_PORT}`);

// WebSocket连接处理
wss.on('connection', (ws) => {
    console.log('📱 WebSocket客户端已连接');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 收到WebSocket消息:', data);

            // 简单的消息处理
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (error) {
            console.error('🔍 WebSocket消息解析错误:', error);
        }
    });

    ws.on('close', () => {
        console.log('📱 WebSocket客户端已断开');
    });
});

// ========== 核心功能函数 (KISS原则：简单直接) ==========

// 分配序列号
function assignSequence(email) {
    if (sequenceStore.has(email)) {
        return sequenceStore.get(email);
    }

    maxSequence++;
    sequenceStore.set(email, maxSequence);
    return maxSequence;
}

// 获取邮箱序列号
function getEmailSequence(email) {
    return {
        success: true,
        email: email,
        sequence: sequenceStore.get(email) || null
    };
}

// 处理邮箱
function processEmail(emailData) {
    const { email, password, client_id, refresh_token } = emailData;

    // 验证必需参数
    if (!email || !password || !client_id || !refresh_token) {
        return {
            success: false,
            error: '缺少必需参数: email, password, client_id, refresh_token'
        };
    }

    // 分配序列号
    const sequence = assignSequence(email);

    // 存储邮箱信息
    emailStore.set(email, {
        email,
        password,
        client_id,
        refresh_token,
        sequence,
        created_at: new Date().toISOString(),
        status: 'pending'
    });

    console.log(`✅ 处理邮箱: ${email} -> 序列号: ${sequence}`);

    return {
        success: true,
        email,
        sequence,
        status: 'pending',
        processed_at: new Date().toISOString()
    };
}

// 获取基本统计
function getStats() {
    return {
        total_emails: emailStore.size,
        total_sequences: sequenceStore.size,
        max_sequence: maxSequence,
        websocket_connections: wss.clients.size,
        timestamp: new Date().toISOString()
    };
}

// ========== CORS代理中间件 ==========

const outlookProxy = createProxyMiddleware({
    target: 'https://graph.microsoft.com',
    changeOrigin: true,
    pathRewrite: {
        '^/api/outlook': '',
    },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`🔄 代理请求: ${req.method} ${req.path}`);
    },
    onError: (err, req, res) => {
        console.error('🔍 代理错误:', err.message);
        res.status(500).json({ error: '代理请求��败' });
    }
});

// ========== API端点 (KISS原则：最少必要) ==========

// 1. Outlook API代理
app.use('/api/outlook', outlookProxy);

// 2. 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        websocket_port: WS_PORT
    });
});

// 3. 服务信息
app.get('/api/info', (req, res) => {
    res.json({
        name: 'Simple Mail Manager Proxy Server',
        description: '简化版邮件管理代理服务器 - 遵循KISS原则',
        version: '1.0.0',
        features: [
            'CORS代理 - 解决跨域访问问题',
            '邮箱序列管理 - 自动分配唯一序列号',
            'WebSocket通信 - 实时消息推送',
            '简化存储 - 内存Map存储，无数据库依赖'
        ],
        endpoints: {
            '健康检查': 'GET /api/health',
            '服务信息': 'GET /api/info',
            '处理邮箱': 'POST /api/emails',
            '查询序列': 'GET /api/sequence/:email',
            '基本统计': 'GET /api/stats',
            'Outlook代理': 'GET /api/outlook/*'
        },
        usage: {
            '添加邮箱': 'POST /api/emails - 处理邮箱数组',
            '查询序列': 'GET /api/sequence/:email - 获取邮箱序列号',
            '基本统计': 'GET /api/stats - 查看基本统计信息',
            'WebSocket': `ws://localhost:${WS_PORT} - 实时通信`
        }
    });
});

// 4. 处理邮箱列表
app.post('/api/emails', (req, res) => {
    try {
        const { emails } = req.body;

        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({
                success: false,
                error: '请提供有效的邮箱数组'
            });
        }

        const results = [];
        let successCount = 0;

        for (const emailData of emails) {
            const result = processEmail(emailData);
            results.push(result);
            if (result.success) successCount++;
        }

        res.json({
            success: true,
            stats: {
                total: emails.length,
                successful: successCount,
                failed: emails.length - successCount
            },
            results
        });

        console.log(`📊 邮箱处理完成: ${successCount}/${emails.length} 成功`);

        // 通过WebSocket通知客户端
        const message = JSON.stringify({
            type: 'emails_processed',
            data: {
                total: emails.length,
                successful: successCount,
                timestamp: new Date().toISOString()
            }
        });

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });

    } catch (error) {
        console.error('❌ 邮箱处理错误:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. 查询邮箱序列
app.get('/api/sequence/:email', (req, res) => {
    const email = req.params.email;
    const result = getEmailSequence(email);
    res.json(result);
});

// 6. 基本统计
app.get('/api/stats', (req, res) => {
    const stats = getStats();
    res.json({
        success: true,
        stats: stats
    });
});

// 7. Microsoft OAuth token (简化版)
app.post('/api/microsoft/token', async (req, res) => {
    try {
        const { client_id, client_secret, code, redirect_uri } = req.body;

        // 简单的token验证逻辑
        if (!client_id || !code) {
            return res.status(400).json({
                error: '缺少必需参数: client_id, code'
            });
        }

        // 这里应该调用真实的Microsoft OAuth API
        // 为了简化，返回模拟数据
        res.json({
            access_token: 'mock_access_token_' + Date.now(),
            refresh_token: 'mock_refresh_token_' + Date.now(),
            expires_in: 3600,
            token_type: 'Bearer'
        });

    } catch (error) {
        console.error('❌ Token获取错误:', error);
        res.status(500).json({
            error: 'Token获取失败'
        });
    }
});

// 8. 简单监控触发
app.post('/api/monitor', (req, res) => {
    const { email, action } = req.body;

    console.log(`🔍 监控请求: ${action} - ${email}`);

    // 通过WebSocket发送监控通知
    const message = JSON.stringify({
        type: 'monitor',
        data: {
            email: email,
            action: action,
            timestamp: new Date().toISOString()
        }
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });

    res.json({
        success: true,
        message: `监控${action}已触发`,
        email: email,
        action: action
    });
});

// 错误处理中间件
app.use((error, req, res, next) => {
    console.error('❌ 服务器错误:', error);
    res.status(500).json({
        success: false,
        error: '服务器内部错误'
    });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: '端点不存在',
        path: req.path
    });
});

// 启动服务器
const server = app.listen(PORT, () => {
    console.log('🚀 简化版邮件管理代理服务器已启动');
    console.log(`📍 代理端口: ${PORT}`);
    console.log(`🔌 WebSocket端口: ${WS_PORT}`);
    console.log(`🌐 健康检查: http://localhost:${PORT}/api/health`);
    console.log(`📋 服务信息: http://localhost:${PORT}/api/info`);
    console.log('');
    console.log('📝 使用说明:');
    console.log('   1. 简化的KISS架构，只保留核心功能');
    console.log('   2. 内存Map存储，无数据库依赖');
    console.log('   3. WebSocket实时通信支持');
    console.log('   4. 支持CORS代理和基本的邮箱管理');
    console.log('   5. 遵循KISS原则：简单、直接、有效');
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('🛑 收到SIGTERM信号，正在关闭服务器...');
    server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 收到SIGINT信号，正在关闭服务器...');
    server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
    });
});