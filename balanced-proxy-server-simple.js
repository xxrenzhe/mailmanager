/**
 * 简化版代理服务器 - 纯前端架构
 * 只提供API代理功能，不存储任何数据
 * Version: 20251102-33 - 精确主体词提取算法
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

// CORS配置 - 支持Cloudflare CDN
const corsOptions = {
    origin: function (origin, callback) {
        // 允许的域名列表
        const allowedOrigins = [
            process.env.DOMAIN_URL || 'http://localhost:3001', // 生产环境域名
            'https://mailmanager.dev',  // 示例域名
            'https://www.mailmanager.dev',
            'http://localhost:3001',    // 开发环境
            'http://127.0.0.1:3001'
        ];

        // 允许无origin的请求(如移动应用)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log('[CORS] 拒绝来源:', origin);
            callback(new Error('不被CORS策略允许'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// 🔧 新增：全局未捕获异常处理，防止进程退出
process.on('unhandledRejection', (reason, promise) => {
    console.error('[未捕获的Promise拒绝]', reason);
    // 不要退出进程，记录错误并继续
});

process.on('uncaughtException', (error) => {
    console.error('[未捕获的异常]', error);
    // 不要退出进程，记录错误并继续
});

// 🔧 新增：进程优雅退出处理
process.on('SIGTERM', () => {
    console.log('[进程] 收到SIGTERM信号，开始优雅退出...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[进程] 收到SIGINT信号，开始优雅退出...');
    process.exit(0);
});

// 🔧 新增：速率限制管理器
class RateLimiter {
    constructor() {
        this.requestTimes = [];
        this.maxRequestsPerSecond = 2; // Microsoft API 限制：每秒最多2个请求
        this.maxRequestsPerMinute = 30; // 每分钟最多30个请求
        this.minInterval = 500; // 请求间最小间隔 500ms
    }

    async waitForSlot() {
        const now = Date.now();

        // 清理1分钟前的请求记录
        this.requestTimes = this.requestTimes.filter(time => now - time < 60000);

        // 检查速率限制
        if (this.requestTimes.length >= this.maxRequestsPerMinute) {
            const oldestRequest = Math.min(...this.requestTimes);
            const waitTime = 60000 - (now - oldestRequest) + 100; // 100ms buffer
            console.log(`[速率限制] 达到每分钟限制，等待 ${waitTime}ms`);
            await this.sleep(waitTime);
            return this.waitForSlot(); // 递归重试
        }

        // 检查最小间隔
        if (this.requestTimes.length > 0) {
            const lastRequest = Math.max(...this.requestTimes);
            const timeSinceLastRequest = now - lastRequest;
            if (timeSinceLastRequest < this.minInterval) {
                const waitTime = this.minInterval - timeSinceLastRequest;
                console.log(`[速率限制] 请求间隔过短，等待 ${waitTime}ms`);
                await this.sleep(waitTime);
            }
        }

        this.requestTimes.push(now);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 全局速率限制器
const globalRateLimiter = new RateLimiter();

// 🔧 新增：重试机制配置
const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000, // 1秒基础延迟
    maxDelay: 10000, // 最大10秒延迟
    backoffMultiplier: 2,
    retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'],
    retryableStatusCodes: [429, 502, 503, 504]
};

// 🔧 新增：指数退避重试函数
async function retryWithBackoff(operation, context = '') {
    let lastError;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            // 检查是否可重试
            const isRetryableError = RETRY_CONFIG.retryableErrors.some(code =>
                error.code && error.code.includes(code)
            );
            const isRetryableStatus = RETRY_CONFIG.retryableStatusCodes.includes(
                parseInt(error.message?.match(/\d{3}/)?.[0])
            );

            if (!isRetryableError && !isRetryableStatus) {
                console.log(`[重试] 不可重试错误 (${context}):`, error.message);
                throw error;
            }

            if (attempt === RETRY_CONFIG.maxRetries) {
                console.log(`[重试] 达到最大重试次数 (${context}):`, error.message);
                throw error;
            }

            // 计算延迟时间（指数退避 + 随机抖动）
            const baseDelay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1);
            const jitter = Math.random() * 1000; // 0-1秒随机抖动
            const delay = Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelay);

            console.log(`[重试] 第${attempt}次尝试失败 (${context})，${delay}ms后重试:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

// Cloudflare专用中间件 - 获取真实客户端IP
app.use((req, res, next) => {
    // 获取Cloudflare转发的真实IP
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    const cfRay = req.headers['cf-ray'];
    const cfCountry = req.headers['cf-country'];
    const cfIpcountry = req.headers['cf-ipcountry'];

    if (cfConnectingIp) {
        req.realIp = cfConnectingIp;
        req.cfRay = cfRay;
        req.cfCountry = cfCountry || cfIpcountry;
        console.log(`[Cloudflare] 请求来源 - IP: ${cfConnectingIp}, Ray: ${cfRay}, 国家: ${req.cfCountry}`);
    }

    next();
});

// 基础中间件
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务 - 优先服务新的拆分结构
app.use(express.static(__dirname));

// 默认路由 - 指向新的index.html
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

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

// 监控系统变量
const accountStore = new Map(); // 存储账户信息
const activeMonitors = new Map(); // 存储活跃的监控任务

// 统一事件发送函数（WebSocket + SSE）
function emitEvent(eventData) {
    try {
        // WebSocket广播
        const eventString = JSON.stringify(eventData);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(eventString);
            }
        });

        console.log(`[事件发送] ${eventData.type}:`, eventData.sessionId || 'global', eventData.email || 'unknown');
    } catch (error) {
        console.error('[事件发送] 失败:', error);
    }
}

// 监控任务管理
function startMonitoring(sessionId, account, duration = 60000) {
    const monitorId = `${sessionId}_${account.id}`;

    // 清理现有监控
    if (activeMonitors.has(monitorId)) {
        clearInterval(activeMonitors.get(monitorId).interval);
    }

    let checkCount = 0;
    const startTime = Date.now();

    console.log(`[监控] 启动监控任务: ${monitorId}`);

    const monitorTask = {
        sessionId,
        account,
        startTime,
        interval: setInterval(async () => {
            checkCount++;
            const elapsed = Date.now() - startTime;

            console.log(`[监控检查] 检查账户: ${account.email} (ID: ${account.id}, 检查次数: ${checkCount})`);

            // 检查是否超时
            if (elapsed >= duration) {
                console.log(`[监控] ${duration/1000}秒监控超时: ${account.email}, 共检查 ${checkCount} 次`);
                stopMonitoring(monitorId);
                return;
            }

            try {
                console.log(`[Token刷新] 开始刷新Token: ${account.email}`);

                // 获取access token
                const tokenResult = await refreshToken(account.refresh_token, account.client_id, '');

                if (!tokenResult || !tokenResult.access_token) {
                    throw new Error('Token刷新失败��未获取到有效的access_token');
                }

                console.log(`[Token刷新] Token刷新成功: ${account.email}`);

                // 获取邮件（带时间过滤和重试机制）
                console.log(`[邮件获取] 开始获取邮件: ${account.email}`);
                const emails = await fetchEmailsWithTimeFilter(tokenResult.access_token, account.last_check_time);

                if (emails && emails.length > 0) {
                    console.log(`[邮件] 获取到 ${emails.length} 封邮件`);

                    // 提取验证码
                    console.log(`[验证码提取] 开始提取验证码: ${account.email}`);
                    const verificationCodes = extractVerificationCodes(emails);

                    console.log(`[验证码提取] 提取结果: ${verificationCodes.length} 个验证码`);

                    if (verificationCodes.length > 0) {
                        const latestCode = verificationCodes[0]; // 已经按时间排序
                        console.log(`[验证码] 发现验证码: ${latestCode.code} (发件人: ${latestCode.sender})`);
                        console.log(`[验证码] 验证码时间: ${latestCode.received_at}`);
                        console.log(`[验证码] 基准时间: ${account.last_check_time}`);

                        // 检查验证码是否比基准时间更新（关键修复）
                        const isCodeNewer = account.last_check_time ?
                            new Date(latestCode.received_at) > new Date(account.last_check_time) : true;

                        if (isCodeNewer) {
                            console.log(`[验证码] ✅ 发现新验证码，停止监控: ${account.email}`);

                            // 更新账户信息
                            account.verification_code = latestCode;
                            account.last_checked = new Date().toISOString();
                            account.email_count = emails.length;
                            account.last_check_time = latestCode.received_at; // 更新基准时间
                            accountStore.set(account.id, account);

                            // 发送验证码发现事件 - 🔧 添加last_code_time字段用于前端判断
                            emitEvent({
                                type: 'verification_code_found',
                                sessionId: sessionId,
                                email_id: account.id,
                                email: account.email,
                                code: latestCode.code,
                                sender: latestCode.sender,
                                subject: latestCode.subject,
                                received_at: latestCode.received_at,
                                last_code_time: latestCode.received_at, // 🔧 新增：发送给前端的时间基准
                                timestamp: new Date().toISOString()
                            });

                            // 发现新验证码后停止监控
                            stopMonitoring(monitorId);
                            return;
                        } else {
                            console.log(`[验证码] ⚠️ 验证码不是新的，继续监控: ${latestCode.code} (${latestCode.received_at} <= ${account.last_check_time})`);
                        }
                    } else {
                        console.log(`[验证码] 未找到验证码，继续监控`);
                    }
                } else {
                    console.log(`[邮件] 未找到新邮件，继续监控`);
                }
            } catch (error) {
                console.error(`[监控检查] 错误: ${account.email}`, error.message);
                console.error(`[监控检查] 错误详情: ${account.email}`, error.stack);

                // 发送监控错误事件
                emitEvent({
                    type: 'monitoring_error',
                    sessionId: sessionId,
                    email_id: account.id,
                    email: account.email,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }, 5000) // 每5秒检查一次
    };

    activeMonitors.set(monitorId, monitorTask);
}

function stopMonitoring(monitorId, reason = '监控结束') {
    if (activeMonitors.has(monitorId)) {
        const monitorTask = activeMonitors.get(monitorId);
        clearInterval(monitorTask.interval);
        activeMonitors.delete(monitorId);

        console.log(`[监控] 停止监控: ${monitorId} - ${reason}`);

        // 发送监控结束事件
        emitEvent({
            type: 'monitoring_ended',
            sessionId: monitorTask.sessionId,
            email_id: monitorTask.account.id,
            email: monitorTask.account.email,
            reason: reason,
            timestamp: new Date().toISOString()
        });
    }
}

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

// 认证回调API
app.post('/api/auth/callback', async (req, res) => {
    try {
        const { code, state, client_id, client_secret, redirect_uri } = req.body;

        if (!code) {
            return res.status(400).json({
                error: '缺少授权码'
            });
        }

        console.log(`[认证回调] 处理OAuth回调，state: ${state}`);

        // 交换授权码获取访问令牌
        const tokenData = await exchangeCodeForToken(code, client_id, client_secret, redirect_uri);

        if (!tokenData || !tokenData.access_token) {
            throw new Error('授权码交换失败：未获取到有效访问令牌');
        }

        console.log(`[认证回调] 授权码交换成功`);

        res.json({
            success: true,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type || 'Bearer',
            scope: tokenData.scope,
            state: state,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[认证回调] OAuth回调处理失败:', error.message);
        res.status(500).json({
            error: 'OAuth回调处理失败',
            message: error.message
        });
    }
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
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
            // 注意：Microsoft public client不需要client_secret
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

        const AUTH_BATCH_SIZE = 5; // 🔧 减少并发数量：从30降到5，避免API速率限制
        const results = [];
        let successCount = 0;
        let failureCount = 0;

        // 🔧 改进：分批处理邮箱授权和取件，增加批次间延迟
        for (let i = 0; i < emails.length; i += AUTH_BATCH_SIZE) {
            const batch = emails.slice(i, i + AUTH_BATCH_SIZE);
            console.log(`[批量导入] 处理批次 ${Math.floor(i / AUTH_BATCH_SIZE) + 1}/${Math.ceil(emails.length / AUTH_BATCH_SIZE)} (${batch.length} 个邮箱)`);

            // 🔧 新增：批次间延迟，避免API速率限制
            if (i > 0) {
                const batchDelay = Math.min(2000, Math.max(500, batch.length * 200)); // 500ms-2s动态延迟
                console.log(`[批量导入] 批次间延迟 ${batchDelay}ms，避免API限制`);
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }

            // 🔧 改进：使用Promise.allSettled处理并发，避免单个失败影响整批
            const authPromises = batch.map(async (emailData, index) => {
                try {
                    // 🔧 新增：请求间延迟，避免并发冲突
                    if (index > 0) {
                        const individualDelay = 300 + Math.random() * 200; // 300-500ms随机延迟
                        await new Promise(resolve => setTimeout(resolve, individualDelay));
                    }
                    // 支持两种格式：字符串或对象
                    let accountData;
                    if (typeof emailData === 'string') {
                        accountData = parseImportLine(emailData);
                    } else if (typeof emailData === 'object' && emailData.email) {
                        accountData = emailData;
                    } else {
                        throw new Error('邮箱数据格式错误');
                    }

                    if (!accountData) {
                        throw new Error('邮箱数据解析失败');
                    }

                    const { email, client_id, refresh_token, id: frontendId } = accountData;

                    // KISS原则：使用前端提供的ID（前端存储数据，前端生成ID）
                    if (!frontendId) {
                        throw new Error('前端未提供账户ID');
                    }
                    accountData.id = frontendId;

                    console.log(`[批量导入] KISS模式：使用前端ID ${email} -> ${frontendId}`);

                    // 1. 验证授权凭证并获取access_token
                    const tokenResult = await refreshToken(refresh_token, client_id, '');
                    if (!tokenResult.access_token) {
                        throw new Error('Token刷新失败');
                    }

                    console.log(`[批量导入] 授权成功: ${email}`);

                    // 2. 获取邮件（带重试机制）
                    console.log(`[批量导入] 获取邮件: ${email}`);
                    const emailsResult = await fetchEmailsWithRetry(tokenResult.access_token);

                    // 3. 提取验证码
                    console.log(`[批量导入] 开始提取验证码，邮件数量: ${emailsResult.length}`);
                    if (emailsResult.length > 0) {
                        console.log(`[批量导入] 第一封邮件完整数据:`, JSON.stringify(emailsResult[0], null, 2));
                        console.log(`[批量导入] 第一封邮件主题: "${emailsResult[0].Subject || emailsResult[0].subject || ''}"`);
                        console.log(`[批量导入] 第一封邮件发件人: ${emailsResult[0].From?.emailAddress?.Address || emailsResult[0].from?.emailAddress?.address || 'unknown'}`);
                        // 添加更详细的From字段调试
                        console.log(`[调试] From字段完整结构:`, JSON.stringify(emailsResult[0].From || {}, null, 2));
                        // 检查其他可能的发件人字段
                        console.log(`[调试] Sender字段:`, JSON.stringify(emailsResult[0].Sender || {}, null, 2));
                        console.log(`[调试] InternetMessageId: ${emailsResult[0].InternetMessageId || 'none'}`);
                        // 检查所有可用字段
                        const allFields = Object.keys(emailsResult[0]);
                        console.log(`[调试] 所有可用字段:`, allFields.join(', '));
                    }

                    const verificationCodes = extractVerificationCodes(emailsResult);
                    const latestCode = verificationCodes.length > 0 ? verificationCodes[0] : null;

                    console.log(`[批量导入] 找到验证码: ${email} -> ${latestCode ? latestCode.code : '无'}`);
                    if (latestCode) {
                        console.log(`[批量导入] 验证码详情:`, {
                            code: latestCode.code,
                            received_at: latestCode.received_at,
                            sender: latestCode.sender,
                            subject: latestCode.subject
                        });
                    }

                    const processedAccountData = {
                        id: 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
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

                    // 1. 首先发送状态更新事件（立即发送，不等待验证码处理）
                    emitEvent({
                        type: 'account_status_changed',
                        sessionId: sessionId,
                        email_id: accountData.id,
                        email: email,
                        status: 'authorized',
                        email_count: emailsResult.length,
                        progress: {
                            current: successCount + failureCount,
                            total: emails.length,
                            success: successCount,
                            failed: failureCount
                        }
                    });

                    // 2. 如果有验证码，立即发送验证码发现事件（独立并发）
                    if (latestCode) {
                        emitEvent({
                            type: 'verification_code_found',
                            sessionId: sessionId,
                            email_id: accountData.id,
                            email: email,
                            code: latestCode.code,
                            sender: latestCode.sender || 'Unknown',
                            received_at: latestCode.received_at // 🔧 修复：移除import time fallback，确保使用邮件接收时间
                        });
                    }

                    // 3. 发送导入进度事件（用于进度条）
                    emitEvent({
                        type: 'import_progress',
                        sessionId: sessionId,
                        email: email,
                        email_id: accountData.id,
                        status: 'authorized',
                        email_count: emailsResult.length,
                        has_verification_code: !!latestCode,
                        progress: {
                            current: successCount + failureCount,
                            total: emails.length,
                            success: successCount,
                            failed: failureCount
                        }
                    });

                    return {
                        success: true,
                        email: email,
                        email_id: accountData.id,
                        status: 'authorized',
                        verification_code: latestCode,
                        email_count: emailsResult.length,
                        data: accountData
                    };

                } catch (error) {
                    console.error(`[批量导入] 处理失败 ${emailData?.email || emailData}:`, error.message);
                    failureCount++;

                    // 发送单个账户导入失败事件
                    emitEvent({
                        type: 'import_progress',
                        sessionId: sessionId,
                        email: emailData?.email || (typeof emailData === 'string' ? emailData : 'unknown'),
                        status: 'failed',
                        error: error.message,
                        progress: {
                            current: successCount + failureCount,
                            total: emails.length,
                            success: successCount,
                            failed: failureCount
                        }
                    });

                    return {
                        success: false,
                        email: emailData?.email || (typeof emailData === 'string' ? emailData : 'unknown'),
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

            // 发送批次完成事件
            const currentBatch = Math.floor(i / AUTH_BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(emails.length / AUTH_BATCH_SIZE);

            emitEvent({
                type: 'bulk_import_progress',
                sessionId: sessionId,
                batch: {
                    current: currentBatch,
                    total: totalBatches,
                    size: batch.length
                },
                progress: {
                    processed: successCount + failureCount,
                    total: emails.length,
                    success: successCount,
                    failed: failureCount
                },
                stage: 'batch_completed'
            });

            // 取消批次间延迟，最大化处理效率
            // if (i + AUTH_BATCH_SIZE < emails.length) {
            //     await new Promise(resolve => setTimeout(resolve, 500));
            // }
        }

        console.log(`[批量导入] 完成处理: ${successCount} 成功, ${failureCount} 失败`);

        // 发送批量导入完成事件
        emitEvent({
            type: 'bulk_import_progress',
            sessionId: sessionId,
            progress: {
                processed: emails.length,
                total: emails.length,
                success: successCount,
                failed: failureCount
            },
            stage: 'completed',
            message: `批量导入完成: ${successCount} 成功${failureCount > 0 ? `, ${failureCount} 失败` : ''}`
        });

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

// 监控API - 复制邮箱触发监控
app.post('/api/monitor/copy-trigger', async (req, res) => {
    try {
        const {
            sessionId,
            email_id,
            email,
            client_id,
            refresh_token,
            current_status,
            codes = [],
            emails = [],
            latest_code_received_at
        } = req.body;

        // 多用户隔离验证：必须有sessionId
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        console.log(`[监控触发] 复制邮箱: ${email}, 账户ID: ${email_id} (会话: ${sessionId})`);
        console.log(`[监控触发] 账户状态: ${current_status}`);

        // 账户状态检查和处理
        let finalStatus = current_status;

        if (current_status === 'pending' || current_status === 'reauth_required') {
            console.log(`[监控触发] 账户 ${email} 状态为 ${current_status}，将尝试重新授权`);

            // 尝试重新授权（刷新token）
            try {
                const tokenResult = await refreshToken(refresh_token, client_id, '');
                if (tokenResult && tokenResult.access_token) {
                    finalStatus = 'authorized';
                    console.log(`[监控触发] 账户 ${email} 重新授权成功，状态更新为 authorized`);

                    // 通知前端重新授权成功
                    emitEvent({
                        type: 'account_status_changed',
                        sessionId: sessionId,
                        email_id: email_id,
                        email: email,
                        status: 'authorized',
                        message: '账户重新授权成功'
                    });
                } else {
                    throw new Error('重新授权失败：未获取到有效token');
                }
            } catch (reauthError) {
                console.log(`[监控触发] 账户 ${email} 重新授权失败: ${reauthError.message}`);

                // 通知前端需要手动重新授权
                emitEvent({
                    type: 'account_status_changed',
                    sessionId: sessionId,
                    email_id: email_id,
                    email: email,
                    status: 'reauth_required',
                    message: 'Token已失效，请重新获取授权信息',
                    error: reauthError.message
                });

                return res.status(403).json({
                    success: false,
                    error: '账户重新授权失败，请手动更新授权信息',
                    status: 'reauth_required',
                    message: '请在应用中更新refresh_token后重试'
                });
            }
        }

        // 记录最新验证码时间（用于日志记录）
        let timeFilter = latest_code_received_at;

        if (codes && codes.length > 0) {
            const latestCode = codes.reduce((latest, code) => {
                return new Date(code.received_at) > new Date(latest.received_at) ? code : latest;
            });
            timeFilter = latestCode.received_at;
            console.log(`[验证码基准] 使用codes数组最新时间: ${timeFilter}`);
        } else if (latest_code_received_at) {
            console.log(`[验证码基准] 使用最新验证码邮件时间: ${timeFilter}`);
        } else {
            // 🔧 修复：首次导入无验证码时，设置基准时间为2000-01-01 UTC
            timeFilter = '2000-01-01T00:00:00Z';
            console.log(`[验证码基准] 首次导入无验证码，设置基准时间为: ${timeFilter}`);
        }

        // 创建账户对象
        const account = {
            id: email_id,
            email: email,
            client_id: client_id,
            refresh_token: refresh_token,
            current_status: finalStatus,
            last_active_at: new Date().toISOString(),
            codes: codes || [],
            emails: emails || [],
            latest_code_received_at: latest_code_received_at,
            last_check_time: timeFilter
        };

        console.log(`[监控检查] 账户 ${email} 将获取比 ${timeFilter} 更新的邮件`);

        // 存储账户
        accountStore.set(email_id, account);

        // 启动1分钟监控
        startMonitoring(sessionId, account, 60000);

        // 统一事件通知
        emitEvent({
            type: 'monitoring_started',
            sessionId: sessionId,
            email_id: email_id,
            email: email,
            duration: 60000,
            time_filter: timeFilter,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: '已启动1分钟监控，将自动检查新邮件',
            email_id: email_id,
            email: email,
            duration: 60000,
            time_filter: timeFilter
        });

    } catch (error) {
        console.error('[监控触发] 错误:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 增强的邮件获取重试机制
// 获取邮件并按时间过滤（用于监控场景）
async function fetchEmailsWithTimeFilter(accessToken, timeFilter = null) {
    try {
        const emails = await fetchEmailsFromMicrosoft(accessToken);

        if (!timeFilter) {
            // 如果没有时间基准，返回所有邮件
            return emails;
        }

        console.log(`[邮件过滤] 基准时间: ${timeFilter}`);

        // 过滤出比基准时间更新的邮件
        const filteredEmails = emails.filter(email => {
            const emailTime = new Date(email.ReceivedDateTime);
            const filterTime = new Date(timeFilter);
            const isAfter = emailTime > filterTime;

            if (isAfter) {
                console.log(`[邮件过滤] ✅ 新邮件: ${email.Subject} (${email.ReceivedDateTime})`);
            } else {
                console.log(`[邮件过滤] ❌ 旧邮件: ${email.Subject} (${email.ReceivedDateTime})`);
            }

            return isAfter;
        });

        console.log(`[邮件过滤] 过滤结果: ${filteredEmails.length}/${emails.length} 封新邮件`);
        return filteredEmails;

    } catch (error) {
        console.error('[邮件过滤] 过滤失败:', error.message);
        // 如果过滤失败，回退到普通获取
        return fetchEmailsWithRetry(accessToken);
    }
}

async function fetchEmailsWithRetry(accessToken, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const emails = await fetchEmailsFromMicrosoft(accessToken);
            return emails;
        } catch (error) {
            console.error(`[邮件重试] 第${attempt}次尝试失败: ${error.message}`);

            // 可重试的错误类型：503、超时、429限流、网络错误
            const retryableErrors = ['503', '超时', '429', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'];
            const isRetryable = retryableErrors.some(err => error.message.includes(err));

            if (isRetryable && attempt < maxRetries) {
                // 更长的指数退避：1s, 2s, 4s, 8s, 10s (最大10秒)
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                console.log(`[邮件重试] 等待${delay}ms后重试...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // 非可重试错误或已达最大重试次数
            console.error(`[邮件重试] 最终失败: ${error.message} (已尝试${attempt}次)`);
            throw error;
        }
    }
}

// 辅助函数：获取Microsoft邮件（扩展支持多文件夹）
async function fetchEmailsFromMicrosoft(accessToken) {
    const OUTLOOK_API = 'https://outlook.office.com/api/v2.0';

    // 要检查的文件夹列表：收件箱、垃圾箱、已删除邮件
    const folders = [
        { name: 'inbox', displayName: '收件箱' },
        { name: 'junkemail', displayName: '垃圾箱' },
        { name: 'deleteditems', displayName: '已删除' }
    ];

    console.log(`[邮件获取] 扩展模式：检查多个文件夹获取邮件`);

    const allEmails = [];
    let successCount = 0;
    let errorCount = 0;

    // 逐个文件夹获取邮件
    for (const folder of folders) {
        try {
            console.log(`[邮件获取] 正在获取${folder.displayName}邮件...`);

            const folderEmails = await fetchEmailsFromFolder(accessToken, folder.name, OUTLOOK_API);

            if (folderEmails.length > 0) {
                console.log(`[邮件获取] ${folder.displayName}获取到 ${folderEmails.length} 封邮件`);
                allEmails.push(...folderEmails);
                successCount++;
            } else {
                console.log(`[邮件获取] ${folder.displayName}无邮件`);
            }

            // 添加文件夹间延迟，避免API速率限制
            if (folders.indexOf(folder) < folders.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }

        } catch (error) {
            console.error(`[邮件获取] ${folder.displayName}获取失败:`, error.message);
            errorCount++;
            // 继续处理其他文件夹，不让单个文件夹失败影响整体
        }
    }

    console.log(`[邮件获取] 文件夹获取完成: 成功 ${successCount}/${folders.length}, 总邮件 ${allEmails.length} 封`);

    // 按接收时间排序并去重
    const sortedEmails = deduplicateAndSortEmails(allEmails);

    console.log(`[邮件获取] 最终获取 ${sortedEmails.length} 封邮件（去重后）`);

    return sortedEmails;
}

// 获取指定文件夹的邮件
async function fetchEmailsFromFolder(accessToken, folderName, outlookApi) {
    return new Promise((resolve, reject) => {
        const url = `${outlookApi}/me/mailFolders/${folderName}/messages?$top=5&$orderby=ReceivedDateTime desc`;

        console.log(`[邮件获取] ${folderName} - URL: ${url}`);

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
                        const emails = result.value || [];

                        // 为每封邮件添加文件夹信息，便于调试
                        emails.forEach(email => {
                            email.folder = folderName;
                        });

                        resolve(emails);
                    } else if (res.statusCode === 404) {
                        // 文件夹不存在或无权限访问，返回空数组
                        console.log(`[邮件获取] ${folderName} 文件夹不存在或无权限访问 (404)`);
                        resolve([]);
                    } else {
                        console.error(`[邮件获取错误] ${folderName} HTTP ${res.statusCode} - URL: ${url}`);

                        // 对于文件夹错误，返回空数组而不是拒绝
                        if (res.statusCode >= 400 && res.statusCode < 500) {
                            console.log(`[邮件获取] ${folderName} 权限或配置问题，跳过此文件夹`);
                            resolve([]);
                        } else {
                            reject(new Error(`${folderName}邮件获取失败: ${res.statusCode}`));
                        }
                    }
                } catch (error) {
                    console.error(`[邮件解析错误] ${folderName}:`, error.message);
                    resolve([]); // 解析错误也返回空数组，继续处理其他文件夹
                }
            });
        });

        req.on('error', (error) => {
            console.error(`[邮件请求错误] ${folderName}:`, error.message);
            resolve([]); // 网络错误也返回空数组
        });

        req.setTimeout(30000, () => {
            req.destroy();
            console.log(`[邮件获取超时] ${folderName} 请求超时`);
            resolve([]); // 超时也返回空数组
        });

        req.end();
    });
}

// 邮件去重和排序函数
function deduplicateAndSortEmails(emails) {
    if (!emails || emails.length === 0) {
        return [];
    }

    console.log(`[邮件处理] 开始去重和排序，原始邮件数: ${emails.length}`);

    // 使用InternetMessageId去重，如果没有则使用Subject+ReceivedDateTime组合
    const seenIds = new Set();
    const seenCombination = new Set();
    const uniqueEmails = [];

    for (const email of emails) {
        // 优先使用InternetMessageId去重
        if (email.InternetMessageId) {
            if (!seenIds.has(email.InternetMessageId)) {
                seenIds.add(email.InternetMessageId);
                uniqueEmails.push(email);
            } else {
                console.log(`[邮件去重] 跳过重复邮件 (ID: ${email.InternetMessageId})`);
            }
        } else {
            // 备用方案：使用主题+接收时间组合去重
            const subject = email.Subject || email.subject || '';
            const receivedTime = email.ReceivedDateTime || email.receivedDateTime || '';
            const combination = `${subject}_${receivedTime}`;

            if (!seenCombination.has(combination)) {
                seenCombination.add(combination);
                uniqueEmails.push(email);
            } else {
                console.log(`[邮件去重] 跳过重复邮件 (主题+时间组合)`);
            }
        }
    }

    // 按接收时间降序排序（最新的在前）
    uniqueEmails.sort((a, b) => {
        const timeA = new Date(a.ReceivedDateTime || a.receivedDateTime || 0);
        const timeB = new Date(b.ReceivedDateTime || b.receivedDateTime || 0);
        return timeB - timeA; // 降序：最新在前
    });

    console.log(`[邮件处理] 去重完成，唯一邮件数: ${uniqueEmails.length}`);

    // 显示前几封邮件的来源文件夹
    uniqueEmails.slice(0, 5).forEach((email, index) => {
        console.log(`[邮件处理] #${index + 1} 来自 ${email.folder}: ${email.Subject || email.subject} (${email.ReceivedDateTime || email.receivedDateTime})`);
    });

    return uniqueEmails;
}

// HTML标签清理函数
function stripHtmlTags(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// 🎯 精确主体词提取算法 - 只提取主语品牌名
function extractSenderEmail(email) {
    if (!email) return 'unknown';

    try {
        // 处理Microsoft Graph API的Pascal命名和camelCase命名法
        const subject = email.Subject || email.subject || '';
        if (!subject) return 'unknown';

        const cleanSubject = subject.trim();
        if (!cleanSubject) return 'unknown';
        console.log(`[主体词提取] 分析主题: "${cleanSubject}"`);

        // 🎯 定义知名品牌和服务名称（单个词）
        const knownBrands = new Set([
            'Google', 'Microsoft', 'Apple', 'Amazon', 'Meta', 'Facebook', 'Twitter', 'Instagram',
            'LinkedIn', 'Netflix', 'Spotify', 'Discord', 'Slack', 'Telegram', 'WhatsApp', 'Zoom',
            'Dropbox', 'Notion', 'Figma', 'GitHub', 'Adobe', 'Oracle', 'Salesforce', 'Shopify',
            'Comet', 'Perplexity', 'OpenAI', 'ChatGPT', 'Claude', 'Anthropic', 'D', 'B',
            'Dub', 'Partners', 'Commission', 'Verification', 'Payment', 'Notification', 'Alert'
        ]);

        // 🎯 模式1: "You just made a commission via [Service Name]!" - 保留完整服务名
        const commissionViaPattern = /^You just made a commission via\s+([A-Za-z0-9\s&']+?)\s*!?\s*$/i;
        let match = cleanSubject.match(commissionViaPattern);
        if (match) {
            let serviceName = match[1].trim();
            serviceName = serviceName.replace(/\s+/g, ' ');
            console.log(`[主体词提取] Commission via 模式: "${serviceName}"`);
            return serviceName;
        }

        // 🎯 模式2: "[Brand] + [业务类型]" - 提取品牌部分
        const brandBusinessPatterns = [
            /\b(Google|Microsoft|Apple|Amazon|Meta|Comet|Perplexity|OpenAI|Anthropic|Dub)\s+(verification|code|notification|alert|payment|commission|welcome|confirm|activate)\b/gi,
            /\b(Your\s+)?(Google|Microsoft|Apple|Amazon|Meta|Comet|Perplexity|OpenAI|Anthropic|Dub)\s+(verification|code|notification|alert|payment|commission)\b/gi
        ];

        for (const pattern of brandBusinessPatterns) {
            const matches = [...cleanSubject.matchAll(pattern)];
            if (matches.length > 0) {
                let brandName = matches[0][2] || matches[0][1]; // 适配不同捕获组
                brandName = brandName.charAt(0).toUpperCase() + brandName.slice(1).toLowerCase();
                console.log(`[主体词提取] 品牌+业务模式: "${brandName}"`);
                return brandName;
            }
        }

        // 🎯 模式3: "Welcome to [Brand]" - 提取品牌名
        const welcomeToPattern = /(?:Welcome\s+to|Join|Start\s+using)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i;
        match = cleanSubject.match(welcomeToPattern);
        if (match && match.length > 1) {
            let brandName = match[1] ? match[1].trim() : '';
            // 如果是多词组合，尝试找到主要品牌词
            if (brandName.includes(' ')) {
                const words = brandName.split(' ');
                for (const word of words) {
                    if (knownBrands.has(word) && word.length > 2) {
                        console.log(`[主体词提取] Welcome to 模式（多词提取）: "${word}"`);
                        return word;
                    }
                }
                // 如果没有找到已知品牌，使用第一个词
                brandName = words[0];
            }
            console.log(`[主体词提取] Welcome to 模式: "${brandName}"`);
            return brandName;
        }

        // 🎯 模式4: via/from/through + [Brand] - 提取品牌名
        const viaPattern = /\b(via|from|through)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi;
        const viaMatches = [...subject.matchAll(viaPattern)];
        if (viaMatches.length > 0) {
            let brandName = viaMatches[0][2].trim();
            // 如果是多词组合，只取第一个主要词
            if (brandName.includes(' ')) {
                const words = brandName.split(' ');
                for (const word of words) {
                    if (knownBrands.has(word) && word.length > 2) {
                        console.log(`[主体词提取] Via 模式（多词提取）: "${word}"`);
                        return word;
                    }
                }
                brandName = words[0];
            }
            console.log(`[主体词提取] Via 模式: "${brandName}"`);
            return brandName;
        }

        // 🎯 模式5: 查找所有大写词汇，选择最可能的品牌名
        const capitalizedWords = [...subject.matchAll(/\b([A-Z][a-z]+)\b/g)];
        if (capitalizedWords.length > 0) {
            // 过滤掉常见词汇
            const commonWords = new Set(['You', 'Your', 'This', 'That', 'With', 'From', 'Have', 'Has', 'Been', 'Made', 'Just', 'Now', 'Welcome', 'Please', 'Click', 'Here', 'Link', 'Button']);

            // 按优先级选择：已知品牌 > 长度 > 位置
            let candidates = capitalizedWords.map(m => m[1])
                .filter(word => !commonWords.has(word) && word.length > 2)
                .sort((a, b) => {
                    // 已知品牌优先
                    if (knownBrands.has(a) && !knownBrands.has(b)) return -1;
                    if (!knownBrands.has(a) && knownBrands.has(b)) return 1;
                    // 长度优先
                    return b.length - a.length;
                });

            if (candidates.length > 0) {
                const selected = candidates[0];
                console.log(`[主体词提取] 大写词汇选择: "${selected}" (候选: [${candidates.slice(0, 3).join(', ')}])`);
                return selected;
            }
        }

        // 🎯 回退到发件人邮箱识别
        if (email.From && email.From.EmailAddress && email.From.EmailAddress.Address) {
            const realEmail = email.From.EmailAddress.Address;
            const senderName = email.From.EmailAddress.Name || '';

            console.log(`[主体词提取] 真实发件人信息: 邮箱="${realEmail}", 姓名="${senderName}"`);

            // 优先使用发件人姓名（提取主要品牌词）
            if (senderName && senderName !== 'Mail' && senderName !== 'noreply' && senderName !== 'no-reply') {
                if (senderName.length > 2 && !/^\d+$/.test(senderName)) {
                    // 提取发件人姓名中的主要词汇
                    const nameWords = senderName.split(/\s+/);
                    for (const word of nameWords) {
                        const capitalizedWord = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                        if (knownBrands.has(capitalizedWord) && capitalizedWord.length > 2) {
                            console.log(`[主体词提取] 发件人姓名品牌词: "${capitalizedWord}"`);
                            return capitalizedWord;
                        }
                    }
                    // 如果没有找到品牌词，使用第一个有意义的词
                    const firstWord = nameWords[0];
                    if (firstWord && firstWord.length > 2) {
                        const formattedName = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
                        console.log(`[主体词提取] 发件人姓名首词: "${formattedName}"`);
                        return formattedName;
                    }
                }
            }

            // 使用邮箱域名
            const domain = realEmail.split('@')[1];
            if (domain) {
                const domainParts = domain.split('.');
                let domainName = domainParts[0];

                // 处理常见邮箱服务商
                const commonEmailProviders = {
                    'gmail': 'Gmail',
                    'outlook': 'Outlook',
                    'hotmail': 'Hotmail',
                    'yahoo': 'Yahoo',
                    'qq': 'QQ Mail',
                    '163': '163 Mail',
                    '126': '126 Mail',
                    'icloud': 'iCloud',
                    'protonmail': 'ProtonMail',
                    'zoho': 'Zoho Mail'
                };

                if (commonEmailProviders[domainName]) {
                    console.log(`[主体词提取] 邮箱服务商: ${commonEmailProviders[domainName]}`);
                    return commonEmailProviders[domainName];
                }

                // 对于非通用域名，提取有意义的名称
                if (domainName.length > 2 && !/^\d+$/.test(domainName)) {
                    const formattedDomain = domainName.charAt(0).toUpperCase() + domainName.slice(1);
                    console.log(`[主体词提取] 邮箱域名: "${formattedDomain}"`);
                    return formattedDomain;
                }
            }
        }

        // 🎯 最后回退：查找已知品牌关键词
        const subjectLower = subject.toLowerCase();
        const brandKeywords = {
            'google': 'Google',
            'microsoft': 'Microsoft',
            'apple': 'Apple',
            'amazon': 'Amazon',
            'meta': 'Meta',
            'facebook': 'Facebook',
            'comet': 'Comet',
            'perplexity': 'Perplexity',
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'dub': 'Dub',
            'verification': 'Verification',
            'commission': 'Commission',
            'payment': 'Payment',
            'notification': 'Notification'
        };

        for (const [keyword, brand] of Object.entries(brandKeywords)) {
            if (subjectLower.includes(keyword)) {
                console.log(`[主体词提取] 关键词匹配: "${brand}"`);
                return brand;
            }
        }

        // 默认返回
        console.log(`[主体词提取] 未能识别主体词，返回默认 "unknown"`);
        return 'unknown';
    } catch (error) {
        console.error('[主体词提取] 提取失败:', error);
        return 'unknown';
    }
}

// 邮政编码过滤函数 - 检查是否为邮政编码或地址中的数字
function isZipCodeOrAddressNumber(text, code, codePosition) {
    if (!text || !code || codePosition === undefined) return false;

    // 获取代码前后的上下文（各30个字符）
    const start = Math.max(0, codePosition - 30);
    const end = Math.min(text.length, codePosition + code.length + 30);
    const context = text.substring(start, end);

    console.log(`[邮政编码检查] 代码: ${code}, 上下文: "${context}"`);

    // 1. 检查美国州缩写 + 邮政编码格式
    const statePattern = /\b(AK|AL|AR|AZ|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+\d{5,6}\b/gi;
    if (statePattern.test(context)) {
        console.log(`[邮政编码检查] 匹配到州缩写+邮政编码格式: ${code}`);
        return true;
    }

    // 2. 检查完整地址格式 (Street, City, ST ZIP)
    const addressPattern = /\b(St|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way),\s*[^,]+,\s*[A-Z]{2}\s+\d{5,6}\b/gi;
    if (addressPattern.test(context)) {
        console.log(`[邮政编码检查] 匹配到完整地址格式: ${code}`);
        return true;
    }

    // 3. 检查标准邮政编码格式
    const zipCodePattern = /\b\d{5}(-\d{4})?\b/g;
    if (zipCodePattern.test(context)) {
        // 进一步检查是否为6位数的邮政编码（一些国际格式）
        if (code.length === 6) {
            // 检查是否为常见的国际邮政编码前缀
            const internationalZipPatterns = [
                /\b(Canada|CA)\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i,  // 加拿大格式
                /\b(UK|GB)\s+([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i,  // 英国格式
                /\b(Germany|DE)\s+\d{5}\b/i,  // 德国格式
                /\b(France|FR)\s+\d{5}\b/i,  // 法国格式
                /\b(Japan|JP)\s+\d{3}-\d{4}\b/i,  // 日本格式
                /\b(Australia|AU)\s+\d{4}\b/i  // 澳大利亚格式
            ];

            for (const pattern of internationalZipPatterns) {
                if (pattern.test(context)) {
                    console.log(`[邮政编码检查] 匹配到国际邮政编码格式: ${code}`);
                    return true;
                }
            }
        }
    }

    // 4. 检查常见的城市名+邮政编码组合
    const cityZipPatterns = [
        /\b(San Francisco|New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose|Austin|Jacksonville|Fort Worth|Columbus|Charlotte|San Francisco|Indianapolis|Seattle|Denver|Washington|Boston|El Paso|Nashville|Detroit|Oklahoma City|Portland|Las Vegas|Memphis|Louisville|Milwaukee|Baltimore|Albuquerque|Tucson|Fresno|Sacramento|Kansas City|Mesa|Atlanta|Omaha|Colorado Springs|Raleigh|Miami|Oakland|Tulsa|Minneapolis|Cleveland|Wichita|Arlington|Tampa|New Orleans|Honolulu|Anaheim|Santa Ana|Corpus Christi|Riverside|Lexington|Stockton|St. Paul|Cincinnati|Greensboro|Pittsburgh|Anchorage|Plano|Henderson|Lincoln|Orlando|Durham|Chula Vista|Newark|Chandler|St. Petersburg|Laredo|Norfolk|Madison|Lubbock|Scottsdale|Reno|Glendale|Gilbert|Winston Salem|North Las Vegas|Hialeah|Garland|Arlington|Akron|Buffalo|Irving| Fremont|Rochester|Boise|Spokane|Birmingham|Montgomery)\s+,[A-Z]{2}\s+\d{5,6}\b/gi
    ];

    for (const pattern of cityZipPatterns) {
        if (pattern.test(context)) {
            console.log(`[邮政编码检查] 匹配到城市名+邮政编码格式: ${code}`);
            return true;
        }
    }

    // 5. 检查是否为电话号码片段
    const phonePattern = /\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\(\d{3}\)\s*\d{3}[-.\s]?\d{4})\b/g;
    if (phonePattern.test(context)) {
        console.log(`[邮政编码检查] 匹配到电话号码格式: ${code}`);
        return true;
    }

    console.log(`[邮政编码检查] 未匹配到邮政编码模式: ${code}`);
    return false;
}

// 验证码提取算法（优化版 - 6位纯数字 + HTML清理 + 邮政编码过滤）
function extractVerificationCode(subject, body) {
    if (!subject && !body) return null;

    // 清理HTML标签
    const cleanSubject = subject || '';
    const cleanBody = stripHtmlTags(body || '');
    const text = `${cleanSubject} ${cleanBody}`;

    // 添加调试日志
    console.log(`[验证码提取] 邮件主题: "${cleanSubject}"`);
    console.log(`[验证码提取] 邮件正文前100字符: "${cleanBody.substring(0, 100)}..."`);
    console.log(`[验证码提取] 合并文本前200字符: "${text.substring(0, 200)}..."`);

    // 高可信度模式 - 必须包含验证码相关关键词
    const highPatterns = [
        /(?:verification code|验证码|验证码为|code is|your code is|安全码|安全验证|verification|authenticate)[\s:：\n\-]*(\d{6})/gi,
        /(?:confirm|activate|verify|authenticate)[\s\S]{0,50}?(\d{6})/gi
    ];

    // 改进的中等可信度模式 - 6位纯数字 + 上下文检查
    const mediumPatterns = [
        /\b(\d{6})\b/g  // 6位数字
    ];

    // 先尝试高可信度模式
    console.log(`[验证码提取] 尝试高可信度模式匹配...`);
    for (const pattern of highPatterns) {
        const matches = text.match(pattern);
        console.log(`[验证码提取] 高可信度模式匹配结果:`, matches);
        if (matches && matches.length > 0) {
            for (const match of matches) {
                const code = match.match(/(\d{6})/);
                if (code && code[1]) {
                    console.log(`[验证码提取] 高可信度模式找到验证码: ${code[1]}`);
                    return code[1];
                }
            }
        }
    }

    // 再尝试中等可信度模式（带邮政编码过滤）
    console.log(`[验证码提取] 尝试中等可信度模式匹配（带邮政编码过滤）...`);
    const mediumMatches = text.match(mediumPatterns[0]);
    console.log(`[验证码提取] 中等可信度模式匹配结果:`, mediumMatches);

    if (mediumMatches && mediumMatches.length > 0) {
        // 过滤掉邮政编码和地址数字
        const filteredCodes = [];

        for (const potentialCode of mediumMatches) {
            // 找到该代码在文本中的位置
            const codePosition = text.indexOf(potentialCode);

            // 检查是否为邮政编码或地址数字
            if (!isZipCodeOrAddressNumber(text, potentialCode, codePosition)) {
                filteredCodes.push(potentialCode);
                console.log(`[验证码提取] 保留有效验证码: ${potentialCode}`);
            } else {
                console.log(`[验证码提取] 过滤掉邮政编码/地址数字: ${potentialCode}`);
            }
        }

        // 返回第一个有效的6位数字
        if (filteredCodes.length > 0) {
            console.log(`[验证码提取] 找到有效验证码: ${filteredCodes[0]}`);
            return filteredCodes[0];
        }
    }

    console.log(`[验证码提取] 未找到验证码`);
    return null;
}

// 辅助函数：提取验证码（兼容旧版本）
// 邮箱导入行解析函数（与前端Utils.parseImportLine完全一致）
function parseImportLine(line) {
    console.log(`[Parse Debug] 解析行:`, line);
    // 预处理：移除行首行尾空白
    line = line.trim();
    if (!line) {
        console.warn(`[Parse] 空行，跳过`);
        return null;
    }
    // 智能解析：先按----分割，如果不是4个字段，再按连续的-分割
    let parts = line.split('----');
    console.log(`[Parse Debug] 第一次分割结果:`, parts, `字段数: ${parts.length}`);
    if (parts.length !== 4) {
        // 如果不是4个字段，尝试智能重构
        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const uuidMatch = line.match(uuidRegex);
        console.log(`[Parse Debug] UUID匹配结果:`, uuidMatch);
        if (uuidMatch) {
            const uuidIndex = line.indexOf(uuidMatch[0]);
            const beforeUuid = line.substring(0, uuidIndex).trim();
            const afterUuid = line.substring(uuidIndex + uuidMatch[0].length).trim();
            const beforeParts = beforeUuid.split(/-+/);
            if (beforeParts.length >= 2) {
                parts = [
                    beforeParts[0],
                    beforeParts[1],
                    uuidMatch[0],
                    afterUuid.replace(/^-+/, '')
                ];
                console.log(`[Parse Debug] 智能重构结果:`, parts);
            }
        }
    }
    if (parts.length < 4) {
        console.warn(`[Parse] 无效数据格式，期望4个字段，实际${parts.length}个:`, line);
        console.warn(`[Parse] 字段详情:`, parts.map((p, i) => `字段${i+1}: "${p}"`));
        return null;
    }
    const [email, password, client_id, refresh_token_enc] = parts;
    // 验证每个字段
    if (!email || !email.includes('@')) {
        console.warn(`[Parse] 无效的邮箱地址: "${email}"`);
        return null;
    }
    if (!client_id || client_id.length < 10) {
        console.warn(`[Parse] 无效的client_id: "${client_id}"`);
        return null;
    }
    if (!refresh_token_enc || refresh_token_enc.length < 10) {
        console.warn(`[Parse] 无效的refresh_token: "${refresh_token_enc?.substring(0, 20)}..."`);
        return null;
    }
    const result = {
        email: email.trim(),
        password: password ? password.trim() : '',
        client_id: client_id.trim(),
        refresh_token: refresh_token_enc.trim()
    };
    console.log(`[Parse Debug] 最终解析结果:`, {
        email: result.email,
        hasClientId: !!result.client_id,
        clientIdLength: result.client_id.length,
        hasRefreshToken: !!result.refresh_token,
        refreshTokenLength: result.refresh_token.length
    });
    return result;
}

function extractVerificationCodes(emails) {
    const codes = [];
    emails.forEach(email => {
        // 处理Microsoft Graph API的Pascal命名��和camelCase命名法
        const subject = email.Subject || email.subject || '';
        const bodyContent = email.Body?.Content || email.body?.content || '';
        // 从邮件主题中提取发件人关键词作为显示名称
        const senderName = extractSenderEmail(email);
        const receivedTime = email.ReceivedDateTime || email.receivedDateTime; // 🔧 KISS原则: 直接使用UTC时间

        const code = extractVerificationCode(subject, bodyContent);
        if (code) {
            // 🔧 调试：记录时间数据以诊断时间显示问题
            console.log(`[验证码提取] 提取到验证码: ${code}`);
            console.log(`[验证码提取] 邮件接收时间: ${receivedTime}`);
            console.log(`[验证码提取] 邮件主题: ${subject}`);
            console.log(`[验证码提取] 发件人: ${senderName}`);

            codes.push({
                code: code,
                sender: senderName,
                received_at: receivedTime, // UTC时间，简单可靠
                subject: subject
            });
        }
    });
    return codes;
}

// Microsoft Token API
app.post('/api/microsoft/token', async (req, res) => {
    try {
        const { client_id, client_secret, code, redirect_uri, grant_type, refresh_token } = req.body;

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

// 手动获取邮件API
app.post('/api/manual-fetch-emails', async (req, res) => {
    try {
        const { sessionId, email_id, email, type, password, client_id, refresh_token, current_status } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        console.log(`[手动取件] 开始取件: ${email}, 类型: ${type}, 账户ID: ${email_id} (会话: ${sessionId})`);

        let emails;
        if (type === 'yahoo') {
            // Yahoo邮箱：直接使用IMAP获取，与Outlook保持一致，每个文件夹5封邮件，最多15封邮件
            try {
                console.log(`[手动取件] Yahoo邮箱获取邮件: ${email}`);
                emails = await fetchEmailsFromYahoo(email, password, 15);
                console.log(`[手动取件] Yahoo邮箱获取成功: ${email}, 邮件数: ${emails.length}`);
            } catch (yahooError) {
                console.error(`[手动取件] Yahoo邮箱获取失败: ${email}`, yahooError.message);
                return res.status(403).json({
                    success: false,
                    error: 'Yahoo邮箱连接失败，请检查邮箱配置',
                    status: 'reauth_required'
                });
            }
        } else {
            // Outlook邮箱：使用OAuth API获取邮件，每个文件夹5封邮件，共3个文件夹最多15封
            try {
                console.log(`[手动取件] Outlook邮箱获取邮件: ${email}`);
                let tokenResult;
                try {
                    tokenResult = await refreshToken(refresh_token, client_id, '');
                } catch (tokenError) {
                    console.error(`[手动取件] Token刷新失败: ${email}`, tokenError.message);
                    return res.status(403).json({
                        success: false,
                        error: 'Token刷新失败，请重新授权',
                        status: 'reauth_required'
                    });
                }

                // 获取邮件
                emails = await fetchEmailsFromMicrosoft(tokenResult.access_token);
                console.log(`[手动取件] Outlook邮箱获取成功: ${email}, 邮件数: ${emails.length}`);
            }
        }

        // 提取验证码
        const verificationCodes = extractVerificationCodes(emails);
        const latestCode = verificationCodes.length > 0 ? verificationCodes[0] : null;

        // 更新账户信息
        const account = {
            id: email_id,
            email: email,
            type: type || 'outlook', // 添加邮箱类型
            password: type === 'yahoo' ? password : '', // Yahoo需要保存密码
            client_id: type === 'outlook' ? client_id : '',
            refresh_token: type === 'outlook' ? refresh_token : '',
            access_token: type === 'outlook' ? (tokenResult ? tokenResult.access_token : '') : '',
            status: 'active',
            last_checked: new Date().toISOString(),
            email_count: emails.length,
            verification_code: latestCode,
            emails: emails
        };

        accountStore.set(email_id, account);

        // 发送事件通知
        emitEvent({
            type: 'manual_fetch_complete',
            sessionId: sessionId,
            email_id: email_id,
            email: email,
            email_count: emails.length,
            verification_codes: verificationCodes,
            latest_code: latestCode,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `获取到 ${emails.length} 封邮件`,
            emails: emails,
            verification_codes: verificationCodes,
            latest_code: latestCode,
            account: account
        });

    } catch (error) {
        console.error('[手动取件] 错误:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 验证码提取API
app.post('/api/extract-verification-codes', async (req, res) => {
    try {
        const { emails } = req.body;

        if (!emails || !Array.isArray(emails)) {
            return res.status(400).json({
                error: '缺少emails参数或格式不正确'
            });
        }

        console.log(`[验证码提取] 收到提取请求，邮件数量: ${emails.length}`);

        const verificationCodes = extractVerificationCodes(emails);

        console.log(`[验证码提取] 提取结果: ${verificationCodes.length} 个验证码`);

        res.json({
            success: true,
            verification_codes: verificationCodes,
            count: verificationCodes.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[验证码提取] 提取失败:', error);
        res.status(500).json({
            error: '验证码提取失败',
            message: error.message
        });
    }
});

// 账户验证同步API
app.post('/api/accounts/verify-sync', async (req, res) => {
    try {
        const { sessionId, accounts } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        console.log(`[验证同步] 开始同步 ${accounts ? accounts.length : 0} 个账户`);

        const results = [];
        let successCount = 0;
        let failureCount = 0;

        if (Array.isArray(accounts)) {
            for (const accountData of accounts) {
                try {
                    const { email_id, email, client_id, refresh_token } = accountData;

                    // 验证token
                    const tokenResult = await refreshToken(refresh_token, client_id, '');

                    if (tokenResult && tokenResult.access_token) {
                        successCount++;
                        results.push({
                            email_id: email_id,
                            email: email,
                            success: true,
                            status: 'active',
                            access_token: tokenResult.access_token
                        });
                    } else {
                        failureCount++;
                        results.push({
                            email_id: email_id,
                            email: email,
                            success: false,
                            status: 'reauth_required'
                        });
                    }
                } catch (error) {
                    failureCount++;
                    results.push({
                        email_id: accountData.email_id,
                        email: accountData.email,
                        success: false,
                        status: 'failed',
                        error: error.message
                    });
                }
            }
        }

        res.json({
            success: true,
            message: `验证同步完成: ${successCount} 成功, ${failureCount} 失败`,
            results: results,
            success_count: successCount,
            failure_count: failureCount
        });

    } catch (error) {
        console.error('[验证同步] 错误:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 直接刷新Token API
app.post('/api/accounts/refresh-token-direct', async (req, res) => {
    try {
        const { email, client_id, refresh_token } = req.body;

        if (!email || !client_id || !refresh_token) {
            return res.status(400).json({
                error: '缺少必需参数: email, client_id, refresh_token'
            });
        }

        console.log(`[直接Token刷新] 开始刷新Token: ${email}`);

        const tokenResult = await refreshToken(refresh_token, client_id, '');

        if (!tokenResult || !tokenResult.access_token) {
            throw new Error('Token刷新失败：未获取到有效访问令牌');
        }

        console.log(`[直接Token刷新] Token刷新成功: ${email}`);

        res.json({
            success: true,
            email: email,
            access_token: tokenResult.access_token,
            refresh_token: tokenResult.refresh_token || refresh_token,
            expires_in: tokenResult.expires_in,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[直接Token刷新] Token刷新失败:', error.message);
        res.status(500).json({
            error: 'Token刷新失败',
            message: error.message,
            email: req.body.email
        });
    }
});

// 服务器信息API
app.get('/api/info', (req, res) => {
    res.json({
        name: 'MailManager 简化版代理服务器',
        version: '1.0.0-simple',
        description: '纯前端架构的邮件管理系统',
        features: [
            'Microsoft OAuth 代理',
            '邮件获取API代理',
            '实时监控WebSocket',
            '批量导入处理',
            '验证码提取'
        ],
        endpoints: {
            oauth: {
                authorize: '/oauth/authorize',
                callback: '/oauth/callback',
                token: '/oauth/token'
            },
            api: {
                health: '/api/health',
                validate_email: '/api/validate-email',
                batch_import: '/api/accounts/batch-import',
                monitor_trigger: '/api/monitor/copy-trigger',
                manual_fetch: '/api/manual-fetch-emails',
                verify_sync: '/api/accounts/verify-sync',
                microsoft_token: '/api/microsoft/token'
            }
        },
        architecture: 'pure_frontend',
        timestamp: new Date().toISOString()
    });
});

// 统计信息API
app.get('/api/stats', (req, res) => {
    const totalAccounts = accountStore.size;
    const activeAccounts = Array.from(accountStore.values()).filter(a => a.current_status === 'active').length;
    const pendingAccounts = Array.from(accountStore.values()).filter(a => a.current_status === 'pending').length;
    const activeMonitorsCount = activeMonitors.size;

    res.json({
        accounts: {
            total: totalAccounts,
            active: activeAccounts,
            pending: pendingAccounts,
            reauth_required: totalAccounts - activeAccounts - pendingAccounts
        },
        monitors: {
            active: activeMonitorsCount,
            running_sessions: Array.from(activeMonitors.keys()).length
        },
        system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            node_version: process.version,
            timestamp: new Date().toISOString()
        }
    });
});

// 事件触发API
app.post('/api/events/trigger', async (req, res) => {
    try {
        const { sessionId, type, data } = req.body;

        if (!type) {
            return res.status(400).json({
                error: '缺少事件类型'
            });
        }

        console.log(`[事件触发] 触发事件: ${type}, sessionId: ${sessionId || 'none'}`);

        const eventData = {
            type: type,
            sessionId: sessionId,
            data: data || {},
            timestamp: new Date().toISOString()
        };

        // 发送WebSocket事件
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(eventData));
            }
        });

        // 发送SSE事件
        const sessions = eventConnections.get(sessionId);
        if (sessions && sessions.length > 0) {
            const eventDataStr = `data: ${JSON.stringify(eventData)}\n\n`;
            sessions.forEach(res => {
                if (!res.destroyed) {
                    res.write(eventDataStr);
                }
            });
        }

        res.json({
            success: true,
            message: '事件触发成功',
            event: eventData
        });

    } catch (error) {
        console.error('[事件触发] 事件触发失败:', error);
        res.status(500).json({
            error: '事件触发失败',
            message: error.message
        });
    }
});

// 事件流API (Server-Sent Events)
app.get('/api/events/stream/:sessionId?', (req, res) => {
    const { sessionId } = req.params;

    // 设置SSE响应头
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    console.log(`[SSE] 客户端连接: ${sessionId || 'anonymous'}`);

    // 发送连接确认
    res.write(`data: ${JSON.stringify({
        type: 'connection_established',
        sessionId: sessionId,
        timestamp: new Date().toISOString(),
        message: 'SSE连接已建立'
    })}\n\n`);

    // 定期发送心跳（每30秒）
    const heartbeat = setInterval(() => {
        res.write(`data: ${JSON.stringify({
            type: 'heartbeat',
            sessionId: sessionId,
            timestamp: new Date().toISOString()
        })}\n\n`);
    }, 30000);

    // 处理客户端断开连接
    req.on('close', () => {
        clearInterval(heartbeat);
        console.log(`[SSE] 客户端断开: ${sessionId || 'anonymous'}`);
    });

    req.on('error', (error) => {
        clearInterval(heartbeat);
        console.error(`[SSE] 连接错误: ${sessionId || 'anonymous'}`, error);
    });
});

// 清空所有数据API
app.post('/api/accounts/clear-all', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        console.log(`[清空数据] 清理会话 ${sessionId} 的数据`);

        // 清理该会话的账户数据
        let clearedCount = 0;
        for (const [accountId, account] of accountStore.entries()) {
            // 停止相关监控
            const monitorId = `${sessionId}_${accountId}`;
            if (activeMonitors.has(monitorId)) {
                stopMonitoring(monitorId, '数据清理');
            }
            accountStore.delete(accountId);
            clearedCount++;
        }

        // 发送清空完成事件
        emitEvent({
            type: 'data_cleared',
            sessionId: sessionId,
            cleared_count: clearedCount,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `已清空 ${clearedCount} 个账户的数据`,
            cleared_count: clearedCount
        });

    } catch (error) {
        console.error('[清空数据] 错误:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== 代理设置相关API ==========

// 代理IP获取接口
app.post('/api/proxy/fetch', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            success: false,
            error: '缺少代理URL参数'
        });
    }

    // 验证URL格式
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (e) {
        return res.status(400).json({
            success: false,
            error: 'URL格式无效'
        });
    }

    if (parsedUrl.protocol !== 'https:') {
        return res.status(400).json({
            success: false,
            error: 'URL必须使用https协议'
        });
    }

    try {
        console.log(`[代理API] 正在获取代理IP: ${url}`);

        // 使用fetch获取代理IP
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/plain, text/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 15000 // 15秒超时
        });

        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
        }

        const proxyData = await response.text();
        const trimmedData = proxyData.trim();

        if (!trimmedData) {
            throw new Error('返回数据为空');
        }

        console.log(`[代理API] 成功获取代理IP: ${trimmedData.substring(0, 20)}...`);

        res.json({
            success: true,
            proxyData: trimmedData,
            message: '代理IP获取成功'
        });

    } catch (error) {
        console.error('[代理API] 获取代理IP失败:', error);

        let errorMessage = '获取代理IP失败';
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
            errorMessage = '请求超时，请检查网络连接或重试';
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = '域名解析失败，请检查URL是否正确';
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage = '连接被拒绝，请检查代理服务是否可用';
        } else if (error.code === 'ECONNRESET') {
            errorMessage = '连接被重置，请重试';
        } else {
            errorMessage = error.message || errorMessage;
        }

        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
});

// Windows系统代理配置接口
app.post('/api/proxy/configure', async (req, res) => {
    const { host, port, username, password } = req.body;

    // 验证参数
    if (!host || !port || !username || !password) {
        return res.status(400).json({
            success: false,
            error: '缺少代理配置参数'
        });
    }

    // 验证端口号
    if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({
            success: false,
            error: '端口号无效，必须在1-65535之间'
        });
    }

    try {
        console.log(`[代理配置] 开始配置Windows系统代理: ${host}:${port}`);

        // 注意：操作系统检测移至前端，后端不再限制操作系统
        // 这样可以在客户端浏览器中检测实际用户的操作系统
        console.log(`[代理配置] 开始配置系统代理: ${host}:${port} (操作系统检测移至前端)`);

        // 构建PowerShell命令
        const proxyServer = `${host}:${port}`;

        // PowerShell脚本内容
        const powershellScript = `
# 设置系统代理
try {
    Write-Host "正在配置系统代理..."

    # 设置注册表代理配置
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyEnable -Value 1 -Type DWord -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyServer -Value "${proxyServer}" -Type String -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyOverride -Value "<local>" -Type String -Force

    # 设置WinHTTP代理
    & netsh winhttp set proxy ${proxyServer} "<local>"

    # 刷新系统设置
    & ipconfig /flushdns > $null

    # 通知系统代理设置已更改
    $signature = @"
[DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
"@

    $type = Add-Type -MemberDefinition $signature -Name WinINet -Namespace System -PassThru
    $INTERNET_OPTION_SETTINGS_CHANGED = 39
    $INTERNET_OPTION_REFRESH = 37
    $type::InternetSetOption(0, $INTERNET_OPTION_SETTINGS_CHANGED, 0, 0)
    $type::InternetSetOption(0, $INTERNET_OPTION_REFRESH, 0, 0)

    Write-Host "系统代理配置完成！"
    Write-Host "代理服务器: ${proxyServer}"
    Write-Host "用户名: ${username}"

    exit 0
} catch {
    Write-Host "配置失败: $($_.Exception.Message)"
    exit 1
}
        `;

        // 执行PowerShell命令
        const { spawn } = require('child_process');

        const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', '-'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        // 发送PowerShell脚本
        ps.stdin.write(powershellScript);
        ps.stdin.end();

        let output = '';
        let errorOutput = '';

        ps.stdout.on('data', (data) => {
            output += data.toString();
        });

        ps.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        // 等待PowerShell执行完成
        const result = await new Promise((resolve, reject) => {
            ps.on('close', (code) => {
                if (code === 0) {
                    console.log('[代理配置] PowerShell执行成功');
                    console.log('[代理配置] 输出:', output);
                    resolve({ success: true, output: output.trim() });
                } else {
                    console.error('[代理配置] PowerShell执行失败，退出码:', code);
                    console.error('[代理配置] 错误输出:', errorOutput);
                    reject(new Error(`PowerShell执行失败 (退出码: ${code}): ${errorOutput}`));
                }
            });

            ps.on('error', (error) => {
                console.error('[代理配置] PowerShell进程错误:', error);
                reject(new Error(`无法启动PowerShell: ${error.message}`));
            });

            // 设置超时
            setTimeout(() => {
                ps.kill();
                reject(new Error('PowerShell执行超时'));
            }, 30000); // 30秒超时
        });

        res.json({
            success: true,
            message: `系统代理配置成功！\n代理服务器: ${proxyServer}\n用户名: ${username}\n\n请打开浏览器访问 https://ip111.cn/ 验证代理是否生效。`,
            details: result.output
        });

    } catch (error) {
        console.error('[代理配置] 配置系统代理失败:', error);

        let errorMessage = '配置系统代理失败';
        if (error.message.includes('Access is denied')) {
            errorMessage = '权限不足，请以管理员身份运行此应用';
        } else if (error.message.includes('PowerShell')) {
            errorMessage = `PowerShell执行失败: ${error.message}`;
        } else {
            errorMessage = error.message || errorMessage;
        }

        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
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