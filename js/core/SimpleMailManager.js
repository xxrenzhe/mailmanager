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

        this.init();
    }

    async init() {
        await this.loadAccounts();
        await this.sequenceManager.initialize(this.accounts);

        // 优先启动WebSocket实时更新
        this.connectWebSocket();

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
            if (window.location.protocol === 'https:') {
                wsUrl = `wss://${window.location.host}/ws?sessionId=${encodeURIComponent(this.sessionId)}`;
            } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                wsUrl = `ws://localhost:3002?sessionId=${encodeURIComponent(this.sessionId)}`;
            } else {
                wsUrl = `ws://${window.location.host}/ws?sessionId=${encodeURIComponent(this.sessionId)}`;
            }

            console.log(`[WebSocket] 连接URL: ${wsUrl}`);
            this.websocket = new WebSocket(wsUrl);

            this.websocket.onopen = () => {
                console.log('[WebSocket] 实时更新连接成功');
                this.wsConnected = true;
                this.wsReconnectAttempts = 0;
                Utils.showNotification('已连接到WebSocket实时更新服务', 'success');

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
                this.attemptReconnect();
            };

            this.websocket.onerror = (error) => {
                console.error('[WebSocket] 连接错误:', error);
                Utils.showNotification('WebSocket连接失败', 'error');
            };

        } catch (error) {
            console.error('[WebSocket] 连接失败:', error);
            Utils.showNotification('无法连接WebSocket实时服务，尝试SSE备用方案', 'warning');
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
            case 'monitoring_ended':
                this.handleMonitoringEvent(data);
                break;

            default:
                console.log(`[WebSocket] 未知事件类型: ${data.type}`);
        }
    }

    // 处理验证码发现事件
    handleVerificationCodeFound(data) {
        console.log(`[验证码] 发现验证码: ${data.email} -> ${data.verification_code}`);

        let account = this.accounts.find(acc => acc.email === data.email);
        if (account) {
            // 确保有codes数组
            if (!account.codes) {
                account.codes = [];
            }

            // 添加新验证码
            account.codes.push({
                code: data.verification_code,
                received_at: data.received_at || new Date().toISOString(),
                subject: data.subject || '',
                from: data.from || ''
            });

            // 更新最新验证码时间
            account.latest_code_time = data.received_at || new Date().toISOString();

            // 保存并更新界面
            this.saveAccounts();
            this.render();
            this.updateStats();

            Utils.showNotification(`发现验证码: ${data.verification_code}`, 'success');
        } else {
            console.warn(`[验证码] 未找到对应账户: ${data.email}`);
        }
    }

    // 处理账户状态变更事件
    handleAccountStatusChanged(data) {
        console.log(`[状态变更] ${data.email}: ${data.old_status} -> ${data.new_status}`);

        let account = this.accounts.find(acc => acc.email === data.email);
        if (account) {
            account.status = data.new_status;
            account.email_count = data.email_count || account.email_count;
            account.last_checked = new Date().toISOString();

            // 保存并更新界面
            this.saveAccounts();
            this.render();
            this.updateStats();

            Utils.showNotification(`${data.email} 状态变更为: ${Utils.getStatusText(data.new_status)}`, 'info');
        }
    }

    // 处理手动取件完成事件
    handleManualFetchComplete(data) {
        console.log(`[手动取件] 完成: ${data.email}`);
        Utils.showNotification(`${data.email} 邮件收取完成`, 'success');

        // 刷新账户数据
        this.refreshData();
    }

    // 处理手动取件错误事件
    handleManualFetchError(data) {
        console.error(`[手动取件] 错误: ${data.email}`, data.error);
        Utils.showNotification(`${data.email} 邮件收取失败: ${data.error}`, 'error');
    }

    // 处理监控事件
    handleMonitoringEvent(data) {
        console.log(`[监控] ${data.type}: ${data.email}`);

        let account = this.accounts.find(acc => acc.email === data.email);
        if (account) {
            if (data.type === 'monitoring_started') {
                account.monitoring = true;
            } else {
                account.monitoring = false;
            }

            this.saveAccounts();
            this.render();
            this.updateStats();
        }
    }

    // 处理导入进度事件
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

            if (account) {
                const oldStatus = account.status;
                account.status = data.status;
                account.email_count = data.email_count || 0;
                account.last_checked = new Date().toISOString();

                this.saveAccounts();
                this.render();
                this.updateStats();

                console.log(`[导入进度] 状态更新完成: ${data.email} (${oldStatus} -> ${data.status})`);
            }
        }

        // 处理导入完成
        if (data.stage === 'completed' && data.message) {
            console.log(`[导入进度] 批量导入完成: ${data.message}`);

            if (window.hideProgressModal) {
                window.hideProgressModal();
            }
            Utils.showNotification(data.message, 'success');
        }
    }

    // 数据持久化方法
    async loadAccounts() {
        try {
            const stored = localStorage.getItem('mailmanager_accounts');
            if (stored) {
                this.accounts = JSON.parse(stored);
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
            console.log(`[数据] 保存了 ${this.accounts.length} 个账户`);
        } catch (error) {
            console.error('[数据] 保存账户数据失败:', error);
        }
    }

    // 账户操作方法
    async addAccount(accountData) {
        try {
            // 生成唯一ID（使用simple-mail-manager.html的方式）
            accountData.id = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
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
        const monitoringAccounts = this.accounts.filter(acc => acc.monitoring).length;

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
            if (field === 'latest_code_time') {
                aVal = aVal ? new Date(aVal).getTime() : 0;
                bVal = bVal ? new Date(bVal).getTime() : 0;
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
                <tr class="hover:bg-gray-50 transition-colors">
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
                                `<button onclick="copyEmailToClipboard('${account.id}')"
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

        // 上一页按钮
        const prevDisabled = this.currentPage === 1 ? 'disabled' : '';
        paginationHTML += `<button class="page-btn" onclick="changePage(-1)" ${prevDisabled}>上一页</button>`;

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

        // 下一页按钮
        const nextDisabled = this.currentPage === totalPages ? 'disabled' : '';
        paginationHTML += `<button class="page-btn" onclick="changePage(1)" ${nextDisabled}>下一页</button>`;

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
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSSEEvent(data);
                } catch (error) {
                    console.error('[SSE] 解析事件数据失败:', error);
                }
            };

            this.eventSource.onerror = () => this.reconnectSSE();

        } catch (error) {
            console.error('[SSE] 连接失败:', error);
            Utils.showNotification('无法连接实时更新服务', 'error');
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
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    
    // 验证码显示逻辑 - 只显示纯数字验证码（从simple-mail-manager.html复制）
    getVerificationCodeDisplay(account) {
        console.log(`[验证码显示] 账户 ${account.email} 数据检查:`, {
            codes: account.codes,
            codesLength: account.codes?.length || 0,
            last_sync: account.last_sync,
            emailsLength: account.emails?.length || 0,
            monitoring_codes_only: account.monitoring_codes_only
        });

        // 如果账户设置了只显示监控期间的验证码，但还没有新验证码，显示"监控中..."
        if (account.monitoring_codes_only && (!account.codes || account.codes.length === 0)) {
            console.log(`[验证码显示] 账户 ${account.email} 监控中，等待新验证码`);
            return '<span class="text-blue-500 text-base animate-pulse">监控中...</span>';
        }

        if (!account.codes || account.codes.length === 0) {
            console.log(`[验证码显示] 账户 ${account.email} 无验证码数据`);
            return '<span class="text-gray-400 text-base">无</span>';
        }

        // 🔧 修复：安全排序，确保显示真正最新的验证码
        const sortedCodes = [...account.codes].sort((a, b) => {
            const timeA = new Date(a.received_at).getTime();
            const timeB = new Date(b.received_at).getTime();
            return timeB - timeA; // 降序，最新的在前
        });

        const latestCode = sortedCodes[0];
        console.log(`[验证码显示] 账户 ${account.email} 排序后最新验证码:`, latestCode);
        console.log(`[验证码显示] 账户 ${account.email} 验证码总数: ${account.codes.length}`);

        // 验证码显示逻辑：只要是从最近5封邮件中提取的验证码就显示
        // 这包括导入时自动获取的验证码和手动同步获取的验证码
        // 不基于时间判断，基于数据来源判断（从最新邮件提取）

        // 如果账户有邮件数据，说明已经进行过邮件同步
        const hasEmailData = account.emails && account.emails.length > 0;

        // 如果账户有last_sync时间戳，说明进行过邮件同步
        const hasBeenSynced = !!account.last_sync;

        console.log(`[验证码显示] 账户 ${account.email} 同步状态:`, {
            hasEmailData,
            hasBeenSynced,
            last_sync: account.last_sync
        });

        // 简化验证码显示逻辑：只要有验证码数据就显示
        // 后端已经成功提取了验证码，应该立即显示
        console.log(`[验证码显示] 账户 ${account.email} 将显示验证码，跳过同步检查`);

        // 检查是否为纯数字验证码
        const isNumericCode = /^\d+$/.test(latestCode.code);

        if (isNumericCode) {
            // 是纯数字验证码
            return `
                <div class="flex items-center gap-2">
                    <span class="text-code cursor-pointer" onclick="copyLatestCode('${account.id}')" title="点击复制验证码">
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

        const latestCode = account.codes[0];

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

        const latestCode = account.codes[0];
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
        Utils.showNotification(data.message || '监控已开始', 'info');
    }

    handleMonitoringProgress(data) {
        console.log('[监控] 监控进度:', data);
        Utils.showNotification(data.message || '监控进行中...', 'info');
    }

    handleMonitoringEnded(data) {
        console.log('[监控] 监控结束:', data);
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
            console.log(`[监控] 开始监控账户: ${account.email}`);

            const response = await fetch('/api/monitoring/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email_id: account.id,
                    email: account.email
                })
            });

            if (response.ok) {
                account.monitoring = true;
                account.status = 'monitoring';
                await this.saveAccounts();
                this.render();

                Utils.showNotification(`开始监控账户: ${account.email}`, 'info');
            } else {
                throw new Error('启动监控失败');
            }
        } catch (error) {
            console.error('[监控] 启动监控失败:', error);
            Utils.showNotification('启动监控失败: ' + error.message, 'error');
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

        console.log('[MailManager] 系统已销毁');
    }
}

// 导出到全局作用域
window.SimpleMailManager = SimpleMailManager;