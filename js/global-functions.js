/**
 * MailManager - 全局函数文件
 * 包含所有需要在HTML onclick事件中调用的函数
 */

// 安全的元素操作辅助函数
function safeSetDisplay(elementId, displayValue) {
    const element = document.getElementById(elementId);
    if (element) {
        // 如果要显示，需要移除modal-hidden和hidden类
        if (displayValue === 'flex') {
            element.classList.remove('modal-hidden', 'hidden');
        }
        element.style.display = displayValue;
    }
}

function safeSetTextContent(elementId, text) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
    }
}

// 批量导入相关函数 - 来自simple-mail-manager.html的简化实现
function showImportModal() {
    const modal = document.getElementById('importModal');
    if (modal) {
        modal.classList.remove('modal-hidden', 'hidden');
        modal.style.display = 'flex';

        const textarea = document.getElementById('importTextarea');
        if (textarea) {
            textarea.focus();
        }
    }
}

function hideImportModal() {
    document.getElementById('importModal').style.display = 'none';
    const textarea = document.getElementById('importTextarea');
    if (textarea) {
        textarea.value = '';
    }
}

function showProgressModal() {
    // 重置状态为导入中
    const importingStatus = document.getElementById('importingStatus');
    const importCompleteStatus = document.getElementById('importCompleteStatus');
    const importCloseButton = document.getElementById('importCloseButton');
    const importProgressModal = document.getElementById('importProgressModal');

    if (importingStatus) importingStatus.classList.remove('hidden');
    if (importCompleteStatus) importCompleteStatus.classList.add('hidden');
    if (importCloseButton) importCloseButton.classList.add('hidden');

    // 使用safeSetDisplay来正确显示弹窗
    if (importProgressModal) {
        importProgressModal.classList.remove('modal-hidden', 'hidden');
        importProgressModal.style.display = 'flex';
    }
}

function hideProgressModal() {
    safeSetDisplay('importProgressModal', 'none');
}

function closeImportProgressModal() {
    hideProgressModal();
    // 刷新界面显示导入的账户
    if (window.manager) {
        window.manager.filteredAccounts = [...window.manager.accounts];
        window.manager.render();
        window.manager.updateStats();
    }
}

function showImportComplete(successCount, errorCount) {
    // 显示完成状态
    document.getElementById('importingStatus').classList.add('hidden');
    document.getElementById('importCompleteStatus').classList.remove('hidden');
    document.getElementById('importCloseButton').classList.remove('hidden');

    // 设置结果文本
    const resultText = `成功: ${successCount} 个\n失败: ${errorCount} 个`;
    document.getElementById('importResultText').textContent = resultText;
}

function showDetailedImportComplete(importedCount, totalCount, authorizedCount, reauthCount, errorCount) {
    // 显示完成状态
    document.getElementById('importingStatus').classList.add('hidden');
    document.getElementById('importCompleteStatus').classList.remove('hidden');
    document.getElementById('importCloseButton').classList.remove('hidden');

    // 构建详细结果文本
    let resultText = `导入完成: ${importedCount} 个\n\n`;
    resultText += `✅ 完全就绪: ${authorizedCount} 个\n`;
    if (reauthCount > 0) {
        resultText += `⚠️ 需重新授权: ${reauthCount} 个\n`;
    }
    if (errorCount > 0) {
        resultText += `❌ 处理失败: ${errorCount} 个\n`;
    }

    // 添加验证码统计
    if (window.manager && window.manager.accounts) {
        const totalCodes = window.manager.accounts.reduce((sum, acc) => sum + (acc.codes?.length || 0), 0);
        if (totalCodes > 0) {
            resultText += `\n📧 发现验证码: ${totalCodes} 个`;
        }
    }

    document.getElementById('importResultText').textContent = resultText;
    document.getElementById('importResultText').style.whiteSpace = 'pre-line';
}

function updateProgress(current, total, message) {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressCount = document.getElementById('progressCount');

    if (progressBar && progressText && progressCount) {
        const percentage = Math.round((current / total) * 100);
        progressBar.style.width = percentage + '%';
        progressText.textContent = message;
        progressCount.textContent = `${current}/${total}`;
    }
}

// 数据清空相关函数
function confirmClearAllData() {
    if (window.manager && window.manager.accounts.length === 0) {
        Utils.showNotification('当前没有数据需要清空', 'warning');
        return;
    }

    // 显示清空数据确认弹窗
    safeSetDisplay('clearDataModal', 'flex');

    // 重置确认复选框状态
    const checkbox = document.getElementById('confirmCheckbox');
    const button = document.getElementById('confirmClearButton');
    if (checkbox) checkbox.checked = false;
    if (button) button.disabled = true;
}

function hideClearDataModal() {
    safeSetDisplay('clearDataModal', 'none');
}

// 排序函数
function sortBySequence() {
    if (!window.manager) return;
    window.manager.sortByField('sequence');
}

function sortByStatus() {
    if (!window.manager) return;
    window.manager.sortByField('status');
}

function sortByEmail() {
    if (!window.manager) return;
    window.manager.sortByField('email');
}

function sortByCodeTime() {
    if (!window.manager) return;
    window.manager.sortByField('latest_code_time');
}

function sortBySender() {
    if (!window.manager) return;
    window.manager.sortByField('email_from');
}

// 分页函数
function changePage(delta) {
    if (!window.manager) return;
    window.manager.changePage(delta);
}

function goToPage(page) {
    if (!window.manager) return;
    window.manager.goToPage(page);
}

function changePageSize() {
    if (!window.manager) return;
    const select = document.getElementById('pageSize');
    const newSize = parseInt(select.value);
    window.manager.changePageSize(newSize);
}

// 账户操作函数
function copyEmailToClipboard(accountId) {
    if (!window.manager) return;
    const account = window.manager.accounts.find(acc => acc.id === accountId);
    if (account) {
        Utils.copyToClipboard(account.email).then(success => {
            if (success) {
                Utils.showNotification(`已复制邮箱地址: ${account.email}`, 'success');
                // 触发1分钟后台监控
                triggerAccountMonitoring(account);
            } else {
                Utils.showNotification('复制失败，请手动复制', 'error');
            }
        });
    }
}

// 手动获取邮件
async function manualFetchEmails(accountId) {
    if (!window.manager) return;

    const account = window.manager.accounts.find(acc => acc.id === accountId);
    if (!account) {
        Utils.showNotification('账户不存在', 'error');
        return;
    }

    try {
        Utils.showNotification(`正在获取 ${account.email} 的邮件...`, 'info');

        const response = await fetch('/api/manual-fetch-emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                email_id: account.id,
                email: account.email,
                client_id: account.client_id,
                refresh_token: account.refresh_token,
                current_status: account.current_status || 'pending'
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            Utils.showNotification(`邮件获取成功: ${account.email}`, 'success');
            // 触发数据刷新
            if (window.manager.refreshData) {
                window.manager.refreshData();
            }
        } else {
            Utils.showNotification(`邮件获取失败: ${result.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        console.error('手动获取邮件错误:', error);
        Utils.showNotification('邮件获取失败，请稍后重试', 'error');
    }
}

// 数据同步函数 - 确保前后端数据一致
async function syncDataWithBackend() {
    if (!window.manager) return;

    try {
        const response = await fetch('/api/accounts/verify-sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                accounts: window.manager.accounts
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // 更新前端账户数据
            if (result.updatedAccounts && result.updatedAccounts.length > 0) {
                result.updatedAccounts.forEach(updatedAccount => {
                    const account = window.manager.accounts.find(acc => acc.id === updatedAccount.id || acc.email === updatedAccount.email);
                    if (account) {
                        // 同步状态
                        if (updatedAccount.status) account.status = updatedAccount.status;
                        if (updatedAccount.codes) account.codes = updatedAccount.codes;
                        if (updatedAccount.email_count !== undefined) account.email_count = updatedAccount.email_count;
                        if (updatedAccount.latest_code_received_at) account.latest_code_received_at = updatedAccount.latest_code_received_at;
                        if (updatedAccount.access_token) account.access_token = updatedAccount.access_token;

                        account.last_checked = new Date().toISOString();
                    }
                });

                // 保存并刷新界面
                window.manager.saveAccounts();
                window.manager.render();
                window.manager.updateStats();

                console.log(`[数据同步] 同步完成，更新了 ${result.updatedAccounts.length} 个账户`);
                Utils.showNotification('数据同步完成', 'success');
            }
        } else {
            console.warn('[数据同步] 后端返回错误:', result?.error);
        }
    } catch (error) {
        console.error('[数据同步] 同步失败:', error);
    }
}

// 定期数据同步 - 每分钟检查一次
let syncInterval = null;
function startPeriodicSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
    }

    syncInterval = setInterval(() => {
        if (window.manager && window.manager.accounts.length > 0) {
            syncDataWithBackend();
        }
    }, 60000); // 每分钟同步一次
}

// 停止定期同步
function stopPeriodicSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

// 触发账户监控
async function triggerAccountMonitoring(account) {
    try {
        const response = await fetch('/api/monitor/copy-trigger', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                email_id: account.id,
                email: account.email,
                client_id: account.client_id,
                refresh_token: account.refresh_token,
                current_status: account.current_status,
                codes: account.codes || [],
                emails: account.emails || [],
                latest_code_received_at: account.latest_code_received_at
            })
        });

        const result = await response.json();
        if (result.success) {
            Utils.showNotification(`已启动监控: ${account.email}`, 'info');

            // 监控完成后自动同步数据
            setTimeout(() => {
                syncDataWithBackend();
            }, 65000); // 监控65秒后同步（确保有足够时间获取验证码）
        } else {
            console.error('监控触发失败:', result.error);
        }
    } catch (error) {
        console.error('监控触发错误:', error);
    }
}

function handleAccountSelection(checkbox) {
    const accountId = checkbox.dataset.accountId; // 使用字符串ID，不转换为数字
    if (checkbox.checked) {
        window.manager.selectedAccounts.add(accountId);
    } else {
        window.manager.selectedAccounts.delete(accountId);
    }
    console.log('已选中的账户:', Array.from(window.manager.selectedAccounts));
}

function toggleAccountSelection(accountId, isChecked) {
    const account = window.manager.accounts.find(acc => acc.id === accountId);
    if (account) {
        account.selected = isChecked;
        window.manager.saveAccounts();
    }
}

function syncAccount(id) {
    const account = window.manager.accounts.find(acc => acc.id === id);
    if (!account) return;

    if (account.status !== 'authorized') {
        // 如果未授权，尝试直接验证授权
        window.manager.validateAccountAuth(id);
        return;
    }

    // 真实同步过程
    window.manager.syncAccountEmails(id);
}

function parseImportData(importData) {
    const emails = [];
    const lines = importData.split('\n').filter(line => line.trim());

    for (const line of lines) {
        try {
            const emailData = Utils.parseImportLine(line.trim());
            if (emailData) {
                emails.push(emailData);
            }
        } catch (error) {
            console.warn(`[Parse] 跳过无效行: ${line}`, error.message);
        }
    }

    return emails;
}

// 完整的账户处理流程（导入后自动执行）
async function processAccountEmails(accountId) {
    const account = window.manager.accounts.find(acc => acc.id === accountId);
    if (!account) return;

    try {
        console.log(`[Process] 开始处理账户: ${account.email}`);

        // 1. 确保有有效的access_token，如果没有则尝试刷新
        if (!account.access_token) {
            console.log(`[Process] 账户缺少access_token，尝试刷新token...`);
            try {
                await window.manager.validateAccountAuth(accountId);
                console.log(`[Process] Token刷新成功`);
            } catch (tokenError) {
                console.warn(`[Process] Token刷新失败，但仍尝试同步邮件:`, tokenError);
            }
        }

        // 2. 同步邮件（即使没有有效token也尝试）
        await window.manager.syncAccountEmails(accountId);

        // 3. 根据是否有有效token更新状态
        if (account.access_token) {
            window.manager.updateAccountStatus(accountId, 'authorized');
            console.log(`[Process] 账户处理完成: ${account.email} (状态: authorized)`);
        } else {
            window.manager.updateAccountStatus(accountId, 'reauth_needed');
            console.log(`[Process] 账户处理完成: ${account.email} (状态: reauth_needed)`);
        }

    } catch (error) {
        console.error(`[Process] 账户处理失败: ${account.email}`, error);
        window.manager.updateAccountStatus(accountId, 'error');
    }
}

function copyLatestCode(accountId) {
    if (!window.manager) return;
    const account = window.manager.accounts.find(acc => acc.id === accountId);
    if (account && account.codes && account.codes.length > 0) {
        const latestCode = account.codes[account.codes.length - 1];
        Utils.copyToClipboard(latestCode.code).then(success => {
            if (success) {
                Utils.showNotification(`已复制验证码: ${latestCode.code}`, 'success');
            } else {
                Utils.showNotification('复制失败，请手动复制', 'error');
            }
        });
    } else {
        Utils.showNotification('没有找到验证码', 'warning');
    }
}

function manualFetchEmails(accountId) {
    if (!window.manager) return;
    window.manager.manualFetchEmails(accountId);
}

function deleteAccountConfirm(accountId) {
    if (!window.manager) return;
    if (confirm('确定要删除这个账户吗？此操作不可撤销。')) {
        window.manager.deleteAccount(accountId);
    }
}

// 数据操作函数
async function importEmails() {
    if (!window.manager) {
        Utils.showNotification('系统未初始化完成，请刷新页面重试', 'error');
        return;
    }

    const textarea = document.getElementById('importTextarea');
    if (!textarea) {
        Utils.showNotification('找不到输入框，请刷新页面重试', 'error');
        return;
    }

    const content = textarea.value.trim();

    if (!content) {
        Utils.showNotification('请输入要导入的邮箱数据', 'warning');
        return;
    }

    // 开始导入流程
    hideImportModal();
    showProgressModal();

    try {
        // 解析邮箱数据（使用与原系统相同的逻辑）
        const emailData = [];
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
            const accountData = Utils.parseImportLine(line);
            if (accountData) {
                emailData.push(accountData);
            }
        }

        if (emailData.length === 0) {
            // 显示无数据状态
            document.getElementById('importingStatus').classList.add('hidden');
            document.getElementById('importCompleteStatus').classList.remove('hidden');
            document.getElementById('importCloseButton').classList.remove('hidden');
            document.getElementById('importResultText').textContent = '没有找到有效的邮箱信息';
            return;
        }

        const totalAccounts = emailData.length;
        updateProgress(0, totalAccounts, '正在批量导入邮箱...');

        // 调用后端批量导入API
        const response = await fetch('/api/accounts/batch-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                emails: emailData
            })
        });

        if (!response.ok) {
            throw new Error(`批量导入失败: ${response.status}`);
        }

        const result = await response.json();

        // 前���快速创建账户记录（显示导入进度）
        let createdCount = 0;
        for (let i = 0; i < emailData.length; i++) {
            const data = emailData[i];

            // 创建基础账户记录（后端会自动更新状态）
            const account = {
                id: 'account_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                email: data.email,
                client_id: data.client_id,
                refresh_token: data.refresh_token,
                access_token: '',
                status: 'pending', // 后端处理状态
                created_at: new Date().toISOString(),
                last_checked: new Date().toISOString(),
                email_count: 0,
                verification_code: null,
                sequence: await window.manager.sequenceManager.assignSequence(data.email),
                monitoring: false,
                codes: []
            };

            window.manager.accounts.push(account);
            createdCount++;

            updateProgress(i + 1, totalAccounts, `已处理 ${i + 1}/${totalAccounts} 个账户...`);
        }

        // 保存账户数据
        await window.manager.saveAccounts();
        window.manager.render();
        window.manager.updateStats();

              // 完成前端导入，后端会异步处理授权和验证码提取
        updateProgress(totalAccounts, totalAccounts, '导入完成！后端正在处理授权和验证码提取...');

        // 保存数据
        await window.manager.saveAccounts();

        // 显示结果
        setTimeout(() => {
            showImportComplete(createdCount, 0);

            // 刷新界面
            window.manager.filteredAccounts = [...window.manager.accounts];
            window.manager.render();
            window.manager.updateStats();

            // 显示成功通知
            Utils.showNotification(`批量导入完成！已导入 ${createdCount} 个账户，后端正在自动处理授权和验证码提取。`, 'success');
        }, 1000);

    } catch (error) {
        hideProgressModal();
        Utils.showNotification('导入失败: ' + error.message, 'error');
    }
}

async function clearAllData() {
    if (!window.manager) {
        Utils.showNotification('系统未初始化，无法清空数据', 'error');
        return;
    }

    try {
        // 清空前端数据
        window.manager.accounts = [];
        window.manager.filteredAccounts = [];
        window.manager.sequenceManager.sequenceCache.clear();
        window.manager.sequenceManager.maxSequenceCache = 0;
        window.manager.sequenceManager.initialized = false;

        // 清空所有本地存储数据
        localStorage.removeItem('mailmanager_accounts');
        localStorage.removeItem('mail_manager_session_id');

        // 生成新的会话ID（多用户隔离）
        window.manager.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('mail_manager_session_id', window.manager.sessionId);

        // WebSocket连接会在构造函数中自动重连，无需手动初始化

        // 刷新界面
        window.manager.render();
        window.manager.updateStats();

        // 关闭弹窗并显示成功消息
        hideClearDataModal();
        Utils.showNotification('所有数据已成功清空！已生成新的会话ID，确保多用户数据隔离。', 'success');

        // 清空数据完成，无需额外验证

    } catch (error) {
        hideClearDataModal();
        Utils.showNotification('数据清理失败: ' + error.message, 'error');
    }
}

// 刷新状态管理
let isRefreshing = false;

async function refreshData() {
    // 防止重复刷新
    if (isRefreshing) {
        if (window.manager) {
            window.manager.showNotification('正在刷新中，请稍候...', 'warning');
        }
        return;
    }

    if (!window.manager) {
        Utils.showNotification('系统未初始化，无法刷新', 'error');
        return;
    }

    isRefreshing = true;
    const refreshButton = document.querySelector('button[onclick="refreshData()"]');
    const originalContent = refreshButton ? refreshButton.innerHTML : '';

    try {
        // 更新按钮状态
        if (refreshButton) {
            refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>刷新中...';
            refreshButton.disabled = true;
            refreshButton.classList.add('opacity-75', 'cursor-not-allowed');
        }

        // 显示刷新开始通知
        if (window.manager.showNotification) {
            window.manager.showNotification('正在重新加载数据...', 'info');
        } else {
            Utils.showNotification('正在重新加载数据...', 'info');
        }
        console.log('[Refresh] 开始重新加载数据...');

        // 1. 重新从LocalStorage加载账户数据
        console.log('[Refresh] 重新加载账户数据...');
        await window.manager.loadAccounts();

        // 2. 重新初始化序列号管理器
        console.log('[Refresh] 重新初始化序列号管理器...');
        await window.manager.sequenceManager.initialize(window.manager.accounts);

        // 3. 重新连接WebSocket
        console.log('[Refresh] 重新连接WebSocket...');
        window.manager.connectWebSocket();

        // 4. 更新筛选账户列表
        console.log('[Refresh] 更新筛选账户列表...');
        window.manager.filteredAccounts = [...window.manager.accounts];

        // 5. 重新渲染界面
        console.log('[Refresh] 重新渲染界面...');
        window.manager.render();
        window.manager.updateStats();

        // 显示成功通知
        if (window.manager.showNotification) {
            window.manager.showNotification('数据重新加载完成！', 'success');
        } else {
            Utils.showNotification('数据重新加载完成！', 'success');
        }

    } catch (error) {
        console.error('[Refresh] 重新加载数据失败:', error);

        if (window.manager.showError) {
            window.manager.showError('数据重新加载失败: ' + error.message);
        } else {
            Utils.showNotification('数据重新加载失败: ' + error.message, 'error');
        }

        // 即使出错也尝试重新渲染界面
        try {
            window.manager.render();
            window.manager.updateStats();
        } catch (renderError) {
            console.error('[Refresh] 界面重新渲染也失败:', renderError);
            if (window.manager.showError) {
                window.manager.showError('数据加载和界面渲染都失败，请刷新页面');
            } else {
                Utils.showNotification('数据加载和界面渲染都失败，请刷新页面', 'error');
            }
        }
    } finally {
        // 恢复按钮状态
        isRefreshing = false;
        if (refreshButton) {
            refreshButton.innerHTML = originalContent;
            refreshButton.disabled = false;
            refreshButton.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    }
}

// 工具函数 - 使用Utils.formatFileSize避免重复
function formatFileSize(bytes) {
    return Utils.formatFileSize(bytes);
}

// 确认复选框状态更新
function updateConfirmButton() {
    const checkbox = document.getElementById('confirmCheckbox');
    const button = document.getElementById('confirmClearButton');
    if (checkbox && button) {
        button.disabled = !checkbox.checked;
    }
}

// 搜索过滤函数
function filterAccounts() {
    if (!window.manager) return;

    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;

    window.manager.filterAccounts();
}

// 全局变量
window.updateConfirmButton = updateConfirmButton;

// 导出函数到全局作用域（确保在HTML中可以调用）
window.showImportModal = showImportModal;
window.hideImportModal = hideImportModal;
window.showProgressModal = showProgressModal;
window.hideProgressModal = hideProgressModal;
window.closeImportProgressModal = closeImportProgressModal;
window.showImportComplete = showImportComplete;
window.showDetailedImportComplete = showDetailedImportComplete;
window.updateProgress = updateProgress;
window.confirmClearAllData = confirmClearAllData;
window.hideClearDataModal = hideClearDataModal;
window.sortBySequence = sortBySequence;
window.sortByStatus = sortByStatus;
window.sortByEmail = sortByEmail;
window.sortByCodeTime = sortByCodeTime;
window.sortBySender = sortBySender;
window.changePage = changePage;
window.goToPage = goToPage;
window.changePageSize = changePageSize;
window.copyEmailToClipboard = copyEmailToClipboard;
window.copyLatestCode = copyLatestCode;
window.manualFetchEmails = manualFetchEmails;
window.triggerAccountMonitoring = triggerAccountMonitoring;
window.syncDataWithBackend = syncDataWithBackend;
window.startPeriodicSync = startPeriodicSync;
window.stopPeriodicSync = stopPeriodicSync;
window.deleteAccountConfirm = deleteAccountConfirm;
window.importEmails = importEmails;
window.clearAllData = clearAllData;
window.refreshData = refreshData;
window.formatFileSize = formatFileSize;
window.filterAccounts = filterAccounts;
window.handleAccountSelection = handleAccountSelection;
window.toggleAccountSelection = toggleAccountSelection;
window.syncAccount = syncAccount;
window.parseImportData = parseImportData;
window.processAccountEmails = processAccountEmails;

// ========== 新增的API功能（从simple-mail-manager.html移植） ==========

// 4. 提取验证码API调用（simple-mail-manager.html中的关键功能）
async function extractVerificationCodes() {
    if (!window.manager) {
        Utils.showNotification('系统未初始化', 'error');
        return;
    }

    try {
        Utils.showNotification('正在提取验证码...', 'info');

        const response = await fetch('/api/extract-verification-codes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                accounts: window.manager.accounts
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            Utils.showNotification(`验证码提取完成，处理了 ${result.processed} 个账户`, 'success');

            // 同步后端返回的验证码数据
            if (result.updatedAccounts && result.updatedAccounts.length > 0) {
                await syncDataWithBackend();
            }
        } else {
            Utils.showNotification('验证码提取失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (error) {
        console.error('提取验证码失败:', error);
        Utils.showNotification('验证码提取失败: ' + error.message, 'error');
    }
}

// 5. Microsoft Token刷新API调用
async function refreshMicrosoftToken(accountId, email, clientId, refreshToken) {
    if (!window.manager) {
        Utils.showNotification('系统未初始化', 'error');
        return;
    }

    try {
        const response = await fetch('/api/microsoft/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                accountId: accountId,
                email: email,
                clientId: clientId,
                refreshToken: refreshToken
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            Utils.showNotification('Token刷新成功', 'success');

            // 更新本地账户数据
            const account = window.manager.accounts.find(acc => acc.id === accountId);
            if (account) {
                account.status = 'authorized';
                account.lastUpdated = new Date().toISOString();
                await window.manager.saveAccounts();
                window.manager.render();
                window.manager.updateStats();
            }
        } else {
            Utils.showNotification('Token刷新失败: ' + (result.error || '未知错误'), 'error');
        }

        return result;
    } catch (error) {
        console.error('Token刷新失败:', error);
        Utils.showNotification('Token刷新失败: ' + error.message, 'error');
        return { success: false, error: error.message };
    }
}

// 6. 直接刷新TokenAPI调用（简化版本）
async function refreshTokenDirect(accountId, email, clientId, refreshToken) {
    if (!window.manager) {
        Utils.showNotification('系统未初始化', 'error');
        return;
    }

    try {
        const response = await fetch('/api/accounts/refresh-token-direct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                accountId: accountId,
                email: email,
                clientId: clientId,
                refreshToken: refreshToken
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            Utils.showNotification('Token直接刷新成功', 'success');

            // 同步后端数据
            await syncDataWithBackend();
        } else {
            Utils.showNotification('Token直接刷新失败: ' + (result.error || '未知错误'), 'error');
        }

        return result;
    } catch (error) {
        console.error('Token直接刷新失败:', error);
        Utils.showNotification('Token直接刷新失败: ' + error.message, 'error');
        return { success: false, error: error.message };
    }
}

// 7. OAuth回调处理（从simple-mail-manager.html移植）
async function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');

    if (error) {
        Utils.showNotification('OAuth授权失败: ' + error, 'error');
        // 清理URL参数
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }

    if (code && state) {
        try {
            Utils.showNotification('正在处理OAuth回调...', 'info');

            const response = await fetch('/api/auth/callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: code,
                    state: state,
                    sessionId: window.manager ? window.manager.sessionId : 'unknown'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                Utils.showNotification('OAuth授权成功！', 'success');

                // 同步后端数据
                if (window.manager) {
                    await syncDataWithBackend();
                }
            } else {
                Utils.showNotification('OAuth授权失败: ' + (result.error || '未知错误'), 'error');
            }

        } catch (error) {
            console.error('OAuth回调处理失败:', error);
            Utils.showNotification('OAuth回调处理失败: ' + error.message, 'error');
        } finally {
            // 清理URL参数
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
}

// 8. 事件触发API调用（用于手动触发后端事件）
async function triggerBackendEvent(eventType, data = {}) {
    if (!window.manager) {
        Utils.showNotification('系统未初始化', 'error');
        return;
    }

    try {
        const response = await fetch('/api/events/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                type: eventType,
                data: data,
                timestamp: new Date().toISOString()
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            console.log('事件触发成功:', eventType);
        } else {
            console.warn('事件触发失败:', result.error);
        }

        return result;
    } catch (error) {
        console.error('事件触发失败:', error);
        return { success: false, error: error.message };
    }
}

// 9. 增强的数据同步功能（包含所有后端状态）
async function enhancedDataSync() {
    if (!window.manager || !window.manager.accounts.length) {
        return;
    }

    try {
        const response = await fetch('/api/accounts/verify-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: window.manager.sessionId,
                accounts: window.manager.accounts,
                includeVerificationCodes: true,
                includeStatus: true
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success && result.data) {
            // 更新所有账户数据
            let updatedCount = 0;

            result.data.forEach(backendAccount => {
                const frontendAccount = window.manager.accounts.find(acc =>
                    acc.email === backendAccount.email || acc.id === backendAccount.id
                );

                if (frontendAccount) {
                    // 同步所有后端状态
                    Object.assign(frontendAccount, backendAccount);
                    updatedCount++;
                }
            });

            if (updatedCount > 0) {
                await window.manager.saveAccounts();
                window.manager.render();
                window.manager.updateStats();
                console.log(`[EnhancedSync] 同步了 ${updatedCount} 个账户的最新状态`);
            }
        }
    } catch (error) {
        console.warn('[EnhancedSync] 数据同步失败:', error.message);
    }
}

// 导出新函数到全局作用域
window.extractVerificationCodes = extractVerificationCodes;
window.refreshMicrosoftToken = refreshMicrosoftToken;
window.refreshTokenDirect = refreshTokenDirect;
window.handleOAuthCallback = handleOAuthCallback;
window.triggerBackendEvent = triggerBackendEvent;
window.enhancedDataSync = enhancedDataSync;

// 页面卸载时清理同步
window.addEventListener('beforeunload', () => {
    stopPeriodicSync();
});

// 页面加载完成后检查OAuth回调
document.addEventListener('DOMContentLoaded', () => {
    // 延迟检查OAuth回调，确保manager已初始化
    setTimeout(() => {
        if (window.location.search.includes('code=') || window.location.search.includes('error=')) {
            handleOAuthCallback();
        }
    }, 1000);
});