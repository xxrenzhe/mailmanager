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

// 2. Microsoft Token刷新（真实实现）
async function refreshAccessToken(clientId, refreshToken, userInitiated = false) {
    // 只对非用户主动触发的刷新进行冷却检查
    if (!userInitiated) {
        const refreshKey = `${clientId}_${refresh_token.substring(0, 10)}`;
        const lastRefresh = lastTokenRefresh.get(refreshKey);
        const now = Date.now();

        if (lastRefresh && (now - lastRefresh) < TOKEN_REFRESH_COOLDOWN * 1000) {
            return reject(new Error(`Token刷新过于频繁，请等待${TOKEN_REFRESH_COOLDOWN}秒`));
        }
    }

    return new Promise((resolve, reject) => {
        const postData = querystring.stringify({
            client_id: clientId,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'https://outlook.office.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access'
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
                    const result = JSON.parse(data);
                    if (res.statusCode === 200) {
                        // 只对非用户主动触发的刷新记录冷却时间
                        if (!userInitiated) {
                            lastTokenRefresh.set(refreshKey, Date.now());
                        }
                        resolve(result);
                    } else {
                        reject(new Error(`Token刷新失败: ${res.statusCode} - ${result.error_description || result.error}`));
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

// 3. 验证码提取算法（简化但有效）
function extractVerificationCode(subject, body) {
    if (!subject && !body) return null;

    const text = `${subject || ''} ${body || ''}`;

    // 高可信度模式
    const highPatterns = [
        /(?:verification code|验证码|验证码为|code is|your code is)[\s:：\n\-]*(\d{4,8})/gi,
        /(?:confirm|activate|verify)[\s\S]{0,30}?(\\d{4,8})/gi
    ];

    // 中等可信度模式
    const mediumPatterns = [
        /(\d{4,8})/g
    ];

    // 先尝试高可信度模式
    for (const pattern of highPatterns) {
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
            for (const match of matches) {
                const code = match.match(/(\d{4,8})/);
                if (code && code[1]) {
                    return code[1];
                }
            }
        }
    }

    // 再尝试中等可信度模式
    const mediumMatches = text.match(mediumPatterns[0]);
    if (mediumMatches && mediumMatches.length > 0) {
        return mediumMatches[0];
    }

    return null;
}

// 4. 获取邮件（真实实现）
async function fetchEmails(account, accessToken, sinceTime = null) {
    return new Promise((resolve, reject) => {
        let url = `${OUTLOOK_API}/me/messages?$top=10&$orderby=ReceivedDateTime desc`;

        if (sinceTime) {
            const filterTime = new Date(sinceTime).toISOString();
            url += `&$filter=ReceivedDateTime gt ${filterTime}`;
        }

        const options = {
            hostname: 'outlook.office.com',
            port: 443,
            path: url,
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

                // 获取邮件
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

                    // 更新最后检查时间
                    account.last_check_time = new Date().toISOString();
                    accountStore.set(account.id, account);
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
        const { sessionId, account_id, email, client_id, refresh_token, current_status, codes = [], emails = [], latest_code_received_at, last_active_at } = req.body;

        console.log(`[监控触发] 复制邮箱: ${email}, 账户ID: ${account_id} (会话: ${sessionId})`);
        console.log(`[监控触发] 账户状态: ${current_status}, 有access_token: ${!!req.body.access_token}`);

        // 创建账户对象
        const account = {
            id: account_id,
            email: email,
            client_id: client_id,
            refresh_token: refresh_token,
            access_token: req.body.access_token,
            current_status: current_status,
            last_active_at: last_active_at || new Date().toISOString(),
            codes: codes || [],
            emails: emails || [],
            latest_code_received_at: latest_code_received_at,
            last_check_time: latest_code_received_at || last_active_at || new Date().toISOString()
        };

        // 计算时间过滤基准
        let timeFilter = account.last_check_time;
        if (account.latest_code_received_at) {
            timeFilter = account.latest_code_received_at;
            console.log(`[时间基准] 使用最新验证码邮件时间: ${timeFilter}`);
        } else if (codes && codes.length > 0) {
            const latestCode = codes.reduce((latest, code) => {
                return new Date(code.received_at) > new Date(latest.received_at) ? code : latest;
            });
            timeFilter = latestCode.received_at;
            console.log(`[时间基准] 使用codes数组最新时间: ${timeFilter}`);
        }

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
        const { emails } = req.body;

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

// 统一事件推送函数 - 支持SSE和WebSocket
function emitEvent(eventData) {
    // WebSocket推送
    const wsNotification = JSON.stringify(eventData);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(wsNotification);
        }
    });

    // SSE推送
    eventEmitter.emit(eventData.type, eventData);
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