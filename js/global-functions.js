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

        // 使用KISS方法：前端生成ID，后端使用
        console.log(`[导入] 使用KISS方法调用 manager.batchImportEmails()，账户数量: ${emailData.length}`);
        const result = await window.manager.batchImportEmails(emailData);

        // 完成前端导入，后端会异步处理授权和验证码提取
        updateProgress(totalAccounts, totalAccounts, '导入完成！后端正在处理授权和验证码提取...');

        // 注意：详细的完成信息会在 SimpleMailManager.showDetailedImportSummary 中显示
        // 这里不显示简单的完成信息，避免重复反馈

    } catch (error) {
        console.error('[导入] 批量导入失败:', error);

        // 显示错误状态
        document.getElementById('importingStatus').classList.add('hidden');
        document.getElementById('importCompleteStatus').classList.remove('hidden');
        document.getElementById('importCloseButton').classList.remove('hidden');

        const errorText = error.message || '未知错误';
        document.getElementById('importResultText').textContent = `导入失败: ${errorText}`;

        Utils.showNotification(`批量导入失败: ${errorText}`, 'error');
    }
}

// 显示导入完成弹窗
function showImportComplete(totalCount, failedCount) {
    // 隐藏进度状态
    document.getElementById('importingStatus').classList.add('hidden');

    // 显示完成状态
    document.getElementById('importCompleteStatus').classList.remove('hidden');
    document.getElementById('importCloseButton').classList.remove('hidden');

    // 设置结果文本
    const successCount = totalCount - failedCount;
    let resultText = `导入完成！成功: ${successCount} 个`;
    if (failedCount > 0) {
        resultText += `，失败: ${failedCount} 个`;
    }
    document.getElementById('importResultText').textContent = resultText;

    Utils.showNotification(`邮箱导入完成，成功导入 ${successCount} 个账户`, failedCount > 0 ? 'warning' : 'success');
}

// 显示详细的导��完成信息
function showDetailedImportComplete(importedCount, totalCount, authorizedCount, reauthCount, errorCount) {
    if (!window.manager) return;

    // 隐藏进度状态
    const importingStatus = document.getElementById('importingStatus');
    const importCompleteStatus = document.getElementById('importCompleteStatus');
    const importCloseButton = document.getElementById('importCloseButton');
    const importResultText = document.getElementById('importResultText');

    if (importingStatus) importingStatus.classList.add('hidden');
    if (importCompleteStatus) importCompleteStatus.classList.remove('hidden');
    if (importCloseButton) importCloseButton.classList.remove('hidden');

    // 构建导入结果文本 - 只显示导入进展，不显示授权状态和验证码统计
    let resultText = `导入完成：${importedCount} 个`;

    // 只在有错误或需要重新授权的情况下才显示这些信息
    if (errorCount > 0 || reauthCount > 0) {
        resultText += `\n\n`;
        if (errorCount > 0) {
            resultText += `❌ 处理失败: ${errorCount} 个\n`;
        }
        if (reauthCount > 0) {
            resultText += `⚠️ 需重新授权: ${reauthCount} 个`;
        }
    }

    if (importResultText) {
        importResultText.textContent = resultText;
        importResultText.style.whiteSpace = 'pre-line';
    }

    // 显示综合通知
    const messageType = errorCount > 0 ? 'warning' : (authorizedCount === importedCount ? 'success' : 'info');
    Utils.showNotification(
        `批量导入完成: ${importedCount} 个账户，其中 ${authorizedCount} 个完全就绪`,
        messageType
    );
}

// 显示进度弹窗
function showProgressModal() {
    document.getElementById('importProgressModal').classList.remove('modal-hidden', 'hidden');
    document.getElementById('importProgressModal').classList.add('flex');

    // 重置状态
    document.getElementById('importingStatus').classList.remove('hidden');
    document.getElementById('importCompleteStatus').classList.add('hidden');
    document.getElementById('importCloseButton').classList.add('hidden');
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressCount').textContent = '0/0';
    document.getElementById('progressText').textContent = '准备导入...';
}

// 隐藏进度弹窗
function hideImportProgressModal() {
    document.getElementById('importProgressModal').classList.add('modal-hidden', 'hidden');
    document.getElementById('importProgressModal').classList.remove('flex');
    closeImportProgressModal();
}

// 更新进度
function updateProgress(current, total, message = '') {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    document.getElementById('progressBar').style.width = percentage + '%';
    document.getElementById('progressCount').textContent = `${current}/${total}`;

    if (message) {
        document.getElementById('progressText').textContent = message;
    } else {
        document.getElementById('progressText').textContent = `已处理 ${current}/${total} 个账户`;
    }
}

// 关闭导入进度弹窗
function closeImportProgressModal() {
    document.getElementById('importProgressModal').classList.add('modal-hidden', 'hidden');
    document.getElementById('importProgressModal').classList.remove('flex');

    // 刷新数据显示
    if (window.manager) {
        window.manager.refreshData();
    }
}

// ==================== 数据管理函数 ====================

// 显示清空数据确认弹窗
function confirmClearAllData() {
    console.log('[调试] confirmClearAllData 函数被调用');

    if (window.manager && window.manager.accounts.length === 0) {
        Utils.showNotification('当前没有数据需要清空', 'warning');
        return;
    }

    // 显示清空数据确认弹窗
    const modal = document.getElementById('clearDataModal');
    if (modal) {
        console.log('[调试] 找到弹窗元素，正在显示...');

        // 彻底移除所有隐藏类
        modal.classList.remove('modal-hidden', 'hidden');

        // 强制设置样式，使用最高优先级
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('visibility', 'visible', 'important');
        modal.style.setProperty('position', 'fixed', 'important');
        modal.style.setProperty('top', '0', 'important');
        modal.style.setProperty('left', '0', 'important');
        modal.style.setProperty('width', '100%', 'important');
        modal.style.setProperty('height', '100%', 'important');
        modal.style.setProperty('z-index', '1050', 'important');
        modal.style.setProperty('align-items', 'center', 'important');
        modal.style.setProperty('justify-content', 'center', 'important');

        console.log('[调试] 强制显示弹窗，当前display:', modal.style.display);
        console.log('[调试] 弹窗元素:', modal);

        // 强制刷新页面重绘
        modal.offsetHeight;

    } else {
        console.error('[调试] 未找到 clearDataModal 元素');
    }

    // 重置确认复选框状态
    const checkbox = document.getElementById('confirmCheckbox');
    const button = document.getElementById('confirmClearButton');
    if (checkbox) {
        checkbox.checked = false;
        console.log('[调试] 重置复选框');
    }
    if (button) {
        button.disabled = true;
        console.log('[调试] 禁用确认按钮');
    }
}

// 隐藏清空数据弹窗
function hideClearDataModal() {
    const modal = document.getElementById('clearDataModal');
    if (modal) {
        modal.classList.add('modal-hidden', 'hidden');
        modal.style.setProperty('display', 'none', 'important');
        modal.style.setProperty('visibility', 'hidden', 'important');
    }
}

// 更新确认按钮状态
function updateConfirmButton() {
    const checkbox = document.getElementById('confirmCheckbox');
    const button = document.getElementById('confirmClearButton');

    if (checkbox && button) {
        button.disabled = !checkbox.checked;
    }
}

// 清空所有数据
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

        // 更新界面
        window.manager.render();
        window.manager.updateStats();

        // 关闭弹窗
        hideClearDataModal();

        Utils.showNotification('所有数据已清空', 'success');

    } catch (error) {
        console.error('清空数据失败:', error);
        Utils.showNotification('清空数据失败: ' + error.message, 'error');
    }
}

// ==================== 排序函数 ====================

// 按序号排序
function sortBySequence() {
    if (!window.manager) return;
    window.manager.sortByField('sequence');
}

// 按状态排序
function sortByStatus() {
    if (!window.manager) return;
    window.manager.sortByField('status');
}

// 按邮箱排序
function sortByEmail() {
    if (!window.manager) return;
    window.manager.sortByField('email');
}

// 按验证码时间排序
function sortByCodeTime() {
    if (!window.manager) return;
    window.manager.sortByField('last_code_time');
}

// 按发件人排序
function sortBySender() {
    if (!window.manager) return;
    window.manager.sortByField('last_sender');
}

// ==================== 工具函数 ====================

// ==================== 工具函数 ====================

// 安全设置元素显示状态
function safeSetDisplay(elementId, display) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = display;
    }
}

// 安全设置元素文本内容
function safeSetTextContent(elementId, text) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
    }
}

// ==================== 导入弹窗函数 ====================

// 显示导入弹窗
function showImportModal() {
    const modal = document.getElementById('importModal');
    if (modal) {
        modal.classList.remove('modal-hidden', 'hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';

        // 聚焦到输入框
        const textarea = document.getElementById('importTextarea');
        if (textarea) {
            textarea.focus();
        }
    }
}

// 隐藏导入弹窗
function hideImportModal() {
    const modal = document.getElementById('importModal');
    if (modal) {
        modal.classList.add('modal-hidden', 'hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';

        // 清空输入框
        const textarea = document.getElementById('importTextarea');
        if (textarea) {
            textarea.value = '';
        }
    }
}

// ==================== 数据刷新函数 ====================

// 刷新数据
async function refreshData() {
    if (!window.manager) {
        Utils.showNotification('系统未初始化完成，请刷新页面重试', 'error');
        return;
    }

    try {
        await window.manager.refreshData();
        Utils.showNotification('数据刷新成功', 'success');
    } catch (error) {
        console.error('刷新数据失败:', error);
        Utils.showNotification('刷新数据失败: ' + error.message, 'error');
    }
}

// ==================== 过滤函数 ====================

// 过滤账户
function filterAccounts() {
    if (!window.manager) return;

    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || '';

    window.manager.filterAccounts(searchTerm, statusFilter);
}

// ==================== 分页函数 ====================

// 改变页码
function changePage(delta) {
    if (!window.manager) return;
    window.manager.changePage(delta);
}

// 跳转到指定页
function goToPage(page) {
    if (!window.manager) return;
    window.manager.goToPage(page);
}

// 改变每页显示数量
function changePageSize() {
    if (!window.manager) return;

    const pageSize = parseInt(document.getElementById('pageSize')?.value) || 50;
    window.manager.setPageSize(pageSize);
}

// ==================== 复制函数 ====================

// 复制邮箱地址到剪贴板并启动监控
function copyEmailToClipboard(accountId) {
    if (window.manager) {
        window.manager.copyEmailToClipboard(accountId);
    }
}

// 复制最新验证码到剪贴板
function copyLatestCode(accountId) {
    if (window.manager) {
        window.manager.copyLatestCode(accountId);
    }
}

// ==================== 删除功能 ====================

// 删除账户确认
function deleteAccountConfirm(accountId) {
    if (!window.manager) return;

    const account = window.manager.accounts.find(acc => acc.id === accountId);
    if (!account) {
        Utils.showNotification('找不到要删除的账户', 'error');
        return;
    }

    // 创建确认删除的弹窗
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 max-w-md mx-4">
            <div class="text-center">
                <i class="fas fa-exclamation-triangle text-red-500 text-4xl mb-4"></i>
                <h3 class="text-lg font-bold text-gray-900 mb-2">确认删除账户</h3>
                <p class="text-gray-600 mb-6">您确定要删除账户 <strong>${account.email}</strong> 吗？</p>
                <p class="text-sm text-gray-500 mb-6">此操作不可撤销，所有相关数据将被永久删除。</p>
                <div class="flex justify-center gap-3">
                    <button onclick="this.closest('.fixed').remove()"
                            class="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition">
                        取消
                    </button>
                    <button onclick="confirmDeleteAccount('${accountId}')"
                            class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
                        确认删除
                    </button>
                </div>
            </div>
        </div>
    `;

    // 点击背景关闭弹窗
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });

    document.body.appendChild(modal);
}

// 确认删除账户
async function confirmDeleteAccount(accountId) {
    if (!window.manager) return;

    try {
        await window.manager.deleteAccount(accountId);
        // 关闭确认弹窗
        const modal = document.querySelector('.fixed.inset-0');
        if (modal) modal.remove();
    } catch (error) {
        Utils.showNotification('删除账户失败: ' + error.message, 'error');
    }
}

// ==================== 手动获取邮件功能 ====================

// 手动获取邮件
async function manualFetchEmails(accountId) {
    if (!window.manager) {
        Utils.showNotification('系统未初始化', 'error');
        return;
    }

    try {
        await window.manager.manualFetchEmails(accountId);
    } catch (error) {
        Utils.showNotification('手动获取邮件失败: ' + error.message, 'error');
    }
}

// ==================== 测试功能 ====================

// 手动触发监控结束（用于测试）
function triggerMonitoringEnd(accountId) {
    if (!window.manager) {
        Utils.showNotification('系统未初始化', 'error');
        return;
    }

    const account = window.manager.accounts.find(acc => acc.id === accountId);
    if (account) {
        // 模拟监控结束事件
        window.manager.handleMonitoringEnded({
            type: 'monitoring_ended',
            email_id: accountId,
            email: account.email,
            message: '测试：监控已结束'
        });
        Utils.showNotification('测试：监控状态已清除', 'info');
    }
}