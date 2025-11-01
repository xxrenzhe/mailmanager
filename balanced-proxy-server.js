/**
 * 平衡版代理服务器 - KISS原则 + 核心业务功能
 * 保持简洁的同时恢复关键业务逻辑
 */

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const WebSocket = require('ws');
const https = require('https');
const querystring = require('querystring');
const EventEmitter = require('events');

const app = express();
const PORT = process.env.PROXY_PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// 基础中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// 创建事件发射器用于SSE
const eventEmitter = new EventEmitter();
let connectedClients = new Set();

// ========== 核心数据存储 ==========
const accountStore = new Map(); // 存储账户信息
const sequenceStore = new Map(); // 存储序列号
const activeMonitors = new Map(); // 存储监控任务
let maxSequence = 0;

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

// ========== 核心业务功能 ==========
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const OUTLOOK_API = 'https://outlook.office.com/api/v2.0';

// 1. 序列号分配
function assignSequence(email) {
    if (sequenceStore.has(email)) {
        return sequenceStore.get(email);
    }
    maxSequence++;
    sequenceStore.set(email, maxSequence);
    return maxSequence;
}

// Token刷新冷却时间（秒）
const TOKEN_REFRESH_COOLDOWN = 60;
const lastTokenRefresh = new Map();

// 2. Microsoft Token刷新（智能scope回退机制）
async function refreshAccessToken(clientId, refreshToken, userInitiated = false) {
    // 只对非用户主动触发的刷新进行冷却检查
    if (!userInitiated) {
        const refreshKey = `${clientId}_${refreshToken.substring(0, 10)}`;
        const lastRefresh = lastTokenRefresh.get(refreshKey);
        const now = Date.now();

        if (lastRefresh && (now - lastRefresh) < TOKEN_REFRESH_COOLDOWN * 1000) {
            return Promise.reject(new Error(`Token刷新过于频繁，请等待${TOKEN_REFRESH_COOLDOWN}秒`));
        }
    }

    // 网络重试机制
    let lastError;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Token刷新] 尝试为客户端 ${clientId.substring(0, 8)}... 刷新token (用户主动: ${userInitiated}, 尝试 ${attempt}/${maxRetries})`);

            const refreshKey = `${clientId}_${refreshToken.substring(0, 10)}`;

            // 使用正确的curl格式 - 不包含scope参数（使用原始授权的scope）
            const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: clientId,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
                // 注意：不包含scope参数，让Microsoft使用原始授权的scope
            })
        });

        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            console.log(`[Token刷新] ✅ Token刷新成功 (尝试 ${attempt}/${maxRetries})`);

            // 只对非用户主动触发的刷新记录冷却时间
            if (!userInitiated) {
                lastTokenRefresh.set(refreshKey, Date.now());
            }

            return {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || refreshToken, // 保持原有refresh_token如果没返回新的
                expires_in: tokenData.expires_in,
                token_type: tokenData.token_type,
                scope: tokenData.scope
            };
        } else {
            // 详细的错误处理（参考原始版本）
            const errorText = await tokenResponse.text();
            console.error(`[Token刷新] ❌ 失败: ${tokenResponse.status}`, errorText);

            let errorMessage = `Token刷新失败: ${tokenResponse.status}`;

            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error === 'invalid_grant') {
                    if (errorData.error_description && errorData.error_description.includes('AADSTS70008')) {
                        errorMessage = 'Refresh Token已过期或已被撤销';
                    } else if (errorData.error_description && errorData.error_description.includes('AADSTS70000')) {
                        errorMessage = '请求的scope未授权或已过期，需要用户重新授权';
                    } else {
                        errorMessage = 'Refresh Token无效或已过期';
                    }
                } else if (errorData.error === 'invalid_client') {
                    errorMessage = 'Client ID配置错误或应用未注册';
                } else if (errorData.error_description) {
                    errorMessage = errorData.error_description;
                } else {
                    errorMessage = `Token刷新失败: ${errorData.error}`;
                }
            } catch (e) {
                errorMessage = `HTTP ${tokenResponse.status}: Token刷新失败`;
            }

            throw new Error(errorMessage);
        }

        // 记录错误用���重试
        lastError = error;

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries) {
            console.log(`[Token刷新] 尝试 ${attempt}/${maxRetries} 失败，${attempt * 1000}ms 后重试: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            continue;
        }

    } catch (error) {
        console.error(`[Token刷新] 异常:`, error.message);
        lastError = error;

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries) {
            console.log(`[Token刷新] 网络异常，尝试 ${attempt}/${maxRetries} 失败，${attempt * 1000}ms 后重试: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            continue;
        }
    }
}

    // 所有尝试都失败了
    console.error(`[Token刷新] ❌ 所有 ${maxRetries} 次尝试都失败`);
    throw lastError || new Error('Token刷新失败：所有重试尝试都失败');
}

// HTML标签清理函数
function stripHtmlTags(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// 3. 验证码提取算法（优化版 - 6位纯数字 + HTML清理）
function extractVerificationCode(subject, body) {
    if (!subject && !body) return null;

    // 清理HTML标签
    const cleanSubject = subject || '';
    const cleanBody = stripHtmlTags(body || '');
    const text = `${cleanSubject} ${cleanBody}`;

    // 高可信度模式 - 必须包含验证码相关关键词
    const highPatterns = [
        /(?:verification code|验证码|验证码为|code is|your code is|安全码|安全验证|verification|authenticate)[\s:：\n\-]*(\d{6})/gi,
        /(?:confirm|activate|verify|authenticate)[\s\S]{0,50}?(\d{6})/gi
    ];

    // 中等可信度模式 - 6位纯数字
    const mediumPatterns = [
        /\b(\d{6})\b/g  // 6位数字
    ];

    // 先尝试高可信度模式
    for (const pattern of highPatterns) {
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
            for (const match of matches) {
                const code = match.match(/(\d{6})/);
                if (code && code[1]) {
                    return code[1];
                }
            }
        }
    }

    // 再尝试中等可信度模式
    const mediumMatches = text.match(mediumPatterns[0]);
    if (mediumMatches && mediumMatches.length > 0) {
        // 返回第一个匹配的6位数字
        return mediumMatches[0];
    }

    return null;
}


// 4. 获取邮件（真实实现）
async function fetchEmails(account, accessToken, sinceTime = null) {
    return new Promise((resolve, reject) => {
        // 构造基础URL
        let url = `${OUTLOOK_API}/me/messages?$top=10&$orderby=ReceivedDateTime desc`;

        // 智能时间过滤器处理
        if (sinceTime) {
            try {
                const filterTime = new Date(sinceTime).toISOString();
                // 使用OData标准格式，时间值需要用单引号包围
                // 构造过滤器时进行正确的URL编码
                const filterClause = `ReceivedDateTime gt '${filterTime}'`;
                const encodedFilter = encodeURIComponent(filterClause);
                url += `&$filter=${encodedFilter}`;
                console.log(`[时间过滤] 获取比 ${sinceTime} 更新的邮件`);
            } catch (error) {
                console.log(`[时间过滤] 时间格式错误，降级获取最近5封邮件: ${error.message}`);
                // 降级到最近5封邮件
                url = `${OUTLOOK_API}/me/messages?$top=5&$orderby=ReceivedDateTime desc`;
            }
        } else {
            // 没有时间过滤器，降级获取最近5封邮件
            console.log(`[时间过滤] 无时间基准，降级获取最近5封邮件`);
            url = `${OUTLOOK_API}/me/messages?$top=5&$orderby=ReceivedDateTime desc`;
        }

        console.log(`[调试] 完整URL: ${url}`);

        // 对整个path进行URL编码，解决特殊字符问题
        const encodedPath = encodeURI(url);

        const options = {
            hostname: 'outlook.office.com',
            port: 443,
            path: encodedPath,
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
                        reject(new Error(`邮件获取失败: ${res.statusCode}`));
                    }
                } catch (error) {
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

// 5. 实时监控任务
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
                // 获取access token（用户主动触发的监控，跳过冷却限制）
                const tokenResult = await refreshAccessToken(account.client_id, account.refresh_token, true);

                // 获取邮件（使用智能时间过滤器）
                const emails = await fetchEmails(account, tokenResult.access_token, account.last_check_time);

                if (emails && emails.length > 0) {
                    console.log(`[邮件] 获取到 ${emails.length} 封邮件`);

                    // 提取验证码
                    for (const email of emails) {
                        const code = extractVerificationCode(email.Subject, email.Body.Content);
                        if (code) {
                            console.log(`[验证码] 发现验证码: ${code} (发件人: ${email.From.EmailAddress.Address})`);

                            // 统一事件通知（SSE + WebSocket）
                            emitEvent({
                                type: 'verification_code_found',
                                sessionId: sessionId,
                                account_id: account.id,
                                email: account.email,
                                code: code,
                                sender: email.From.EmailAddress.Address,
                                subject: email.Subject,
                                received_at: email.ReceivedDateTime,
                                timestamp: new Date().toISOString()
                            });
                            break; // 只取第一个验证码
                        }
                    }

                    // 发现验证码后，更新最后检查时间为当前邮件的接收时间
                    if (emails && emails.length > 0) {
                        account.last_check_time = emails[0].ReceivedDateTime; // 使用最新邮件时间作为基准
                        accountStore.set(account.id, account);
                    }
                }

            } catch (error) {
                console.error(`[监控检查] 账户 ${account.email} 检查失败:`, error.message);

                // 如果是token刷新失败，更新账户状态并通知前端
                if (error.message.includes('Token刷新失败') || error.message.includes('AADSTS70000')) {
                    account.current_status = 'reauth_required';
                    account.last_error = error.message;
                    accountStore.set(account.id, account);

                    // 通知前端需要重新授权
                    emitEvent({
                        type: 'account_status_changed',
                        sessionId: sessionId,
                        account_id: account.id,
                        email: account.email,
                        status: 'reauth_required',
                        message: 'Token已过期，请重新授权',
                        error: error.message
                    });

                    console.log(`[授权] 账户 ${account.email} 需要重新授权`);
                }
            }

        }, 15000) // 每15秒检查一次
    };

    activeMonitors.set(monitorId, monitorTask);

    // 设置自动停止定时器
    setTimeout(() => {
        stopMonitoring(monitorId);
    }, duration);
}

function stopMonitoring(monitorId) {
    if (activeMonitors.has(monitorId)) {
        const monitor = activeMonitors.get(monitorId);
        clearInterval(monitor.interval);
        activeMonitors.delete(monitorId);

        console.log(`[监控] 停止监控任务: ${monitorId}`);

        // 统一事件通知（SSE + WebSocket）
        emitEvent({
            type: 'monitoring_ended',
            sessionId: monitor.sessionId,
            account_id: monitor.account.id,
            email: monitor.account.email,
            reason: '监控超时',
            timestamp: new Date().toISOString()
        });
    }
}

// ========== API端点 ==========

// CORS代理
const outlookProxy = createProxyMiddleware({
    target: 'https://outlook.office.com',
    changeOrigin: true,
    pathRewrite: { '^/api/outlook': '' },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`🔄 代理请求: ${req.method} ${req.path}`);
    }
});

app.use('/api/outlook', outlookProxy);

// 主页 - 服务HTML文件
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/simple-mail-manager.html');
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        websocket_port: WS_PORT,
        active_monitors: activeMonitors.size,
        accounts_stored: accountStore.size
    });
});

// 服务信息
app.get('/api/info', (req, res) => {
    res.json({
        name: 'Balanced Mail Manager Proxy Server',
        description: '平衡版邮件管理代理服务器 - KISS原则 + 核心业务功能',
        version: '3.1.0',
        features: [
            'CORS代理 - 解决跨域访问问题',
            'Microsoft Outlook API集成 - 真实邮件获取',
            '验证码智能提取 - 多层级识别算法',
            '实时监控系统 - 定时检查机制',
            'Token自动刷新 - 保持访问有效性',
            'WebSocket通信 - 实时通知推送',
            '简化存储 - 内存存储，易于维护'
        ],
        endpoints: {
            '健康检查': 'GET /api/health',
            '服务信息': 'GET /api/info',
            'Token刷新': 'POST /api/microsoft/token',
            '触发监控': 'POST /api/monitor/copy-trigger',
            '序列查询': 'GET /api/sequence/:email',
            '基本统计': 'GET /api/stats',
            'Outlook代理': 'GET /api/outlook/*'
        }
    });
});

// Microsoft Token刷新（真实实现）
app.post('/api/microsoft/token', async (req, res) => {
    try {
        const { client_id, refresh_token } = req.body;

        if (!client_id || !refresh_token) {
            return res.status(400).json({
                error: '缺少必需参数: client_id, refresh_token'
            });
        }

        console.log(`[Token刷新] 尝试为客户端 ${client_id} 刷新token`);
        const result = await refreshAccessToken(client_id, refresh_token);

        res.json({
            access_token: result.access_token,
            refresh_token: result.refresh_token || refresh_token,
            expires_in: result.expires_in || 3600,
            token_type: result.token_type || 'Bearer',
            scope: result.scope
        });

    } catch (error) {
        console.error('[Token刷新] 失败:', error.message);
        res.status(400).json({
            error: 'Token刷新失败',
            details: error.message
        });
    }
});

// 触发监控（恢复完整功能）
app.post('/api/monitor/copy-trigger', async (req, res) => {
    try {
        const { sessionId, account_id, email, client_id, refresh_token, current_status, codes = [], emails = [], latest_code_received_at } = req.body;

        // 多用户隔离验证：必须有sessionId
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        console.log(`[监控触发] 复制邮箱: ${email}, 账户ID: ${account_id} (会话: ${sessionId})`);
        console.log(`[监控触发] 账户状态: ${current_status}, 有access_token: ${!!req.body.access_token}`);

        // 账户状态检查和处理
        let finalStatus = current_status;

        if (current_status === 'reauth_required') {
            console.log(`[监控触发] 账户 ${email} 状态为 reauth_required，将尝试重新授权`);

            // 尝试重新授权（刷新token）
            try {
                const tokenResult = await refreshAccessToken(client_id, refresh_token, true);
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

        // 获取最新的access_token（如果重新授权成功）
        let latestAccessToken = req.body.access_token;
        if (finalStatus === 'active' && current_status === 'reauth_required') {
            // 重新授权成功，使用新token
            const tokenResult = await refreshAccessToken(client_id, refresh_token, true);
            latestAccessToken = tokenResult.access_token;
        }

        // 计算时间过滤基准（只使用latest_code_received_at）
        let timeFilter = latest_code_received_at;

        // 如果有codes数组，使用最新的验证码时间
        if (codes && codes.length > 0) {
            const latestCode = codes.reduce((latest, code) => {
                return new Date(code.received_at) > new Date(latest.received_at) ? code : latest;
            });
            timeFilter = latestCode.received_at;
            console.log(`[时间基准] 使用codes数组最新时间: ${timeFilter}`);
        } else if (latest_code_received_at) {
            console.log(`[时间基准] 使用最新验证码邮件时间: ${timeFilter}`);
        } else {
            console.log(`[时间基准] 无验证码邮件时间，将降级获取最近5封邮件`);
        }

        // 创建账户对象
        const account = {
            id: account_id,
            email: email,
            client_id: client_id,
            refresh_token: refresh_token,
            access_token: latestAccessToken,
            current_status: finalStatus,
            last_active_at: last_active_at || new Date().toISOString(),
            codes: codes || [],
            emails: emails || [],
            latest_code_received_at: latest_code_received_at,
            last_check_time: timeFilter  // 使用计算好的时间过滤基准
        };

        console.log(`[监控检查] 账户 ${email} 将获取比 ${timeFilter} 更新的邮件`);

        // 存储账户
        accountStore.set(account_id, account);

        // 启动1分钟监控
        startMonitoring(sessionId, account, 60000);

        // 统一事件通知（SSE + WebSocket）
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

// 批量导入账户（前端兼容）
app.post('/api/accounts/batch-import', async (req, res) => {
    try {
        const { emails, sessionId } = req.body;

        // 多用户隔离验证：必须有sessionId
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({
                success: false,
                error: '请提供有效的邮箱数组'
            });
        }

        const results = [];
        let successCount = 0;
        let errorCount = 0;

        for (const emailData of emails) {
            try {
                const { email, password, client_id, refresh_token } = emailData;

                if (!email || !password || !client_id || !refresh_token) {
                    results.push({
                        success: false,
                        email: email || 'unknown',
                        error: '缺少必需参数'
                    });
                    errorCount++;
                    continue;
                }

                // 验证授权凭证
                console.log(`[批量导入] 验证授权: ${email}`);
                let tokenResult;
                try {
                    tokenResult = await refreshAccessToken(client_id, refresh_token, false);
                    console.log(`[批量导入] ✅ 授权验证成功: ${email}`);
                } catch (error) {
                    console.error(`[批量导入] ❌ 授权验证失败: ${email}`, error.message);
                    results.push({
                        success: false,
                        email: email,
                        error: `授权验证失败: ${error.message}`
                    });
                    errorCount++;
                    continue;
                }

                // 分配序列号
                const sequence = assignSequence(email);

                // 创建账户
                const account = {
                    id: `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    email: email,
                    password: password,
                    client_id: client_id,
                    refresh_token: tokenResult.refresh_token || refresh_token, // 使用新的refresh_token
                    access_token: tokenResult.access_token, // 存储access_token
                    sequence: sequence,
                    status: 'authorized', // 直接设置为已授权
                    created_at: new Date().toISOString(),
                    last_active_at: new Date().toISOString()
                };

                // 存储账户
                accountStore.set(account.id, account);

                // 异步取件最新5封邮件并提取验证码
                (async () => {
                    try {
                        console.log(`[批量导入] 开始异步取件: ${email}`);

                        // 获取最新5封邮件（无时间过滤器，降级处理）
                        const emails = await fetchEmails(account, tokenResult.access_token, null);

                        if (emails && emails.length > 0) {
                            console.log(`[批量导入] 获取到 ${emails.length} 封邮件: ${email}`);

                            // 提取验证码并保存最新的
                            let latestCode = null;
                            let latestCodeTime = null;

                            for (const emailItem of emails) {
                                const code = extractVerificationCode(emailItem.Subject, emailItem.Body.Content);
                                if (code) {
                                    const receivedTime = new Date(emailItem.ReceivedDateTime).toISOString();
                                    if (!latestCodeTime || new Date(receivedTime) > new Date(latestCodeTime)) {
                                        latestCode = code;
                                        latestCodeTime = receivedTime;
                                    }
                                    console.log(`[批量导入] 发现验证码: ${code} (发件人: ${emailItem.From.EmailAddress.Address})`);
                                }
                            }

                            // 更新账户信息
                            if (latestCode) {
                                account.codes = [{
                                    code: latestCode,
                                    received_at: latestCodeTime,
                                    sender: email,  // 统一使用sender字段名
                                    subject: "批量导入验证码"
                                }];
                                account.latest_code_received_at = latestCodeTime;
                                accountStore.set(account.id, account);

                                console.log(`[批量导入] ✅ 提取最新验证码: ${latestCode} (时间: ${latestCodeTime})`);

                                // 批量导入使用sessionId进行精确路由通知
                                emitEvent({
                                    type: 'verification_code_found',
                                    sessionId: sessionId, // 使用sessionId进行精确路由
                                    account_id: account.id,
                                    email: account.email,
                                    code: latestCode,
                                    sender: email,
                                    subject: "批量导入验证码",
                                    received_at: latestCodeTime,
                                    timestamp: new Date().toISOString(),
                                    batch_import: true // 标识这是批量导入的验证码
                                });
                            } else {
                                console.log(`[批量导入] 未发现验证码: ${email}`);
                            }
                        } else {
                            console.log(`[批量导入] 未获取到邮件: ${email}`);
                        }
                    } catch (error) {
                        console.error(`[批量导入] 异步取件失败: ${email}`, error.message);
                    }
                })();

                results.push({
                    success: true,
                    email: email,
                    sequence: sequence,
                    account_id: account.id,
                    status: 'pending'
                });

                successCount++;
                console.log(`[批量导入] 成功导入: ${email} -> 序列号: ${sequence}`);

            } catch (error) {
                console.error(`[批量导入] 失败: ${emailData.email}`, error);
                results.push({
                    success: false,
                    email: emailData.email || 'unknown',
                    error: error.message
                });
                errorCount++;
            }
        }

        res.json({
            success: true,
            stats: {
                total: emails.length,
                successful: successCount,
                failed: errorCount
            },
            results
        });

        console.log(`[批量导入] 完成统计: ${successCount}/${emails.length} 成功`);

    } catch (error) {
        console.error('[批量导入] 处理失败:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 处理单个邮箱账户（前端兼容）
app.post('/api/accounts', (req, res) => {
    try {
        const { email, password, client_id, refresh_token } = req.body;

        if (!email || !password || !client_id || !refresh_token) {
            return res.status(400).json({
                success: false,
                error: '缺少必需参数: email, password, client_id, refresh_token'
            });
        }

        // 分配序列号
        const sequence = assignSequence(email);

        // 创建账户
        const account = {
            id: `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            email: email,
            password: password,
            client_id: client_id,
            refresh_token: refresh_token,
            sequence: sequence,
            status: 'pending',
            created_at: new Date().toISOString(),
            last_active_at: new Date().toISOString()
        };

        // 存储账户
        accountStore.set(account.id, account);

        console.log(`[账户] 创建账户: ${email} -> 序列号: ${sequence}`);

        res.json({
            success: true,
            account: account
        });

    } catch (error) {
        console.error('[账户] 创建失败:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 手动取件邮件
app.post('/api/manual-fetch-emails', async (req, res) => {
    try {
        const { account_id, email, client_id, refresh_token, access_token, current_status, sessionId, latest_code_received_at, codes = [] } = req.body;

        // 多用户隔离验证：必须有sessionId
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: '缺少会话标识：sessionId'
            });
        }

        console.log(`[手动取件] 开始收取: ${email} (账户ID: ${account_id})`);

        // 账户状态检查和处理
        let finalStatus = current_status;
        let latestAccessToken = access_token;

        if (current_status === 'reauth_required') {
            console.log(`[手动取件] 账户 ${email} 状态为 reauth_required，将尝试重新授权`);

            // 尝试重新授权（刷新token）
            try {
                const tokenResult = await refreshAccessToken(client_id, refresh_token, true);
                if (tokenResult && tokenResult.access_token) {
                    finalStatus = 'active';
                    latestAccessToken = tokenResult.access_token;
                    console.log(`[手动取件] 账户 ${email} 重新授权成功，状态更新为 active`);

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
                console.log(`[手动取件] 账户 ${email} 重新授权失败: ${reauthError.message}`);

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

        if (!account_id || !email || !client_id || !refresh_token) {
            return res.status(400).json({
                success: false,
                error: '缺少必需参数: account_id, email, client_id, refresh_token'
            });
        }

        // 计算时间过滤基准（只使用latest_code_received_at）
        let timeFilter = latest_code_received_at;

        // 如果有codes数组，使用最新的验证码时间
        if (codes && codes.length > 0) {
            const latestCode = codes.reduce((latest, code) => {
                return new Date(code.received_at) > new Date(latest.received_at) ? code : latest;
            });
            timeFilter = latestCode.received_at;
            console.log(`[手动取件] 使用codes数组最新时间: ${timeFilter}`);
        } else if (latest_code_received_at) {
            console.log(`[手动取件] 使用最新验证码邮件时间: ${timeFilter}`);
        } else {
            console.log(`[手动取件] 无验证码邮件时间，将降级获取最近5封邮件`);
        }

        // 创建账户对象
        const account = {
            id: account_id,
            email: email,
            client_id: client_id,
            refresh_token: refresh_token,
            access_token: latestAccessToken,
            current_status: finalStatus,
            last_check_time: timeFilter // 使用智能时间过滤器
        };

        try {
            // 如果重新授权过程中已获取token，直接使用；否则刷新token
            if (!latestAccessToken || finalStatus !== 'active') {
                const tokenResult = await refreshAccessToken(account.client_id, account.refresh_token, true);
                account.access_token = tokenResult.access_token;
                account.refresh_token = tokenResult.refresh_token || refresh_token;
            }

            // 获取邮件（使用智能时间过滤器）
            const emails = await fetchEmails(account, account.access_token, account.last_check_time);

            console.log(`[手动取件] 获取到 ${emails ? emails.length : 0} 封邮件`);

            // 提取验证码
            const foundCodes = [];
            for (const emailData of emails || []) {
                const code = extractVerificationCode(emailData.Subject, emailData.Body.Content);
                if (code) {
                    foundCodes.push({
                        code: code,
                        sender: emailData.From.EmailAddress.Address,
                        subject: emailData.Subject,
                        received_at: emailData.ReceivedDateTime
                    });
                    console.log(`[手动取件] 发现验证码: ${code} (发件人: ${emailData.From.EmailAddress.Address})`);
                }
            }

            // 通知前端结果
            if (foundCodes.length > 0) {
                // 使用最新的验证码
                const latestCode = foundCodes[foundCodes.length - 1];

                emitEvent({
                    type: 'verification_code_found',
                    sessionId: sessionId,
                    account_id: account_id,
                    email: email,
                    code: latestCode.code,
                    sender: latestCode.sender,
                    subject: latestCode.subject,
                    received_at: latestCode.received_at,
                    timestamp: new Date().toISOString()
                });
            }

            emitEvent({
                type: 'manual_fetch_complete',
                sessionId: sessionId,
                account_id: account_id,
                email: email,
                emails_count: emails ? emails.length : 0,
                codes_count: foundCodes.length,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: `成功收取 ${emails ? emails.length : 0} ��邮件`,
                emails_count: emails ? emails.length : 0,
                codes_found: foundCodes.length,
                codes: foundCodes
            });

        } catch (error) {
            console.error(`[手动取件] 失败: ${email}`, error.message);

            // 通知前端错误
            emitEvent({
                type: 'manual_fetch_error',
                sessionId: sessionId,
                account_id: account_id,
                email: email,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                success: false,
                error: `手动取件失败: ${error.message}`
            });
        }

    } catch (error) {
        console.error('[手动取件] 处理失败:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 查询邮箱序列
app.get('/api/sequence/:email', (req, res) => {
    const email = req.params.email;
    const sequence = sequenceStore.get(email);

    res.json({
        success: true,
        email: email,
        sequence: sequence || null
    });
});

// SSE事件流端点 - 实时更新（前端兼容）
app.get('/api/events/stream/:sessionId?', (req, res) => {
    const sessionId = req.params.sessionId || 'default';

    // 设置SSE响应头
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const clientId = `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[SSE] 新的客户端连接: ${clientId} (会话: ${sessionId})`);

    // 发送连接确认
    res.write(`event: connection\n`);
    res.write(`data: ${JSON.stringify({
        type: 'connection',
        clientId: clientId,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
    })}\n\n`);

    // 监听事件并转发给客户端
    const eventHandler = (eventData) => {
        if (eventData.sessionId === sessionId || !eventData.sessionId) {
            res.write(`event: ${eventData.type}\n`);
            res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        }
    };

    eventEmitter.on(eventData.type, eventHandler);

    // 处理客户端断开连接
    req.on('close', () => {
        console.log(`[SSE] 客户端断开连接: ${clientId}`);
        eventEmitter.removeListener(eventData.type, eventHandler);
    });

    // 心跳保活
    const heartbeat = setInterval(() => {
        res.write(`event: heartbeat\n`);
        res.write(`data: ${JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString()
        })}\n\n`);
    }, 30000); // 30秒心跳

    req.on('close', () => {
        clearInterval(heartbeat);
    });
});

// 统一事件推送函数 - 支持SSE和WebSocket，支持sessionId精确路由
function emitEvent(eventData) {
    // WebSocket推送 - 支持基于sessionId的精确路由
    const wsNotification = JSON.stringify(eventData);

    if (eventData.sessionId) {
        // 如果指定了sessionId，只推送给对应的会话
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.sessionId === eventData.sessionId) {
                client.send(wsNotification);
                console.log(`[WebSocket] 🎯 精确路由通知到会话 ${eventData.sessionId}: ${eventData.type}`);
            }
        });
    } else {
        // 没有指定sessionId，广播给所有客户端（向后兼容）
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(wsNotification);
            }
        });
    }

    // SSE推送 - 支持基于sessionId的精确路由
    if (eventData.sessionId) {
        eventEmitter.emit(`${eventData.type}_${eventData.sessionId}`, eventData);
        console.log(`[SSE] 🎯 精确路由事件到会话 ${eventData.sessionId}: ${eventData.type}`);
    } else {
        // 没有指定sessionId，广播事件（向后兼容）
        eventEmitter.emit(eventData.type, eventData);
    }
}

// 基本统计
app.get('/api/stats', (req, res) => {
    const stats = {
        accounts: {
            total: accountStore.size,
            pending: Array.from(accountStore.values()).filter(a => a.status === 'pending').length,
            authorized: Array.from(accountStore.values()).filter(a => a.status === 'authorized').length
        },
        sequences: {
            total: sequenceStore.size,
            max_sequence: maxSequence
        },
        monitors: {
            active: activeMonitors.size,
            sessions: new Set(Array.from(activeMonitors.values()).map(m => m.sessionId)).size
        },
        websockets: {
            connected: wss.clients.size
        },
        timestamp: new Date().toISOString()
    };

    res.json({
        success: true,
        stats: stats
    });
});

// 错误处理
app.use((error, req, res, next) => {
    console.error('❌ 服务器错误:', error);
    res.status(500).json({
        success: false,
        error: '服务器内部错误'
    });
});

// 启动服务器
const server = app.listen(PORT, () => {
    console.log('🚀 平衡版邮件管理代理服务器已启动');
    console.log(`📍 代理端口: ${PORT}`);
    console.log(`🔌 WebSocket端口: ${WS_PORT}`);
    console.log(`🌐 健康检查: http://localhost:${PORT}/api/health`);
    console.log(`📋 服务信息: http://localhost:${PORT}/api/info`);
    console.log('');
    console.log('📝 功能特点:');
    console.log('   ✅ 保持KISS原则的简洁架构');
    console.log('   ✅ 恢复Microsoft Outlook API集成');
    console.log('   ✅ 恢复验证码智能提取算法');
    console.log('   ✅ 恢复实时监控定时检查机制');
    console.log('   ✅ 恢复Token自动刷新功能');
    console.log('   ✅ 保持WebSocket实时通信');
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('🛑 正在关闭服务器...');

    // 清理所有监控任务
    activeMonitors.forEach((monitor, id) => {
        clearInterval(monitor.interval);
    });
    activeMonitors.clear();

    server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 正在关闭服务器...');

    // 清理所有监控任务
    activeMonitors.forEach((monitor, id) => {
        clearInterval(monitor.interval);
    });
    activeMonitors.clear();

    server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
    });
});