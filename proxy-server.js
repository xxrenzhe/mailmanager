/**
 * CORS代理服务器
 * 解决浏览器跨域访问Outlook API的问题
 */

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const EventEmitter = require('events');

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

// 添加body parser中间件
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 提供静态文件服务
app.use(express.static(__dirname));

// 创建事件发射器用于SSE
const eventEmitter = new EventEmitter();
let connectedClients = new Set();

// 配置CORS - 允许所有本地访问
app.use(cors({
    origin: true, // 允许所有来源
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Microsoft Token端点代理
app.post('/api/microsoft/token', async (req, res) => {
    const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    console.log('[Token] 收到token验证请求:', {
        hasClientId: !!req.body.client_id,
        hasRefreshToken: !!req.body.refresh_token,
        grantType: req.body.grant_type
    });

    try {
        // 转发请求到Microsoft
        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(req.body).toString()
        });

        console.log('[Token] Microsoft API响应状态:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Token] Microsoft API错误响应:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });

            // 尝试解析Microsoft错误响应
            let microsoftError = null;
            try {
                microsoftError = JSON.parse(errorText);
            } catch (e) {
                // 如果不是JSON格式，使用原始错误信息
            }

            // 返回Microsoft的原始错误信息，帮助前端理解具体原因
            const statusCode = response.status;
            const errorMessage = microsoftError?.error_description || response.statusText;

            return res.status(statusCode).json({
                error: 'Token validation failed',
                message: errorMessage,
                microsoft_error: microsoftError,
                status_code: statusCode,
                is_auth_error: statusCode === 400 && microsoftError?.error === 'invalid_grant'
            });
        }

        const data = await response.json();
        console.log('[Token] Token验证成功:', {
            hasAccessToken: !!data.access_token,
            tokenType: data.token_type,
            expiresIn: data.expires_in
        });
        res.json(data);

    } catch (error) {
        console.error('[Token] Token请求失败:', error);
        // 避免重复发送响应
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Token validation failed',
                message: error.message
            });
        }
    }
});

// Outlook API代理
app.get('/api/outlook/*', (req, res) => {
    const outlookEndpoint = `https://outlook.office.com${req.originalUrl.replace('/api/outlook', '')}`;

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Missing access token' });
    }

    fetch(outlookEndpoint, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        res.json(data);
    })
    .catch(error => {
        console.error('Outlook API请求失败:', error);
        res.status(500).json({
            error: 'Outlook API request failed',
            message: error.message
        });
    });
});

// 监控管理器（支持多用户会话隔离）
const activeMonitors = new Map(); // 存储活跃的监控任务 (monitorId -> task)
const sessionMonitors = new Map(); // 存储会话监控映射 (sessionId -> Set<monitorId>)

// 监控触发端点 - 复制邮箱时自动启动监控
app.post('/api/monitor/copy-trigger', (req, res) => {
    const { sessionId, account_id, email, client_id, refresh_token, current_status, access_token } = req.body;
    const userSessionId = sessionId || 'default';

    console.log(`[监控触发] 复制邮箱: ${email}, 账户ID: ${account_id} (会话: ${userSessionId})`);
    console.log(`[监控触发] 账户状态: ${current_status}, 有access_token: ${!!access_token}`);

    // 存储账户信息用于后续的授权尝试
    const accountInfo = {
        sessionId: userSessionId,
        account_id,
        email,
        client_id,
        refresh_token,
        current_status,
        access_token,
        last_auth_attempt: null
    };

    // 生成唯一的监控任务ID（包含会话信息）
    const monitorId = `${userSessionId}_${account_id}`;

    // 如果已有监控任务，先清除
    if (activeMonitors.has(monitorId)) {
        console.log(`[监控] 清除账户 ${account_id} 的现有监控 (会话: ${userSessionId})`);
        clearTimeout(activeMonitors.get(monitorId).timeoutId);
        activeMonitors.delete(monitorId);

        // 从会话监控映射中移除
        if (sessionMonitors.has(userSessionId)) {
            sessionMonitors.get(userSessionId).delete(monitorId);
        }
    }

    // 启动新的监控任务
    const monitoringTask = {
        monitorId: monitorId,
        sessionId: userSessionId,
        accountId: account_id,
        email: email,
        accountInfo: accountInfo, // 存储完整的账户信息
        startTime: new Date(),
        checkCount: 0,
        timeoutId: null
    };

    // 存储监控任务到活跃监控映射
    activeMonitors.set(monitorId, monitoringTask);

    // 添加到会话监控映射
    if (!sessionMonitors.has(userSessionId)) {
        sessionMonitors.set(userSessionId, new Set());
    }
    sessionMonitors.get(userSessionId).add(monitorId);

    console.log(`[监控] 启动监控任务: ${monitorId}, 会话: ${userSessionId}`);
    performMonitoringCheck(monitorId, email);

    // 设置定时器 - 每15秒检查一次
    const monitoringInterval = setInterval(() => {
        performMonitoringCheck(monitorId, email);
        monitoringTask.checkCount++;
    }, 15000);

    // 设置1分钟停止定时器
    const stopTimeout = setTimeout(() => {
        clearInterval(monitoringInterval);
        activeMonitors.delete(monitorId);

        // 从会话监控映射中移除
        if (sessionMonitors.has(userSessionId)) {
            sessionMonitors.get(userSessionId).delete(monitorId);
            if (sessionMonitors.get(userSessionId).size === 0) {
                sessionMonitors.delete(userSessionId);
            }
        }

        console.log(`[监控] 1分钟监控结束: ${email}, 共检查 ${monitoringTask.checkCount + 1} 次`);

        // 发送监控结束事件
        const stopEventData = {
            type: 'monitoring_ended',
            account_id: account_id,
            email: email,
            action: 'auto_stop',
            message: `${email} 的1分钟监控已结束`,
            duration: 60000,
            check_count: monitoringTask.checkCount + 1,
            timestamp: new Date().toISOString()
        };

        // 发送给特定会话
        eventEmitter.emit(`monitoring_event_${userSessionId}`, stopEventData);
        console.log(`[SSE] 发送���控结束事件: ${stopEventData.message}`);
    }, 60000);

    monitoringTask.intervalId = monitoringInterval;
    monitoringTask.timeoutId = stopTimeout;

    // 触发SSE事件通知所有客户端
    const eventData = {
        sessionId: userSessionId,
        type: 'monitoring_started',
        account_id: account_id,
        email: email,
        action: 'copy_trigger',
        message: `已启动对 ${email} 的1分钟监控`,
        timestamp: new Date().toISOString()
    };

    // 发送给特定会话
    eventEmitter.emit(`monitoring_event_${userSessionId}`, eventData);
    console.log(`[SSE] 触发监控事件 (会话: ${userSessionId}): ${eventData.message}`);

    res.json({
        success: true,
        message: '已启动1分钟监控，将自动检查新邮件',
        account_id: account_id,
        email: email,
        duration: 60000 // 1分钟
    });
});

// 导入进度事件触发端点（支持会话隔离）
app.post('/api/events/trigger', (req, res) => {
    const { sessionId, ...eventData } = req.body;
    console.log(`[事件触发] ${eventData.type}: ${eventData.message} (会话: ${sessionId || 'all'})`);

    // 通过SSE发送事件，支持会话隔离
    const fullEventData = {
        ...eventData,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
    };

    if (sessionId) {
        // 发送给特定会话
        eventEmitter.emit(`monitoring_event_${sessionId}`, fullEventData);
    } else {
        // 发送给所有会话（向后兼容）
        eventEmitter.emit('monitoring_event', fullEventData);
    }

    res.json({
        success: true,
        message: '事件已发送'
    });
});

// 执行监控检查的函数
async function performMonitoringCheck(monitorId, email) {
    const monitoringTask = activeMonitors.get(monitorId);
    if (!monitoringTask || !monitoringTask.accountInfo) {
        console.error(`[监控检查] 找不到监控任务: ${monitorId}`);
        return;
    }

    const { accountId, sessionId } = monitoringTask;

    const { accountInfo } = monitoringTask;

    try {
        console.log(`[监控检查] 检查账户: ${email} (ID: ${accountId}, 检查次数: ${monitoringTask.checkCount + 1})`);

        // 检查是否需要重新授权
        if (!accountInfo.access_token || accountInfo.current_status !== 'authorized') {
            console.log(`[监控检查] 账户 ${email} 需要重新授权，尝试刷新token...`);

            // 避免频繁尝试授权（每次检查最多尝试一次）
            if (!accountInfo.last_auth_attempt ||
                (Date.now() - new Date(accountInfo.last_auth_attempt).getTime() > 60000)) {

                accountInfo.last_auth_attempt = new Date().toISOString();

                try {
                    const authResult = await attemptTokenRefresh(accountInfo);
                    if (authResult.success) {
                        console.log(`[监控检查] 账户 ${email} 重新授权成功`);
                        accountInfo.access_token = authResult.access_token;
                        accountInfo.current_status = 'authorized';

                        // 发送授权成功事件
                        const authSuccessEvent = {
                            sessionId: sessionId,
                            type: 'account_status_changed',
                            account_id: accountId,
                            email: email,
                            status: 'authorized',
                            message: `账户 ${email} 授权已恢复，开始检查邮件...`,
                            timestamp: new Date().toISOString()
                        };
                        eventEmitter.emit(`monitoring_event_${sessionId}`, authSuccessEvent);
                    } else {
                        console.log(`[监控检查] 账户 ${email} 重新授权失败: ${authResult.error}`);
                    }
                } catch (authError) {
                    console.log(`[监控检查] 账户 ${email} 重新授权异常:`, authError.message);
                }
            }
        }

        // 发送监控进度事件
        const progressEventData = {
            sessionId: sessionId,
            type: 'monitoring_progress',
            account_id: accountId,
            email: email,
            message: `正在检查 ${email} 的新邮件...`,
            timestamp: new Date().toISOString()
        };
        eventEmitter.emit(`monitoring_event_${sessionId}`, progressEventData);

        // 如果有有效的access_token，尝试获取邮件
        if (accountInfo.access_token) {
            await fetchNewEmails(accountId, accountInfo, sessionId);
        } else {
            const noTokenEvent = {
                sessionId: sessionId,
                type: 'monitoring_progress',
                account_id: accountId,
                email: email,
                message: `账户 ${email} 暂无有效授权，跳过邮件检查`,
                timestamp: new Date().toISOString()
            };
            eventEmitter.emit(`monitoring_event_${sessionId}`, noTokenEvent);
        }

    } catch (error) {
        console.error(`[监控检查] 检查失败: ${email}`, error);
        // 发送错误事件
        const errorEventData = {
            sessionId: sessionId,
            type: 'monitoring_error',
            account_id: accountId,
            email: email,
            error: error.message,
            message: `监控 ${email} 时发生错误: ${error.message}`,
            timestamp: new Date().toISOString()
        };

        eventEmitter.emit(`monitoring_event_${sessionId}`, errorEventData);
    }
}

// 尝试刷新token
async function attemptTokenRefresh(accountInfo) {
    const { client_id, refresh_token } = accountInfo;

    if (!client_id || !refresh_token) {
        return { success: false, error: '缺少client_id或refresh_token' };
    }

    try {
        console.log(`[Token刷新] 尝试为账户 ${accountInfo.email} 刷新token`);

        const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: client_id,
                refresh_token: refresh_token,
                grant_type: 'refresh_token',
                scope: 'https://outlook.office.com/Mail.Read'
            })
        });

        if (response.ok) {
            const data = await response.json();
            return {
                success: true,
                access_token: data.access_token,
                expires_in: data.expires_in
            };
        } else {
            const errorText = await response.text();
            console.error(`[Token刷新] 失败:`, response.status, errorText);
            return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }
    } catch (error) {
        console.error(`[Token刷新] 异常:`, error);
        return { success: false, error: error.message };
    }
}

// 获取新邮件
async function fetchNewEmails(accountId, accountInfo, sessionId) {
    try {
        const response = await fetch(`https://outlook.office.com/api/v2.0/me/messages?$orderby=ReceivedDateTime desc&$top=5`, {
            headers: {
                'Authorization': `Bearer ${accountInfo.access_token}`,
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`邮件API调用失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const messages = data.value || [];

        if (messages.length > 0) {
            console.log(`[邮件] 账户 ${accountInfo.email} 找到 ${messages.length} 封新邮件`);

            // 提取验证码
            const results = extractVerificationCodesAdvanced(messages);

            if (results.length > 0) {
                console.log(`[验证码] 从邮件中提取到 ${results.length} 个验证码`);

                results.forEach(result => {
                    eventEmitter.emit(`verification_code_found_${sessionId}`, {
                        type: 'verification_code_found',
                        sessionId: sessionId,
                        account_id: accountId,
                        code: result.code,
                        sender: result.sender,
                        received_at: result.received_at,
                        score: result.score || 1.0,
                        priority: result.priority || 'medium',
                        subject: result.subject,
                        timestamp: new Date().toISOString()
                    });
                });

                // 发送验证码发现事件
                const codesFoundEvent = {
                    sessionId: sessionId,
                    type: 'monitoring_progress',
                    account_id: accountId,
                    email: accountInfo.email,
                    message: `发现 ${results.length} 个新验证码`,
                    timestamp: new Date().toISOString()
                };
                eventEmitter.emit(`monitoring_event_${sessionId}`, codesFoundEvent);
            }
        } else {
            console.log(`[邮件] 账户 ${accountInfo.email} 没有新邮件`);
        }

    } catch (error) {
        console.error(`[邮件] 获取邮件失败: ${accountInfo.email}`, error);

        // 如果是授权错误，标记需要重新授权
        if (error.message.includes('401') || error.message.includes('403')) {
            accountInfo.access_token = null;
            accountInfo.current_status = 'reauth_needed';
        }
    }
}

// SSE事件流端点 - 实时更新
app.get('/api/events/stream/:sessionId?', (req, res) => {
    // 设置SSE响应头
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // 使用会话ID或生成默认ID
    const sessionId = req.params.sessionId || 'default';
    const clientId = `${sessionId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    connectedClients.add({
        id: clientId,
        response: res,
        sessionId: sessionId
    });

    console.log(`[SSE] 新的客户端连接: ${clientId} (会话: ${sessionId}), 当前连接数: ${connectedClients.size}`);

    // 发送连接确认
    const welcomeEvent = {
        type: 'connection',
        message: '已连接到实时更新服务',
        clientId: clientId,
        connectedClients: connectedClients.size,
        timestamp: new Date().toISOString()
    };

    res.write(`data: ${JSON.stringify(welcomeEvent)}\n\n`);

    // 监听各种事件并转发给客户端（支持会话隔离）
    const eventHandlers = {
        [`monitoring_event_${sessionId}`]: (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        },
        [`verification_code_found_${sessionId}`]: (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        },
        monitoring_event: (data) => {
            // 只有当没有指定会话时才接收全局事件（向后兼容）
            if (!data.sessionId || data.sessionId === sessionId) {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        },
        verification_code_found: (data) => {
            // 只有当没有指定会话时才接收全局事件（向后兼容）
            if (!data.sessionId || data.sessionId === sessionId) {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        },
        account_status_changed: (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        },
        bulk_import_progress: (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };

    // 注册事件监听器
    Object.keys(eventHandlers).forEach(eventType => {
        eventEmitter.on(eventType, eventHandlers[eventType]);
    });

    // 发送心跳包
    const heartbeat = setInterval(() => {
        if (!res.destroyed) {
            const heartbeatData = {
                type: 'heartbeat',
                clientId: clientId,
                timestamp: new Date().toISOString()
            };
            res.write(`data: ${JSON.stringify(heartbeatData)}\n\n`);
        }
    }, 30000); // 每30秒发送心跳

    // 处理客户端断开连接
    req.on('close', () => {
        console.log(`[SSE] 客户端断开连接: ${clientId}`);

        // 清理事件监听器
        Object.keys(eventHandlers).forEach(eventType => {
            eventEmitter.removeListener(eventType, eventHandlers[eventType]);
        });

        // 清理心跳定时器
        clearInterval(heartbeat);

        // 从连接列表中移除
        connectedClients.delete(clientId);
        console.log(`[SSE] 当前连接数: ${connectedClients.size}`);
    });

    req.on('error', (error) => {
        console.error(`[SSE] 客户端连接错误: ${clientId}`, error);
    });
});

// 简单账户验��API（KISS原则）
app.post('/api/accounts/validate', async (req, res) => {
    const { sessionId, accountId, client_id, refresh_token } = req.body;

    try {
        console.log(`[验证] 开始验证账户 ${accountId}`);

        // 1. 快速检查token有效性
        const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: client_id,
                refresh_token: refresh_token,
                grant_type: 'refresh_token',
                scope: 'https://outlook.office.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All'
            })
        });

        if (!tokenResponse.ok) {
            return res.json({
                success: false,
                status: 'reauth_needed',
                message: 'Token验证失败'
            });
        }

        const tokenData = await tokenResponse.json();

        // 2. 获取最近邮件
        const emailResponse = await fetch('https://outlook.office.com/api/v2.0/me/messages?$top=3&$orderby=ReceivedDateTime desc', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Accept': 'application/json'
            }
        });

        let emails = [];
        if (emailResponse.ok) {
            const emailData = await emailResponse.json();
            emails = emailData.value || [];
        }

        // 3. 提取验证码
        let verificationCodes = [];
        if (emails.length > 0) {
            const results = extractVerificationCodesAdvanced(emails);
            verificationCodes = results.map(r => ({
                code: r.code,
                sender: r.sender,
                received_at: r.received_at,
                score: r.score || 1.0
            }));

            // 发送验证码发现事件
            verificationCodes.forEach(result => {
                eventEmitter.emit(`verification_code_found_${sessionId || 'default'}`, {
                    type: 'verification_code_found',
                    sessionId: sessionId || 'default',
                    account_id: accountId,
                    code: result.code,
                    sender: result.sender,
                    received_at: result.received_at,
                    score: result.score,
                    timestamp: new Date().toISOString()
                });
            });
        }

        res.json({
            success: true,
            status: 'authorized',
            message: `验证成功，找到 ${emails.length} 封邮件`,
            emails_count: emails.length,
            verification_codes: verificationCodes,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token
        });

    } catch (error) {
        console.error('[验证] 账户验证失败:', error);
        res.json({
            success: false,
            status: 'error',
            message: '验证过程出错'
        });
    }
});

// 高级验证码提取API（支持会话隔离）
app.post('/api/extract-verification-codes', (req, res) => {
    const { sessionId, messages, accountId } = req.body;
    const userSessionId = sessionId || 'default';

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid messages data'
        });
    }

    try {
        console.log(`[Extract] 开始处理 ${messages.length} 封邮件的验证码提取`);

        // 使用服务端高级提取算法
        const results = extractVerificationCodesAdvanced(messages);

        console.log(`[Extract] 提取完成，找到 ${results.length} 个验证码`);

        // 触发SSE事件通知客户端
        if (results.length > 0) {
            results.forEach(result => {
                eventEmitter.emit(`verification_code_found_${userSessionId}`, {
                    type: 'verification_code_found',
                    sessionId: userSessionId,
                    account_id: accountId,
                    code: result.code,
                    sender: result.sender,
                    received_at: result.received_at,
                    score: result.score || 1.0,
                    priority: result.priority || 'medium',
                    subject: result.subject,
                    timestamp: new Date().toISOString()
                });
            });
        }

        res.json({
            success: true,
            results: results,
            total: results.length
        });

    } catch (error) {
        console.error('[Extract] 验证码提取失败:', error);
        res.status(500).json({
            success: false,
            error: 'Verification code extraction failed',
            details: error.message
        });
    }
});

// 账户信息获取端点 - 供服务器端监控使用
app.post('/api/accounts/get', (req, res) => {
    const { account_id } = req.body;

    console.log(`[Account] 查询账户信息: ${account_id}`);

    // 注意：在真实应用中，这里应该从数据库或安全存储中获取
    // 由于这是浏览器版本，我们需要前端传递账户信息
    res.json({
        success: true,
        message: '请在前端处理账户信息'
    });
});

// 健康检查端点
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 根路径直接跳转到邮件管理系统
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/simple-mail-manager.html');
});

// 服务信息API端点
app.get('/api/info', (req, res) => {
    res.json({
        name: 'Mail Manager Proxy Server',
        description: 'CORS代理服务器，用于解决跨域访问Outlook API的问题',
        version: '1.0.0',
        endpoints: {
            token: '/api/microsoft/token - Microsoft OAuth token端点',
            outlook: '/api/outlook/* - Outlook REST API端点',
            health: '/api/health - 健康检查'
        },
        usage: {
            '添加账户': '使用表单添加账户并自动验证授权',
            '批量导入': '上传CSV文件批量导入账户',
            '同步邮件': '自动同步邮件并提取验证码'
        }
    });
});

// 错误处理中间件
app.use((error, req, res, next) => {
    console.error('代理服务器错误:', error);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
    });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'Endpoint not found'
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 邮件管理代理服务器已启动`);
    console.log(`📍 代理端口: ${PORT}`);
    console.log(`🌐 健康检查: http://localhost:${PORT}/api/health`);
    console.log(`📋 服务信息: http://localhost:${PORT}/`);
    console.log(`\n📝 使用说明:`);
    console.log(`   1. 确保代理服务器运行在此端口`);
    console.log(`   2. 浏览器版本会自动使用代理解决CORS问题`);
    console.log(`   3. 支持所有Outlook API调用和OAuth token验证`);
});

// 高级验证码提取算法函数
function extractVerificationCodesAdvanced(messages) {
    const verificationCodes = [];

    for (const message of messages) {
        const messageData = parseMessage(message);
        if (!messageData) continue;

        const candidates = findVerificationCandidates(messageData);

        for (const candidate of candidates) {
            const validation = isValidVerificationCode(
                candidate.code,
                messageData.fullContent,
                candidate.context
            );

            if (validation.valid) {
                verificationCodes.push({
                    ...candidate,
                    ...messageData,
                    validation,
                    score: calculateScore(candidate, messageData)
                });
            }
        }
    }

    // 去重并按分数和时间排序
    const uniqueCodes = deduplicateVerificationCodes(verificationCodes);
    return uniqueCodes.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return new Date(b.received_at) - new Date(a.received_at);
    });
}

function parseMessage(message) {
    try {
        const subject = message.Subject || message.subject || '无标题';
        const from = message.From || message.from;
        const receivedDateTime = message.ReceivedDateTime || message.receivedDateTime;
        const messageId = message.Id || message.id;

        let bodyContent = message.Body?.Content || message.body?.content || message.body?.preview || '';

        // 清理HTML内容，只保留可见文本
        if (bodyContent && bodyContent.includes('<')) {
            bodyContent = cleanHtmlContent(bodyContent);
        }

        const sender = from?.EmailAddress?.Name || from?.emailAddress?.name || from?.name || 'Unknown';

        return {
            subject,
            sender,
            received_at: receivedDateTime || new Date().toISOString(),
            messageId,
            fullContent: `${subject}\n${bodyContent}`,
            bodyContent
        };
    } catch (error) {
        console.error('[Parse] 解析邮件失败:', error);
        return null;
    }
}

function cleanHtmlContent(htmlContent) {
    if (!htmlContent) return '';

    let content = htmlContent;

    // 移除script标签和内容
    content = content.replace(/<script[^>]*>.*?<\/script>/gis, '');

    // 移除style标签和内容
    content = content.replace(/<style[^>]*>.*?<\/style>/gis, '');

    // 移除HTML注释
    content = content.replace(/<!--.*?-->/gs, '');

    // 移除HTML标签，保留文本内容
    content = content.replace(/<[^>]*>/g, ' ');

    // 清理多余的空白字符
    content = content.replace(/\s+/g, ' ').trim();

    return content;
}

function findVerificationCandidates(messageData) {
    const candidates = [];
    const { subject, fullContent } = messageData;

    const verificationPatterns = {
        high: [
            /(?:verification code|验证码|vertification code)[\s:：\n\-]*(\d{4,8})/gi,
            /(?:code|码)[\s:：\n\-]*(\d{4,8})/gi,
            /(?:pin|密码)[\s:：\n\-]*(\d{4,8})/gi,
            /(?:your code is|您的验证码是)[\s:：\n]*(\d{4,8})/gi,
            /(?:enter|input|请输入)[\s:：\n]*(\d{4,8})/gi,
            /^\[(\d{4,8})\]/gmi,
            /^verification[:\s]*(\d{4,8})/gmi
        ],
        medium: [
            /(?:verify|confirm|confirm|activate|激活|确认)[\s\S]{0,50}?(\d{4,8})/gi,
            /(?:secure|安全|access|登录)[\s\S]{0,30}?(\d{4,8})/gi,
            /(?:otp|one time|一次性)[\s\S]{0,30}?(\d{4,8})/gi,
            /(?:temporary|临时)[\s\S]{0,30}?(\d{4,8})/gi
        ],
        low: [
            /\b(\d{4,8})\b/g
        ]
    };

    for (const [priority, patterns] of Object.entries(verificationPatterns)) {
        for (const pattern of patterns) {
            let match;
            const regex = new RegExp(pattern);

            while ((match = regex.exec(fullContent)) !== null) {
                const code = match[1] || match[0];

                if (code && /^\d{4,8}$/.test(code)) {
                    const position = match.index;
                    const context = analyzeContext(fullContent, code, position);

                    candidates.push({
                        code,
                        priority,
                        position,
                        context,
                        pattern: pattern.toString(),
                        surroundingText: fullContent.substring(
                            Math.max(0, position - 50),
                            Math.min(fullContent.length, position + code.length + 50)
                        )
                    });
                }
            }
        }
    }

    return candidates;
}

function analyzeContext(content, code, position) {
    const beforeText = content.substring(Math.max(0, position - 100), position);
    const afterText = content.substring(position + code.length, Math.min(content.length, position + code.length + 100));

    return {
        before: beforeText.trim(),
        after: afterText.trim(),
        full: beforeText + code + afterText
    };
}

function isValidVerificationCode(code, content, context = null) {
    if (!code || code.length < 4 || code.length > 8) {
        return { valid: false, reason: 'Invalid length' };
    }

    const invalidPatterns = [
        /^(\d)\1{3,8}$/,
        /^(?:1234|12345|123456|1234567|12345678)$/,
        /^20(1[5-9]|2[0-9]|3[0-5])$/,
        /^\d{5}$/,
        /^(800|888|900|555)\d{4}$/,
        /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/,
        /^(?:ref|Ref|REF)\d+$/,
        /^(?:order|Order|ORDER)\d+$/,
        /^(?:invoice|Invoice|INVOICE)\d+$/
    ];

    for (const pattern of invalidPatterns) {
        if (pattern.test(code)) {
            return { valid: false, reason: 'Matches invalid pattern' };
        }
    }

    if (context) {
        const fullContext = `${context.before} ${code} ${context.after}`.toLowerCase();

        const highTrustKeywords = ['verification code', '验证码', 'your code is', '您的验证码是', 'enter this code'];
        const mediumTrustKeywords = ['verify', 'confirm', 'activate', 'security', 'access', 'login', 'otp'];

        let hasHighTrust = highTrustKeywords.some(keyword => fullContext.includes(keyword.toLowerCase()));
        let hasMediumTrust = mediumTrustKeywords.some(keyword => fullContext.includes(keyword.toLowerCase()));

        if (!hasHighTrust && !hasMediumTrust && !content.toLowerCase().includes(code.toLowerCase())) {
            return { valid: false, reason: 'No verification context found' };
        }
    }

    return { valid: true, reason: 'Valid verification code' };
}

function calculateScore(candidate, messageData) {
    let score = 1.0;

    const priorityWeights = { high: 3.0, medium: 2.0, low: 1.0 };
    score += priorityWeights[candidate.priority] || 1.0;

    if (messageData.subject.includes(candidate.code)) {
        score += 2.0;
    }

    if (candidate.context) {
        const fullContext = candidate.context.before + candidate.code + candidate.context.after;

        const keywords = {
            'verification code': 3.0,
            '验证码': 3.0,
            'your code is': 2.5,
            '您的验证码是': 2.5,
            'verify': 2.0,
            'confirm': 2.0,
            'security': 1.5,
            'access': 1.5,
            'login': 1.5
        };

        for (const [keyword, weight] of Object.entries(keywords)) {
            if (fullContext.toLowerCase().includes(keyword.toLowerCase())) {
                score += weight;
            }
        }
    }

    return Math.round(score * 10) / 10;
}

function deduplicateVerificationCodes(verificationCodes) {
    const uniqueCodes = [];
    const seenCodes = new Set();

    for (const codeData of verificationCodes) {
        const key = `${codeData.code}_${codeData.sender}`;
        if (!seenCodes.has(key)) {
            seenCodes.add(key);
            uniqueCodes.push(codeData);
        }
    }

    return uniqueCodes;
}

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n🛑 正在关闭代理服务器...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 正在关闭代理服务器...');
    process.exit(0);
});