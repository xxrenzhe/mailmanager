/**
 * CORS代理服务器
 * 解决浏览器跨域访问Outlook API的问题
 */

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const EventEmitter = require('events');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PROXY_PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// 性能和安全配置
const MAX_CONNECTIONS = 1000; // 最大SSE连接数限制
const MEMORY_THRESHOLD = 100 * 1024 * 1024; // 100MB内存阈值

// 添加body parser中间件 - 支持大批量数据
app.use(express.json({ limit: '10mb' })); // 增加JSON请求体限制到10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // 增加form-data限制到10MB

// 提供静态文件服务
app.use(express.static(__dirname));

// 创建事件发射器用于SSE
const eventEmitter = new EventEmitter();
let connectedClients = new Set();

// 后台自动Token刷新和重新授权系统
class AutoTokenManager {
    constructor() {
        this.refreshQueue = [];
        this.processing = false;
        this.refreshInProgress = new Map(); // 防止重复刷新
        this.deviceCodePolling = new Map(); // 设备码轮询管理
    }

    // 智能Token检查和自动刷新
    async checkAndRefreshToken(account, accountId, sessionId) {
        try {
            console.log(`[自动Token管理] 检查账户 ${account.email} 的Token状态`);

            // 如果已经在刷新中，跳过
            if (this.refreshInProgress.has(accountId)) {
                console.log(`[自动Token管理] 账户 ${account.email} 正在刷新中，跳过`);
                return this.refreshInProgress.get(accountId);
            }

            const refreshPromise = this.performTokenRefresh(account, accountId, sessionId);
            this.refreshInProgress.set(accountId, refreshPromise);

            try {
                const result = await refreshPromise;
                return result;
            } finally {
                this.refreshInProgress.delete(accountId);
            }

        } catch (error) {
            console.error(`[自动Token管理] 账户 ${account.email} Token检查失败:`, error);
            this.refreshInProgress.delete(accountId);
            return { success: false, needsReauth: true };
        }
    }

    // 执行Token刷新
    async performTokenRefresh(account, accountId, sessionId) {
        try {
            // 1. 首先尝试使用refresh_token自动刷新
            if (account.refresh_token && this.isRefreshTokenValid(account)) {
                console.log(`[自动Token管理] 尝试自动刷新账户 ${account.email} 的Token`);

                const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: account.client_id,
                        refresh_token: account.refresh_token,
                        grant_type: 'refresh_token',
                        scope: 'https://outlook.office.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access'
                    })
                });

                if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json();
                    console.log(`[自动Token管理] 账户 ${account.email} Token自动刷新成功`);

                    // 验证新Token
                    const isValid = await this.validateNewToken(tokenData.access_token);
                    if (isValid) {
                        // 通知前端Token已自动刷新
                        this.notifyTokenRefreshed(accountId, sessionId, {
                            email: account.email,
                            autoRefreshed: true,
                            message: 'Token已自动刷新'
                        });

                        return {
                            success: true,
                            access_token: tokenData.access_token,
                            refresh_token: tokenData.refresh_token || account.refresh_token,
                            expires_in: tokenData.expires_in,
                            autoRefreshed: true
                        };
                    }
                } else {
                    console.warn(`[自动Token管理] 账户 ${account.email} Token刷新失败: ${tokenResponse.status}`);
                }
            }

            // 2. 如果自动刷新失败，尝试后台静默重新授权
            console.log(`[自动Token管理] 开始为账户 ${account.email} 执行后台重新授权`);
            return await this.performBackgroundReauth(account, accountId, sessionId);

        } catch (error) {
            console.error(`[自动Token管理] 账户 ${account.email} Token刷新异常:`, error);
            return { success: false, needsReauth: true, error: error.message };
        }
    }

    // 检查refresh_token是否仍然有效（提前30分钟刷新）
    isRefreshTokenValid(account) {
        if (!account.token_expires_at) return true; // 如果没有过期时间，尝试刷新

        const expirationTime = new Date(account.token_expires_at);
        const now = new Date();

        // 如果Token过期时间在30分钟内，认为需要刷新
        const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);
        return expirationTime > thirtyMinutesFromNow;
    }

    // 验证新Token的有效性
    async validateNewToken(accessToken) {
        try {
            const response = await fetch('https://outlook.office.com/api/v2.0/me/messages?$top=1', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            });
            return response.ok;
        } catch (error) {
            console.error(`[自动Token管理] Token验证失败:`, error);
            return false;
        }
    }

    // 后台重新授权（使用保存的凭据自动处理）
    async performBackgroundReauth(account, accountId, sessionId) {
        try {
            console.log(`[后台重新授权] 开始为账户 ${account.email} 执行后台���新授权`);

            // 对于已经失效的Token，直接标记需要重新授权并生成新的授权URL
            const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
            authUrl.searchParams.set('client_id', account.client_id);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('redirect_uri', 'http://localhost:3001/auth/callback');
            authUrl.searchParams.set('scope', 'https://outlook.office.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access');
            authUrl.searchParams.set('response_mode', 'query');
            authUrl.searchParams.set('state', JSON.stringify({
                account_id: accountId,
                email: account.email,
                auto_reauth: true,
                timestamp: Date.now()
            }));

            // 通知前端需要自动重新授权
            this.notifyAutoReauthRequired(accountId, sessionId, {
                email: account.email,
                auth_url: authUrl.toString(),
                message: '系统检测到Token失效，正在自动重新授权...'
            });

            // 监听OAuth回调
            return await this.waitForOAuthCallback(accountId, sessionId);

        } catch (error) {
            console.error(`[后台重新授权] 账户 ${account.email} 后台重新授权失败:`, error);
            return { success: false, needsReauth: true, error: error.message };
        }
    }

    // 等待OAuth回调
    async waitForOAuthCallback(accountId, sessionId, timeoutMs = 300000) { // 5分钟超时
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                eventEmitter.removeListener(`oauth_callback_${accountId}`, callback);
                resolve({ success: false, error: 'OAuth回调超时' });
            }, timeoutMs);

            const callback = (data) => {
                clearTimeout(timeout);
                console.log(`[后台重新授权] 收到账户 ${accountId} 的OAuth回调结果:`, data);

                if (data.success) {
                    this.notifyTokenRefreshed(accountId, sessionId, {
                        email: data.email,
                        autoReauthed: true,
                        message: '账户已自动重新授权'
                    });
                }

                resolve(data);
            };

            eventEmitter.once(`oauth_callback_${accountId}`, callback);
        });
    }

    // 通知Token已刷新
    notifyTokenRefreshed(accountId, sessionId, data) {
        const eventData = {
            type: 'token_refreshed',
            account_id: accountId,
            ...data
        };
        eventEmitter.emit(`monitoring_event_${sessionId}`, eventData);
    }

    // 通知需要自动重新授权
    notifyAutoReauthRequired(accountId, sessionId, data) {
        const eventData = {
            type: 'auto_reauth_required',
            account_id: accountId,
            ...data
        };
        eventEmitter.emit(`monitoring_event_${sessionId}`, eventData);
    }

    // 批量自动刷新Token
    async batchRefreshTokens(accounts, sessionId) {
        console.log(`[自动Token管理] 开始批量自动刷新 ${accounts.length} 个账户的Token`);

        const results = [];
        const batchSize = 3; // 并发限制

        for (let i = 0; i < accounts.length; i += batchSize) {
            const batch = accounts.slice(i, i + batchSize);

            const batchPromises = batch.map(async (account) => {
                const result = await this.checkAndRefreshToken(account, account.id, sessionId);
                return { account_id: account.id, result };
            });

            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : {
                account_id: r.reason.account_id,
                result: { success: false, error: r.reason.message }
            }));

            // 批次间延迟
            if (i + batchSize < accounts.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        console.log(`[自动Token管理] 批量刷新完成，结果:`, results);
        return results;
    }
}

// 创建全局自动Token管理器实例
const autoTokenManager = new AutoTokenManager();

// 内存监控和清理机制
setInterval(() => {
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed > MEMORY_THRESHOLD) {
        console.log(`[内存监控] 内存使用过高: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB，触发清理`);
        // 强制垃圾回收（如果可用）
        if (global.gc) {
            global.gc();
        }
        // 清理可能的事件监听器泄漏
        eventEmitter.removeAllListeners();
        console.log(`[内存监控] 已清理事件监听器，当前连接数: ${connectedClients.size}`);
    }
}, 60000); // 每分钟检查一次

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

// 手动取件端点 - 用户主动触发邮件收取
app.post('/api/manual-fetch-emails', async (req, res) => {
    const { sessionId, account_id, email, client_id, refresh_token, current_status, access_token } = req.body;
    const userSessionId = sessionId || 'default';

    console.log(`[手动取件] 用户主动触发: ${email}, 账户ID: ${account_id} (会话: ${userSessionId})`);

    try {
        // 检查token有效性，如需要则刷新
        let tokenToUse = access_token;
        if (!tokenToUse || current_status !== 'authorized') {
            console.log(`[手动取件] 账户 ${email} 需要刷新token...`);
            const authResult = await attemptTokenRefresh({
                client_id,
                refresh_token,
                access_token,
                current_status
            });

            if (authResult.success) {
                tokenToUse = authResult.access_token;
                console.log(`[手动取件] 账户 ${email} token刷新成功`);

                // 发送token更新事件
                const tokenUpdateEvent = {
                    sessionId: userSessionId,
                    type: 'account_status_changed',
                    account_id: account_id,
                    email: email,
                    status: 'authorized',
                    access_token: authResult.access_token,
                    refresh_token: authResult.refresh_token,
                    message: `账户 ${email} 授权已更新`,
                    timestamp: new Date().toISOString()
                };
                eventEmitter.emit(`monitoring_event_${userSessionId}`, tokenUpdateEvent);
            } else {
                console.log(`[手动取件] 账户 ${email} token刷新失败: ${authResult.error}`);
                return res.json({
                    success: false,
                    message: '账户授权失效，请重新导入',
                    error: authResult.error
                });
            }
        }

        // 获取最近5封邮件
        const emailResponse = await fetch('https://outlook.office.com/api/v2.0/me/messages?$top=5&$orderby=ReceivedDateTime desc', {
            headers: {
                'Authorization': `Bearer ${tokenToUse}`,
                'Accept': 'application/json'
            }
        });

        if (!emailResponse.ok) {
            throw new Error(`邮件API调用失败: ${emailResponse.status} ${emailResponse.statusText}`);
        }

        const emailData = await emailResponse.json();
        const messages = emailData.value || [];

        if (messages.length > 0) {
            console.log(`[手动取件] 账户 ${email} 获取到 ${messages.length} 封邮件`);

            // 提取验证码
            const results = extractVerificationCodesAdvanced(messages);

            if (results.length > 0) {
                console.log(`[手动取件] 从邮件中提取到 ${results.length} 个验证码`);

                // 发送验证码发现事件
                results.forEach(result => {
                    pushEventToSession(userSessionId, {
                        type: 'verification_code_found',
                        sessionId: userSessionId,
                        account_id: account_id,
                        code: result.code,
                        sender: result.sender,
                        received_at: result.received_at,
                        score: result.score || 1.0,
                        priority: result.priority || 'medium',
                        subject: result.subject,
                        timestamp: new Date().toISOString()
                    });
                });

                // 发送取件成功事件
                const successEvent = {
                    sessionId: userSessionId,
                    type: 'manual_fetch_complete',
                    account_id: account_id,
                    email: email,
                    message: `手动取件完成：发现 ${results.length} 个验证码`,
                    emails_found: messages.length,
                    codes_found: results.length,
                    timestamp: new Date().toISOString()
                };
                eventEmitter.emit(`monitoring_event_${userSessionId}`, successEvent);

                return res.json({
                    success: true,
                    message: `手动取件成功，发现 ${results.length} 个验证码`,
                    emails_found: messages.length,
                    codes_found: results.length,
                    codes: results
                });
            } else {
                console.log(`[手动取件] 账户 ${email} 未发现验证码`);

                // 发送无验证码事件
                const noCodesEvent = {
                    sessionId: userSessionId,
                    type: 'manual_fetch_complete',
                    account_id: account_id,
                    email: email,
                    message: `手动取件完成：未发现验证码`,
                    emails_found: messages.length,
                    codes_found: 0,
                    timestamp: new Date().toISOString()
                };
                eventEmitter.emit(`monitoring_event_${userSessionId}`, noCodesEvent);

                return res.json({
                    success: true,
                    message: '手动取件完成，未发现验证码',
                    emails_found: messages.length,
                    codes_found: 0
                });
            }
        } else {
            console.log(`[手动取件] 账户 ${email} 没有新邮件`);

            return res.json({
                success: true,
                message: '手动取件完成，没有新邮件',
                emails_found: 0,
                codes_found: 0
            });
        }

    } catch (error) {
        console.error(`[手动取件] 处理失败: ${email}`, error);

        // 发送错误事件
        const errorEvent = {
            sessionId: userSessionId,
            type: 'manual_fetch_error',
            account_id: account_id,
            email: email,
            message: `手动取件失败: ${error.message}`,
            error: error.message,
            timestamp: new Date().toISOString()
        };
        eventEmitter.emit(`monitoring_event_${userSessionId}`, errorEvent);

        res.status(500).json({
            success: false,
            message: '手动取件失败',
            error: error.message
        });
    }
});

// 监控触发端点 - 复制邮箱时自动启动监控
app.post('/api/monitor/copy-trigger', (req, res) => {
    const {
        sessionId,
        account_id,
        email,
        client_id,
        refresh_token,
        current_status,
        access_token,
        // 新增：接收历史邮件数据
        codes = [],
        emails = [],
        latest_code_received_at,
        last_active_at
    } = req.body;
    const userSessionId = sessionId || 'default';

    console.log(`[监控触发] 复制邮箱: ${email}, 账户ID: ${account_id} (会话: ${userSessionId})`);
    console.log(`[监控触发] 账户状态: ${current_status}, 有access_token: ${!!access_token}`);
    console.log(`[监控触发] 历史数据: ${codes.length}个验证码, ${emails.length}封邮件`);

    // 存储账户信息用于后续的授权尝试
    const accountInfo = {
        sessionId: userSessionId,
        account_id,
        email,
        client_id,
        refresh_token,
        current_status,
        access_token,
        // 新增：存储历史邮件数据用于时间过滤
        codes,
        emails,
        latest_code_received_at,
        last_active_at,
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
        monitor_start_time: new Date().toISOString(), // 记录监控开始时间，用于新邮件过滤
        checkCount: 0,
        timeoutId: null
    };

    // 存储监控任务到活跃监控映射
    activeMonitors.set(monitorId, monitoringTask);

    // 将监控开始时间添加到accountInfo中，用于邮件过滤
    accountInfo.monitor_start_time = monitoringTask.monitor_start_time;

    // 添加到会话监控映射
    if (!sessionMonitors.has(userSessionId)) {
        sessionMonitors.set(userSessionId, new Set());
    }
    sessionMonitors.get(userSessionId).add(monitorId);

    console.log(`[监控] 启动监控任务: ${monitorId}, 会话: ${userSessionId}`);
    performMonitoringCheck(monitorId, email);

    // 设置定时器 - 每5秒检查一次，提高响应速度
    const monitoringInterval = setInterval(() => {
        performMonitoringCheck(monitorId, email);
        monitoringTask.checkCount++;
    }, 5000);

    // 保存定时器ID到监控任务中
    monitoringTask.intervalId = monitoringInterval;

    // 设置1分钟停止定时器
    const stopTimeout = setTimeout(() => {
        console.log(`[监控] 1分钟监控超时: ${email}, 共检查 ${monitoringTask.checkCount + 1} 次`);

        // KISS修复：调用标准停止函数，确保事件格式正确
        stopMonitoringTask(monitorId, '1分钟监控超时');

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

// 停止监控的辅助函数
function stopMonitoringTask(monitorId, reason = '验证码已找到') {
    const monitoringTask = activeMonitors.get(monitorId);
    if (!monitoringTask) {
        return false;
    }

    const { sessionId, accountId, email } = monitoringTask;

    console.log(`[监控] 停止监控任务: ${monitorId}, 原因: ${reason}`);

    // 清理定时器
    if (monitoringTask.intervalId) {
        clearInterval(monitoringTask.intervalId);
    }
    if (monitoringTask.timeoutId) {
        clearTimeout(monitoringTask.timeoutId);
    }

    // 删除监控任务
    activeMonitors.delete(monitorId);

    // 从会话监控映射中移除
    if (sessionMonitors.has(sessionId)) {
        sessionMonitors.get(sessionId).delete(monitorId);
        if (sessionMonitors.get(sessionId).size === 0) {
            sessionMonitors.delete(sessionId);
        }
    }

    // 发送监控结束事件
    const stopEvent = {
        sessionId: sessionId,
        type: 'monitoring_ended',
        account_id: accountId,
        email: email,
        action: 'auto_stop',
        reason: reason,
        message: `监控已停止: ${reason}`,
        timestamp: new Date().toISOString()
    };
    eventEmitter.emit(`monitoring_event_${sessionId}`, stopEvent);

    return true;
}

// 执行监控检查的函数
async function performMonitoringCheck(monitorId, email) {
    const monitoringTask = activeMonitors.get(monitorId);
    if (!monitoringTask || !monitoringTask.accountInfo) {
        // KISS 优化：静默处理已清理的监控任务，避免错误日志干扰
        console.log(`[监控检查] 监控任务已结束: ${monitorId}`);
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
                        console.log(`[监控检查] 账��� ${email} 重新授权成功`);
                        accountInfo.access_token = authResult.access_token;
                        // 关键：更新refresh_token确保持久化
                        if (authResult.refresh_token) {
                            accountInfo.refresh_token = authResult.refresh_token;
                        }
                        accountInfo.current_status = 'authorized';

                        // 发送授权成功事件，包含新的token信息
                        const authSuccessEvent = {
                            sessionId: sessionId,
                            type: 'account_status_changed',
                            account_id: accountId,
                            email: email,
                            status: 'authorized',
                            access_token: authResult.access_token,
                            refresh_token: authResult.refresh_token,
                            message: `账户 ${email} 授权已恢复，开始检查邮件...`,
                            timestamp: new Date().toISOString()
                        };
                        eventEmitter.emit(`monitoring_event_${sessionId}`, authSuccessEvent);

                        // KISS 优化：重新授权成功后立即尝试获取邮件
                        console.log(`[监控检查] 账户 ${email} 重新授权成功，立即尝试获取邮件`);
                        accountInfo._just_reauthorized = true; // 设置临时标记
                        await fetchNewEmails(accountId, accountInfo, sessionId);
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

        // 🔧 修复：使用上一封邮件的绝对时间作为过滤基准
        if (accountInfo.access_token) {
            // 获取最新邮件的收件时间作为绝对基准
            const latestEmailTime = getLatestEmailReceivedTime(accountInfo);

            // 构建邮件获取选项
            let fetchOptions = { onlyNew: true };

            if (latestEmailTime) {
                // ✅ 使用上一封邮件的绝对时间作为过滤起点
                // 这样可以获取所有比上一封邮件更新的邮件
                fetchOptions.sinceTime = latestEmailTime;
                console.log(`[监控检查] 账户 ${email} ✅ 使用历史邮件时间作为绝对基准: ${latestEmailTime}`);
            } else if (accountInfo._just_reauthorized) {
                // 如果刚刚重新授权成功，使用监控开始时间
                fetchOptions.sinceTime = accountInfo.monitor_start_time || new Date(Date.now() - 60000).toISOString();
                console.log(`[监控检查] 账户 ${email} 刚重新授权，使用监控开始时间: ${fetchOptions.sinceTime}`);
            } else {
                // 默认情况：没有邮件历史时，使用1分钟前作为基准
                const fallbackTime = new Date(Date.now() - 60000).toISOString();
                fetchOptions.sinceTime = fallbackTime;
                console.log(`[监控检查] 账户 ${email} 无邮件历史，使用默认基准: ${fallbackTime}`);
            }

            console.log(`[监控检查] 账户 ${email} 将获取比 ${fetchOptions.sinceTime} 更新的邮件`);
            const emailResult = await fetchNewEmails(accountId, accountInfo, sessionId, fetchOptions);

            // 检查是否发现了验证码，如果是则停止监控
            if (emailResult && emailResult.should_stop_monitoring && emailResult.verification_codes_found > 0) {
                console.log(`[监控] 发现验证码，立即停止监控: ${email} (发现 ${emailResult.verification_codes_found} 个验证码)`);
                stopMonitoringTask(monitorId, `发现 ${emailResult.verification_codes_found} 个验证码`);
                return; // 提前退出监控检查
            }
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

        // 清除临时标记
        delete accountInfo._just_reauthorized;

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
                refresh_token: data.refresh_token, // 关键：返回新的refresh_token确保持久化
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

// 获取最新验证码邮件的收件时间
function getLatestEmailReceivedTime(accountInfo) {
    // ✅ 优先使用最新���证码邮件时间
    if (accountInfo.latest_code_received_at) {
        console.log(`[时间基准] 使用最新验证码邮件时间: ${accountInfo.latest_code_received_at}`);
        return new Date(accountInfo.latest_code_received_at).toISOString();
    }

    // ✅ 备选方案1：使用验证码记录的时间，因为这是确认包含验证码的邮件
    if (accountInfo.codes && accountInfo.codes.length > 0) {
        const sortedCodes = accountInfo.codes.sort((a, b) =>
            new Date(b.received_at) - new Date(a.received_at)
        );
        const latestCode = sortedCodes[0];
        if (latestCode && latestCode.received_at) {
            console.log(`[时间基准] 使用验证码记录时间: ${latestCode.received_at} (验证码: ${latestCode.code})`);
            return new Date(latestCode.received_at).toISOString();
        }
    }

    // 🔧 备选方案2：如果没有验证码记录，则使用最新邮件时间
    if (accountInfo.emails && accountInfo.emails.length > 0) {
        const sortedEmails = accountInfo.emails.sort((a, b) =>
            new Date(b.received_at) - new Date(a.received_at)
        );
        const latestEmail = sortedEmails[0];
        if (latestEmail && latestEmail.received_at) {
            console.log(`[时间基准] 备选方案：使用最新邮件时间: ${latestEmail.received_at} (无验证码记录)`);
            return new Date(latestEmail.received_at).toISOString();
        }
    }

    // 🔧 备选方案3：使用账户最后活跃时间
    if (accountInfo.last_active_at) {
        console.log(`[时间基准] 备选方案：使用账户最后活跃时间: ${accountInfo.last_active_at}`);
        return new Date(accountInfo.last_active_at).toISOString();
    }

    // 如果都没有，返回null
    console.log(`[时间基准] 无任何历史时间数据，返回null`);
    return null;
}

// 获取新邮件（支持只获取新邮件的模式）
async function fetchNewEmails(accountId, accountInfo, sessionId, options = {}) {
    const { onlyNew = false, sinceTime = null } = options;

    try {
        // 构建查询参数
        let query = `$orderby=ReceivedDateTime desc&$top=5`;

        // 如果只获取新邮件，添加时间过滤条件
        if (onlyNew && sinceTime) {
            // ✅ 优先使用明确的绝对时间参数
            const sinceISO = new Date(sinceTime).toISOString();
            // 对时间进行URL编码，避免特殊字符问题
            const encodedTime = encodeURIComponent(sinceISO);
            query += `&$filter=ReceivedDateTime ge ${encodedTime}`;
            console.log(`[邮件] ✅ 时间过滤生效，将获取比 ${sinceISO} 更新的邮件`);
        } else if (onlyNew && accountInfo.last_check) {
            // 备用方案：使用上次检查时间作为基准（也是绝对时间）
            const lastCheckISO = new Date(accountInfo.last_check).toISOString();
            const encodedTime = encodeURIComponent(lastCheckISO);
            query += `&$filter=ReceivedDateTime ge ${encodedTime}`;
            console.log(`[邮件] 使用上次检查时间过滤: ${lastCheckISO}`);
        }

        const response = await fetch(`https://outlook.office.com/api/v2.0/me/messages?${query}`, {
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
            console.log(`[邮件] 账户 ${accountInfo.email} 找到 ${messages.length} 封邮件（时间过滤后）`);

            // 显示邮件时间范围，用于验证时间过滤效果
            if (messages.length > 0) {
                const oldestEmail = messages[messages.length - 1];
                const newestEmail = messages[0];
                console.log(`[邮件] 时间范围: ${oldestEmail.ReceivedDateTime} 至 ${newestEmail.ReceivedDateTime}`);
            }
        } else {
            console.log(`[邮件] 账户 ${accountInfo.email} 时间过滤后无新邮件（符合预期）`);
        }

            // 提取验证码
            const results = extractVerificationCodesAdvanced(messages);

            if (results.length > 0) {
                console.log(`[验证码] 从邮件中提取到 ${results.length} 个验证码`);

                // 🎯 关键修复：更新accountInfo中的时间基准，确保后续监控使用最新时间
                const latestResult = results[0]; // results已按时间排序
                if (latestResult && latestResult.received_at) {
                    accountInfo.latest_code_received_at = latestResult.received_at;
                    accountInfo.last_active_at = latestResult.received_at;
                    console.log(`[时间基准] 已更新最新验证码时间基准: ${latestResult.received_at} (验证码: ${latestResult.code})`);
                }

                results.forEach(result => {
                    pushEventToSession(sessionId, {
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

                // 返回验证码发现状态，用于监控停止判断
                return {
                    success: true,
                    verification_codes_found: results.length,
                    emails_found: messages.length,
                    should_stop_monitoring: results.length > 0 // 发现验证码时建议停止监控
                };
            }
        } else {
            console.log(`[邮件] 账户 ${accountInfo.email} 没有新邮件`);
        }

        // 返回默认状态（没有发现验证码）
        return {
            success: true,
            verification_codes_found: 0,
            emails_found: messages.length,
            should_stop_monitoring: false
        };

    } catch (error) {
        console.error(`[邮件] 获取邮件失败: ${accountInfo.email}`, error);

        // 如果是授权错误，标记需要重新授权
        if (error.message.includes('401') || error.message.includes('403')) {
            accountInfo.access_token = null;
            accountInfo.current_status = 'reauth_needed';
        }

        // 返回错误状态
        return {
            success: false,
            verification_codes_found: 0,
            emails_found: 0,
            should_stop_monitoring: false,
            error: error.message
        };
    }
}

// SSE事件流端点 - 实时更新（带连接数限制）
app.get('/api/events/stream/:sessionId?', (req, res) => {
    // 检查连接数限制
    if (connectedClients.size >= MAX_CONNECTIONS) {
        console.log(`[SSE] 连接数超限: ${connectedClients.size}/${MAX_CONNECTIONS}，拒绝新连接`);
        return res.status(429).json({
            error: 'Too many connections',
            message: `服务器连接数已达上限 (${MAX_CONNECTIONS})，请稍后重试`
        });
    }

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

        // 2. 获取最近5封邮件，不受时间限制
        const emailResponse = await fetch('https://outlook.office.com/api/v2.0/me/messages?$top=5&$orderby=ReceivedDateTime desc', {
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
                pushEventToSession(sessionId || 'default', {
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

// 批量账户验证API（提升导入性能）
app.post('/api/accounts/batch-validate', async (req, res) => {
    const { sessionId, accounts } = req.body;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid accounts data'
        });
    }

    try {
        console.log(`[批量验证] 开始批量验证 ${accounts.length} 个账户`);

        const results = [];
        let batchSize = calculateOptimalBatchSize(accounts.length);

        console.log(`[批量验证] 使用动态批量大小: ${batchSize}, 总账户数: ${accounts.length}`);

        // 性能优化：并行处理所有批次，大幅提升处理速度
        const totalBatches = Math.ceil(accounts.length / batchSize);
        console.log(`[批量验证] 性能优化模式：${totalBatches} 个批次并行处理，每批 ${batchSize} 个账户`);

        // 创建所有批次的任务
        const allBatchTasks = [];
        for (let i = 0; i < accounts.length; i += batchSize) {
            const batchIndex = Math.floor(i / batchSize);
            const batch = accounts.slice(i, i + batchSize);

            const batchTask = (async () => {
                const startTime = Date.now();
                console.log(`[批次 ${batchIndex + 1}/${totalBatches}] 开始处理 ${batch.length} 个账户`);

                const batchPromises = batch.map(async (account) => {
                let retryCount = 0;
                const maxRetries = 3;
                const retryDelay = 500; // 减少重试延迟到0.5秒，提升性能

                while (retryCount < maxRetries) {
                    try {
                        console.log(`[批量验证] 尝试验证账户 ${account.email} (尝试 ${retryCount + 1}/${maxRetries})`);

                        const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({
                                client_id: account.client_id,
                                refresh_token: account.refresh_token,
                                grant_type: 'refresh_token',
                                scope: 'https://outlook.office.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All'
                            })
                        });

                        if (response.ok) {
                            // Token刷新成功，继续处理
                            const tokenData = await response.json();

                            // 获取最近5封邮件进行验证（符合用户需求）
                            const emailResponse = await fetch('https://outlook.office.com/api/v2.0/me/messages?$top=5&$orderby=ReceivedDateTime desc', {
                                headers: {
                                    'Authorization': `Bearer ${tokenData.access_token}`,
                                    'Accept': 'application/json'
                                }
                            });

                            if (emailResponse.ok) {
                                const emails = await emailResponse.json();
                                const verificationCodes = await extractVerificationCodesAdvanced(emails.value, account.id, 'auto');

                                // 发送验证码发现事件（批量验证时也需要通知前端）
                                if (verificationCodes.length > 0) {
                                    console.log(`[批量验证] 账户 ${account.email} 提取到 ${verificationCodes.length} 个验证码，发送WebSocket事件`);

                                    verificationCodes.forEach(result => {
                                        // 向所有活跃的WebSocket连接广播事件
                                        if (websocketServer && websocketServer.clients) {
                                            const codeFoundEvent = {
                                                sessionId: sessionId,
                                                type: 'verification_code_found',
                                                account_id: account.id,
                                                code: result.code,
                                                sender: result.sender,
                                                received_at: result.received_at,
                                                score: result.score || 1.0,
                                                priority: result.priority || 'medium',
                                                subject: result.subject,
                                                timestamp: new Date().toISOString()
                                            };

                                            websocketServer.clients.forEach(client => {
                                                if (client.readyState === 1) { // WebSocket.OPEN
                                                    client.send(JSON.stringify(codeFoundEvent));
                                                }
                                            });
                                        }

                                        // 同时通过SSE发送事件（兼容性）
                                        if (eventEmitter) {
                                            pushEventToSession(sessionId, {
                                                type: 'verification_code_found',
                                                sessionId: sessionId,
                                                account_id: account.id,
                                                code: result.code,
                                                sender: result.sender,
                                                received_at: result.received_at,
                                                score: result.score || 1.0,
                                                priority: result.priority || 'medium',
                                                subject: result.subject,
                                                timestamp: new Date().toISOString()
                                            });
                                        }
                                    });
                                }

                                return {
                                    account_id: account.id,
                                    email: account.email,
                                    success: true,
                                    status: 'authorized',
                                    access_token: tokenData.access_token,
                                    expires_in: tokenData.expires_in,
                                    verification_codes: verificationCodes,
                                    message: '验证成功'
                                };
                            } else {
                                return {
                                    account_id: account.id,
                                    email: account.email,
                                    success: true,
                                    status: 'authorized',
                                    access_token: tokenData.access_token,
                                    expires_in: tokenData.expires_in,
                                    verification_codes: [],
                                    message: 'Token刷新成功，但邮件获取失败'
                                };
                            }
                        } else {
                            // Token刷新失败，分析错误类型
                            let status = 'reauth_needed';
                            let message = 'Token验证失败';
                            let shouldRetry = false;

                            try {
                                const errorData = await response.json();
                                console.log(`[批量验证] 账户 ${account.email} Token刷新失败:`, {
                                    error: errorData.error,
                                    description: errorData.error_description,
                                    status: response.status,
                                    codes: errorData.error_codes
                                });

                                // 根据错误类型决定是否重试
                                if (errorData.error === 'invalid_grant') {
                                    if (errorData.error_description && errorData.error_description.includes('expired')) {
                                        message = 'Refresh Token已过期，需要手动重新授权';
                                        status = 'expired_refresh_token';
                                    } else {
                                        message = 'Refresh Token无效，需要手动重新授权';
                                        status = 'invalid_refresh_token';
                                    }
                                    shouldRetry = false; // 完全过期，不重试
                                } else if (errorData.error === 'invalid_client') {
                                    message = 'Client ID配置错误或应用未注册';
                                    status = 'invalid_client_id';
                                    shouldRetry = false; // 配置错误，不重试
                                } else if (errorData.error === 'temporarily_unavailable' || response.status === 429) {
                                    message = 'Microsoft服务暂时不可用，稍后重试';
                                    status = 'service_unavailable';
                                    shouldRetry = true; // 服务问题，可以重试
                                } else if (errorData.error === 'internal_server_error') {
                                    message = 'Microsoft内部服务器错误，稍后重试';
                                    status = 'server_error';
                                    shouldRetry = true; // 服务器错误，可以重试
                                } else {
                                    message = `Token刷新失败: ${errorData.error_description || errorData.error}`;
                                    status = 'token_refresh_error';
                                    shouldRetry = true; // 未知错误，可以重试
                                }
                            } catch (e) {
                                console.log(`[批量验证] 账户 ${account.email} 响应解析失败:`, e.message);
                                message = `HTTP ${response.status}: Token刷新失败，响应格式异常`;
                                status = 'response_parse_error';
                                shouldRetry = response.status >= 500 || response.status === 429; // 服务器错误时重试
                            }

                            if (shouldRetry && retryCount < maxRetries - 1) {
                                retryCount++;
                                console.log(`[批量验证] 账户 ${account.email} 将在 ${retryDelay/1000}秒后重试 (${retryCount}/${maxRetries})`);
                                await new Promise(resolve => setTimeout(resolve, retryDelay));
                                continue; // 继续重试
                            }

                            // 不重试或重试次数用完，返回失败结果
                            return {
                                account_id: account.id,
                                email: account.email,
                                success: false,
                                status: status,
                                message: message,
                                retry_attempts: retryCount + 1
                            };
                        }
                    } catch (error) {
                        console.error(`[批量验证] 账户 ${account.email} 验证异常:`, error.message);

                        if (retryCount < maxRetries - 1) {
                            retryCount++;
                            console.log(`[批量验证] 账户 ${account.email} 网络异常，将在 ${retryDelay/1000}秒后重试 (${retryCount}/${maxRetries})`);
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            continue; // 继续重试
                        }

                        return {
                            account_id: account.id,
                            email: account.email,
                            success: false,
                            status: 'network_error',
                            message: '网络连接失败',
                            retry_attempts: retryCount + 1
                        };
                    }
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);

                // 处理批次结果
                const validResults = [];
                batchResults.forEach(promiseResult => {
                    if (promiseResult.status === 'fulfilled') {
                        const result = promiseResult.value;
                        validResults.push(result);
                        // 保存验证历史
                        saveValidationHistory(result.account_id, result);
                    } else {
                        console.error(`[批量验证] 批次处理异常:`, promiseResult.reason);
                    }
                });

                const duration = Date.now() - startTime;
                console.log(`[批次 ${batchIndex + 1}/${totalBatches}] 完成，耗时: ${(duration/1000).toFixed(1)}秒，有效结果: ${validResults.length}`);

                return validResults;
            })();

            allBatchTasks.push(batchTask);
        }

        // 并行执行所有批次，但限制并发数以避免过载
        const maxConcurrentBatches = Math.min(8, totalBatches); // 最多8个批次并行
        console.log(`[批量验证] 启动并行处理，最多 ${maxConcurrentBatches} 个批次同时执行`);

        const finalResults = [];
        for (let i = 0; i < allBatchTasks.length; i += maxConcurrentBatches) {
            const currentBatchTasks = allBatchTasks.slice(i, i + maxConcurrentBatches);
            const batchResults = await Promise.allSettled(currentBatchTasks);

            batchResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    finalResults.push(...result.value);
                }
            });

            // 发送进度更新
            const completedBatches = Math.min(i + maxConcurrentBatches, totalBatches);
            const progress = (completedBatches / totalBatches * 100).toFixed(1);
            console.log(`[批量验证] 进度: ${completedBatches}/${totalBatches} 批次完成 (${progress}%)`);
        }

        results.push(...finalResults);

        const successCount = results.filter(r => r.success).length;
        const totalCodes = results.reduce((sum, r) => sum + (r.verification_codes?.length || 0), 0);

        res.json({
            success: true,
            message: `批量验证完成：${successCount}/${accounts.length} 成功，共找到 ${totalCodes} 个验证码`,
            results: results
        });

    } catch (error) {
        console.error('[批量验证] 批量验证失败:', error);
        res.status(500).json({
            success: false,
            error: '批量验证过程出错'
        });
    }
});

// Token有效性预检查API
app.post('/api/accounts/check-tokens', async (req, res) => {
    const { accounts, sessionId } = req.body;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid accounts data'
        });
    }

    try {
        console.log(`[Token检查] 检查 ${accounts.length} 个账户`);

        const results = await Promise.allSettled(
            accounts.map(async (account) => {
                try {
                    console.log(`[Token检查] 检查账户 ${account.email} 的Token`);

                    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            client_id: account.client_id,
                            refresh_token: account.refresh_token,
                            grant_type: 'refresh_token',
                            scope: 'https://outlook.office.com/Mail.Read offline_access'
                        })
                    });

                    if (response.ok) {
                        const tokenData = await response.json();

                        // 发送账户状态变更事件 - Token有效，账户已授权
                        if (sessionId && eventEmitter) {
                            const statusChangedEvent = {
                                sessionId: sessionId,
                                type: 'account_status_changed',
                                account_id: account.id,
                                email: account.email,
                                status: 'authorized',
                                message: `账户 ${account.email} Token验证成功，状态已更新为已授权`,
                                timestamp: new Date().toISOString()
                            };

                            // 向所有活跃的WebSocket连接广播事件
                            if (websocketServer && websocketServer.clients) {
                                console.log(`[WebSocket事件] 准备发送account_status_changed事件: ${account.email} -> authorized`);
                                let sentCount = 0;
                                websocketServer.clients.forEach(client => {
                                    if (client.readyState === 1) { // WebSocket.OPEN
                                        client.send(JSON.stringify(statusChangedEvent));
                                        sentCount++;
                                    }
                                });
                                console.log(`[WebSocket事件] account_status_changed事件已发送给 ${sentCount} 个客户端`);
                            } else {
                                console.log(`[WebSocket事件] websocketServer或clients不存在，跳过WebSocket发送`);
                            }

                            // 同时通过SSE发送事件（兼容性）
                            eventEmitter.emit(`monitoring_event_${sessionId}`, statusChangedEvent);
                        }

                        return {
                            account_id: account.id,
                            email: account.email,
                            valid: true,
                            expires_in: tokenData.expires_in,
                            message: 'Token有效'
                        };
                    } else {
                        let status = 'unknown_error';
                        let message = 'Token验证失败';

                        try {
                            const errorData = await response.json();
                            if (errorData.error === 'invalid_grant') {
                                status = 'expired_refresh_token';
                                message = 'Refresh Token已过期或无效';
                            } else if (errorData.error === 'invalid_client') {
                                status = 'invalid_client_id';
                                message = 'Client ID配置错误';
                            } else {
                                message = `Token验证失败: ${errorData.error_description || errorData.error}`;
                            }
                        } catch (e) {
                            message = `HTTP ${response.status}: Token验证失败`;
                        }

                        // 发送账户状态变更事件 - Token无效，需要重新授权
                        if (sessionId && eventEmitter) {
                            const statusChangedEvent = {
                                sessionId: sessionId,
                                type: 'account_status_changed',
                                account_id: account.id,
                                email: account.email,
                                status: 'reauth_needed',
                                message: `账户 ${account.email} ${message}`,
                                timestamp: new Date().toISOString()
                            };

                            // 向所有活跃的WebSocket连接广播事件
                            if (websocketServer && websocketServer.clients) {
                                websocketServer.clients.forEach(client => {
                                    if (client.readyState === 1) { // WebSocket.OPEN
                                        client.send(JSON.stringify(statusChangedEvent));
                                    }
                                });
                            }

                            // 同时通过SSE发送事件（兼容性）
                            eventEmitter.emit(`monitoring_event_${sessionId}`, statusChangedEvent);
                        }

                        return {
                            account_id: account.id,
                            email: account.email,
                            valid: false,
                            status: status,
                            message: message
                        };
                    }
                } catch (error) {
                    console.error(`[Token检查] 账户 ${account.email} 检查异常:`, error.message);

                    // 发送账户状态变更事件 - 网络错误
                    if (sessionId && eventEmitter) {
                        const statusChangedEvent = {
                            sessionId: sessionId,
                            type: 'account_status_changed',
                            account_id: account.id,
                            email: account.email,
                            status: 'network_error',
                            message: `账户 ${account.email} 网络连接失败`,
                            timestamp: new Date().toISOString()
                        };

                        // 向所有活跃的WebSocket连接广播事件
                        if (websocketServer && websocketServer.clients) {
                            websocketServer.clients.forEach(client => {
                                if (client.readyState === 1) { // WebSocket.OPEN
                                    client.send(JSON.stringify(statusChangedEvent));
                                }
                            });
                        }

                        // 同时通过SSE发送事件（兼容性）
                        eventEmitter.emit(`monitoring_event_${sessionId}`, statusChangedEvent);
                    }

                    return {
                        account_id: account.id,
                        email: account.email,
                        valid: false,
                        status: 'network_error',
                        message: '网络连接失败'
                    };
                }
            })
        );

        const validTokens = results.filter(r => r.status === 'fulfilled' && r.value.valid).length;
        const invalidTokens = results.filter(r => r.status === 'fulfilled' && !r.value.valid).length;

        console.log(`[Token检查] 完成: ${validTokens} 有效, ${invalidTokens} 无效`);

        res.json({
            success: true,
            message: `Token检查完成: ${validTokens} 有效, ${invalidTokens} 无效`,
            valid_count: validTokens,
            invalid_count: invalidTokens,
            results: results.map(r => r.status === 'fulfilled' ? r.value : {
                account_id: r.reason?.account_id || 'unknown',
                email: r.reason?.email || 'unknown',
                valid: false,
                status: 'check_failed',
                message: '检查过程异常'
            })
        });

    } catch (error) {
        console.error('[Token检查] 批量检查失败:', error);
        res.status(500).json({
            success: false,
            error: 'Token检查过程出错'
        });
    }
});

// 计算最优批量大小（性能优化版本）
function calculateOptimalBatchSize(totalAccounts) {
    const memoryUsage = process.memoryUsage();
    const memoryUtilization = memoryUsage.heapUsed / memoryUsage.heapTotal;

    // 性能优化的基础批量大小
    let baseBatchSize = 8; // 提高基础并发数

    // 根据内存使用率调整（更宽松的限制）
    if (memoryUtilization > 0.85) {
        baseBatchSize = 4; // 极高内存使用时适度降低
    } else if (memoryUtilization < 0.5) {
        baseBatchSize = 12; // 低内存使用时可以大幅增加并发
    }

    // 根据账户数量动态调整（性能优化）
    if (totalAccounts >= 1000) {
        baseBatchSize = Math.min(baseBatchSize, 15); // 超大批量时允许更高并发
    } else if (totalAccounts >= 500) {
        baseBatchSize = Math.min(baseBatchSize, 12); // 大批量时适中并发
    } else if (totalAccounts >= 100) {
        baseBatchSize = Math.min(baseBatchSize, 8); // 中等批量时标准并发
    } else if (totalAccounts < 20) {
        baseBatchSize = Math.min(baseBatchSize + 2, 10); // 小批量时可以更激进
    }

    // 根据时间调整（避开高峰时段，但限制更宽松）
    const hour = new Date().getHours();
    if (hour >= 9 && hour <= 11 || hour >= 14 && hour <= 16) {
        baseBatchSize = Math.max(baseBatchSize - 2, 4); // 仅在高峰时段适度降低
    }

    console.log(`[批量大小计算] 内存使用率: ${(memoryUtilization * 100).toFixed(1)}%, 账户数: ${totalAccounts}, 批量大小: ${baseBatchSize}`);

    return Math.max(baseBatchSize, 4); // 最小批量大小提高到4
}

// 验证历史记录存储
const validationHistory = new Map(); // accountId -> validation records

// 保存验证历史
function saveValidationHistory(accountId, result) {
    if (!validationHistory.has(accountId)) {
        validationHistory.set(accountId, []);
    }

    const history = validationHistory.get(accountId);
    history.unshift({
        timestamp: new Date().toISOString(),
        success: result.success,
        status: result.status,
        message: result.message,
        verification_codes_count: result.verification_codes?.length || 0,
        processing_time_ms: result.processing_time_ms || 0
    });

    // 只保留最近10条记录
    if (history.length > 10) {
        history.pop();
    }
}

// 获取验证历史API
app.post('/api/accounts/validation-history', (req, res) => {
    const { account_ids } = req.body;

    try {
        const history = {};

        if (account_ids && Array.isArray(account_ids)) {
            // 返回指定账户的历史
            account_ids.forEach(accountId => {
                history[accountId] = validationHistory.get(accountId) || [];
            });
        } else {
            // 返回所有账户的历史
            validationHistory.forEach((records, accountId) => {
                history[accountId] = records;
            });
        }

        // 计算统计信息
        const stats = {
            total_accounts: Object.keys(history).length,
            total_validations: Object.values(history).reduce((sum, records) => sum + records.length, 0),
            success_rate: 0,
            most_common_status: {},
            recent_activity: []
        };

        // 计算成功率
        let totalSuccess = 0;
        const statusCounts = {};

        Object.values(history).forEach(records => {
            records.forEach(record => {
                if (record.success) totalSuccess++;
                statusCounts[record.status] = (statusCounts[record.status] || 0) + 1;

                // 收集最近活动
                if (stats.recent_activity.length < 10) {
                    stats.recent_activity.push({
                        account_id: 'unknown',
                        timestamp: record.timestamp,
                        success: record.success,
                        status: record.status
                    });
                }
            });
        });

        stats.success_rate = stats.total_validations > 0 ? (totalSuccess / stats.total_validations * 100).toFixed(1) : 0;
        stats.most_common_status = Object.entries(statusCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .reduce((obj, [status, count]) => {
                obj[status] = count;
                return obj;
            }, {});

        res.json({
            success: true,
            history: history,
            stats: stats
        });

    } catch (error) {
        console.error('[验证历史] 获取历史记录失败:', error);
        res.status(500).json({
            success: false,
            error: '获取验证历史失败'
        });
    }
});

// Microsoft OAuth 重新授权URL生成
app.post('/api/accounts/reauth-url', async (req, res) => {
    const { client_id, redirect_uri } = req.body;

    if (!client_id) {
        return res.status(400).json({
            success: false,
            error: '缺少client_id参数'
        });
    }

    try {
        console.log(`[重新授权] 生成重新授权URL，client_id: ${client_id.substring(0, 8)}...`);

        // 构建OAuth授权URL
        const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        authUrl.searchParams.set('client_id', client_id);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', redirect_uri || 'http://localhost:3001/auth/callback');
        authUrl.searchParams.set('scope', 'https://outlook.office.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access');
        authUrl.searchParams.set('response_mode', 'query');
        authUrl.searchParams.set('state', 'reauth_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));

        res.json({
            success: true,
            auth_url: authUrl.toString(),
            state: authUrl.searchParams.get('state'),
            message: '请使用此URL重新授权Microsoft账户'
        });

    } catch (error) {
        console.error('[重新授权] 生成授权URL失败:', error);
        res.status(500).json({
            success: false,
            error: '生成授权URL失败'
        });
    }
});

// OAuth回调处理 - 支持自动Token管理
app.post('/api/auth/callback', async (req, res) => {
    const { code, state, client_id, redirect_uri, account_id, email } = req.body;

    if (!code || !client_id) {
        return res.status(400).json({
            success: false,
            error: '缺少必要的OAuth参数'
        });
    }

    try {
        console.log(`[OAuth回调] 处理重新授权回调，账户: ${email || account_id}, client_id: ${client_id.substring(0, 8)}...`);

        // 使用授权码获取refresh_token
        const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: client_id,
                code: code,
                redirect_uri: redirect_uri || 'http://localhost:3001/auth/callback',
                grant_type: 'authorization_code',
                scope: 'https://outlook.office.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access'
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error(`[OAuth回调] Token交换失败:`, errorData);
            throw new Error(`Token交换失败: ${tokenResponse.status}`);
        }

        const tokenData = await tokenResponse.json();

        console.log(`[OAuth回调] 成功获取新Token，expires_in: ${tokenData.expires_in}秒`);

        // 验证新Token
        const isValid = await autoTokenManager.validateNewToken(tokenData.access_token);
        if (!isValid) {
            throw new Error('新Token验证失败');
        }

        const response = {
            success: true,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            scope: tokenData.scope,
            message: '重新授权成功，已获取新的访问令牌'
        };

        // 如果是自动重新授权，触发事件通知
        if (state) {
            try {
                const stateData = JSON.parse(state);
                if (stateData.auto_reauth && stateData.account_id) {
                    console.log(`[OAuth回调] 触发自动重新授权完成事件: ${stateData.account_id}`);
                    eventEmitter.emit(`oauth_callback_${stateData.account_id}`, {
                        success: true,
                        account_id: stateData.account_id,
                        email: stateData.email,
                        ...response
                    });
                }
            } catch (e) {
                console.warn(`[OAuth回调] 无法解析state参数:`, e);
            }
        }

        res.json(response);

    } catch (error) {
        console.error('[OAuth回调] 处理重新授权失败:', error);

        // 如果是自动重新授权，触发失败事件
        if (state) {
            try {
                const stateData = JSON.parse(state);
                if (stateData.auto_reauth && stateData.account_id) {
                    eventEmitter.emit(`oauth_callback_${stateData.account_id}`, {
                        success: false,
                        account_id: stateData.account_id,
                        email: stateData.email,
                        error: error.message
                    });
                }
            } catch (e) {
                console.warn(`[OAuth回调] 无法解析state参数:`, e);
            }
        }

        res.status(500).json({
            success: false,
            error: '处理重新授权回调失败',
            message: error.message
        });
    }
});

// 直接Token刷新API - 完全模拟curl方式
app.post('/api/accounts/refresh-token-direct', async (req, res) => {
    const { client_id, refresh_token, grant_type } = req.body;

    if (!client_id || !refresh_token) {
        return res.status(400).json({
            success: false,
            error: '缺少client_id或refresh_token'
        });
    }

    try {
        console.log(`[Token刷新] 开始刷新 ${client_id.substring(0, 8)}...`);

        // 完全模拟成功的curl命令 - 直接转发form数据
        const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: client_id,
                refresh_token: refresh_token,
                grant_type: grant_type || 'refresh_token'
                // 注意：完全模拟curl命令格式
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error(`[直接Token刷新] Token刷新失败:`, errorData);
            return res.status(400).json({
                success: false,
                error: 'Token刷新失败',
                details: `HTTP ${tokenResponse.status}`
            });
        }

        const tokenData = await tokenResponse.json();
        console.log(`[Token刷新] 刷新成功，有效期: ${tokenData.expires_in}秒`);

        res.json({
            success: true,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            scope: tokenData.scope,
            message: 'Token刷新成功'
        });

    } catch (error) {
        console.error('[直接Token刷新] 处理失败:', error);
        res.status(500).json({
            success: false,
            error: 'Token刷新处理失败',
            message: error.message
        });
    }
});

// 更新账户Token
app.post('/api/accounts/update-token', async (req, res) => {
    const { account_id, email, client_id, new_refresh_token, new_access_token, expires_in } = req.body;

    if (!account_id || !new_refresh_token) {
        return res.status(400).json({
            success: false,
            error: '缺少必要参数'
        });
    }

    try {
        console.log(`[更新Token] 更新账户 ${email || account_id} 的Token`);

        // 验证新Token是否有效
        const testResponse = await fetch('https://outlook.office.com/api/v2.0/me/messages?$top=1', {
            headers: {
                'Authorization': `Bearer ${new_access_token}`,
                'Accept': 'application/json'
            }
        });

        if (!testResponse.ok) {
            throw new Error(`新Token验证失败: ${testResponse.status}`);
        }

        console.log(`[更新Token] 账户 ${email || account_id} Token验证成功`);

        res.json({
            success: true,
            message: 'Token更新成功',
            account_id: account_id,
            email: email,
            updated_fields: {
                refresh_token: true,
                access_token: true,
                expires_in: expires_in
            }
        });

    } catch (error) {
        console.error(`[更新Token] 更新账户 ${email || account_id} Token失败:`, error);
        res.status(500).json({
            success: false,
            error: 'Token更新失败',
            message: error.message
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

        // 触发WebSocket事件通知客户端
        if (results.length > 0) {
            results.forEach(result => {
                pushEventToSession(userSessionId, {
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

// WebSocket服务器 - 替代SSE提供更稳定的实时通信
const wss = new WebSocket.Server({ port: WS_PORT });
const wsClients = new Map(); // 存储WebSocket客户端连接

console.log(`🔌 WebSocket服务器已配置 - 端口: ${WS_PORT}`);

wss.on('connection', (ws, request) => {
    const clientId = generateClientId();
    const sessionId = extractSessionId(request) || 'default';

    // 简单的会话连接数限制 - KISS原则
    const sessionConnections = Array.from(wsClients.values()).filter(c => c.sessionId === sessionId);
    if (sessionConnections.length >= 5) {
        console.log(`[WebSocket] 会话 ${sessionId} 连接数超限，拒绝连接 (当前: ${sessionConnections.length})`);
        ws.close(1008, '连接数超限');
        return;
    }

    console.log(`[WebSocket] 新客户端连接: ${clientId} (会话: ${sessionId}, 连接数: ${sessionConnections.length + 1})`);

    // 存储客户端信息
    const clientInfo = {
        id: clientId,
        sessionId: sessionId,
        ws: ws,
        connectedAt: new Date(),
        lastPing: new Date()
    };

    wsClients.set(clientId, clientInfo);

    // 简单的连接清理 - 定期清理断开的连接
    if (wsClients.size % 100 === 0) {
        cleanupStaleConnections();
    }

    // 发送连接确认
    ws.send(JSON.stringify({
        type: 'connection_established',
        clientId: clientId,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
    }));

    // 处理客户端消息
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleWebSocketMessage(clientId, message);
        } catch (error) {
            console.error(`[WebSocket] 消息解析错误:`, error);
        }
    });

    // 处理连接关闭
    ws.on('close', (code, reason) => {
        console.log(`[WebSocket] 客户端断开: ${clientId}, 原因: ${reason}`);
        wsClients.delete(clientId);
    });

    // 处理连接错误
    ws.on('error', (error) => {
        console.error(`[WebSocket] 连接错误: ${clientId}:`, error);
        wsClients.delete(clientId);
    });

    // 心跳检测
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
            clientInfo.lastPing = new Date();
        } else {
            clearInterval(pingInterval);
        }
    }, 30000); // 30秒心跳
});

// 生成客户端ID
function generateClientId() {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 从请求中提取会话ID
function extractSessionId(request) {
    const url = request.url;
    const match = url.match(/sessionId=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

// 简单的连接清理函数 - KISS原则
function cleanupStaleConnections() {
    const now = new Date();
    const staleThreshold = 5 * 60 * 1000; // 5分钟超时
    let cleaned = 0;

    wsClients.forEach((client, clientId) => {
        if (now - client.lastPing > staleThreshold || client.ws.readyState !== 1) {
            try {
                client.ws.close();
            } catch (e) {
                // 忽略关闭错误
            }
            wsClients.delete(clientId);
            cleaned++;
        }
    });

    if (cleaned > 0) {
        console.log(`[WebSocket] 清理了 ${cleaned} 个断开的连接，当前连接数: ${wsClients.size}`);
    }
}

// 简单的并发监控 - KISS原则
setInterval(() => {
    const sessionCount = new Set(Array.from(wsClients.values()).map(c => c.sessionId)).size;
    const connectionCount = wsClients.size;
    const memoryUsage = process.memoryUsage();

    console.log(`[并发监控] 会话数: ${sessionCount}, 连接数: ${connectionCount}, 内存: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);

    // 简单的内存监控和自动清理
    if (memoryUsage.heapUsed > 200 * 1024 * 1024) { // 200MB阈值
        console.log(`[内存监控] 内存使用过高，执行清理`);
        if (global.gc) {
            global.gc();
        }
        cleanupStaleConnections();
    }
}, 60000); // 每分钟监控一次

// 处理WebSocket消息
function handleWebSocketMessage(clientId, message) {
    const client = wsClients.get(clientId);
    if (!client) return;

    switch (message.type) {
        case 'pong':
            client.lastPing = new Date();
            break;
        case 'subscribe':
            client.subscriptions = message.events || [];
            console.log(`[WebSocket] 客户端 ${clientId} 订阅事件:`, client.subscriptions);
            break;
        default:
            console.log(`[WebSocket] 未知消息类型: ${message.type}`);
    }
}

// 广播消息到指定会话的所有客户端
function broadcastToSession(sessionId, eventData) {
    const message = JSON.stringify(eventData);
    let sentCount = 0;

    wsClients.forEach((client, clientId) => {
        if (client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
            sentCount++;
        }
    });

    console.log(`[WebSocket] 广播到会话 ${sessionId}: ${eventData.type} (${sentCount}个客户端)`);
    return sentCount;
}

// 广播消息到所有客户端
function broadcastToAll(eventData) {
    const message = JSON.stringify(eventData);
    let sentCount = 0;

    wsClients.forEach((client, clientId) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
            sentCount++;
        }
    });

    console.log(`[WebSocket] 全网广播: ${eventData.type} (${sentCount}个客户端)`);
    return sentCount;
}

// 统一事件推送函数 - 同时支持SSE和WebSocket（过渡期兼容）
function pushEventToSession(sessionId, eventData) {
    // WebSocket推送（优先）
    const wsCount = broadcastToSession(sessionId, eventData);

    // 如果WebSocket没有客户端，则使用SSE作为备用
    if (wsCount === 0) {
        eventEmitter.emit(`${eventData.type}_${sessionId}`, eventData);
        console.log(`[事件推送] SSE备用推送: ${eventData.type} (会话: ${sessionId})`);
    }
}

// 启动HTTP服务器
app.listen(PORT, () => {
    console.log(`🚀 邮件管理代理服务器已启动`);
    console.log(`📍 代理端口: ${PORT}`);
    console.log(`🌐 健康检查: http://localhost:${PORT}/api/health`);
    console.log(`📋 服务信息: http://localhost:${PORT}/`);
    console.log(`\n📝 使用说明:`);
    console.log(`   1. 确保代理服务器运行在此端口`);
    console.log(`   2. 浏览器版本会自动使用代理解决CORS问题`);
    console.log(`   3. 支持所有Outlook API调用和OAuth token验证`);
    console.log(`   4. WebSocket实时通信端口: ${WS_PORT}`);
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