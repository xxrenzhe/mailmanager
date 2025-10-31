const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

// 导入KISS优化组件
const SimpleDatabase = require('./database_simple.js');
const SimpleMonitor = require('./simpleMonitor.js');

const app = express();
const PORT = process.env.PORT || 3000;

// 基础配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 设置EJS视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// 初始化数据库和监控器
let db;
let monitor;

async function initializeApp() {
    try {
        // 初始化简单数据库
        db = new SimpleDatabase();
        await db.init();
        console.log('[App] 数据库初始化完成');

        // 初始化简单监控器
        monitor = new SimpleMonitor({
            maxConcurrentMonitors: 9
        });

        // 设置监控事件监听
        setupMonitorEvents();

        console.log('[App] 应用初始化完成');
    } catch (error) {
        console.error('[App] 初始化失败:', error);
        process.exit(1);
    }
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
        res.render('accounts_simple');
    } catch (error) {
        console.error('[Route] 主页渲染失败:', error);
        res.status(500).send('服务器错误');
    }
});

// 分页获取账户列表
app.get('/api/accounts/paged', async (req, res) => {
    try {
        const { page = 1, size = 50, search = '', status = '' } = req.query;

        const options = {
            page: parseInt(page),
            pageSize: parseInt(size),
            filters: {}
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

// SSE事件流
app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    sseClients.add(res);

    // 发送连接确认
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    // 处理连接关闭
    req.on('close', () => {
        sseClients.delete(res);
    });
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
            status: status || 'authorized', // 批量导入通常已经是授权状态
            last_active_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const accountId = await db.createAccount(accountData);

        console.log(`[API] 批量导入成功: ${email} (ID: ${accountId})`);

        res.json({
            success: true,
            account_id: accountId,
            email: email,
            message: '账户导入成功'
        });
    } catch (error) {
        console.error('[API] 批量导入失败:', error);

        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: '邮箱已存在' });
        }

        res.status(500).json({ error: '批量导入失败' });
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

        // 删除账户（软删除 - 设置为非活跃）
        await db.updateAccount(accountId, { is_active: 0 });

        res.json({ success: true, message: '账户删除成功' });
    } catch (error) {
        console.error('[API] 删除账户失败:', error);
        res.status(500).json({ error: '删除账户失败' });
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

    app.listen(PORT, () => {
        console.log(`[App] MailManager KISS版本已启动`);
        console.log(`[App] 服务地址: http://localhost:${PORT}`);
        console.log(`[App] 环境: ${process.env.NODE_ENV || 'development'}`);
    });
}

// 启动应用
startServer().catch(error => {
    console.error('[App] 启动失败:', error);
    process.exit(1);
});

module.exports = app;