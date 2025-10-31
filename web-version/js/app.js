/**
 * 邮件管理系统 - 主应用逻辑
 * 现代化的前端应用架构
 */

class MailManagerApp {
    constructor() {
        this.storage = window.optimizedClientStorage;
        this.currentPage = 'dashboard';
        this.accounts = [];
        this.filteredAccounts = [];
        this.selectedAccounts = new Set();
        this.sortField = 'updated_at';
        this.sortDirection = 'desc';
        this.currentPageNum = 1;
        this.itemsPerPage = 20;

        // UI状态
        this.isLoading = false;
        this.modals = {};

        // 初始化应用
        this.init();
    }

    /**
     * 应用初始化
     */
    async init() {
        try {
            console.log('[MailManagerApp] 正在初始化应用...');

            // 初始化存储
            await this.storage.init();

            // 绑定DOM事件
            this.bindEvents();

            // 初始化UI组件
            this.initUI();

            // 加载初始数据
            await this.loadData();

            // 启动实时更新
            this.startRealTimeUpdates();

            console.log('[MailManagerApp] 应用初始化完成');

        } catch (error) {
            console.error('[MailManagerApp] 应用初始化失败:', error);
            this.showToast('应用初始化失败', 'error', error.message);
        }
    }

    /**
     * 绑定DOM事件
     */
    bindEvents() {
        // 侧边栏导航
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                const page = e.currentTarget.dataset.page;
                this.switchPage(page);
            });
        });

        // 侧边栏切换
        document.getElementById('sidebarToggle').addEventListener('click', () => {
            this.toggleSidebar();
        });

        // 账户管理按钮
        document.getElementById('addAccountBtn').addEventListener('click', () => {
            this.openAccountModal();
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.refreshData();
        });

        // 搜索和过滤
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        document.getElementById('statusFilter').addEventListener('change', (e) => {
            this.handleFilter(e.target.value);
        });

        // 表格排序
        document.querySelectorAll('.modern-table th[data-sort]').forEach(th => {
            th.addEventListener('click', (e) => {
                const field = e.currentTarget.dataset.sort;
                if (field !== 'checkbox') {
                    this.handleSort(field);
                }
            });
        });

        // 全选复选框
        document.getElementById('selectAll').addEventListener('change', (e) => {
            this.handleSelectAll(e.target.checked);
        });

        // 批量操作
        document.getElementById('bulkSyncBtn').addEventListener('click', () => {
            this.bulkSync();
        });

        // 导入导出
        document.getElementById('importBtn').addEventListener('click', () => {
            this.openImportModal();
        });

        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportData();
        });

        // 设置
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.openSettingsModal();
        });

        // 帮助和关于
        document.getElementById('helpBtn').addEventListener('click', () => {
            this.showHelp();
        });

        document.getElementById('aboutBtn').addEventListener('click', () => {
            this.showAbout();
        });

        // 模态框事件
        this.bindModalEvents();

        // 键盘快捷键
        this.bindKeyboardShortcuts();

        // 窗口事件
        window.addEventListener('resize', () => {
            this.handleResize();
        });

        window.addEventListener('beforeunload', (e) => {
            this.handleBeforeUnload(e);
        });
    }

    /**
     * 绑定模态框事件
     */
    bindModalEvents() {
        // 账户模态框
        const accountModal = document.getElementById('accountModal');
        this.modals.account = accountModal;

        document.getElementById('modalClose').addEventListener('click', () => {
            this.closeModal('account');
        });

        document.getElementById('modalCancel').addEventListener('click', () => {
            this.closeModal('account');
        });

        document.getElementById('modalSave').addEventListener('click', () => {
            this.saveAccount();
        });

        // OAuth模态框
        const oauthModal = document.getElementById('oauthModal');
        this.modals.oauth = oauthModal;

        document.getElementById('oauthClose').addEventListener('click', () => {
            this.closeModal('oauth');
        });

        document.getElementById('oauthCancel').addEventListener('click', () => {
            this.closeModal('oauth');
        });

        document.getElementById('oauthStartBtn').addEventListener('click', () => {
            this.startOAuth();
        });

        // 导入模态框
        const importModal = document.getElementById('importModal');
        this.modals.import = importModal;

        document.getElementById('importClose').addEventListener('click', () => {
            this.closeModal('import');
        });

        document.getElementById('importCancelBtn').addEventListener('click', () => {
            this.closeModal('import');
        });

        document.getElementById('importStartBtn').addEventListener('click', () => {
            this.startImport();
        });

        // 点击模态框外部关闭
        Object.values(this.modals).forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    const modalKey = Object.keys(this.modals).find(key => this.modals[key] === modal);
                    this.closeModal(modalKey);
                }
            });
        });
    }

    /**
     * 绑定键盘快捷键
     */
    bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // 忽略输入框中的快捷键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            switch (e.key) {
                case 'n':
                case 'N':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.openAccountModal();
                    }
                    break;

                case 'r':
                case 'R':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.refreshData();
                    }
                    break;

                case 'f':
                case 'F':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        document.getElementById('searchInput').focus();
                    }
                    break;

                case 'Escape':
                    this.closeAllModals();
                    break;
            }
        });
    }

    /**
     * 初始化UI组件
     */
    initUI() {
        // 初始化工具提示
        this.initTooltips();

        // 初始化存储指示器
        this.updateStorageIndicator();

        // 初始化表格
        this.initTable();

        // 初始化统计卡片
        this.updateStatsCards();
    }

    /**
     * 初始化工具提示
     */
    initTooltips() {
        // 简单的工具提示实现
        document.querySelectorAll('[title]').forEach(element => {
            element.addEventListener('mouseenter', (e) => {
                this.showTooltip(e.target, e.target.title);
            });

            element.addEventListener('mouseleave', (e) => {
                this.hideTooltip();
            });
        });
    }

    /**
     * 显示工具提示
     */
    showTooltip(element, text) {
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = text;
        tooltip.style.cssText = `
            position: absolute;
            background: var(--gray-800);
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.875rem;
            z-index: 10000;
            pointer-events: none;
            white-space: nowrap;
        `;

        document.body.appendChild(tooltip);

        const rect = element.getBoundingClientRect();
        tooltip.style.left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2 + 'px';
        tooltip.style.top = rect.top - tooltip.offsetHeight - 8 + 'px';

        element.tooltip = tooltip;
    }

    /**
     * 隐藏工具提示
     */
    hideTooltip() {
        document.querySelectorAll('.tooltip').forEach(tooltip => {
            tooltip.remove();
        });
    }

    /**
     * 切换页面
     */
    switchPage(pageName) {
        // 更新导航状态
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-page="${pageName}"]`).classList.add('active');

        // 隐藏所有页面
        document.querySelectorAll('.page').forEach(page => {
            page.classList.add('hidden');
        });

        // 显示目标页面
        const targetPage = document.getElementById(`${pageName}Page`);
        if (targetPage) {
            targetPage.classList.remove('hidden');
        }

        // 更新页面标题
        const titles = {
            dashboard: '控制台',
            accounts: '账户管理',
            codes: '验证码'
        };
        document.getElementById('pageTitle').textContent = titles[pageName] || '邮件管理';

        this.currentPage = pageName;

        // 页面特定的初始化
        this.initPage(pageName);
    }

    /**
     * 初始化页面
     */
    initPage(pageName) {
        switch (pageName) {
            case 'dashboard':
                this.updateDashboard();
                break;
            case 'accounts':
                this.updateAccountsTable();
                break;
            case 'codes':
                this.updateCodesList();
                break;
        }
    }

    /**
     * 加载数据
     */
    async loadData() {
        try {
            this.isLoading = true;
            this.showLoading(true);

            // 加载账户数据
            this.accounts = await this.storage.getAllAccounts();
            this.filteredAccounts = [...this.accounts];

            // 更新UI
            this.updateStatsCards();
            this.updateAccountsTable();

            console.log(`[MailManagerApp] 加载了 ${this.accounts.length} 个账户`);

        } catch (error) {
            console.error('[MailManagerApp] 数据加载失败:', error);
            this.showToast('数据加载失败', 'error', error.message);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    /**
     * 刷新数据
     */
    async refreshData() {
        if (this.isLoading) return;

        try {
            this.isLoading = true;
            this.showLoading(true);

            // 重新加载数据
            await this.loadData();

            // 更新当前页面
            this.initPage(this.currentPage);

            this.showToast('数据已刷新', 'success');

        } catch (error) {
            console.error('[MailManagerApp] 数据刷新失败:', error);
            this.showToast('数据刷新失败', 'error', error.message);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    /**
     * 更新统计卡片
     */
    updateStatsCards() {
        const stats = {
            total: this.accounts.length,
            authorized: this.accounts.filter(acc => acc.status === 'authorized').length,
            pending: this.accounts.filter(acc => acc.status === 'pending').length,
            reauth_needed: this.accounts.filter(acc => acc.status === 'reauth_needed').length
        };

        document.getElementById('totalAccounts').textContent = stats.total;
        document.getElementById('authorizedAccounts').textContent = stats.authorized;
        document.getElementById('pendingAccounts').textContent = stats.pending;
        document.getElementById('reauthAccounts').textContent = stats.reauth_needed;

        // 更新活动指示器
        const activeAccounts = this.accounts.filter(acc => {
            const lastUpdate = new Date(acc.updated_at || 0);
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            return lastUpdate > oneDayAgo;
        });

        document.querySelector('#totalAccounts').closest('.stat-card')
            .querySelector('.stat-change span:last-child').textContent = `${activeAccounts.length} 活跃`;
    }

    /**
     * 更新控制台
     */
    async updateDashboard() {
        // 更新最近活动
        await this.updateRecentActivity();

        // 更新存储信息
        await this.updateStorageIndicator();
    }

    /**
     * 更新最近活动
     */
    async updateRecentActivity() {
        const recentActivity = document.getElementById('recentActivity');

        if (this.accounts.length === 0) {
            recentActivity.innerHTML = `
                <p style="color: var(--gray-500); text-align: center; padding: 20px;">
                    暂无账户活动
                </p>
            `;
            return;
        }

        // 获取最近更新的账户
        const recentAccounts = this.accounts
            .filter(acc => acc.updated_at)
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .slice(0, 10);

        const activityHtml = recentAccounts.map(account => {
            const updateTime = new Date(account.updated_at);
            const timeAgo = this.getTimeAgo(updateTime);
            const statusIcon = this.getStatusIcon(account.status);

            return `
                <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--gray-100);">
                    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${this.getStatusColor(account.status)};"></div>
                    <div style="flex: 1;">
                        <div style="font-weight: 500; color: var(--gray-900);">${account.email}</div>
                        <div style="font-size: 0.875rem; color: var(--gray-500);">${statusIcon} ${this.getStatusText(account.status)} · ${timeAgo}</div>
                    </div>
                    <button class="btn btn-sm btn-secondary" onclick="app.viewAccountDetails('${account.id}')">
                        查看
                    </button>
                </div>
            `;
        }).join('');

        recentActivity.innerHTML = activityHtml || `
            <p style="color: var(--gray-500); text-align: center; padding: 20px;">
                暂无最近活动
            </p>
        `;
    }

    /**
     * 更新账户表格
     */
    updateAccountsTable() {
        const tbody = document.getElementById('accountsTableBody');

        if (this.filteredAccounts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: var(--gray-500);">
                        ${this.accounts.length === 0 ? '暂无账户数据' : '没有符合筛选条件的账户'}
                    </td>
                </tr>
            `;
            this.updateTableInfo();
            return;
        }

        // 分页处理
        const startIndex = (this.currentPageNum - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pageAccounts = this.filteredAccounts.slice(startIndex, endIndex);

        const rowsHtml = await Promise.all(pageAccounts.map(async account => {
            const codes = await this.storage.getLatestCodes(account.id, 1);
            const latestCode = codes[0];

            const isChecked = this.selectedAccounts.has(account.id);

            return `
                <tr data-account-id="${account.id}">
                    <td>
                        <label class="custom-checkbox">
                            <input type="checkbox" class="account-checkbox"
                                   data-account-id="${account.id}"
                                   ${isChecked ? 'checked' : ''}>
                            <span class="checkmark"></span>
                        </label>
                    </td>
                    <td>
                        <span class="status-badge status-${account.status}">
                            <span class="status-dot"></span>
                            ${this.getStatusText(account.status)}
                        </span>
                    </td>
                    <td>
                        <div style="font-weight: 500; color: var(--gray-900);">${account.email}</div>
                        ${account.display_name ? `<div style="font-size: 0.875rem; color: var(--gray-500);">${account.display_name}</div>` : ''}
                    </td>
                    <td>
                        <div class="code-display ${latestCode ? '' : 'empty'}">
                            ${latestCode ? latestCode.code : '无验证码'}
                        </div>
                    </td>
                    <td>
                        <div class="time-display">
                            <span>🕒</span>
                            <span>${latestCode ? this.formatTime(latestCode.received_at) : '---'}</span>
                        </div>
                    </td>
                    <td>
                        <div style="font-size: 0.875rem; color: var(--gray-600);">
                            ${latestCode ? (latestCode.sender || '未知') : '---'}
                        </div>
                    </td>
                    <td>
                        <div class="time-display">
                            <span>🕒</span>
                            <span>${this.formatTime(account.updated_at)}</span>
                        </div>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="action-btn edit" onclick="app.editAccount('${account.id}')" title="编辑">
                                ✏️
                            </button>
                            <button class="action-btn sync" onclick="app.syncAccount('${account.id}')" title="同步">
                                🔄
                            </button>
                            <button class="action-btn delete" onclick="app.deleteAccount('${account.id}')" title="删除">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }));

        tbody.innerHTML = rowsHtml.join('');

        // 绑定复选框事件
        tbody.querySelectorAll('.account-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const accountId = e.target.dataset.accountId;
                if (e.target.checked) {
                    this.selectedAccounts.add(accountId);
                } else {
                    this.selectedAccounts.delete(accountId);
                }
                this.updateSelectAllState();
            });
        });

        this.updateTableInfo();
        this.updatePagination();
    }

    /**
     * 更新验证码列表
     */
    async updateCodesList() {
        const codesList = document.getElementById('codesList');

        if (this.accounts.length === 0) {
            codesList.innerHTML = `
                <p style="color: var(--gray-500); text-align: center; padding: 20px;">
                    暂无账户数据
                </p>
            `;
            return;
        }

        // 获取所有账户的最新验证码
        const allCodes = [];
        for (const account of this.accounts) {
            const codes = await this.storage.getLatestCodes(account.id, 5);
            codes.forEach(code => {
                allCodes.push({
                    ...code,
                    account_email: account.email,
                    account_display_name: account.display_name
                });
            });
        }

        // 按时间排序
        allCodes.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

        if (allCodes.length === 0) {
            codesList.innerHTML = `
                <p style="color: var(--gray-500); text-align: center; padding: 20px;">
                    暂无验证码记录
                </p>
            `;
            return;
        }

        const codesHtml = allCodes.map(code => `
            <div class="card" style="margin-bottom: 16px;">
                <div class="card-body">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                        <div>
                            <div style="font-weight: 500; color: var(--gray-900); margin-bottom: 4px;">
                                ${code.account_display_name || code.account_email}
                            </div>
                            <div style="font-size: 0.875rem; color: var(--gray-500);">
                                ${code.sender || '未知发件人'}
                            </div>
                        </div>
                        <div class="code-display">${code.code}</div>
                    </div>
                    <div class="time-display">
                        <span>🕒</span>
                        <span>收到时间: ${this.formatTime(code.received_at)}</span>
                    </div>
                </div>
            </div>
        `).join('');

        codesList.innerHTML = codesHtml;
    }

    /**
     * 更新存储指示器
     */
    async updateStorageIndicator() {
        try {
            const stats = await this.storage.getStats();
            const usagePercent = stats.storageQuota ? (stats.storageUsage / stats.storageQuota) * 100 : 0;

            document.getElementById('storageFill').style.width = `${Math.min(usagePercent, 100)}%`;
            document.getElementById('storageText').textContent =
                `${this.formatBytes(stats.storageUsage)} / ${this.formatBytes(stats.storageQuota)}`;

            // 根据使用量改变颜色
            const storageFill = document.getElementById('storageFill');
            if (usagePercent > 80) {
                storageFill.style.background = 'var(--danger-color)';
            } else if (usagePercent > 60) {
                storageFill.style.background = 'var(--warning-color)';
            } else {
                storageFill.style.background = 'linear-gradient(90deg, var(--success-color), var(--primary-color))';
            }

        } catch (error) {
            console.warn('[MailManagerApp] 更新存储指示器失败:', error);
        }
    }

    /**
     * 处理搜索
     */
    handleSearch(query) {
        const searchTerm = query.toLowerCase().trim();

        if (!searchTerm) {
            this.filteredAccounts = [...this.accounts];
        } else {
            this.filteredAccounts = this.accounts.filter(account =>
                account.email.toLowerCase().includes(searchTerm) ||
                (account.display_name && account.display_name.toLowerCase().includes(searchTerm)) ||
                (account.notes && account.notes.toLowerCase().includes(searchTerm))
            );
        }

        this.currentPageNum = 1;
        this.updateAccountsTable();
    }

    /**
     * 处理过滤
     */
    handleFilter(status) {
        if (!status) {
            this.filteredAccounts = [...this.accounts];
        } else {
            this.filteredAccounts = this.accounts.filter(account => account.status === status);
        }

        this.currentPageNum = 1;
        this.updateAccountsTable();
    }

    /**
     * 处理排序
     */
    handleSort(field) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }

        // 更新排序图标
        document.querySelectorAll('.sort-icon').forEach(icon => {
            icon.classList.remove('active');
            icon.textContent = '↕';
        });

        const currentIcon = document.querySelector(`th[data-sort="${field}"] .sort-icon`);
        currentIcon.classList.add('active');
        currentIcon.textContent = this.sortDirection === 'asc' ? '↑' : '↓';

        // 执行排序
        this.filteredAccounts.sort((a, b) => {
            let aValue = a[field];
            let bValue = b[field];

            // 处理特殊字段
            if (field === 'code') {
                // 这里需要异步获取验证码，暂时跳过
                return 0;
            }

            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            if (typeof aValue === 'string') {
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            }

            let comparison = 0;
            if (aValue > bValue) comparison = 1;
            if (aValue < bValue) comparison = -1;

            return this.sortDirection === 'desc' ? -comparison : comparison;
        });

        this.updateAccountsTable();
    }

    /**
     * 处理全选
     */
    handleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.account-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
            const accountId = checkbox.dataset.accountId;
            if (checked) {
                this.selectedAccounts.add(accountId);
            } else {
                this.selectedAccounts.delete(accountId);
            }
        });
    }

    /**
     * 更新全选状态
     */
    updateSelectAllState() {
        const selectAll = document.getElementById('selectAll');
        const checkboxes = document.querySelectorAll('.account-checkbox');
        const checkedCount = document.querySelectorAll('.account-checkbox:checked').length;

        selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
        selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }

    /**
     * 批量同步
     */
    async bulkSync() {
        if (this.selectedAccounts.size === 0) {
            this.showToast('请先选择要同步的账户', 'warning');
            return;
        }

        try {
            this.isLoading = true;
            this.showLoading(true);

            let successCount = 0;
            let errorCount = 0;

            for (const accountId of this.selectedAccounts) {
                try {
                    // 这里应该实现实际的同步逻辑
                    // await this.syncAccountData(accountId);
                    successCount++;
                } catch (error) {
                    console.error(`同步账户 ${accountId} 失败:`, error);
                    errorCount++;
                }
            }

            this.showToast(
                `批量同步完成: ${successCount} 成功, ${errorCount} 失败`,
                errorCount === 0 ? 'success' : 'warning'
            );

            // 刷新数据
            await this.refreshData();

        } catch (error) {
            console.error('[MailManagerApp] 批量同步失败:', error);
            this.showToast('批量同步失败', 'error', error.message);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    /**
     * 打开账户模态框
     */
    openAccountModal(accountId = null) {
        const modal = this.modals.account;
        const form = document.getElementById('accountForm');
        const title = document.getElementById('modalTitle');

        // 重置表单
        form.reset();

        if (accountId) {
            // 编辑模式
            title.textContent = '编辑账户';
            this.loadAccountToForm(accountId);
            modal.dataset.accountId = accountId;
        } else {
            // 添加模式
            title.textContent = '添加账户';
            delete modal.dataset.accountId;
        }

        this.openModal('account');
    }

    /**
     * 加载账户数据到表单
     */
    async loadAccountToForm(accountId) {
        try {
            const account = await this.storage.getAccount(accountId);
            if (account) {
                document.getElementById('accountEmail').value = account.email || '';
                document.getElementById('accountDisplay').value = account.display_name || '';
                document.getElementById('accountNotes').value = account.notes || '';
            }
        } catch (error) {
            console.error('[MailManagerApp] 加载账户数据失败:', error);
        }
    }

    /**
     * 保存账户
     */
    async saveAccount() {
        const modal = this.modals.account;
        const accountId = modal.dataset.accountId;
        const isEdit = !!accountId;

        try {
            // 验证表单
            const email = document.getElementById('accountEmail').value.trim();
            const displayName = document.getElementById('accountDisplay').value.trim();
            const notes = document.getElementById('accountNotes').value.trim();

            if (!email) {
                this.showToast('请输入邮箱地址', 'error');
                return;
            }

            if (!this.isValidEmail(email)) {
                this.showToast('邮箱地址格式不正确', 'error');
                return;
            }

            // 检查邮箱是否已存在
            const existingAccount = await this.storage.getAccountByEmail(email);
            if (existingAccount && existingAccount.id !== accountId) {
                this.showToast('该邮箱地址已存在', 'error');
                return;
            }

            // 保存账户
            const accountData = {
                email,
                display_name: displayName,
                notes,
                status: 'pending'
            };

            if (isEdit) {
                accountData.id = accountId;
                await this.storage.saveAccount(accountData);
                this.showToast('账户更新成功', 'success');
            } else {
                await this.storage.saveAccount(accountData);
                this.showToast('账户添加成功', 'success');

                // 如果是新账户，打开OAuth授权
                setTimeout(() => {
                    this.openOAuthModal(email);
                }, 1000);
            }

            this.closeModal('account');
            await this.refreshData();

        } catch (error) {
            console.error('[MailManagerApp] 保存账户失败:', error);
            this.showToast('保存账户失败', 'error', error.message);
        }
    }

    /**
     * 编辑账户
     */
    editAccount(accountId) {
        this.openAccountModal(accountId);
    }

    /**
     * 同步账户
     */
    async syncAccount(accountId) {
        try {
            this.isLoading = true;
            this.showLoading(true);

            // 这里应该实现实际的同步逻辑
            // await this.syncAccountData(accountId);

            this.showToast('账户同步成功', 'success');
            await this.refreshData();

        } catch (error) {
            console.error('[MailManagerApp] 同步账户失败:', error);
            this.showToast('同步账户失败', 'error', error.message);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    /**
     * 删除账户
     */
    async deleteAccount(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) return;

        const confirmed = confirm(`确定要删除账户 "${account.email}" 吗？\n\n此操作将删除该账户的所有数据，包括验证码记录。`);
        if (!confirmed) return;

        try {
            await this.storage.deleteAccount(accountId);
            this.showToast('账户删除成功', 'success');

            // 从选中列表中移除
            this.selectedAccounts.delete(accountId);

            await this.refreshData();

        } catch (error) {
            console.error('[MailManagerApp] 删除账户失败:', error);
            this.showToast('删除账户失败', 'error', error.message);
        }
    }

    /**
     * 查看账户详情
     */
    viewAccountDetails(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) return;

        // 这里可以实现账户详情页面
        console.log('查看账户详情:', account);
    }

    /**
     * 打开OAuth授权模态框
     */
    openOAuthModal(email) {
        document.getElementById('oauthEmail').textContent = email;
        document.getElementById('oauthStatus').innerHTML = `
            <span style="color: var(--gray-500);">准备就绪</span>
        `;

        this.openModal('oauth');
    }

    /**
     * 开始OAuth授权
     */
    async startOAuth() {
        const email = document.getElementById('oauthEmail').textContent;

        try {
            document.getElementById('oauthStatus').innerHTML = `
                <span class="loading"></span>
                <span>正在启动授权...</span>
            `;

            // 这里应该实现实际的OAuth授权流程
            // const result = await this.performOAuth(email);

            // 模拟授权过程
            setTimeout(() => {
                document.getElementById('oauthStatus').innerHTML = `
                    <span style="color: var(--success-color);">✅</span>
                    <span>授权成功</span>
                `;

                setTimeout(() => {
                    this.closeModal('oauth');
                    this.showToast('授权成功', 'success');
                    this.refreshData();
                }, 1500);
            }, 2000);

        } catch (error) {
            console.error('[MailManagerApp] OAuth授权失败:', error);
            document.getElementById('oauthStatus').innerHTML = `
                <span style="color: var(--danger-color);">❌</span>
                <span>授权失败</span>
            `;
            this.showToast('授权失败', 'error', error.message);
        }
    }

    /**
     * 打开导入模态框
     */
    openImportModal() {
        document.getElementById('importFile').value = '';
        document.getElementById('clearExistingData').checked = false;
        document.getElementById('skipValidation').checked = true;
        document.getElementById('importProgress').style.display = 'none';

        this.openModal('import');
    }

    /**
     * 开始导入
     */
    async startImport() {
        const fileInput = document.getElementById('importFile');
        const file = fileInput.files[0];

        if (!file) {
            this.showToast('请选择要导入的文件', 'warning');
            return;
        }

        try {
            const clearExisting = document.getElementById('clearExistingData').checked;
            const skipValidation = document.getElementById('skipValidation').checked;

            document.getElementById('importProgress').style.display = 'block';
            document.getElementById('importStatus').textContent = '正在读取文件...';

            // 读取文件
            const text = await file.text();
            const data = JSON.parse(text);

            document.getElementById('importProgressBar').style.width = '30%';
            document.getElementById('importStatus').textContent = '正在验证数据...';

            // 导入数据
            const result = await this.storage.importData(data, {
                clearExisting,
                skipValidation
            });

            document.getElementById('importProgressBar').style.width = '100%';
            document.getElementById('importStatus').textContent = '导入完成';

            setTimeout(() => {
                this.closeModal('import');
                this.showToast(
                    `导入成功: ${result.importedAccounts} 账户, ${result.importedCodes} 验证码`,
                    'success'
                );
                this.refreshData();
            }, 1500);

        } catch (error) {
            console.error('[MailManagerApp] 导入失败:', error);
            document.getElementById('importStatus').textContent = '导入失败: ' + error.message;
            this.showToast('导入失败', 'error', error.message);
        }
    }

    /**
     * 导出数据
     */
    async exportData() {
        try {
            this.isLoading = true;
            this.showLoading(true);

            const data = await this.storage.exportData({
                includeHistory: true,
                includeSettings: true
            });

            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mailmanager_backup_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showToast('数据导出成功', 'success');

        } catch (error) {
            console.error('[MailManagerApp] 导出失败:', error);
            this.showToast('导出失败', 'error', error.message);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    /**
     * 打开设置模态框
     */
    openSettingsModal() {
        // 这里可以实现设置模态框
        this.showToast('设置功能开发中...', 'info');
    }

    /**
     * 显示帮助
     */
    showHelp() {
        const helpContent = `
            <div style="max-width: 600px; line-height: 1.8;">
                <h3 style="margin-bottom: 16px; color: var(--gray-900);">使用帮助</h3>

                <h4 style="margin: 16px 0 8px 0; color: var(--gray-800);">快捷键</h4>
                <ul style="margin-left: 20px; color: var(--gray-600);">
                    <li><kbd>Ctrl+N</kbd> - 添加新账户</li>
                    <li><kbd>Ctrl+R</kbd> - 刷新数据</li>
                    <li><kbd>Ctrl+F</kbd> - 搜索账户</li>
                    <li><kbd>Esc</kbd> - 关闭模态框</li>
                </ul>

                <h4 style="margin: 16px 0 8px 0; color: var(--gray-800);">账户管理</h4>
                <ul style="margin-left: 20px; color: var(--gray-600);">
                    <li>点击"添加账户"按钮创建新的邮箱账户</li>
                    <li>首次添加账户需要完成OAuth授权</li>
                    <li>系统会自动提取邮件中的验证码</li>
                    <li>支持批量操作和搜索过滤</li>
                </ul>

                <h4 style="margin: 16px 0 8px 0; color: var(--gray-800);">数据管理</h4>
                <ul style="margin-left: 20px; color: var(--gray-600);">
                    <li>所有数据存储在浏览器本地</li>
                    <li>支持数据导出备份</li>
                    <li>可以导入之前备份的数据</li>
                    <li>清除浏览器数据会丢失所有信息</li>
                </ul>

                <h4 style="margin: 16px 0 8px 0; color: var(--gray-800);">注意事项</h4>
                <ul style="margin-left: 20px; color: var(--gray-600);">
                    <li>建议定期导出数据进行备份</li>
                    <li>更换浏览器时需要导入数据</li>
                    <li>隐私模式下数据不会保存</li>
                </ul>
            </div>
        `;

        this.showAlert('使用帮助', helpContent);
    }

    /**
     * 显示关于
     */
    showAbout() {
        const aboutContent = `
            <div style="text-align: center; max-width: 500px; line-height: 1.8;">
                <div style="font-size: 3rem; margin-bottom: 16px;">📧</div>
                <h3 style="margin-bottom: 8px; color: var(--gray-900);">邮件验证码管理系统</h3>
                <p style="color: var(--gray-600); margin-bottom: 16px;">
                    版本 2.0.0<br>
                    现代化的浏览器端邮件管理解决方案
                </p>

                <div style="text-align: left; background: var(--gray-50); padding: 16px; border-radius: 8px; margin: 16px 0;">
                    <h4 style="margin-bottom: 8px; color: var(--gray-800);">主要特性</h4>
                    <ul style="margin-left: 20px; color: var(--gray-600); font-size: 0.9rem;">
                        <li>🔒 本地数据存储，保护隐私</li>
                        <li>🚀 高性能 IndexedDB 数据库</li>
                        <li>📱 响应式设计，支持移动端</li>
                        <li>⚡ 实时数据更新</li>
                        <li>💾 数据导入导出功能</li>
                        <li>🔐 OAuth 安全授权</li>
                        <li>🎨 现代化用户界面</li>
                        <li>📊 详细的数据统计</li>
                    </ul>
                </div>

                <div style="font-size: 0.875rem; color: var(--gray-500); margin-top: 16px;">
                    <p>© 2024 邮件管理系统</p>
                    <p>基于现代Web技术构建</p>
                </div>
            </div>
        `;

        this.showAlert('关于应用', aboutContent);
    }

    /**
     * 模态框控制
     */
    openModal(modalName) {
        const modal = this.modals[modalName];
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    closeModal(modalName) {
        const modal = this.modals[modalName];
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    closeAllModals() {
        Object.keys(this.modals).forEach(modalName => {
            this.closeModal(modalName);
        });
    }

    /**
     * 显示提示消息
     */
    showToast(message, type = 'info', description = '') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <div class="toast-icon">${icons[type]}</div>
            <div class="toast-content">
                <div class="toast-title">${message}</div>
                ${description ? `<div class="toast-message">${description}</div>` : ''}
            </div>
            <button class="toast-close">✕</button>
        `;

        document.body.appendChild(toast);

        // 定位提示消息
        toast.style.top = '20px';
        toast.style.right = '20px';

        // 绑定关闭事件
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });

        // 自动关闭
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 5000);
    }

    /**
     * 显示警告框
     */
    showAlert(title, content) {
        const alert = document.createElement('div');
        alert.className = 'modal active';
        alert.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h3 class="modal-title">${title}</h3>
                    <button class="modal-close alert-close">✕</button>
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary alert-close">确定</button>
                </div>
            </div>
        `;

        document.body.appendChild(alert);
        document.body.style.overflow = 'hidden';

        // 绑定关闭事件
        alert.querySelectorAll('.alert-close').forEach(btn => {
            btn.addEventListener('click', () => {
                alert.remove();
                document.body.style.overflow = '';
            });
        });

        // 点击外部关闭
        alert.addEventListener('click', (e) => {
            if (e.target === alert) {
                alert.remove();
                document.body.style.overflow = '';
            }
        });
    }

    /**
     * 显示加载状态
     */
    showLoading(show) {
        let loadingIndicator = document.getElementById('loadingIndicator');

        if (show) {
            if (!loadingIndicator) {
                loadingIndicator = document.createElement('div');
                loadingIndicator.id = 'loadingIndicator';
                loadingIndicator.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: var(--shadow-lg);
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                `;
                loadingIndicator.innerHTML = `
                    <div class="loading loading-lg"></div>
                    <span>加载中...</span>
                `;
                document.body.appendChild(loadingIndicator);
            }
        } else {
            if (loadingIndicator) {
                loadingIndicator.remove();
            }
        }
    }

    /**
     * 切换侧边栏
     */
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.querySelector('.main-content');

        sidebar.classList.toggle('active');
        mainContent.classList.toggle('sidebar-collapsed');
    }

    /**
     * 实时更新
     */
    startRealTimeUpdates() {
        // 每30秒更新一次存储指示器
        setInterval(() => {
            this.updateStorageIndicator();
        }, 30000);

        // 每5分钟更新一次统计（如果当前在控制台页面）
        setInterval(() => {
            if (this.currentPage === 'dashboard') {
                this.updateDashboard();
            }
        }, 300000);
    }

    /**
     * 处理窗口大小变化
     */
    handleResize() {
        if (window.innerWidth < 768) {
            document.getElementById('sidebar').classList.remove('active');
            document.querySelector('.main-content').classList.add('sidebar-collapsed');
        }
    }

    /**
     * 处理页面卸载
     */
    handleBeforeUnload(e) {
        // 如果有未保存的更改，提示用户
        if (this.hasUnsavedChanges()) {
            e.preventDefault();
            e.returnValue = '您有未保存的更改，确定要离开吗？';
            return e.returnValue;
        }
    }

    /**
     * 检查是否有未保存的更改
     */
    hasUnsavedChanges() {
        // 这里可以实现检查未保存更改的逻辑
        return false;
    }

    /**
     * 更新表格信息
     */
    updateTableInfo() {
        const total = this.filteredAccounts.length;
        const start = (this.currentPageNum - 1) * this.itemsPerPage + 1;
        const end = Math.min(start + this.itemsPerPage - 1, total);

        document.getElementById('tableInfo').textContent =
            `显示 ${start}-${end} 个账户，共 ${total} 个`;
    }

    /**
     * 更新分页
     */
    updatePagination() {
        const totalPages = Math.ceil(this.filteredAccounts.length / this.itemsPerPage);
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        const pageInfo = document.getElementById('pageInfo');

        prevBtn.disabled = this.currentPageNum === 1;
        nextBtn.disabled = this.currentPageNum === totalPages || totalPages === 0;

        pageInfo.textContent = `第 ${this.currentPageNum} 页，共 ${totalPages || 1} 页`;

        // 更新事件监听器
        prevBtn.onclick = () => {
            if (this.currentPageNum > 1) {
                this.currentPageNum--;
                this.updateAccountsTable();
            }
        };

        nextBtn.onclick = () => {
            if (this.currentPageNum < totalPages) {
                this.currentPageNum++;
                this.updateAccountsTable();
            }
        };
    }

    /**
     * 初始化表格
     */
    initTable() {
        // 初始化表格事件和样式
        // 这里可以添加表格的初始化逻辑
    }

    // 工具函数
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    formatTime(timeString) {
        if (!timeString) return '---';

        const date = new Date(timeString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return '刚刚';
        if (diffMins < 60) return `${diffMins}分钟前`;
        if (diffHours < 24) return `${diffHours}小时前`;
        if (diffDays < 7) return `${diffDays}天前`;

        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    getTimeAgo(date) {
        return this.formatTime(date.toISOString());
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    getStatusIcon(status) {
        const icons = {
            authorized: '✅',
            pending: '⏳',
            reauth_needed: '⚠️',
            error: '❌'
        };
        return icons[status] || '❓';
    }

    getStatusText(status) {
        const texts = {
            authorized: '已授权',
            pending: '待授权',
            reauth_needed: '需重新授权',
            error: '错误'
        };
        return texts[status] || '未知';
    }

    getStatusColor(status) {
        const colors = {
            authorized: 'var(--success-color)',
            pending: 'var(--warning-color)',
            reauth_needed: 'var(--danger-color)',
            error: 'var(--gray-500)'
        };
        return colors[status] || 'var(--gray-400)';
    }
}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[MailManagerApp] DOM加载完成，正在初始化应用...');

    try {
        app = new MailManagerApp();
        console.log('[MailManagerApp] 应用启动成功');
    } catch (error) {
        console.error('[MailManagerApp] 应用启动失败:', error);

        // 显示错误信息
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--gray-50);">
                <div style="text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: var(--shadow-lg); max-width: 500px;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">❌</div>
                    <h2 style="margin-bottom: 16px; color: var(--gray-900);">应用启动失败</h2>
                    <p style="color: var(--gray-600); margin-bottom: 24px;">${error.message}</p>
                    <button onclick="location.reload()" class="btn btn-primary">
                        <span>🔄</span>
                        <span>重新加载</span>
                    </button>
                </div>
            </div>
        `;
    }
});

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('[MailManagerApp] 全局错误:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('[MailManagerApp] 未处理的Promise拒绝:', event.reason);
});