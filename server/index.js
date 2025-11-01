const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

// 导入核心组件
const Database = require('./database.js');
const Monitor = require('./simpleMonitor.js');
const EmailService = require('./emailService.js');
const ErrorHandler = require('./errorHandler.js');
const BulkImportQueue = require('./bulkImportQueue.js');
const EmailSequenceManager = require('./emailSequenceManager.js');
const AutoReauthService = require('./autoReauthService.js');

const app = express();
const PORT = process.env.PORT || 3000;

// 基础配置 - 增加请求体大小限制以支持大批量导入
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 50000 }));
app.use(express.static('public'));

// 设置EJS视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// 全局错误处理中间件（必须在所有路由之后）
app.use(ErrorHandler.expressMiddleware());

// 速率限制中间件（可选）- 为批量导入放宽限制
app.use('/api/', ErrorHandler.createRateLimiter(200, 15 * 60 * 1000)); // 15分钟200请求
// 批量导入专用路由不使用严格限制
app.use('/api/bulk-import/', ErrorHandler.createRateLimiter(1000, 15 * 60 * 1000)); // 15分钟1000请求

// 初始化数据库、监控器和邮件服务
let db;
let monitor;
let emailService;
let bulkImportQueue;
let sequenceManager;

async function initializeApp() {
    try {
        // 初始化数据库
        db = new Database();
        await ErrorHandler.safeExecute(
            () => db.init(),
            null,
            '数据库初始化'
        );
        console.log('[App] 数据库初始化完成');

        // 初始化邮件服务
        emailService = new EmailService();
        emailService.setDatabase(db); // 注入数据库连接
        console.log('[App] 邮件服务初始化完成');

        // 初始化邮箱序列管理器
        sequenceManager = new EmailSequenceManager(db);
        await sequenceManager.initialize();
        console.log('[App] 邮箱序列管理器初始化完成');

        // 初始化批量导入队列
        bulkImportQueue = new BulkImportQueue(db, emailService, sequenceManager);
        console.log('[App] 批量导入队列初始化完成');

        // 初始化监控器
        monitor = new Monitor({
            maxConcurrentMonitors: 9
        });
        // 注入数据库和邮件服务实例到监控器
        monitor.db = db;
        monitor.emailService = emailService;

        // 设置监控事件监听
        setupMonitorEvents();

        // 启动简单的定时授权检查
        startSimpleTokenCheck();
        console.log('[App] 简单Token监控已启动');

        console.log('[App] 应用初始化完成');
    } catch (error) {
        ErrorHandler.logError(error, '应用初始化');
        console.error('[App] 初始化失败，进程退出');
        process.exit(1);
    }
}

// 简单的定时Token检查
function startSimpleTokenCheck() {
    // 每30分钟检查一次需要重新授权的账户
    setInterval(async () => {
        try {
            console.log('[SimpleTokenCheck] 开始检查需要重新授权的账户...');

            const reauthNeeded = await db.all(`
                SELECT id, email
                FROM accounts
                WHERE status = 'reauth_needed'
                OR (refresh_token_enc IS NULL OR refresh_token_enc = '')
                LIMIT 50
            `);

            if (reauthNeeded.length > 0) {
                console.log(`[SimpleTokenCheck] 找到 ${reauthNeeded.length} 个账户需要重新授权`);

                // 使用现有的授权处理逻辑
                for (const account of reauthNeeded) {
                    try {
                        const success = await emailService.validateAuthorization(account);
                        if (success.authorized) {
                            await db.updateAccount(account.id, {
                                status: 'authorized',
                                updated_at: new Date().toISOString()
                            });
                            console.log(`[SimpleTokenCheck] ✅ ${account.email} 授权恢复成功`);
                        }
                    } catch (error) {
                        console.log(`[SimpleTokenCheck] ❌ ${account.email} 授权检查失败: ${error.message}`);
                    }
                }
            } else {
                console.log('[SimpleTokenCheck] 没有需要处理的账户');
            }
        } catch (error) {
            console.error('[SimpleTokenCheck] 检查过程失败:', error);
        }
    }, 30 * 60 * 1000); // 30分钟

    console.log('[SimpleTokenCheck] 定时检查已启动，间隔: 30分钟');
}

// 设置监控事件
function setupMonitorEvents() {
    monitor.on('newCodeDetected', (data) => {
        console.log(`[Monitor] 新验证码: 账户${data.accountId} -> ${data.code}`);

        // 通过SSE推送新验证码
        sendSSEEvent('new_code', {
            account_id: data.accountId,
            code: data.code,
            subject: data.subject,
            sender: data.sender,
            received_at: data.received_at
        });
    });

    monitor.on('monitoringStarted', (data) => {
        console.log(`[Monitor] 监控启动: 账户${data.accountId}`);
        sendSSEEvent('monitoring_status', {
            account_id: data.accountId,
            status: 'started'
        });
    });

    monitor.on('monitoringStopped', (data) => {
        console.log(`[Monitor] 监控停止: 账户${data.accountId}, 原因: ${data.reason}`);
        sendSSEEvent('monitoring_status', {
            account_id: data.accountId,
            status: 'stopped'
        });
    });

    monitor.on('checkError', (data) => {
        console.error(`[Monitor] 检查错误: 账户${data.accountId}, 错误: ${data.error}`);
    });
}

// SSE连接管理
const sseClients = new Set();

function sendSSEEvent(type, data) {
    const event = `data: ${JSON.stringify({ type, ...data })}\n\n`;

    sseClients.forEach(client => {
        try {
            client.write(event);
        } catch (error) {
            console.error('[SSE] 发送失败:', error);
            sseClients.delete(client);
        }
    });
}

// === 路由定义 ===

// 主页 - 使用简单前端
app.get('/', async (req, res) => {
    try {
        res.sendFile(path.join(__dirname, '../simple-mail-manager.html'));
    } catch (error) {
        ErrorHandler.logError(error, '主页渲染');
        res.status(500).send('页面加载失败');
    }
});

// 批量导入页面已下线，功能整合到主页

// 分页获取账户列表
app.get('/api/accounts/paged', async (req, res) => {
    try {
        const { page = 1, size = 50, search = '', status = '', sortBy = 'last_active_at', order = 'desc' } = req.query;

        const options = {
            page: parseInt(page),
            pageSize: parseInt(size),
            filters: {},
            sortBy: sortBy,
            order: order
        };

        if (search) {
            options.filters.email = search;
        }
        if (status) {
            options.filters.status = status;
        }

        const accounts = await db.getAccountsWithLatestCodes(options);
        const total = await db.getTotalAccounts(options.filters);

        res.json({
            accounts,
            total,
            page: parseInt(page),
            pageSize: parseInt(size)
        });
    } catch (error) {
        console.error('[API] 获取账户列表失败:', error);
        res.status(500).json({ error: '获取数据失败' });
    }
});

// 启动监控
app.post('/api/monitor/start', async (req, res) => {
    try {
        const { account_id } = req.body;

        if (!account_id) {
            return res.status(400).json({ error: '缺少账户ID' });
        }

        const account = await db.getAccount(account_id);
        if (!account) {
            return res.status(404).json({ error: '账户不存在' });
        }

        if (account.status !== 'authorized') {
            return res.status(400).json({ error: '账户未授权' });
        }

        await monitor.startMonitoring(account_id, {
            interval: 5000,
            maxDuration: 300000,
            autoStopOnCode: true
        });

        res.json({ success: true, message: '监控已启动' });
    } catch (error) {
        console.error('[API] 启动监控失败:', error);
        res.status(500).json({ error: '启动监控失败' });
    }
});

// 停止监控
app.post('/api/monitor/stop', async (req, res) => {
    try {
        const { account_id } = req.body;

        if (!account_id) {
            return res.status(400).json({ error: '缺少账户ID' });
        }

        monitor.stopMonitoring(account_id);
        res.json({ success: true, message: '监控已停止' });
    } catch (error) {
        console.error('[API] 停止监控失败:', error);
        res.status(500).json({ error: '停止监控失败' });
    }
});

// 获取监控状态
app.get('/api/monitor/status', (req, res) => {
    try {
        const status = monitor.getStatus();
        res.json(status);
    } catch (error) {
        console.error('[API] 获取监控状态失败:', error);
        res.status(500).json({ error: '获取状态失败' });
    }
});


// 复制邮箱触发监控
app.post('/api/monitor/copy-trigger', async (req, res) => {
    try {
        const { account_id } = req.body;

        if (!account_id) {
            return res.status(400).json({ error: '缺少账户ID' });
        }

        const account = await db.getAccount(account_id);
        if (!account) {
            return res.status(404).json({ error: '账户不存在' });
        }

        // 启动1分钟的监控
        await monitor.startMonitoring(account_id, {
            interval: 5000, // 5秒检查一次
            maxDuration: 60000, // 1分钟
            autoStopOnCode: true // 收到邮件后自动停止
        });

        res.json({
            success: true,
            message: '已启动1分钟监控，将自动检查新邮件',
            duration: 60000
        });
    } catch (error) {
        console.error('[API] 启动复制触发监控失败:', error);
        res.status(500).json({ error: '启动监控失败' });
    }
});

// SSE事件流
app.get('/api/events', (req, res) => {
    // 设置SSE响应头
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // 发送初始连接确认
    res.write('retry: 10000\n'); // 设置重连间隔为10秒
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    sseClients.add(res);

    // 处理各种连接关闭事件
    const cleanup = () => {
        sseClients.delete(res);
        console.log('[SSE] 客户端断开连接，当前连接数:', sseClients.size);
    };

    req.on('close', cleanup);
    req.on('end', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);

    // 心跳机制，每30秒发送一次心跳
    const heartbeat = setInterval(() => {
        try {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
        } catch (error) {
            console.error('[SSE] 心跳发送失败:', error);
            cleanup();
            clearInterval(heartbeat);
        }
    }, 30000);

    // 清理定时器
    req.on('close', () => {
        clearInterval(heartbeat);
    });

    console.log('[SSE] 新客户端连接，当前连接数:', sseClients.size);
});

// 添加账户
app.post('/api/accounts', async (req, res) => {
    try {
        const { email, client_id } = req.body;

        if (!email || !client_id) {
            return res.status(400).json({ error: '邮箱和客户端ID不能为空' });
        }

        const accountData = {
            email,
            client_id,
            status: 'pending',
            last_active_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const accountId = await db.createAccount(accountData);

        res.json({
            success: true,
            account_id: accountId,
            message: '账户添加成功'
        });
    } catch (error) {
        console.error('[API] 添加账户失败:', error);
        res.status(500).json({ error: '添加账户失败' });
    }
});

// 特定格式的批量导入账户（账号----密码----clientId----授权码）
app.post('/api/accounts/batch-import', async (req, res) => {
    try {
        const { import_data } = req.body;

        if (!import_data) {
            return res.status(400).json({ error: '导入数据不能为空' });
        }

        console.log('[API] 收到导入数据:', import_data.substring(0, 100) + '...');

        // 智能解析：先按----分割，如果不是4个字段，再按连续的-分割
        let parts = import_data.split('----');

        if (parts.length !== 4) {
            // 如果不是4个字段，尝试智能重构
            // 找到UUID格式的ClientId (8-4-4-4-12 格式)
            const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
            const uuidMatch = import_data.match(uuidRegex);

            if (uuidMatch) {
                const uuidIndex = import_data.indexOf(uuidMatch[0]);
                const beforeUuid = import_data.substring(0, uuidIndex).trim();
                const afterUuid = import_data.substring(uuidIndex + uuidMatch[0].length).trim();

                // 分割before部分
                const beforeParts = beforeUuid.split(/-+/);
                if (beforeParts.length >= 2) {
                    parts = [
                        beforeParts[0], // 邮箱
                        beforeParts[1], // 密码
                        uuidMatch[0],    // ClientId (UUID)
                        afterUuid.replace(/^-+/, '') // 授权码 (去掉开头的-)
                    ];
                }
            }
        }

        if (parts.length < 4) {
            return res.status(400).json({ error: '导入格式错误，应为：账号-密码-clientId-授权码（支持多个-分隔符）' });
        }

        const [email, password, client_id, refresh_token_enc] = parts;

        console.log('[API] 解析结果:');
        console.log('  邮箱:', email);
        console.log('  密码:', password ? '[已设置]' : '[为空]');
        console.log('  ClientId:', client_id ? '[已设置]' : '[为空]');
        console.log('  RefreshToken:', refresh_token_enc ? '[已设置]' : '[为空]');

        // 检查邮箱是否已存在
        const existingAccount = await db.getAccountByEmail(email.trim());
        if (existingAccount) {
            return res.status(409).json({ error: '邮箱已存在' });
        }

        const accountData = {
            email: email.trim(),
            client_id: client_id.trim(),
            refresh_token_enc: refresh_token_enc.trim(),
            status: 'pending', // 初始状态为pending，等待后台授权验证
            last_active_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const accountId = await db.createAccount(accountData);

        // 立即进行授权验证（但不提取验证码）
        console.log(`[API] 账户导入成功，开始授权验证: ${email}`);
        let authorizationResult = { authorized: false, error: '未知错误' };

        try {
            const account = await db.getAccount(accountId);
            if (account) {
                // 仅验证授权，不提取邮件
                authorizationResult = await emailService.validateAuthorization(account);

                if (authorizationResult.authorized) {
                    console.log(`[API] ${email} 授权验证成功`);
                    await db.updateAccount(accountId, {
                        status: 'authorized',
                        updated_at: new Date().toISOString()
                    });
                } else {
                    console.log(`[API] ${email} 授权验证失败: ${authorizationResult.error}`);
                    await db.updateAccount(accountId, {
                        status: 'pending',
                        updated_at: new Date().toISOString()
                    });
                }
            }
        } catch (authError) {
            console.warn(`[API] ${email} 授权验证异常:`, authError.message);
            authorizationResult = { authorized: false, error: authError.message };
            await db.updateAccount(accountId, {
                status: 'pending',
                updated_at: new Date().toISOString()
            });
        }

        // 将邮件提取安排到后台处理，避免导入时的性能压力
        scheduleBackgroundEmailExtraction(accountId);

        console.log(`[API] 批量导入成功: ${email} (ID: ${accountId})`);

        // 获取更新后的账户信息用于响应
        const updatedAccount = await db.getAccount(accountId);

        res.json({
            success: true,
            account_id: accountId,
            email: email,
            status: updatedAccount.status,
            message: '账户导入成功，授权验证已' + (authorizationResult.authorized ? '通过' : '失败'),
            authorization_result: {
                verified: authorizationResult.authorized,
                error: authorizationResult.error,
                note: '邮件提取已在后台安排，将在稍后自动完成'
            }
        });
    } catch (error) {
        console.error('[API] 批量导入失败:', error);

        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: '邮箱已存在' });
        }

        res.status(500).json({ error: '批量导入失败' });
    }
});

// 后台批量授权处理队列
const backgroundAuthQueue = [];
const BATCH_SIZE = 5; // 每批处理5个账户
const BATCH_DELAY = 2000; // 批次间隔2秒

function scheduleBackgroundEmailExtraction(accountId) {
    // 添加到后台处理队列
    backgroundAuthQueue.push({
        accountId,
        scheduledAt: new Date(),
        retryCount: 0
    });

    console.log(`[Background] 账户 ${accountId} 已��加到后台邮件提取队列`);

    // 启动后台处理（如果未运行）
    processBackgroundAuthQueue();
}

async function processBackgroundAuthQueue() {
    if (backgroundAuthQueue.length === 0) {
        return;
    }

    console.log(`[Background] 开始处理后台授权队列，当前队列长度: ${backgroundAuthQueue.length}`);

    // 分批处理
    while (backgroundAuthQueue.length > 0) {
        const batch = backgroundAuthQueue.splice(0, BATCH_SIZE);

        console.log(`[Background] 处理批次: ${batch.map(item => item.accountId).join(', ')}`);

        // 并行处理当前批次
        await Promise.all(batch.map(async (item) => {
            try {
                await processBackgroundEmailExtraction(item);
            } catch (error) {
                console.error(`[Background] 处理账户 ${item.accountId} 失败:`, error.message);

                // 重试机制
                if (item.retryCount < 3) {
                    item.retryCount++;
                    item.scheduledAt = new Date(Date.now() + 10000 * item.retryCount); // 递增延迟
                    backgroundAuthQueue.push(item);
                    console.log(`[Background] 账户 ${item.accountId} 将在第 ${item.retryCount} 次重试`);
                } else {
                    console.error(`[Background] 账户 ${item.accountId} 达到最大重试次数，放弃处理`);
                }
            }
        }));

        // 批次间延迟
        if (backgroundAuthQueue.length > 0) {
            console.log(`[Background] 批次处理完成，等待 ${BATCH_DELAY}ms 后处理下一批`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }

    console.log('[Background] 后台授权队列处理完成');
}

async function processBackgroundEmailExtraction(item) {
    const { accountId } = item;

    console.log(`[Background] 开始为账户 ${accountId} 提取邮件...`);

    const account = await db.getAccount(accountId);
    if (!account) {
        console.warn(`[Background] 账户 ${accountId} 不存在，跳过处理`);
        return;
    }

    if (account.status !== 'authorized') {
        console.log(`[Background] 账户 ${accountId} 状态为 ${account.status}，跳过邮件提取`);
        return;
    }

    try {
        // 提取最近24小时的验证码
        const extractedCodes = await emailService.extractRecentCodes(account);

        if (extractedCodes.length > 0) {
            // 更新最新验证码信息
            const latestCode = extractedCodes[0];
            await db.updateAccount(accountId, {
                latest_code: latestCode.code,
                latest_code_received_at: latestCode.received_at,
                latest_code_sender: latestCode.sender,
                last_active_at: latestCode.received_at,
                updated_at: new Date().toISOString()
            });

            console.log(`[Background] 账户 ${accountId} 邮件提取完成，提取到 ${extractedCodes.length} 个验证码`);
        } else {
            console.log(`[Background] 账户 ${accountId} 邮件提取完成，无验证码`);
        }
    } catch (error) {
        console.error(`[Background] 账户 ${accountId} 邮件提取失败:`, error.message);
        throw error;
    }
}

// 异步授权验证函数
async function performAsyncAuthorization(accountId, email) {
    try {
        console.log(`[AsyncAuth] 开始异步授权验证: ${email}`);
        const account = await db.getAccount(accountId);
        if (!account) {
            console.warn(`[AsyncAuth] 账户不存在: ${accountId}`);
            return;
        }

        const authorizationResult = await emailService.validateAuthorization(account);
        if (authorizationResult.authorized) {
            console.log(`[AsyncAuth] ${email} 授权验证成功`);
            await db.updateAccount(accountId, {
                status: 'authorized',
                updated_at: new Date().toISOString()
            });
        } else {
            console.log(`[AsyncAuth] ${email} 授权验证失败: ${authorizationResult.error}`);
            await db.updateAccount(accountId, {
                status: 'pending',
                updated_at: new Date().toISOString()
            });
        }
    } catch (error) {
        console.warn(`[AsyncAuth] ${email} 授权验证异常:`, error.message);
        await db.updateAccount(accountId, {
            status: 'pending',
            updated_at: new Date().toISOString()
        });
    }
}

// 批量导入账户
app.post('/api/accounts/batch', async (req, res) => {
    try {
        const { email, password, client_id, refresh_token_enc, status } = req.body;

        if (!email || !client_id || !refresh_token_enc) {
            return res.status(400).json({ error: '邮箱、客户端ID和授权码不能为空' });
        }

        // 检查邮箱是否已存在
        const existingAccount = await db.getAccountByEmail(email);
        if (existingAccount) {
            return res.status(409).json({ error: '邮箱已存在' });
        }

        const accountData = {
            email: email.trim(),
            client_id: client_id.trim(),
            refresh_token_enc: refresh_token_enc.trim(),
            status: 'pending', // 初始状态为pending，等待授权验证
            last_active_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const accountId = await db.createAccount(accountData);

        // 立即进行授权验证（与单个导入逻辑一致）
        console.log(`[API] 批量导入成功，开始授权验证: ${email}`);
        let authorizationResult = { authorized: false, error: '未知错误' };

        try {
            const account = await db.getAccount(accountId);
            if (account) {
                // 仅验证授权，不提取邮件
                authorizationResult = await emailService.validateAuthorization(account);

                if (authorizationResult.authorized) {
                    console.log(`[API] ${email} 批量导入授权验证成功`);
                    await db.updateAccount(accountId, {
                        status: 'authorized',
                        updated_at: new Date().toISOString()
                    });
                } else {
                    console.log(`[API] ${email} 批量导入授权验证失败: ${authorizationResult.error}`);
                    await db.updateAccount(accountId, {
                        status: 'pending',
                        updated_at: new Date().toISOString()
                    });
                }
            }
        } catch (authError) {
            console.warn(`[API] ${email} 批量导入授权验证异常:`, authError.message);
            authorizationResult = { authorized: false, error: authError.message };
            await db.updateAccount(accountId, {
                status: 'pending',
                updated_at: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            account_id: accountId,
            email: email,
            status: authorizationResult.authorized ? 'authorized' : 'pending',
            message: '账户导入成功，授权验证已' + (authorizationResult.authorized ? '通过' : '失败'),
            verified: authorizationResult.authorized,
            error: authorizationResult.authorized ? null : authorizationResult.error
        });
    } catch (error) {
        console.error('[API] 批量导入失败:', error);

        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: '邮箱已存在' });
        }

        res.status(500).json({ error: '批量导入失败' });
    }
});

// === 优化的批量导入API ===

// 解析批量导入数据
app.post('/api/bulk-import/parse', async (req, res) => {
    try {
        const { import_data } = req.body;

        if (!import_data) {
            return res.status(400).json({ error: '导入数据不能为空' });
        }

        // 解析导入数据
        const emails = parseImportData(import_data);

        res.json({
            success: true,
            count: emails.length,
            emails: emails.map(e => ({
                email: e.email,
                client_id: e.client_id ? '[已设置]' : '[为空]',
                refresh_token_enc: e.refresh_token_enc ? '[已设置]' : '[为空]'
            })),
            message: `成功解析 ${emails.length} 个邮箱账户`
        });

    } catch (error) {
        console.error('[API] 解析导入数据失败:', error);
        res.status(400).json({ error: error.message || '数据解析失败' });
    }
});

// 启动批量导入
app.post('/api/bulk-import/start', async (req, res) => {
    try {
        const { import_data } = req.body;

        if (!import_data) {
            return res.status(400).json({ error: '导入数据不能为空' });
        }

        // 解析导入数据
        const emails = parseImportData(import_data);

        if (emails.length === 0) {
            return res.status(400).json({ error: '未找到有效的邮箱数据' });
        }

        // 生成导入ID
        const importId = 'import_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // 为每个邮箱添加导入ID
        emails.forEach(email => {
            email.importId = importId;
        });

        // 启动批量导入
        const result = await bulkImportQueue.startBulkImport(importId, emails);

        res.json({
            ...result,
            parsed_count: emails.length,
            import_id: importId
        });

    } catch (error) {
        console.error('[API] 批量导入启动失败:', error);
        // 改进错误信息处理，确保返回可读的错误信息
        let errorMessage = '批量导入启动失败';
        if (error.message) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        } else if (error && error.toString) {
            errorMessage = error.toString();
        }
        res.status(500).json({ error: errorMessage });
    }
});

// 查询批量导入状态
app.get('/api/bulk-import/status/:importId', (req, res) => {
    try {
        const { importId } = req.params;
        const status = bulkImportQueue.getImportStatus(importId);

        if (status.error) {
            return res.status(404).json({ error: status.error });
        }

        res.json(status);

    } catch (error) {
        console.error('[API] 查询导入状态失败:', error);
        res.status(500).json({ error: '查询状态失败' });
    }
});

// 清理旧的导入会话
app.post('/api/bulk-import/cleanup', (req, res) => {
    try {
        bulkImportQueue.cleanupOldSessions();
        res.json({ success: true, message: '旧会话清理完成' });
    } catch (error) {
        console.error('[API] 清理会话失败:', error);
        res.status(500).json({ error: '清理会话失败' });
    }
});

// 解析导入数据的工具函数
function parseImportData(importData) {
    const emails = [];
    const lines = importData.split('\n').filter(line => line.trim());

    for (const line of lines) {
        try {
            const emailData = parseImportLine(line.trim());
            if (emailData) {
                emails.push(emailData);
            }
        } catch (error) {
            console.warn(`[Parse] 跳过无效行: ${line}`, error.message);
        }
    }

    return emails;
}

function parseImportLine(line) {
    // 智能解析：先按----分割，如果不是4个字段，再按连续的-分割
    let parts = line.split('----');

    if (parts.length !== 4) {
        // 如果不是4个字段，尝试智能重构
        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const uuidMatch = line.match(uuidRegex);

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
            }
        }
    }

    if (parts.length < 4) {
        return null;
    }

    const [email, password, client_id, refresh_token_enc] = parts;

    return {
        email: email.trim(),
        password: password ? password.trim() : '',
        client_id: client_id.trim(),
        refresh_token_enc: refresh_token_enc.trim()
    };
}

// === 邮箱序列管理API ===

// 获取序列统计信息
app.get('/api/sequence/stats', async (req, res) => {
    try {
        const stats = await sequenceManager.getSequenceStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('[API] 获取序列统计失败:', error);
        res.status(500).json({ error: '获取统计信息失败' });
    }
});

// 重建序列编号
app.post('/api/sequence/rebuild', async (req, res) => {
    try {
        console.log('[API] 开始重建序列编号...');
        await sequenceManager.rebuildSequence();

        res.json({
            success: true,
            message: '序列编号重建完成'
        });
    } catch (error) {
        console.error('[API] 重建序列编号失败:', error);
        res.status(500).json({ error: '重建序列编号失败' });
    }
});

// 获取邮箱的编号
app.get('/api/sequence/email/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const sequence = await sequenceManager.getEmailSequence(email);

        if (sequence === null) {
            return res.status(404).json({ error: '邮箱编号不存在' });
        }

        res.json({
            success: true,
            email,
            sequence
        });
    } catch (error) {
        console.error('[API] 获取邮箱编号失败:', error);
        res.status(500).json({ error: '获取邮箱编号失败' });
    }
});

// 导出序列映射
app.get('/api/sequence/export', async (req, res) => {
    try {
        const mapping = sequenceManager.exportSequenceMapping();
        const stats = await sequenceManager.getSequenceStats();

        res.json({
            success: true,
            stats,
            mapping,
            exportedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] 导出序列映射失败:', error);
        res.status(500).json({ error: '导出序列映射失败' });
    }
});

// 重新激活账户
app.put('/api/accounts/:id', async (req, res) => {
    try {
        const accountId = parseInt(req.params.id);

        if (isNaN(accountId)) {
            return res.status(400).json({ error: '无效的账户ID' });
        }

        // 重新激活账户
        await db.updateAccount(accountId, {
            is_active: 1,
            status: 'authorized',
            updated_at: new Date().toISOString()
        });

        res.json({ success: true, message: '账户已重新激活' });
    } catch (error) {
        console.error('[API] 重新激活账户失败:', error);
        res.status(500).json({ error: '重新激活账户失败' });
    }
});

// 删除账户
app.delete('/api/accounts/:id', async (req, res) => {
    try {
        const accountId = parseInt(req.params.id);

        if (isNaN(accountId)) {
            return res.status(400).json({ error: '无效的账户ID' });
        }

        // 先停止监控
        monitor.stopMonitoring(accountId, '账户删除');

        // 完全删除账户及其所有相关数据（验证码、消息等）
        const deleted = await db.deleteAccountCompletely(accountId);

        if (deleted) {
            res.json({
                success: true,
                message: '账户及其所有相关数据已完全删除'
            });
        } else {
            res.status(404).json({ error: '账户不存在' });
        }
    } catch (error) {
        console.error('[API] 删除账户失败:', error);
        res.status(500).json({ error: '删除账户失败' });
    }
});

// 创建验证码（用于测试）
app.post('/api/codes', async (req, res) => {
    try {
        const { account_id, code, subject, sender, received_at, created_at } = req.body;

        if (!account_id || !code) {
            return res.status(400).json({ error: '账户ID和验证码不能为空' });
        }

        await db.createCode({
            account_id,
            code,
            subject: subject || '测试验证码',
            sender: sender || 'test@service.com',
            received_at: received_at || new Date().toISOString(),
            created_at: created_at || new Date().toISOString()
        });

        // 更新账户的活跃时间为邮件收件时间
        if (received_at) {
            await db.updateAccount(account_id, {
                last_active_at: received_at
            });
        }

        res.json({
            success: true,
            message: '验证码创建成功'
        });
    } catch (error) {
        console.error('[API] 创建验证码失败:', error);
        res.status(500).json({ error: '创建验证码失败' });
    }
});

// 系统状态
app.get('/api/status', async (req, res) => {
    try {
        const dbStats = {
            cacheSize: db.cache.size,
            totalAccounts: await db.getTotalAccounts()
        };

        const monitorStats = monitor.getStatus();

        const systemStats = {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version,
            timestamp: new Date().toISOString()
        };

        res.json({
            database: dbStats,
            monitor: monitorStats,
            system: systemStats
        });
    } catch (error) {
        console.error('[API] 获取系统状态失败:', error);
        res.status(500).json({ error: '获取状态失败' });
    }
});

// 清除缓存API
app.post('/api/cache/clear', async (req, res) => {
    try {
        db.clearCache();
        res.json({ success: true, message: '缓存已清除' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 清空所有数据
app.delete('/api/clear-all-data', async (req, res) => {
    try {
        console.log('[API] 开始清空所有数据...');

        // 清空所有数据库表
        await db.clearAllData();

        // 清空缓存
        db.clearCache();

        // 重置序列管理器（如果存在）
        if (sequenceManager) {
            sequenceManager.clearCache();
        }

        console.log('[API] 所有数据已成功清空');

        res.json({
            success: true,
            message: '所有数据已成功清空'
        });
    } catch (error) {
        console.error('[API] 清空数据失败:', error);
        res.status(500).json({
            error: '清空数据失败: ' + error.message
        });
    }
});

// 错误处理中间件
app.use((error, req, res, next) => {
    console.error('[App] 未捕获的错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// 优雅关闭
async function gracefulShutdown() {
    console.log('[App] 开始优雅关闭...');

    try {
        if (monitor) {
            monitor.shutdown();
        }

        if (db) {
            await db.close();
        }

        console.log('[App] 优雅关闭完成');
        process.exit(0);
    } catch (error) {
        console.error('[App] 关闭过程中出错:', error);
        process.exit(1);
    }
}

// 注册关闭信号
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// 启动服务器
async function startServer() {
    await initializeApp();

    // 启动自动重新授权服务
    try {
        const autoReauthService = new AutoReauthService(db, emailService);
        autoReauthService.startAutoReauthService();
        console.log('[App] 自动重新授权服务已启动');
    } catch (error) {
        console.error('[App] 启动自动重新授权服务失败:', error);
    }

    app.listen(PORT, () => {
        console.log(`[App] MailManager KISS版本已启动`);
        console.log(`[App] 服务地址: http://localhost:${PORT}`);
        console.log(`[App] 环境: ${process.env.NODE_ENV || 'development'}`);
    });
}

// 数据导出API
app.get('/api/accounts/export', ErrorHandler.asyncWrapper(async (req, res) => {
    try {
        const accounts = await db.getAccounts({
            page: 1,
            pageSize: 10000, // 导出所有数据
            filters: {},
            sortBy: 'import_sequence',
            order: 'asc'
        });

        const csvData = convertToCSV(accounts);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="accounts_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csvData);
    } catch (error) {
        throw ErrorHandler.createError(error, 'DATABASE_ERROR', '数据导出');
    }
}));

// CSV转换工具
function convertToCSV(accounts) {
    const headers = ['序号', '邮箱地址', '状态', '最新验证码', '最后活跃时间', '创建时间'];
    const csvRows = [headers.join(',')];

    accounts.forEach(account => {
        const row = [
            account.import_sequence || '',
            `"${account.email}"`, // 用引号包围防止CSV格式问题
            getStatusText(account.status),
            `"${account.latest_code || ''}"`,
            account.last_active_at || '',
            account.created_at || ''
        ];
        csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
}

function getStatusText(status) {
    const texts = {
        'pending': '待处理',
        'authorized': '已授权',
        'error': '错误'
    };
    return texts[status] || '未知';
}

// 启动应用
startServer().catch(error => {
    console.error('[App] 启动失败:', error);
    process.exit(1);
});

module.exports = app;