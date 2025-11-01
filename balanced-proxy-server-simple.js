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
                // 获取access token
                const tokenResult = await refreshToken(account.refresh_token, account.client_id, '');

                // 获取邮件
                const emails = await fetchEmailsFromMicrosoft(tokenResult.access_token);

                if (emails && emails.length > 0) {
                    console.log(`[邮件] 获取到 ${emails.length} 封邮件`);

                    // 提取验证码
                    const verificationCodes = extractVerificationCodes(emails);

                    if (verificationCodes.length > 0) {
                        const latestCode = verificationCodes[0]; // 已经按时间排序
                        console.log(`[验证码] 发现验证码: ${latestCode.code} (发件人: ${latestCode.sender})`);

                        // 更新账户信息
                        account.verification_code = latestCode;
                        account.last_checked = new Date().toISOString();
                        account.email_count = emails.length;
                        accountStore.set(account.id, account);

                        // 发送验证码发现事件
                        emitEvent({
                            type: 'verification_code_found',
                            sessionId: sessionId,
                            account_id: account.id,
                            email: account.email,
                            code: latestCode.code,
                            sender: latestCode.sender,
                            subject: latestCode.subject,
                            received_at: latestCode.received_time,
                            timestamp: new Date().toISOString()
                        });

                        // 发现验证码后停止监控
                        console.log(`[监控] 发现验证码，停止监控: ${account.email}`);
                        stopMonitoring(monitorId, '已获取验证码');
                    }
                }
            } catch (error) {
                console.error(`[监控检查] 错误: ${account.email}`, error.message);
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
            account_id: monitorTask.account.id,
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

// 监控API - 复制邮箱触发监控
app.post('/api/monitor/copy-trigger', async (req, res) => {
    try {
        const {
            sessionId,
            account_id,
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

        console.log(`[监控触发] 复制邮箱: ${email}, 账户ID: ${account_id} (会话: ${sessionId})`);
        console.log(`[监控触发] 账户状态: ${current_status}`);

        // 账户状态检查和处理
        let finalStatus = current_status;

        if (current_status === 'reauth_required') {
            console.log(`[监控触发] 账户 ${email} 状态为 reauth_required，将尝试重新授权`);

            // 尝试重新授权（刷新token）
            try {
                const tokenResult = await refreshToken(refresh_token, client_id, '');
                if (tokenResult && tokenResult.access_token) {
                    finalStatus = 'active';
                    console.log(`[监控触发] 账户 ${email} 重新授权成功，状态更新为 active`);

                    // 通知前端重新授权成功
                    emitEvent({
                        type: 'account_status_changed',
                        sessionId: sessionId,
                        account_id: account_id,
                        email: email,
                        status: 'active',
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
                    account_id: account_id,
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
            console.log(`[验证码基准] 无验证码邮件时间，将获取最新5封邮件`);
        }

        // 创建账户对象
        const account = {
            id: account_id,
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
        accountStore.set(account_id, account);

        // 启动1分钟监控
        startMonitoring(sessionId, account, 60000);

        // 统一事件通知
        emitEvent({
            type: 'monitoring_started',
            sessionId: sessionId,
            account_id: account_id,
            email: email,
            duration: 60000,
            time_filter: timeFilter,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: '已启动1分钟监控，将自动检查新邮件',
            account_id: account_id,
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
        const { sessionId, account_id, email, client_id, refresh_token, current_status } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        console.log(`[手动取件] 开始取件: ${email}, 账户ID: ${account_id} (会话: ${sessionId})`);

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
        const emails = await fetchEmailsFromMicrosoft(tokenResult.access_token);
        console.log(`[手动取件] 获取到 ${emails.length} 封邮件`);

        // 提取验证码
        const verificationCodes = extractVerificationCodes(emails);
        const latestCode = verificationCodes.length > 0 ? verificationCodes[0] : null;

        // 更新账户信息
        const account = {
            id: account_id,
            email: email,
            client_id: client_id,
            refresh_token: refresh_token,
            access_token: tokenResult.access_token,
            status: 'active',
            last_checked: new Date().toISOString(),
            email_count: emails.length,
            verification_code: latestCode,
            emails: emails
        };

        accountStore.set(account_id, account);

        // 发送事件通知
        emitEvent({
            type: 'manual_fetch_complete',
            sessionId: sessionId,
            account_id: account_id,
            email: email,
            email_count: emails.length,
            verification_code: latestCode,
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
                    const { account_id, email, client_id, refresh_token } = accountData;

                    // 验证token
                    const tokenResult = await refreshToken(refresh_token, client_id, '');

                    if (tokenResult && tokenResult.access_token) {
                        successCount++;
                        results.push({
                            account_id: account_id,
                            email: email,
                            success: true,
                            status: 'active',
                            access_token: tokenResult.access_token
                        });
                    } else {
                        failureCount++;
                        results.push({
                            account_id: account_id,
                            email: email,
                            success: false,
                            status: 'reauth_required'
                        });
                    }
                } catch (error) {
                    failureCount++;
                    results.push({
                        account_id: accountData.account_id,
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