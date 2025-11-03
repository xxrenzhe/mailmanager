/**
 * MailManager - 核心管理类
 * 负责邮箱账户管理、实时更新、数据持久化等核心功能
 */

class SimpleMailManager {
    constructor() {
        this.accounts = [];
        this.filteredAccounts = [];
        this.selectedAccounts = new Set(); // 选中的账户ID集合
        this.sortField = 'sequence';
        this.sortDirection = 'asc';
        this.currentPage = 1;
        this.pageSize = 50;

        // 邮件序列管理器
        this.sequenceManager = new EmailSequenceManager();

        // WebSocket实时更新系统
        this.websocket = null;
        this.wsConnected = false;
        this.wsReconnectAttempts = 0;
        this.wsReconnectTimer = null;

        // SSE实时更新系统（备用方案）
        this.eventSource = null;
        this.sseConnected = false;
        this.sseReconnectAttempts = 0;
        this.sseReconnectTimer = null;

        // 会话ID管理
        this.sessionId = null;
        this.importCompletionShown = false; // 防止重复显示导入完成状态

        // 新验证码视觉提示定时器
        this.codeDisplayTimer = null;

        this.init();
    }

    async init() {
        await this.loadAccounts();
        await this.sequenceManager.initialize(this.accounts);

        // 优先启动WebSocket实时更新
        this.connectWebSocket();

        // 初始化连接状态显示
        this.updateConnectionStatus('connecting');

        this.render();
        this.updateStats();
    }

    // WebSocket实时更新系统
    connectWebSocket() {
        if (this.websocket) {
            this.websocket.close();
        }

        // 从localStorage获取或生成会话ID
        if (!this.sessionId) {
            const savedSessionId = localStorage.getItem('mail_manager_session_id');
            if (savedSessionId) {
                this.sessionId = savedSessionId;
                console.log(`[WebSocket] 恢复会话ID: ${this.sessionId}`);
            } else {
                this.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('mail_manager_session_id', this.sessionId);
                console.log(`[WebSocket] 生成并保存会话ID: ${this.sessionId}`);
            }
        }

        try {
            console.log('[WebSocket] 正在连接实时更新服务...');
            let wsUrl;

            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                // 开发环境：直连WebSocket服务器
                wsUrl = `ws://localhost:3002?sessionId=${encodeURIComponent(this.sessionId)}`;
                console.log('[WebSocket] 开发环境，使用直连');
            } else {
                // 生产环境：通过CDN代理连接WebSocket
                const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
                wsUrl = `${protocol}://${window.location.host}/ws?sessionId=${encodeURIComponent(this.sessionId)}`;
                console.log('[WebSocket] 生产环境，通过CDN连接');
            }

            console.log(`[WebSocket] 连接URL: ${wsUrl}`);
            this.websocket = new WebSocket(wsUrl);

            this.websocket.onopen = () => {
                console.log('[WebSocket] 实时更新连接成功');
                this.wsConnected = true;
                this.wsReconnectAttempts = 0;
                Utils.showNotification('已连接到WebSocket实时更新服务', 'success');

                // 更新连接状态显示
                this.updateConnectionStatus('connected');

                // 订阅所有事件类型
                this.websocket.send(JSON.stringify({
                    type: 'subscribe',
                    sessionId: this.sessionId,
                    events: [
                        'verification_code_found',
                        'account_status_changed',
                        'manual_fetch_complete',
                        'manual_fetch_error',
                        'bulk_import_progress',
                        'import_progress',
                        'monitoring_started',
                        'monitoring_ended'
                    ]
                }));
            };

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketEvent(data);
                } catch (error) {
                    console.error('[WebSocket] 消息解析错误:', error);
                }
            };

            this.websocket.onclose = () => {
                console.log('[WebSocket] 连接已断开');
                this.wsConnected = false;
                this.updateConnectionStatus('disconnected');
                this.attemptReconnect();
            };

            this.websocket.onerror = (error) => {
                console.error('[WebSocket] 连接错误:', error);
                Utils.showNotification('WebSocket连接失败', 'error');
                this.updateConnectionStatus('failed');
            };

        } catch (error) {
            console.error('[WebSocket] 连接失败:', error);
            Utils.showNotification('无法连接WebSocket实时服务，尝试SSE备用方案', 'warning');
            this.updateConnectionStatus('disconnected');
            this.connectSSE(); // 备用SSE连接
        }
    }

    // WebSocket重连机制
    attemptReconnect() {
        if (this.wsReconnectAttempts >= 5) {
            console.log('[WebSocket] 重连次数已达上限，停止重连');
            Utils.showNotification('WebSocket连接失败，请刷新页面重试', 'error');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts), 30000);
        this.wsReconnectAttempts++;

        console.log(`[WebSocket] ${delay}ms后尝试第${this.wsReconnectAttempts}次重连...`);

        this.wsReconnectTimer = setTimeout(() => {
            this.connectWebSocket();
        }, delay);
    }

    // 处理WebSocket事件
    handleWebSocketEvent(data) {
        console.log('[WebSocket] 收到事件:', data);
        console.log('[WebSocket] 事件类型:', data.type);

        switch (data.type) {
            case 'connection_established':
                console.log(`[WebSocket] 连接确认: ${data.clientId}`);
                this.wsReconnectAttempts = 0; // 重置重连计数
                break;

            case 'ping':
                // 响应心跳
                if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    this.websocket.send(JSON.stringify({
                        type: 'pong',
                        timestamp: new Date().toISOString()
                    }));
                }
                break;

            case 'verification_code_found':
                this.handleVerificationCodeFound(data);
                break;

            case 'account_status_changed':
                this.handleAccountStatusChanged(data);
                break;

            case 'manual_fetch_complete':
                this.handleManualFetchComplete(data);
                break;

            case 'manual_fetch_error':
                this.handleManualFetchError(data);
                break;

            case 'bulk_import_progress':
                this.handleBulkImportProgress(data);
                break;

            case 'import_progress':
                this.handleImportProgress(data);
                break;

            case 'emails_processed':
                this.handleEmailsProcessed(data);
                break;

            case 'data_cleared':
                this.handleDataCleared(data);
                break;

            case 'monitoring_started':
                this.handleMonitoringStarted(data);
                break;

            case 'monitoring_ended':
                this.handleMonitoringEnded(data);
                break;

            default:
                console.log(`[WebSocket] 未知事件类型: ${data.type}`);
        }
    }

    // 处理验证码发现��件
    handleVerificationCodeFound(data) {
        console.log(`[验证码] 发现验证码: ${data.email} -> ${data.code}`);

        // KISS：前端已经创建了账户，直接查找即可
        let account = this.accounts.find(acc => acc.id === data.email_id);

        if (!account) {
            console.warn(`[验证码] 找不到账户 ${data.email} (ID: ${data.email_id})`);
            console.warn(`[验证码] 这不应该发生，前端应该已经创建了账户`);
            return;
        }

        console.log(`[验证码] 处理账户: ${account.email} (ID: ${account.id})`);

        // 现在account一定存在，继续处理验证码
        // 确保有codes数组
        if (!account.codes) {
            account.codes = [];
        }

        // 添加新验证码 - 验证码时间统一为邮件收件时间
        // 🔧 重要：received_at应该是邮件的收件时间，不是当前时间
        const emailReceivedTime = data.received_at || new Date().toISOString();

        // 设置监控标记时间戳（用于新验证码判断）
        account.last_monitoring_code_id = new Date().toISOString();

        account.codes.push({
            code: data.code,
            received_at: emailReceivedTime, // 邮件收件时间（固定）
            subject: data.subject || '',
            sender: data.sender || '',
            from: data.sender || ''
        });

        // 更新最新验证码时间 - 🔧 使用后端发送的基准时间
        account.last_code_time = data.last_code_time || emailReceivedTime;

        // 只更新当前账户的界面显示，不重新渲染整个表格
        this.updateSingleAccountDisplay(account.id);
        this.updateStats();

        // 启动新验证码视觉提示定时器（1分钟后刷新显示）
        this.startNewCodeVisualTimer(account.id);

        Utils.showNotification(`发现验证码: ${data.code}`, 'success');
    }

    // 处理账户状态变更事件
    handleAccountStatusChanged(data) {
        // 优先使用email_id匹配，如果没有则使用email匹配
        let account = this.accounts.find(acc => acc.id === data.email_id) ||
                    this.accounts.find(acc => acc.email === data.email);
        if (account) {
            // 🔧 兼容新旧事件格式：支持 status 和 new_status 字段
            const newStatus = data.new_status || data.status;
            const oldStatus = data.old_status || account.status;

            console.log(`[状态变更] ${data.email}: ${oldStatus} -> ${newStatus}`);

            account.status = newStatus;
            account.email_count = data.email_count || account.email_count;
            account.last_checked = new Date().toISOString();

            // 处理进度更新（批量导入时使用）
            if (data.progress && data.progress.current !== undefined && data.progress.total) {
                console.log(`[进度更新] ${data.email}: ${data.progress.current}/${data.progress.total}`);
                if (window.updateProgress) {
                    window.updateProgress(
                        data.progress.current,
                        data.progress.total,
                        `正在处理第 ${data.progress.current} 个账户... (${data.email})`
                    );
                }
            }

            // 只更新单个账户显示，避免重新渲染整个表格
            this.updateSingleAccountDisplay(data.email_id);
            this.updateStats();

            Utils.showNotification(`${data.email} 状态变更为: ${Utils.getStatusText(newStatus)}`, 'info');
        }
    }

    // 处理手动取件完成事件
    handleManualFetchComplete(data) {
        console.log(`[手动取件] 完成: ${data.email}`);
        console.log(`[手动取件] 收到验证码: ${data.verification_code}`);
        console.log(`[手动取件] 事件数据:`, data);
        Utils.showNotification(`${data.email} 邮件收取完成`, 'success');

        // 清除手动监控状态
        if (data.email_id) {
            const account = this.accounts.find(acc => acc.id === data.email_id);
            if (account) {
                account.is_monitoring = false;
                delete account.monitoring_type;
                console.log(`[手动取件] 清除账户 ${account.email} 的手动监控状态`);
            }
        }

        // 标记手动获取的验证码为新验证码
        if (data.email_id && data.verification_code) {
            const account = this.accounts.find(acc => acc.id === data.email_id);
            if (account && account.codes) {
                // 🔧 优化验证码查找逻辑：优先查找最新时间戳的验证码
                const latestCode = account.codes
                    .filter(code => code.code === data.verification_code)
                    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0];

                if (latestCode) {
                    // 添加手动取件时间戳
                    latestCode.manual_fetch_timestamp = new Date().toISOString();
                    // 🔧 更新时间基准
                    account.last_code_time = latestCode.received_at;
                    console.log(`[手动取件] 标记新验证码: ${latestCode.code} for ${data.email}`);
                    console.log(`[手动取件] 验证码信息 - 接收时间: ${latestCode.received_at}, 手动取件时间: ${latestCode.manual_fetch_timestamp}`);
                    console.log(`[手动取件] 更新时间基准: ${account.last_code_time}`);

                    // 启动新验证码显示定时器
                    this.startNewCodeVisualTimer(account.id);

                    // 立即更新显示
                    this.updateSingleAccountDisplay(data.email_id);
                } else {
                    console.warn(`[手动取件] 找不到匹配的验证码: ${data.verification_code} for ${data.email}`);
                    console.log(`[手动取件] 当前账户验证码列表:`, account.codes.map(c => ({ code: c.code, received_at: c.received_at })));
                }
            }
        }

        // 更新统计信息
        this.updateStats();
    }

    // 处理手动取件错误事件
    handleManualFetchError(data) {
        console.error(`[手动取件] 错误: ${data.email}`, data.error);
        Utils.showNotification(`${data.email} 邮件收取失败: ${data.error}`, 'error');

        // 清除手动监控状态
        if (data.email_id) {
            const account = this.accounts.find(acc => acc.id === data.email_id);
            if (account) {
                account.is_monitoring = false;
                delete account.monitoring_type;
                console.log(`[手动取件] 清除账户 ${account.email} 的手动监控状态（错误情况）`);
            }
        }

        // 刷新UI以反映监控状态清除
        this.render();
        this.updateStats();
    }

    // 🔧 统一监控系统 - 处理监控开始事件
    handleMonitoringStarted(data) {
        console.log('[监控] 监控开始:', data);

        // 更新账户监控状态
        if (data.email_id) {
            const account = this.accounts.find(acc => acc.id === data.email_id);
            if (account) {
                console.log(`[监控] 设置账户 ${account.email} is_monitoring = true`);
                account.is_monitoring = true;
                this.debouncedSave();
                this.updateStats();
                this.render();
            } else {
                console.error(`[监控] handleMonitoringStarted找不到账户ID: ${data.email_id}`);
            }
        }

        Utils.showNotification(data.message || '监控已开始', 'info');
    }

    // 统一处理导入进度事件（合并批量导入和单个导入进度）
    handleImportProgress(data) {
        if (data.message) {
            console.log(`[导入进度] ${data.message}`);
        }

        // 更新进度显示
        if (data.progress && data.progress.current !== undefined && data.progress.total) {
            const percentage = Math.round((data.progress.current / data.progress.total) * 100);
            if (window.updateProgress) {
                window.updateProgress(
                    data.progress.current,
                    data.progress.total,
                    data.message || `正在处理第 ${data.progress.current} 个账户...`
                );
            }
        }

        // 处理账户状态更新
        if (data.email_id && data.email && data.status) {
            let account = this.accounts.find(acc => acc.id === data.email_id);
            if (!account) {
                account = this.accounts.find(acc => acc.email === data.email && acc.status === 'pending');
            }

            // KISS：前端已经创建了账户���只需要更新状态
            if (account) {
                const oldStatus = account.status;
                account.status = data.status;
                account.email_count = data.email_count || 0;
                account.last_checked = new Date().toISOString();

                // 🔧 关键修��：处理导入时发现的验证码
                if (data.data && data.data.verification_code) {
                    const verificationCode = data.data.verification_code;
                    console.log(`[导入进度] 处理导入时发现的验证码: ${account.email} -> ${verificationCode.code}`);
                    console.log(`[导入进度] 验证码完整数据:`, JSON.stringify(verificationCode, null, 2));

                    // 确保有codes数组
                    if (!account.codes) {
                        account.codes = [];
                    }

                    // 添加验证码到codes数组
                    const importTimestamp = new Date().toISOString();
                    const codeData = {
                        code: verificationCode.code,
                        sender: verificationCode.sender || 'Unknown',
                        subject: verificationCode.subject || 'Imported during bulk import',
                        received_at: verificationCode.received_at || new Date().toISOString(),
                        import_timestamp: importTimestamp
                    };

                    // 插入到codes数组开头（最新的在前面）
                    account.codes.unshift(codeData);

                    // 🔧 更新时间基准为最新验证码的收件时间
                    account.last_code_time = codeData.received_at;
                    console.log(`[导入进度] 更新时间基准: ${account.last_code_time}`);
                    console.log(`[导入进度] 验证码收件时间: ${codeData.received_at}`);
                }

                // 如果账户状态变为已授权且有验证码，标记为导入时获取的新验证码
                // 🔧 支持多种已授权状态，确保批量导入的验证码显示为新验证码
                if ((data.status === 'authorized' || data.status === 'active') && account.codes && account.codes.length > 0) {
                    // 为所有验证码设置导入时的时间戳标记
                    const importTimestamp = new Date().toISOString();
                    // 🔧 注意：批量导入时不要设置last_monitoring_code_id，避免与监控逻辑混淆

                    // 更新所有验证码的时间戳，使其符合新验证码的条件
                    account.codes.forEach((code, index) => {
                        if (!code.import_timestamp) {
                            code.import_timestamp = importTimestamp;
                            console.log(`[导入进度] 设置验证码${index}导入时间戳: ${code.code}, 时间: ${importTimestamp}`);
                        }
                    });

                    // 🔧 更新时间基准为最新验证码的收件时间
                    if (account.codes.length > 0) {
                        const latestCode = this.getLatestVerificationCode(account);
                        account.last_code_time = latestCode.received_at;
                        console.log(`[导入进度] 更新时间基准: ${account.last_code_time}`);
                    }

                    console.log(`[导入进度] 标记导入验证码为新的: ${account.email}, 验证码数量: ${account.codes.length}`);

                    // 启动新验证码视觉提示定时器
                    this.startNewCodeVisualTimer(account.id);
                }

                this.updateSingleAccountDisplay(data.email_id);
                this.updateStats();

                console.log(`[导入进度] 状态更新完成: ${data.email} (${oldStatus} -> ${data.status})`);
            } else {
                console.warn(`[导入进度] 找不到账户 ${data.email} (ID: ${data.email_id})`);
                console.warn(`[导入进度] 这不应该发生，前端应该已经创建了账户`);
            }
        }

        // 统一处理导入完成（避免重复显示）
        if (data.stage === 'completed' || data.stage === 'batch_completed') {
            console.log(`[导入进度] 批量导入完成: ${data.message || '所有账户处理完成'}`);

            // 添加防重复标志，避免多次调用完成显示
            if (!this.importCompletionShown) {
                this.importCompletionShown = true;

                if (window.hideProgressModal) {
                    window.hideProgressModal();
                }

                // 使用详细的导入完成反馈
                this.showDetailedImportSummary();
            } else {
                console.log(`[导入进度] 完成状态已显示，跳过重复显示`);
            }
        }
    }

    // 兼容性方法：保留旧的批量导入处理方法，委托给统一处理器
    handleBulkImportProgress(data) {
        console.log(`[批量导入] 委托给统一导入进度处理器`);
        this.handleImportProgress(data);
    }

    // 数据持久化方法
    async loadAccounts() {
        try {
            const stored = localStorage.getItem('mailmanager_accounts');
            if (stored) {
                this.accounts = JSON.parse(stored);

                // 迁移旧格式账户ID
                let migratedCount = 0;
                this.accounts = this.accounts.map(account => {
                    if (account.id && !account.id.startsWith('account_')) {
                        // 旧格式：生成新格式ID
                        const oldId = account.id;
                        account.id = `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        console.log(`[数据] 迁移账户ID: ${account.email} ${oldId} -> ${account.id}`);
                        migratedCount++;
                    }
                    return account;
                });

                if (migratedCount > 0) {
                    await this.saveAccounts();
                    console.log(`[数据] 迁移了 ${migratedCount} 个账户ID格式`);
                }

                this.filteredAccounts = [...this.accounts];
                console.log(`[数据] 加载了 ${this.accounts.length} 个账户`);
            }
        } catch (error) {
            console.error('[数据] 加载账户数据失败:', error);
            this.accounts = [];
            this.filteredAccounts = [];
        }
    }

    async saveAccounts() {
        try {
            localStorage.setItem('mailmanager_accounts', JSON.stringify(this.accounts));
        } catch (error) {
            console.error('[数据] 保存账户数据失败:', error);
        }
    }

    // 账户操作方法
    async addAccount(accountData) {
        try {
            // 生成唯一ID（匹配后端格式）
            accountData.id = `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            accountData.created_at = new Date().toISOString();
            accountData.status = 'pending';
            accountData.email_count = 0;
            accountData.monitoring = false;
            accountData.codes = [];
            accountData.selected = false;

            this.accounts.push(accountData);
            await this.saveAccounts();

            console.log(`[账户] 添加成功: ${accountData.email} [ID: ${accountData.id}]`);
            return accountData;
        } catch (error) {
            console.error('[账户] 添加失败:', error);
            throw error;
        }
    }

    async deleteAccount(accountId) {
        try {
            const index = this.accounts.findIndex(acc => acc.id === accountId);
            if (index !== -1) {
                const account = this.accounts[index];
                this.accounts.splice(index, 1);
                await this.saveAccounts();

                // 更新过滤列表
                this.filteredAccounts = this.filteredAccounts.filter(acc => acc.id !== accountId);

                this.render();
                this.updateStats();

                console.log(`[账户] 删除成功: ${account.email}`);
                Utils.showNotification(`已删除账户: ${account.email}`, 'success');
            }
        } catch (error) {
            console.error('[账户] 删除失败:', error);
            Utils.showNotification('删除账户失败', 'error');
        }
    }

    async clearAllData() {
        try {
            this.accounts = [];
            this.filteredAccounts = [];
            this.currentPage = 1;

            await this.saveAccounts();
            this.render();
            this.updateStats();

            console.log('[数据] 所有数据已清空');
        } catch (error) {
            console.error('[数据] 清空数据失败:', error);
            throw error;
        }
    }

    // 手动取件方法
    async manualFetchEmails(accountId) {
        try {
            const account = this.accounts.find(acc => acc.id === accountId);
            if (!account) {
                throw new Error('账户不存在');
            }

            // 设置账户为手动监控状态
            account.is_monitoring = true;
            account.monitoring_type = 'manual'; // 标记为手动监控
            console.log(`[手动取件] 设置账户 ${account.email} 为手动监控状态`);

            // 立即更新UI显示监控状态
            this.render();
            this.updateStats();

            const requestData = {
                email_id: accountId,
                email: account.email,
                client_id: account.client_id,
                refresh_token: account.refresh_token,
                access_token: account.access_token,
                current_status: account.status,
                sessionId: this.sessionId
            };

            console.log(`[手动取件] 发送取件请求:`, requestData);

            const response = await fetch('/api/manual-fetch-emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();
            if (!response.ok) {
                // 如果请求失败，清除监控状态
                account.is_monitoring = false;
                delete account.monitoring_type;
                this.render();
                this.updateStats();
                throw new Error(result.details || result.message || '自动取件失败');
            }

            console.log(`[手动取件] ${account.email} 取件请求已发送`);
            Utils.showNotification(`已自动启动 ${account.email} 的邮件收取...`, 'info');

        } catch (error) {
            console.error('[手动取件] 错误:', error);
            Utils.showNotification(error.message, 'error');
        }
    }

    // 数据刷新方法
    async refreshData() {
        try {
            await this.loadAccounts();
            await this.sequenceManager.initialize(this.accounts);
            this.filteredAccounts = [...this.accounts];
            this.render();
            this.updateStats();
            console.log('[数据] 数据刷新完成');
        } catch (error) {
            console.error('[数据] 刷新失败:', error);
            throw error;
        }
    }

    // OAuth回调处理方法
    async handleOAuthCallback() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const code = urlParams.get('code');
            const error = urlParams.get('error');

            if (error) {
                Utils.showNotification('OAuth授权失败: ' + error, 'error');
                this.cleanupOAuthUrl();
                return;
            }

            if (code) {
                Utils.showNotification('正在处理OAuth授权...', 'info');

                const response = await fetch('/api/oauth-callback', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ code })
                });

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || 'OAuth回调处理失败');
                }

                if (result.success) {
                    Utils.showNotification('OAuth授权成功！', 'success');
                    await this.refreshData();
                } else {
                    Utils.showNotification(result.message || 'OAuth授权失败', 'error');
                }

                this.cleanupOAuthUrl();
            }
        } catch (error) {
            console.error('[OAuth] 回调处理失败:', error);
            Utils.showNotification('OAuth授权处理失败: ' + error.message, 'error');
            this.cleanupOAuthUrl();
        }
    }

    cleanupOAuthUrl() {
        const url = new URL(window.location);
        url.searchParams.delete('code');
        url.searchParams.delete('error');
        url.searchParams.delete('state');
        window.history.replaceState({}, document.title, url.pathname);
        console.log('[OAuth] 已清理URL参数');
    }

    // UI更新方法
    updateStats() {
        const totalAccounts = this.accounts.length;
        const authorizedAccounts = this.accounts.filter(acc => acc.status === 'authorized').length;
        const pendingAccounts = this.accounts.filter(acc => acc.status === 'pending').length;
        const failedAccounts = this.accounts.filter(acc => acc.status === 'error').length;
        const monitoringAccounts = this.accounts.filter(acc => acc.is_monitoring).length;

        // 安全地更新统计信息，添加空值检查
        const totalAccountsEl = document.getElementById('totalAccounts');
        const authorizedCountEl = document.getElementById('authorizedCount');
        const pendingCountEl = document.getElementById('pendingCount');
        const failedCountEl = document.getElementById('failedCount');
        const monitoringCountEl = document.getElementById('monitoringCount');
        const accountCountEl = document.getElementById('accountCount');

        if (totalAccountsEl) totalAccountsEl.textContent = totalAccounts;
        if (authorizedCountEl) authorizedCountEl.textContent = authorizedAccounts;
        if (pendingCountEl) pendingCountEl.textContent = pendingAccounts;
        if (failedCountEl) failedCountEl.textContent = failedAccounts;
        if (monitoringCountEl) monitoringCountEl.textContent = monitoringAccounts;
        if (accountCountEl) accountCountEl.textContent = this.filteredAccounts.length;
    }

    // 账户选择切换方法
    toggleAccountSelection(accountId) {
        if (this.selectedAccounts.has(accountId)) {
            this.selectedAccounts.delete(accountId);
        } else {
            this.selectedAccounts.add(accountId);
        }
        console.log(`[账户选择] 已选择 ${this.selectedAccounts.size} 个账户`);
    }

    // 获取选中的账户
    getSelectedAccounts() {
        return this.accounts.filter(account => this.selectedAccounts.has(account.id));
    }

    // 全选/取消全选
    toggleSelectAll() {
        if (this.selectedAccounts.size === this.filteredAccounts.length) {
            // 全部选中，则取消全选
            this.selectedAccounts.clear();
        } else {
            // 全选当前页
            this.filteredAccounts.forEach(account => {
                this.selectedAccounts.add(account.id);
            });
        }
    }

    // 排序方法
    sortByField(field) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }

        this.filteredAccounts.sort((a, b) => {
            let aVal = a[field];
            let bVal = b[field];

            // 处理特殊字段
            if (field === 'last_code_time') {
                aVal = aVal ? new Date(aVal).getTime() : 0;
                bVal = bVal ? new Date(bVal).getTime() : 0;
            } else if (field === 'last_sender') {
                aVal = aVal || '';
                bVal = bVal || '';
            } else if (field === 'email_from') {
                aVal = aVal || '';
                bVal = bVal || '';
            } else if (field === 'sequence') {
                aVal = aVal || 0;
                bVal = bVal || 0;
            }

            let result = 0;
            if (aVal < bVal) result = -1;
            else if (aVal > bVal) result = 1;

            return this.sortDirection === 'asc' ? result : -result;
        });

        this.render();
    }

    // 分页方法
    changePage(delta) {
        const totalPages = Math.ceil(this.filteredAccounts.length / this.pageSize);
        const newPage = this.currentPage + delta;

        if (newPage >= 1 && newPage <= totalPages) {
            this.currentPage = newPage;
            this.render();
        }
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredAccounts.length / this.pageSize);
        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            this.render();
        }
    }

    changePageSize(newSize) {
        this.pageSize = newSize;
        this.currentPage = 1;
        this.render();
    }

    // 搜索过滤方法
    filterAccounts() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const statusFilter = document.getElementById('statusFilter').value;

        this.filteredAccounts = this.accounts.filter(account => {
            // 搜索过滤
            const matchesSearch = !searchTerm ||
                account.email.toLowerCase().includes(searchTerm) ||
                (account.email_from && account.email_from.toLowerCase().includes(searchTerm));

            // 状态过滤
            const matchesStatus = !statusFilter || account.status === statusFilter;

            return matchesSearch && matchesStatus;
        });

        this.currentPage = 1;
        this.render();
    }

    // 渲染方法
    render() {
        const tbody = document.getElementById('accountsTableBody');
        if (!tbody) return;

        if (this.filteredAccounts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-8 text-gray-500">
                        <div class="text-6xl mb-4">📭</div>
                        <h3 class="text-lg font-medium text-gray-900 mb-2">暂无邮箱账户</h3>
                        <p>点击上方"导入邮箱"按钮开始使用</p>
                    </td>
                </tr>
            `;
            this.updatePagination();
            return;
        }

        // 计算分页范围
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, this.filteredAccounts.length);
        const pageAccounts = this.filteredAccounts.slice(startIndex, endIndex);

        // 生成表格HTML - 使用simple-mail-manager.html的结构和样式
        let html = '';
        pageAccounts.forEach(account => {
            const statusConfig = Utils.getStatusConfig(account.status);
            const latestCode = account.codes && account.codes.length > 0 ?
                account.codes[account.codes.length - 1] : null;

            // 获取状态类和图标（使用simple-mail-manager.html的方式）
            const statusClass = Utils.getStatusColorClass(account.status);
            const statusIcon = this.getStatusIcon(account.status);
            const statusText = statusConfig.text;

            html += `
                <tr class="hover:bg-gray-50 transition-colors" data-account-id="${account.id}">
                    <td class="px-3 py-3 whitespace-nowrap text-center w-16">
                        <span class="text-base font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded">
                            ${account.sequence || account.import_seq || '-'}
                        </span>
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap w-20">
                        <span class="${statusClass}">
                            <i class="${statusIcon} mr-1"></i>
                            <span class="text-base">${statusText}</span>
                        </span>
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap w-40">
                        <div class="flex items-center">
                            <i class="fas fa-envelope text-gray-400 mr-3 text-base"></i>
                            <span class="text-base font-medium text-gray-900 cursor-pointer hover:text-blue-600 transition truncate"
                                  onclick="copyEmailToClipboard('${account.id}')"
                                  title="${account.email}">
                                ${account.email}
                            </span>
                        </div>
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap text-center w-14">
                        <input type="checkbox"
                               class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                               data-account-id="${account.id}"
                               ${this.selectedAccounts.has(account.id) ? 'checked' : ''}
                               onchange="handleAccountSelection(this)">
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap w-32 code-cell">
                        <div class="flex flex-col ${account.is_new_code ? 'bg-blue-50 border border-blue-300 rounded' : ''}">
                            ${this.getVerificationCodeDisplay(account)}
                        </div>
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap text-base text-gray-600 w-28">
                        ${this.getActiveTimeDisplay(account)}
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap text-base text-gray-600 w-24">
                        ${this.getEmailSenderDisplay(account)}
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap w-40">
                        <div class="flex gap-1 flex-wrap">
                            <!-- 手动取件按钮 - 始终显示 -->
                            <button onclick="manualFetchEmails('${account.id}')"
                                    class="px-2 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded transition text-base"
                                    title="手动收取最新邮件">
                                取件
                            </button>

                            <!-- 状态按钮：重新授权状态或复制按钮 -->
                            ${account.status === 'reauthorizing' ?
                                `<span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-sm font-medium">
                                    自动重新授权中...
                                </span>` :
                                account.reauth_required || account.status === 'reauth_required' || account.status === 'expired_refresh_token' || account.status === 'invalid_refresh_token' ?
                                `<span class="px-2 py-1 bg-orange-100 text-orange-700 rounded text-sm font-medium">
                                    等待重新授权
                                </span>` :
                                `<button onclick="copyEmailOnly('${account.id}')"
                                        class="px-2 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition text-base">
                                    复制
                                </button>`
                            }

                            <button onclick="copyLatestCode('${account.id}')"
                                    class="px-2 py-1 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition text-base">
                                验证码
                            </button>
                            <button onclick="deleteAccountConfirm('${account.id}')"
                                    class="px-2 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded transition text-base">
                                删除
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        this.updatePagination(startIndex, endIndex);
    }

    // 更新分页控件
    updatePagination(startIndex = 0, endIndex = 0) {
        const totalPages = Math.ceil(this.filteredAccounts.length / this.pageSize);
        const pagination = document.getElementById('pagination');

        if (!pagination) return;

        let paginationHTML = '';

        // 第一页按钮
        const prevDisabled = this.currentPage === 1 ? 'disabled' : '';
        paginationHTML += `<button class="page-btn" onclick="goToFirstPage()" ${prevDisabled}>第一页</button>`;

        // 页码按钮
        if (totalPages <= 7) {
            // 总页数少于7页，显示所有页码
            for (let i = 1; i <= totalPages; i++) {
                const activeClass = i === this.currentPage ? 'active' : '';
                paginationHTML += `<button class="page-btn ${activeClass}" onclick="goToPage(${i})">${i}</button>`;
            }
        } else {
            // 总页数较多，智能显示页码
            if (this.currentPage <= 4) {
                // 前几页
                for (let i = 1; i <= 5; i++) {
                    const activeClass = i === this.currentPage ? 'active' : '';
                    paginationHTML += `<button class="page-btn ${activeClass}" onclick="goToPage(${i})">${i}</button>`;
                }
                paginationHTML += `<span class="px-2">...</span>`;
                paginationHTML += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
            } else if (this.currentPage >= totalPages - 3) {
                // 后几页
                paginationHTML += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
                paginationHTML += `<span class="px-2">...</span>`;
                for (let i = totalPages - 4; i <= totalPages; i++) {
                    const activeClass = i === this.currentPage ? 'active' : '';
                    paginationHTML += `<button class="page-btn ${activeClass}" onclick="goToPage(${i})">${i}</button>`;
                }
            } else {
                // 中间页
                paginationHTML += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
                paginationHTML += `<span class="px-2">...</span>`;
                for (let i = this.currentPage - 1; i <= this.currentPage + 1; i++) {
                    const activeClass = i === this.currentPage ? 'active' : '';
                    paginationHTML += `<button class="page-btn ${activeClass}" onclick="goToPage(${i})">${i}</button>`;
                }
                paginationHTML += `<span class="px-2">...</span>`;
                paginationHTML += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
            }
        }

        // 最后一页按钮
        const nextDisabled = this.currentPage === totalPages ? 'disabled' : '';
        paginationHTML += `<button class="page-btn" onclick="goToLastPage()" ${nextDisabled}>最后一页</button>`;

        pagination.innerHTML = paginationHTML;

        // 更新显示信息
        const startItem = this.filteredAccounts.length > 0 ? startIndex + 1 : 0;
        const showingFrom = document.getElementById('showingFrom');
        const showingTo = document.getElementById('showingTo');
        const totalRecords = document.getElementById('totalRecords');

        if (showingFrom) showingFrom.textContent = startItem;
        if (showingTo) showingTo.textContent = endIndex;
        if (totalRecords) totalRecords.textContent = this.filteredAccounts.length;
    }

    // 连接SSE实时更新系统（WebSocket备用方案）
    connectSSE() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        // 从localStorage获取或生成会话ID
        if (!this.sessionId) {
            const savedSessionId = localStorage.getItem('mail_manager_session_id');
            if (savedSessionId) {
                this.sessionId = savedSessionId;
                console.log(`[SSE] 恢复会话ID: ${this.sessionId}`);
            } else {
                this.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('mail_manager_session_id', this.sessionId);
                console.log(`[SSE] 生成并保存会话ID: ${this.sessionId}`);
            }
        }

        try {
            console.log('[SSE] 正在连接实时更新服务...');
            this.eventSource = new EventSource(`/api/events/stream/${this.sessionId}`);

            this.eventSource.onopen = () => {
                console.log('[SSE] 实时更新连接成功');
                this.sseConnected = true;
                Utils.showNotification('已连接到实时更新服务', 'success');
                this.updateConnectionStatus('connected');
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSSEEvent(data);
                } catch (error) {
                    console.error('[SSE] 解析事件数据失败:', error);
                }
            };

            this.eventSource.onerror = () => {
                this.updateConnectionStatus('disconnected');
                this.reconnectSSE();
            };

        } catch (error) {
            console.error('[SSE] 连接失败:', error);
            Utils.showNotification('无法连接实时更新服务', 'error');
            this.updateConnectionStatus('failed');
        }
    }

    // 处理SSE事件
    handleSSEEvent(data) {
        console.log('[SSE] 收到事件:', data);
        console.log('[SSE] 事件类型:', data.type);
        console.log('[SSE] 当前会话ID:', this.sessionId);

        switch (data.type) {
            case 'connection':
                console.log(`[SSE] 连接确认: ${data.message}`);
                break;

            case 'heartbeat':
                // 心跳事件，无需处理
                break;

            case 'monitoring_started':
                this.handleMonitoringStarted(data);
                break;

            case 'monitoring_progress':
                this.handleMonitoringProgress(data);
                break;

            case 'monitoring_ended':
                this.handleMonitoringEnded(data);
                break;

            case 'monitoring_error':
                this.handleMonitoringError(data);
                break;

            case 'verification_code_found':
                this.handleVerificationCodeFound(data);
                break;

            case 'account_status_changed':
                this.handleAccountStatusChanged(data);
                break;

            case 'emails_processed':
                this.handleEmailsProcessed(data);
                break;

            case 'data_cleared':
                this.handleDataCleared(data);
                break;

            default:
                console.log(`[SSE] 未知事件类型: ${data.type}`);
        }
    }

    // SSE重连机制
    reconnectSSE() {
        if (this.sseReconnectTimer) {
            clearTimeout(this.sseReconnectTimer);
        }

        const reconnectDelay = Math.min(1000 * Math.pow(2, this.sseReconnectAttempts || 0), 30000);
        this.sseReconnectAttempts = (this.sseReconnectAttempts || 0) + 1;

        console.log(`[SSE] ${reconnectDelay/1000}秒后尝试第${this.sseReconnectAttempts}次重连...`);

        this.sseReconnectTimer = setTimeout(() => {
            if (!this.sseConnected) {
                this.connectSSE();
            }
        }, reconnectDelay);
    }

    // 切换账户选中状态
    toggleAccountSelection(accountId) {
        if (this.selectedAccounts.has(accountId)) {
            this.selectedAccounts.delete(accountId);
        } else {
            this.selectedAccounts.add(accountId);
        }
        this.render();
    }

    // 获取状态类名（从simple-mail-manager.html复制）
    getStatusClass(status) {
        const classes = {
            'authorized': 'text-green-600',
            'pending': 'text-yellow-600',
            'failed': 'text-red-600',
            'reauth_needed': 'text-red-600',
            'error': 'text-red-600',
            'monitoring': 'text-blue-600'
        };
        return classes[status] || 'text-gray-600';
    }

    // 获取状态文本（从simple-mail-manager.html复制）
    getStatusText(status) {
        const texts = {
            'authorized': '已授权',
            'pending': '待授权',
            'failed': '授权失败',
            'reauth_needed': '需重新授权',
            'error': '错误',
            'monitoring': '监控中'
        };
        return texts[status] || '未知';
    }

    // 格式化完整时间（从simple-mail-manager.html复制）
    formatFullTime(timestamp) {
        if (!timestamp) return '-';

        try {
            const date = new Date(timestamp);

            // 验证日期有效性
            if (isNaN(date.getTime())) {
                console.warn(`[时间格式化] 无效的时间戳: ${timestamp}`);
                return '-';
            }

            // 🔧 KISS原则: 直接显示UTC时间，简单可靠
            const utcTime = date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
            return utcTime;
        } catch (error) {
            console.error(`[时间格式化] 错误:`, error);
            return '-';
        }
    }

    // 🔧 新增：统一的获取最新验证码工具函数
    getLatestVerificationCode(account) {
        if (!account.codes || account.codes.length === 0) {
            return null;
        }

        // 使用安全的排序逻辑，确保获取真正最新的验证码
        const sortedCodes = [...account.codes].sort((a, b) => {
            const timeA = a.received_at ? new Date(a.received_at).getTime() : 0;
            const timeB = b.received_at ? new Date(b.received_at).getTime() : 0;
            // 如果时间解析失败，使用0作为默认值
            return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA); // 降序，最新的在前
        });

        return sortedCodes[0];
    }

    // 验证码显示逻辑 - 只显示纯数字验证码（从simple-mail-manager.html复制）
    getVerificationCodeDisplay(account) {
        console.log(`[验证码显示] 账户 ${account.email} - is_monitoring: ${account.is_monitoring}, monitoring_codes_only: ${account.monitoring_codes_only}, codes数量: ${account.codes?.length || 0}`);

        // 如果账户正在监控中，显示"监控中..."
        if (account.is_monitoring) {
            console.log(`[验证码显示] 账户 ${account.email} 显示"监控中..." - 原因: is_monitoring = true`);
            return '<span class="text-blue-500 text-base animate-pulse">监控中...</span>';
        }

        // 如果账户设置了只显示监控期间的验证码，但还没有新验证码，显示"监控中..."
        if (account.monitoring_codes_only && (!account.codes || account.codes.length === 0)) {
            console.log(`[验证码显示] 账户 ${account.email} 显示"监控中..." - 原因: monitoring_codes_only = true 且无验证码`);
            return '<span class="text-blue-500 text-base animate-pulse">监控中...</span>';
        }

        if (!account.codes || account.codes.length === 0) {
            return '<span class="text-gray-400 text-base">无</span>';
        }

        // 🔧 修复：使用统一的工具函数获取最新验证码
        const latestCode = this.getLatestVerificationCode(account);
        console.log(`[验证码显示] 账户 ${account.email} 最新验证码:`, latestCode);
        console.log(`[验证码显示] 账户 ${account.email} 验证码总数: ${account.codes.length}`);

        // 验证码显示逻辑：只要是从最近5封邮件中提取的验证码就显示
        // 这包括导入时自动获取的验证码和手动同步获取的验证码
        // 不基于时间判断，基于数据来源判断（从最新邮件提取）

        // 如果账户有邮件数据，说明已经进行过邮件同步
        const hasEmailData = account.emails && account.emails.length > 0;

        // 如果账户有last_sync时间戳，说明进行过邮件同步
        const hasBeenSynced = !!account.last_sync;

        // 简化验证码显示逻辑：只要有验证码数据就显示
        // 后端已经成功提取了验证码，应该立即显示

        // 检查是否为纯数字验证码
        const isNumericCode = /^\d+$/.test(latestCode.code);

        if (isNumericCode) {
            // 检查是否为新验证码（1分钟内）
            const isNewCode = this.isNewVerificationCode(account, latestCode);
            const bgClass = isNewCode ? 'bg-blue-500 text-white' : 'bg-green-500 text-white';
            const titleText = isNewCode ? '新验证码（1分钟内获取）- 点击复制' : '点击复制验证码';

            // 是纯数字验证码
            return `
                <div class="flex items-center gap-2">
                    <span class="text-code cursor-pointer px-2 py-1 rounded ${bgClass}" onclick="copyLatestCode('${account.id}')" title="${titleText}">
                        ${latestCode.code}
                        <i class="fas fa-copy ml-1 text-xs"></i>
                    </span>
                </div>
            `;
        } else {
            // 不是纯数字验证码，显示为"无"
            return '<span class="text-gray-400 text-base">无</span>';
        }
    }

    // 🔧 新验证码判断工具 - 基于存储时间基准的判断逻辑
    isNewVerificationCode(account, code) {
        if (!code || !code.received_at) {
            return false;
        }

        const currentTime = new Date().getTime();
        const receivedTime = new Date(code.received_at).getTime();

        // 获取账户之前存储的最新验证码时间基准
        const baselineTime = account.last_code_time ? new Date(account.last_code_time).getTime() : 0;

        // 判断逻辑：新获取的验证码收件时间必须晚于存储的基准时间
        const isNewCode = receivedTime > baselineTime;
        const timeDiff = Math.round((currentTime - receivedTime) / 1000);
        const baselineDiff = baselineTime > 0 ? Math.round((receivedTime - baselineTime) / 1000) : 0;

        // 详细调试信息
        console.log(`[新验证码检查] ${account.email}:`);
        console.log(`  新验证码: ${code.code} (${timeDiff}秒前)`);
        console.log(`  基准时间: ${baselineTime > 0 ? new Date(baselineTime).toISOString() : '无'}`);
        console.log(`  时间差: ${baselineDiff > 0 ? `比基准晚${baselineDiff}秒` : '无基准或更早'}`);
        console.log(`  判断结果: ${isNewCode ? '新验证码' : '历史验证码'}`);

        return isNewCode;
    }

    // 启动新验证码视觉提示定时器
    startNewCodeVisualTimer(accountId) {
        // 清除现有定时器
        if (this.codeDisplayTimer) {
            clearTimeout(this.codeDisplayTimer);
        }

        console.log(`[视觉提示] 启动新验证码视觉提示定时器: ${accountId}`);

        // 1分钟后刷新显示，从蓝色背景恢复到绿色背景
        this.codeDisplayTimer = setTimeout(() => {
            console.log(`[视觉提示] 1分钟结束，刷新验证码显示: ${accountId}`);
            this.updateSingleAccountDisplay(accountId);
            this.codeDisplayTimer = null;
        }, 60 * 1000); // 1分钟
    }

    // 获取状态图标（从simple-mail-manager.html复制）
    getStatusIcon(status) {
        const icons = {
            'authorized': 'fas fa-check-circle',
            'pending': 'fas fa-clock',
            'failed': 'fas fa-exclamation-circle',
            'reauth_needed': 'fas fa-exclamation-triangle',
            'error': 'fas fa-times-circle',
            'monitoring': 'fas fa-eye'
        };
        return icons[status] || 'fas fa-question-circle';
    }

  
    // 获取验证码收件时间显示（从simple-mail-manager.html复制）
    getActiveTimeDisplay(account) {
        // 如果没有验证码，显示"无"
        if (!account.codes || account.codes.length === 0) {
            return '<span class="text-gray-400 text-base">无</span>';
        }

        const latestCode = this.getLatestVerificationCode(account);

        // 检查是否是纯数字验证码（只有纯数字验证码才显示时间）
        const isNumericCode = /^\d+$/.test(latestCode.code);
        if (!isNumericCode) {
            return '<span class="text-gray-400 text-base">无</span>';
        }

        // KISS 原则：移除复杂的时间检查逻辑
        // 后端提取到验证码后应该立即显示，不需要等待冷却期
        // 注释：刚导入的账户也可以显示验证码时间

        // 显示验证码收件时间
        return this.formatFullTime(latestCode.received_at);
    }

    // 发件人显示逻辑 - 精简显示（从simple-mail-manager.html复制）
    getEmailSenderDisplay(account) {
        if (!account.codes || account.codes.length === 0) {
            return '<span class="text-gray-400 text-base">无</span>';
        }

        const latestCode = this.getLatestVerificationCode(account);
        if (!latestCode || !latestCode.sender) {
            return '<span class="text-gray-400 text-base">无</span>';
        }

        // KISS 原则：移除复杂的时间检查逻辑
        // 后端提取到验证码后应该立即显示发件人，不需要等待冷却期
        // 注释：刚导入的账户也可以显示发件人信息

        const sender = latestCode.sender;
        let displayName = sender;

        // 提炼发件人域名或关键信息
        if (sender.includes('@')) {
            // 邮箱地址，提取域名
            const domain = sender.split('@')[1];
            displayName = domain.split('.')[0]; // 取域名第一部分
        }

        // 常见发件人的友好名称映射
        const senderNameMap = {
            'Microsoft': 'Microsoft',
            'Google': 'Google',
            'Amazon': 'Amazon',
            'Apple': 'Apple',
            'Facebook': 'Meta',
            'Netflix': 'Netflix',
            'Twitter': 'X(Twitter)',
            'Instagram': 'Instagram',
            'LinkedIn': 'LinkedIn',
            'GitHub': 'GitHub',
            'PayPal': 'PayPal',
            'Steam': 'Steam',
            'Epic': 'Epic Games',
            'Uber': 'Uber',
            'Didi': '滴滴',
            'Meituan': '美团',
            'Taobao': '淘宝',
            'JD': '京东',
            'WeChat': '微信',
            'QQ': 'QQ'
        };

        // 检查是否匹配常见发件人
        for (const [key, value] of Object.entries(senderNameMap)) {
            if (sender.toLowerCase().includes(key.toLowerCase())) {
                displayName = value;
                break;
            }
        }

        // 如果太长，截断显示
        if (displayName.length > 15) {
            displayName = displayName.substring(0, 15) + '...';
        }

        return `<span class="text-gray-700 text-base" title="${sender}">${displayName}</span>`;
    }

    // 处理监控事件
    handleMonitoringStarted(data) {
        console.log('[监控] 监控开始:', data);

        // 🔧 调试：检查所有账户的当前状态
        console.log(`[调试] handleMonitoringStarted执行前所有账户监控状态:`);
        this.accounts.forEach(acc => {
            console.log(`[调试] 账户 ${acc.email}: is_monitoring=${acc.is_monitoring}, monitoring_codes_only=${acc.monitoring_codes_only}`);
        });

        // 更新账户监控状态
        if (data.email_id) {
            const account = this.accounts.find(acc => acc.id === data.email_id);
            if (account) {
                console.log(`[监控] 设置账户 ${account.email} is_monitoring = true`);
                account.is_monitoring = true;

                console.log(`[调试] handleMonitoringStarted设置is_monitoring后:`);
                this.accounts.forEach(acc => {
                    console.log(`[调试] 账户 ${acc.email}: is_monitoring=${acc.is_monitoring}, monitoring_codes_only=${acc.monitoring_codes_only}`);
                });

                this.debouncedSave();
                this.updateStats();
                // 立即更新单个账户的UI显示
                this.updateSingleAccountDisplay(data.email_id);
            } else {
                console.error(`[监控] handleMonitoringStarted找不到账户ID: ${data.email_id}`);
            }
        }

        Utils.showNotification(data.message || '监控已开始', 'info');
    }

    handleMonitoringProgress(data) {
        console.log('[监控] 监控进度:', data);
        Utils.showNotification(data.message || '监控进行中...', 'info');
    }

    // 🔧 统一监控系统 - 处理监控结束事件
    handleMonitoringEnded(data) {
        console.log('[监控] 监控结束:', data);

        // 更新账户监控状态
        if (data.email_id) {
            const account = this.accounts.find(acc => acc.id === data.email_id);
            if (account) {
                console.log(`[监控] 清除账户 ${account.email} 的所有监控状态`);

                // 🔧 统一清除所有监控相关状态
                account.is_monitoring = false;
                account.monitoring_codes_only = false;

                console.log(`[监控] 已清除 - is_monitoring: ${account.is_monitoring}, monitoring_codes_only: ${account.monitoring_codes_only}`);

                // 保存状态
                this.debouncedSave();

                // 强制更新单个账户UI，避免全量渲染
                this.updateSingleAccountDisplay(account.id);
                this.updateStats();

                console.log(`[监控] 账户 ${account.email} 监控状态已清除，验证码数量: ${account.codes?.length || 0}`);
            } else {
                console.error(`[监控] 找不到账户ID: ${data.email_id}`);
            }
        }

        Utils.showNotification(data.message || '监控已结束', 'info');
    }

    handleMonitoringError(data) {
        console.log('[监控] 监控错误:', data);
        Utils.showNotification(data.message || '监控出错', 'error');
    }

    handleEmailsProcessed(data) {
        console.log('[邮件] 处理完成:', data);
    }

    handleDataCleared(data) {
        console.log('[数据] 数据清空:', data);
        Utils.showNotification(data.message || '数据已清空', 'success');
    }

    // 批量检查账户状态（从simple-mail-manager.html复制）
    async batchCheckAccountStatus(accountIds = null) {
        try {
            const accountsToCheck = accountIds ?
                this.accounts.filter(acc => accountIds.includes(acc.id)) :
                this.accounts;

            console.log(`[状态检查] 开始检查 ${accountsToCheck.length} 个账户状态`);

            const statusPromises = accountsToCheck.map(async (account) => {
                try {
                    // 这里应该调用后端API检查账户状态
                    // 暂时模拟状态检查
                    const response = await fetch(`/api/accounts/${account.id}/status`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (response.ok) {
                        const statusData = await response.json();
                        // 更新账户状态
                        account.status = statusData.status;
                        account.last_checked = new Date().toISOString();

                        console.log(`[状态检查] 账户 ${account.email} 状态: ${account.status}`);
                    }
                } catch (error) {
                    console.error(`[状态检查] 账户 ${account.email} 状态检查失败:`, error);
                }
            });

            await Promise.all(statusPromises);

            // 保存更新后的数据
            await this.saveAccounts();
            this.render();

            console.log(`[状态检查] 批量状态检查完成`);
            Utils.showNotification('账户状态检查完成', 'success');

        } catch (error) {
            console.error('[状态检查] 批量状态检查失败:', error);
            Utils.showNotification('状态检查失败: ' + error.message, 'error');
        }
    }

    // 验证账户授权（从simple-mail-manager.html复制）
    async validateAccountAuthorization(accountId) {
        try {
            const account = this.accounts.find(acc => acc.id === accountId);
            if (!account) {
                throw new Error('账户不存在');
            }

            console.log(`[授权验证] 开始验证账户: ${account.email}`);

            // 调用后端API验证授权
            const response = await fetch(`/api/accounts/${accountId}/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                account.status = result.authorized ? 'authorized' : 'pending';
                account.last_checked = new Date().toISOString();

                await this.saveAccounts();
                this.render();

                console.log(`[授权验证] 账户 ${account.email} 验证结果: ${account.status}`);
                Utils.showNotification(`账户 ${account.email} ${result.authorized ? '已授权' : '需要重新授权'}`, 'info');

                return result;
            } else {
                throw new Error('授权验证失败');
            }
        } catch (error) {
            console.error('[授权验证] 验证失败:', error);
            Utils.showNotification('授权验证失败: ' + error.message, 'error');
            throw error;
        }
    }

    // 同步账户邮件（从simple-mail-manager.html复制）
    async syncAccountEmails(accountId) {
        try {
            const account = this.accounts.find(acc => acc.id === accountId);
            if (!account) {
                throw new Error('账户不存在');
            }

            console.log(`[邮件同步] 开始同步账户邮件: ${account.email}`);

            const response = await fetch(`/api/accounts/${accountId}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                account.last_checked = new Date().toISOString();
                account.email_count = result.email_count || 0;

                // 如果有验证码，更新验证码列表
                if (result.verification_codes) {
                    account.codes = result.verification_codes;
                }

                await this.saveAccounts();
                this.render();

                console.log(`[邮件同步] 账户 ${account.email} 同步完成，找到 ${result.email_count || 0} 封邮件`);
                Utils.showNotification(`邮件同步完成，找到 ${result.email_count || 0} 封邮件`, 'success');

                return result;
            } else {
                throw new Error('邮件同步失败');
            }
        } catch (error) {
            console.error('[邮件同步] 同步失败:', error);
            Utils.showNotification('邮件同步失败: ' + error.message, 'error');
            throw error;
        }
    }

    // 提取验证码（从simple-mail-manager.html复制）
    async extractVerificationCodes(messages, accountId) {
        try {
            console.log(`[验证码提取] 开始提取验证码，消息数: ${messages.length}`);

            const verificationCodes = [];

            for (const message of messages) {
                // 使用正则表达式提取验证码
                const codePatterns = [
                    /\b(\d{4,8})\b/g,  // 4-8位数字
                    /\b([A-Z0-9]{4,12})\b/g,  // 4-12位字母数字组合
                    /code[:\s]+(\d{4,8})/gi,  // code: 123456
                    /验证码[:\s]*(\d{4,8})/g,  // 验证码: 123456
                    /verification[:\s]*(\d{4,8})/gi  // verification: 123456
                ];

                for (const pattern of codePatterns) {
                    const matches = message.body?.match(pattern) || [];
                    for (const match of matches) {
                        const code = match.replace(/\D/g, ''); // 只保留数字
                        if (code.length >= 4 && code.length <= 8) {
                            verificationCodes.push({
                                code: code,
                                sender: message.from || '未知',
                                subject: message.subject || '无主题',
                                received_at: message.received_at || new Date().toISOString(),
                                email_id: accountId
                            });
                        }
                    }
                }
            }

            // 去重
            const uniqueCodes = verificationCodes.filter((code, index, self) =>
                index === self.findIndex(c => c.code === code.code)
            );

            console.log(`[验证码提取] 提取到 ${uniqueCodes.length} 个验证码`);
            return uniqueCodes;

        } catch (error) {
            console.error('[验证码提取] 提取失败:', error);
            return [];
        }
    }

    // 开始监控单个账户（从simple-mail-manager.html复制）
    async startMonitoringForAccount(account) {
        try {
            const response = await fetch('/api/monitor/copy-trigger', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    email_id: account.id,
                    email: account.email,
                    client_id: account.client_id,
                    refresh_token: account.refresh_token,
                    current_status: account.status,
                    access_token: account.access_token,
                    // 新增：传递历史邮件数据用于时间过滤
                    codes: account.codes || [],
                    emails: account.emails || [],
                    latest_code_received_at: account.latest_code_received_at || null,
                    last_active_at: account.last_active_at || null
                })
            });

            if (response.ok) {
                const result = await response.json();
                Utils.showNotification('已启动1分钟监控，系统将自动处理授权并检查新邮件', 'success');
                console.log('[监控] 已为账户', account.email, '启动监控，后端将自动检查授权和获取邮件');

                // 更新账户监控状态
                account.is_monitoring = true;
                account.last_active_at = new Date().toISOString();
                this.debouncedSave();
                this.updateStats();
                this.render();
            } else {
                console.warn('[监控] 启动监控失败:', response.statusText);
                Utils.showNotification('监控启动失败，请稍后重试', 'error');
            }
        } catch (monitorError) {
            console.warn('[监控] 启动监控失败:', monitorError);
            Utils.showNotification('监控启动失败，请稍后重试', 'error');
        }
    }

    // 🔧 统一监控系统 - 复制邮箱地址并自动启动监控
    async copyEmailToClipboard(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) {
            console.error(`[错误] 找不到账户ID: ${accountId}`);
            return;
        }

        // 🔧 调试：输出账户实际状态
        console.log(`[调试] 账户 ${account.email} 当前状态: ${account.status} (显示为: ${Utils.getStatusConfig(account.status).text})`);

        try {
            await navigator.clipboard.writeText(account.email);
            Utils.showNotification('邮箱已复制: ' + account.email, 'success');

            // 🔧 统一监控状态设置
            console.log(`[监控] 开始为账户 ${account.email} 启动监控`);

            // 设置监控标志（不设置is_monitoring，等待WebSocket事件设置）
            account.monitoring_codes_only = true;
            account.last_sync = null;

            // 保存状态并启动监控
            this.debouncedSave();
            await this.startMonitoringForAccount(account);

        } catch (error) {
            console.warn('[监控] 启动监控失败:', error);
            Utils.showNotification('启动监控失败，请稍后重试', 'error');
        }
    }

    // 复制最新验证码到剪贴板
    async copyLatestCode(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) {
            console.error(`[错误] 找不到账户ID: ${accountId}`);
            Utils.showNotification('找不到对应账户', 'error');
            return;
        }

        // 检查是否有验证码
        if (!account.codes || account.codes.length === 0) {
            Utils.showNotification('该账户暂无验证码', 'warning');
            return;
        }

        // 🔧 修复：使用统一的工具函数获取最新验证码
        const latestCode = this.getLatestVerificationCode(account);
        if (!latestCode || !latestCode.code) {
            Utils.showNotification('该账户暂无可用验证码', 'warning');
            return;
        }

        try {
            await navigator.clipboard.writeText(latestCode.code);
            Utils.showNotification(`验证码已复制: ${latestCode.code}`, 'success');
            console.log(`[验证码] 已复制账户 ${account.email} 的最新验证码: ${latestCode.code}`);
        } catch (error) {
            console.error('[验证码] 复制失败:', error);
            Utils.showNotification('复制失败，请手动复制验证码', 'error');
        }
    }

    // 只复制邮箱地址到剪贴板（不启动监控）
    async copyEmailOnly(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) {
            console.error(`[错误] 找不到账户ID: ${accountId}`);
            Utils.showNotification('找不到对应账户', 'error');
            return;
        }

        try {
            await navigator.clipboard.writeText(account.email);
            Utils.showNotification(`邮箱已复制: ${account.email}`, 'success');
            console.log(`[复制] 已复制账户邮箱: ${account.email}`);
        } catch (error) {
            console.error('[复制] 复制失败:', error);
            Utils.showNotification('复制失败，请手动复制邮箱地址', 'error');
        }
    }

    // 显示详细的导入完成摘要
    showDetailedImportSummary() {
        const totalCount = this.accounts.length;
        const authorizedCount = this.accounts.filter(acc => acc.status === 'authorized').length;
        const reauthCount = this.accounts.filter(acc => acc.status === 'reauth_needed').length;
        const failedCount = this.accounts.filter(acc => acc.status === 'failed').length;
        const totalCodes = this.accounts.reduce((sum, acc) => sum + (acc.codes?.length || 0), 0);

        // 如果全局函数存在则使用，否则使用简单通知
        if (typeof window.showDetailedImportComplete === 'function') {
            window.showDetailedImportComplete(totalCount, totalCount, authorizedCount, reauthCount, failedCount);
        } else {
            // 回退到简单通知
            const message = `导入完成: ${totalCount} 个账户，其中 ${authorizedCount} 个完全就绪`;
            const messageType = failedCount > 0 ? 'warning' : (authorizedCount === totalCount ? 'success' : 'info');
            Utils.showNotification(message, messageType);
        }
    }

    // 自动重新授权尝试（从simple-mail-manager.html复制）
    async attemptAutoReauth(account) {
        try {
            console.log(`[自动重新授权] 尝试自动重新授权: ${account.email}`);

            const response = await fetch('/api/accounts/reauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email_id: account.id,
                    refresh_token: account.refresh_token
                })
            });

            if (response.ok) {
                const result = await response.json();

                if (result.success) {
                    account.status = 'authorized';
                    account.access_token = result.access_token;
                    account.last_checked = new Date().toISOString();

                    await this.saveAccounts();
                    this.render();

                    Utils.showNotification(`账户 ${account.email} 重新授权成功`, 'success');
                    return true;
                }
            }

            throw new Error('自动重新授权失败');
        } catch (error) {
            console.error('[自动重新授权] 重新授权失败:', error);
            account.status = 'reauth_needed';
            await this.saveAccounts();
            this.render();

            Utils.showNotification(`账户 ${account.email} 需要手动重新授权`, 'warning');
            return false;
        }
    }

    // 清理OAuth URL（从simple-mail-manager.html复制）
    cleanupOAuthUrl() {
        if (window.history && window.history.replaceState) {
            const url = new URL(window.location);
            url.searchParams.delete('code');
            url.searchParams.delete('state');
            url.searchParams.delete('error');
            window.history.replaceState({}, document.title, url.toString());
        }
    }

    // 只更新单个账户的显示，避免重新渲染整个表格
    updateSingleAccountDisplay(accountId) {
        console.log(`[UI更新] 开始更新单个账户显示: ${accountId}`);
        const row = document.querySelector(`[data-account-id="${accountId}"]`);
        console.log(`[UI更��] 找到表格行: ${!!row}`);
        if (row) {
            const account = this.accounts.find(acc => acc.id === accountId);
            console.log(`[UI更新] 找到账户数据: ${!!account}, 账户邮箱: ${account?.email}`);
            if (account) {
                // 更新验证码列 - 修复CSS类名匹配
                const codeCell = row.querySelector('.code-cell');
                console.log(`[UI更新] 找到验证码单元格: ${!!codeCell}`);
                if (codeCell) {
                    const displayContent = this.getVerificationCodeDisplay(account);
                    console.log(`[UI更新] 验证码显示内容: ${displayContent.substring(0, 50)}...`);
                    codeCell.innerHTML = `<div class="flex flex-col ${account.is_new_code ? 'bg-blue-50 border border-blue-300 rounded' : ''}">${displayContent}</div>`;
                    console.log(`[UI更新] 验证码单元格已更新`);
                }

                // 更新验证码时间列 (第6列)
                const timeCell = row.cells && row.cells[5]; // 第6列是验证码时间列，添加安全检查
                if (timeCell) {
                    timeCell.innerHTML = this.getActiveTimeDisplay(account);
                }

                // 更新发件人列 (第7列)
                const senderCell = row.cells && row.cells[6]; // 第7列是发件人列，添加安全检查
                if (senderCell) {
                    senderCell.innerHTML = this.getEmailSenderDisplay(account);
                }

                // 延迟保存，避免频繁写入
                this.debouncedSave();
            }
        }
    }

    // 防抖保存，避免频繁写入localStorage
    debouncedSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveAccounts();
        }, 500); // 500ms延迟
    }

    // KISS批量导入方法
    async batchImportEmails(emailDataList) {
        console.log(`[批量导入] 开始处理 ${emailDataList.length} 个邮箱`);

        // 重置导入完成标志，允许新的导入显示完成状态
        this.importCompletionShown = false;

        // 1. 前端创建账户记录（并发处理提高效率）
        const newAccounts = await Promise.all(emailDataList.map(async (data, i) => {
            // 生成唯一ID
            const accountId = `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            data.id = accountId;

            const account = {
                id: accountId,
                email: data.email,
                client_id: data.client_id,
                refresh_token: data.refresh_token,
                access_token: '',
                status: 'pending',
                created_at: new Date().toISOString(),
                last_checked: new Date().toISOString(),
                email_count: 0,
                verification_code: null,
                sequence: i + 1,
                monitoring_enabled: false,
                codes: [],
                emails: []
            };

            return account;
        }));

        // 批量添加到账户列表
        this.accounts.push(...newAccounts);

        // 2. 立即保存到localStorage并更新界面
        this.saveAccounts();
        this.filteredAccounts = [...this.accounts];
        this.currentPage = 1;
        this.render();
        this.updateStats();

        console.log(`[批量导入] 已创建并保存 ${newAccounts.length} 个账户到前端`);

        // 3. 准备发送给后端的数据
        const emailsData = emailDataList.map(data => ({
            id: data.id, // 前端生成的ID
            email: data.email,
            password: data.password,
            client_id: data.client_id,
            refresh_token: data.refresh_token
        }));

        // 4. 发送到后端处理
        try {
            // 确保sessionId存在
            if (!this.sessionId) {
                const savedSessionId = localStorage.getItem('mail_manager_session_id');
                if (savedSessionId) {
                    this.sessionId = savedSessionId;
                } else {
                    this.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    localStorage.setItem('mail_manager_session_id', this.sessionId);
                }
                console.log(`[批量导��] 会话ID: ${this.sessionId}`);
            }

            const response = await fetch('/api/accounts/batch-import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    emails: emailsData
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`[批量导入] 后端响应:`, result);

            return result;

        } catch (error) {
            console.error(`[批量导入] 请求失败:`, error);
            throw error;
        }
    }

    // 销毁方法
    destroy() {
        // 关闭WebSocket连接
        if (this.websocket) {
            this.websocket.close();
        }

        // 关闭SSE连接
        if (this.eventSource) {
            this.eventSource.close();
        }

        // 清除重连定时器
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
        }
        if (this.sseReconnectTimer) {
            clearTimeout(this.sseReconnectTimer);
        }

        // 清除验证码视觉提示定时器
        if (this.codeDisplayTimer) {
            clearTimeout(this.codeDisplayTimer);
            this.codeDisplayTimer = null;
        }

        console.log('[MailManager] 系统已销毁');
    }

    // 连接状态管理
    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connectionStatus');
        if (!statusElement) return;

        let html = '';
        let className = 'connection-status';

        switch (status) {
            case 'connected':
                className += ' connected';
                html = `
                    <i class="fas fa-wifi"></i>
                    <span>连接正常</span>
                `;
                break;
            case 'connecting':
                className += ' connecting';
                html = `
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>连接中...</span>
                `;
                break;
            case 'disconnected':
                className += ' disconnected';
                html = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>重新连接</span>
                `;
                statusElement.onclick = () => {
                    this.reconnectAll();
                };
                break;
            case 'failed':
                className += ' failed';
                html = `
                    <i class="fas fa-times-circle"></i>
                    <span>连接失败</span>
                `;
                statusElement.onclick = () => {
                    this.reconnectAll();
                };
                break;
            default:
                className += ' connecting';
                html = `
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>连接中...</span>
                `;
        }

        statusElement.className = className;
        statusElement.innerHTML = html;

        console.log(`[连接状态] 状态已更新为: ${status}`);
    }

    // 重新连接所有服务
    reconnectAll() {
        console.log('[连接状态] 用户触发重新连接');
        this.updateConnectionStatus('connecting');

        // 关闭现有连接
        if (this.websocket) {
            this.websocket.close();
        }
        if (this.eventSource) {
            this.eventSource.close();
        }

        // 重置连接状态
        this.wsConnected = false;
        this.sseConnected = false;
        this.wsReconnectAttempts = 0;
        this.sseReconnectAttempts = 0;

        // 重新连接
        setTimeout(() => {
            this.connectWebSocket();
        }, 1000);
    }
}

// 导出到全局作用域
window.SimpleMailManager = SimpleMailManager;