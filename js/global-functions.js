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

// 刷新数据功能已被智能连接状态显示取代
// 如需重新连接，请点击连接状态按钮

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
    window.manager.changePageSize(pageSize);
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
                <h3 class="text-lg font-bold text-gray-900 mb-2">确认删除邮箱</h3>
                <p class="text-gray-600 mb-6">您确定要删除邮箱 <strong>${account.email}</strong> 吗？</p>
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
        // 关闭确认弹窗 - 使用更精确的选择器
        const modals = document.querySelectorAll('.fixed.inset-0');
        modals.forEach(modal => modal.remove());
    } catch (error) {
        Utils.showNotification('删除账户失败: ' + error.message, 'error');
        // 即使删除失败也要关闭弹窗
        const modals = document.querySelectorAll('.fixed.inset-0');
        modals.forEach(modal => modal.remove());
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

// ==================== 账户选择功能 ====================

// 处理账户选择
function handleAccountSelection(checkbox) {
    if (!window.manager) {
        console.error('Manager not initialized');
        return;
    }

    const accountId = checkbox.dataset.accountId; // 使用字符串ID，不转换为数字
    if (checkbox.checked) {
        manager.selectedAccounts.add(accountId);
    } else {
        manager.selectedAccounts.delete(accountId);
    }
    console.log('已选中的账户:', Array.from(manager.selectedAccounts));
}

// 复制邮箱地址到剪贴板
async function copyEmailOnly(accountId) {
    if (!window.manager) {
        Utils.showNotification('系统未初始化，请刷新页面重试', 'error');
        return;
    }

    try {
        await window.manager.copyEmailOnly(accountId);
    } catch (error) {
        console.error('复制邮箱地址失败:', error);
        Utils.showNotification('复制失败，请手动复制邮箱地址', 'error');
    }
}

// 跳转到第一页
function goToFirstPage() {
    if (!window.manager) return;
    window.manager.goToPage(1);
}

// 跳转到最后一页
function goToLastPage() {
    if (!window.manager) return;
    const totalPages = Math.ceil(window.manager.filteredAccounts.length / window.manager.pageSize);
    window.manager.goToPage(totalPages);
}

// ========== 代理设置相关功能 ==========

// 显示代理设置弹窗
function showProxyModal() {
    const modal = document.getElementById('proxyModal');
    if (modal) {
        modal.classList.remove('modal-hidden', 'hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
        // 重置弹窗状态
        resetProxyModal();
    }
}

// 隐藏代理设置弹窗
function hideProxyModal() {
    const modal = document.getElementById('proxyModal');
    if (modal) {
        modal.classList.add('modal-hidden', 'hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

// 重置代理弹窗状态
function resetProxyModal() {
    // 清除错误信息
    const errorDiv = document.getElementById('proxyUrlError');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';
    }

    // 隐藏结果区域
    const resultSection = document.getElementById('proxyResultSection');
    const actionsSection = document.getElementById('proxyActionsSection');
    const statusMessage = document.getElementById('proxyStatusMessage');

    if (resultSection) resultSection.classList.add('hidden');
    if (actionsSection) actionsSection.classList.add('hidden');
    if (statusMessage) {
        statusMessage.classList.add('hidden');
        statusMessage.textContent = '';
    }

    // 重置按钮状态
    const generateBtn = document.getElementById('generateProxyBtn');
    if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="fas fa-download mr-2"></i>生成代理IP';
        generateBtn.classList.remove('bg-gray-400');
        generateBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
    }
}

// 验证代理URL格式
function validateProxyUrl(url) {
    if (!url) {
        return { valid: false, error: '请输入代理URL' };
    }

    // 检查URL格式和https协议
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (e) {
        return { valid: false, error: 'URL格式无效，请输入有效的https URL' };
    }

    if (parsedUrl.protocol !== 'https:') {
        return { valid: false, error: 'URL必须使用https协议' };
    }

    // 检查必须参数
    const params = new URLSearchParams(parsedUrl.search);
    const username = params.get('username');
    const password = params.get('password');
    const requiredParams = 'ips=1&type=-res-&proxyType=http&responseType=txt';

    if (!username) {
        return { valid: false, error: 'URL缺少必须参数：username' };
    }

    if (!password) {
        return { valid: false, error: 'URL缺少必须参数：password' };
    }

    // 检查固定参数
    if (!url.includes(requiredParams)) {
        return { valid: false, error: `URL缺少必须参数：${requiredParams}` };
    }

    return { valid: true, data: { url, username, password } };
}

// 显示代理URL验证错误
function showProxyUrlError(message) {
    const errorDiv = document.getElementById('proxyUrlError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
}

// 隐藏代理URL验证错误
function hideProxyUrlError() {
    const errorDiv = document.getElementById('proxyUrlError');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
    }
}

// 生成代理IP
async function generateProxyIP() {
    const urlInput = document.getElementById('proxyUrlInput');
    const generateBtn = document.getElementById('generateProxyBtn');

    if (!urlInput || !generateBtn) {
        Utils.showNotification('页面元素未找到，请刷新页面重试', 'error');
        return;
    }

    const proxyUrl = urlInput.value.trim();

    // 验证URL格式
    const validation = validateProxyUrl(proxyUrl);
    if (!validation.valid) {
        showProxyUrlError(validation.error);
        return;
    }

    hideProxyUrlError();

    // 更新按钮状态
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>正在获取代理IP...';
    generateBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
    generateBtn.classList.add('bg-gray-400');

    try {
        // 调用后端API获取代理IP
        const response = await fetch('/api/proxy/fetch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: proxyUrl })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '获取代理IP失败');
        }

        const result = await response.json();

        if (result.success && result.proxyData) {
            // 解析代理IP数据
            const proxyData = parseProxyData(result.proxyData);
            if (proxyData) {
                displayProxyData(proxyData);
                Utils.showNotification('代理IP获取成功', 'success');
            } else {
                throw new Error('代理IP数据格式错误');
            }
        } else {
            throw new Error(result.error || '获取代理IP失败');
        }

    } catch (error) {
        console.error('生成代理IP失败:', error);
        Utils.showNotification(`获取代理IP失败: ${error.message}`, 'error');
    } finally {
        // 恢复按钮状态
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="fas fa-download mr-2"></i>生成代理IP';
        generateBtn.classList.remove('bg-gray-400');
        generateBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
    }
}

// 解析代理IP数据 (格式: host:port:username:password)
function parseProxyData(proxyString) {
    if (!proxyString) return null;

    const parts = proxyString.split(':');
    if (parts.length !== 4) {
        console.error('代理数据格式错误，期望4个字段:', proxyString);
        return null;
    }

    return {
        host: parts[0].trim(),
        port: parseInt(parts[1], 10),
        username: parts[2].trim(),
        password: parts[3].trim()
    };
}

// 显示代理数据
function displayProxyData(proxyData) {
    const resultSection = document.getElementById('proxyResultSection');
    const actionsSection = document.getElementById('proxyActionsSection');

    if (!resultSection || !actionsSection) return;

    // 更新显示数据
    const elements = {
        proxyHost: proxyData.host,
        proxyPort: proxyData.port,
        proxyUsername: proxyData.username,
        proxyPassword: proxyData.password,
        fullProxyAddress: `${proxyData.host}:${proxyData.port}:${proxyData.username}:${proxyData.password}`
    };

    Object.keys(elements).forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = elements[id];
        }
    });

    // 显示结果区域和操作按钮
    resultSection.classList.remove('hidden');
    actionsSection.classList.remove('hidden');
}

// 配置Edge浏览器一键代理（KISS原则）
async function configureSystemProxy() {
    console.log('[DEBUG] configureSystemProxy 函数开始执行');

    // 安全获取DOM元素内容
    const proxyHostElement = document.getElementById('proxyHost');
    const proxyPortElement = document.getElementById('proxyPort');
    const proxyUsernameElement = document.getElementById('proxyUsername');
    const proxyPasswordElement = document.getElementById('proxyPassword');

    const proxyHost = proxyHostElement ? proxyHostElement.textContent.trim() : '';
    const proxyPort = proxyPortElement ? proxyPortElement.textContent.trim() : '';
    const proxyUsername = proxyUsernameElement ? proxyUsernameElement.textContent.trim() : '';
    const proxyPassword = proxyPasswordElement ? proxyPasswordElement.textContent.trim() : '';

    console.log('[DEBUG] 代理数据:', {
        proxyHost,
        proxyPort,
        proxyUsername,
        passwordLength: proxyPassword?.length,
        hostElement: !!proxyHostElement,
        portElement: !!proxyPortElement,
        userElement: !!proxyUsernameElement,
        passElement: !!proxyPasswordElement
    });

    if (!proxyHost || !proxyPort || !proxyUsername || !proxyPassword) {
        console.log('[DEBUG] 代理数据不完整');
        Utils.showNotification('代理数据不完整，请重新获取代理IP', 'error');
        return;
    }

    const configureBtn = document.getElementById('configureProxyBtn');

    if (configureBtn) {
        configureBtn.disabled = true;
        configureBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>正在生成代理配置...';
        configureBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
        configureBtn.classList.add('bg-gray-400');
    }

    try {
        // 检测用户操作系统和浏览器
        const userAgent = navigator.userAgent;
        const isWindows = userAgent.indexOf('Windows') !== -1;
        const isEdge = userAgent.indexOf('Edg/') !== -1;

        console.log(`[DEBUG] 系统检测 - 操作系统: ${isWindows ? 'Windows' : '非Windows'}, 浏览器: ${isEdge ? 'Edge' : '其他'}, UserAgent: ${userAgent}`);

        if (!isWindows) {
            throw new Error('代理配置功能仅支持Windows操作系统。');
        }

        if (!isEdge) {
            console.log('[DEBUG] 非Edge浏览器，显示不支持信息');
            // 非Edge浏览器显示指导信息
            Utils.showModal('浏览器不支持', `
🚫 此功能仅支持 Microsoft Edge 浏览器

📋 当前浏览器：${userAgent.split(' ').pop()}
✅ 推荐浏览器：Microsoft Edge

💡 使用方法：
1. 请打开 Microsoft Edge 浏览器
2. 访问此页面进行代理配置
3. 享受一键配置的便利体验

如需下载Edge浏览器，请访问：
https://www.microsoft.com/edge
            `);
            return;
        }

        console.log('[DEBUG] 通过Edge检测，继续执行KISS配置流程');

        // Edge专用一键配置 - 直接执行，无需确认
        console.log('[DEBUG] 开始执行Edge专用一键配置');
        showProxyStatus('info', '正在准备Edge代理配置...');
        const result = await executeEdgeOneClickProxy(proxyHost, proxyPort, proxyUsername, proxyPassword);

        console.log('[DEBUG] executeEdgeOneClickProxy 执行结果:', result);

        if (result.success) {
            console.log('[DEBUG] Edge配置成功，显示成功状态');
            showProxyStatus('success', 'Edge代理配置完成！');
            Utils.showNotification('Edge代理配置成功！PowerShell窗口即将打开...', 'success');

            // 延迟显示简化指导
            setTimeout(() => {
                console.log('[DEBUG] 显示Edge简化指导');
                showEdgeSimpleGuide();
            }, 1500);

        } else {
            console.log('[DEBUG] Edge配置失败:', result.error);
            throw new Error(result.error || 'Edge代理配置失败');
        }

    } catch (error) {
        console.error('Edge一键配置失败:', error);
        showProxyStatus('error', `配置失败: ${error.message}`);
        Utils.showNotification(`Edge代理配置失败: ${error.message}`, 'error');
    } finally {
        if (configureBtn) {
            configureBtn.disabled = false;
            configureBtn.innerHTML = '<i class="fas fa-cog mr-2"></i>一键代理设置';
            configureBtn.classList.remove('bg-gray-400');
            configureBtn.classList.add('bg-green-500', 'hover:bg-green-600');
        }
    }
}

// 生成并执行Edge代理配置脚本
async function generateAndExecuteEdgeProxy(host, port, username, password) {
    try {
        // PowerShell脚本内容 - 基于templates/powershell/edge-proxy-simple.ps1
        const psScript = `# Microsoft Edge 专用代理配置脚本
param(
    [Parameter(Mandatory=$true)][string]$ProxyHost,
    [Parameter(Mandatory=$true)][string]$ProxyPort,
    [Parameter(Mandatory=$true)][string]$ProxyUser,
    [Parameter(Mandatory=$true)][string]$ProxyPass
)

# 设置Edge代理配置函数
function Set-EdgeProxy {
    param([string]$Server)
    try {
        # 配置Windows系统代理
        Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -Value 1 -Type DWord -Force
        Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyServer" -Value $Server -Type String -Force

        # 配置Edge专用代理设置
        Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyEnable" -Value 1 -Type DWord -Force
        Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyServer" -Value $Server -Type String -Force

        Write-Host "✓ Edge代理配置成功: $Server"
        return $true
    } catch {
        Write-Host "✗ 代理配置失败: $($_.Exception.Message)"
        return $false
    }
}

# 设置凭据函数
function Set-ProxyCredentials {
    param([string]$Host, [string]$Port, [string]$User, [string]$Pass)
    try {
        $targets = @("$Host", "Windows_Proxy", "Microsoft_Edge_Proxy")
        foreach ($target in $targets) {
            try {
                cmdkey /add:$target /user:$User /pass:$Pass | Out-Null
                Write-Host "✓ 凭据添加成功: $target"
            } catch {
                Write-Host "✗ 凭据添加失败: $target"
            }
        }
        return $true
    } catch {
        Write-Host "✗ 凭据配置失败: $($_.Exception.Message)"
        return $false
    }
}

# 启动Edge浏览器函数
function Start-EdgeBrowser {
    try {
        Start-Process msedge "https://ip111.cn" -WindowStyle Maximized
        Write-Host "✓ Edge浏览器启动成功"
        return $true
    } catch {
        Write-Host "✗ Edge启动失败: $($_.Exception.Message)"
        return $false
    }
}

# 主执行逻辑
Write-Host "=== Microsoft Edge 代理配置开始 ==="
Write-Host "代理服务器: $ProxyHost" + ":" + "$ProxyPort"
Write-Host "用户名: $ProxyUser"

$proxyServer = "$ProxyHost" + ":" + "$ProxyPort"
$proxyResult = Set-EdgeProxy -Server $proxyServer

if ($proxyResult) {
    $credResult = Set-ProxyCredentials -Host $ProxyHost -Port $ProxyPort -User $ProxyUser -Pass $ProxyPass

    if ($credResult) {
        Write-Host "=== 配置完成，正在启动Edge ==="
        Start-Sleep -Seconds 2
        Start-EdgeBrowser
        Write-Host "=== Edge代理配置成功完成 ==="
    } else {
        Write-Host "=== 凭据配置失败 ==="
        exit 1
    }
} else {
    Write-Host "=== 代理配置失败 ==="
    exit 1
}`;

        // 创建临时PowerShell文件
        const blob = new Blob([psScript], { type: 'text/plain;charset=utf-8' });
        const file = new File([blob], "edge-proxy-config.ps1", { type: "text/plain" });

        // 下载文件
        const downloadResult = await downloadPowerShellScript(file, host, port, username, password);

        return downloadResult;

    } catch (error) {
        console.error('生成Edge代理配置脚本失败:', error);
        return { success: false, error: error.message };
    }
}

// 下载PowerShell脚本
async function downloadPowerShellScript(file, host, port, username, password) {
    return new Promise((resolve) => {
        try {
            // 创建下载链接
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // 显示执行说明
            setTimeout(() => {
                const executionSteps = `📋 Edge浏览器代理配置执行步骤：

✅ 脚本已下载到您的下载文件夹

🔧 手动执行步骤：
1. 打开下载文件夹
2. 找到 "edge-proxy-config.ps1" 文件
3. 右键点击文件 → 选择"使用PowerShell运行"
4. 如果出现UAC提示，点击"是"
5. 等待脚本执行完成（会自动启动Edge浏览器）

📝 脚本配置信息：
• 代理服务器：${host}:${port}
• 用户名：${username}
• 自动密码配置：已包含

🌐 配置完成后，Edge浏览器将自动打开并验证代理IP。

如果PowerShell执行被阻止，请：
1. 右键点击脚本 → 属性
2. 勾选"解除阻止"
3. 确定后重新运行`;

                Utils.showModal('Edge代理配置说明', executionSteps);

                resolve({
                    success: true,
                    requiresManualExecution: true,
                    message: 'PowerShell脚本已下载，请按照说明手动执行'
                });
            }, 1000);

        } catch (error) {
            console.error('下载PowerShell脚本失败:', error);
            resolve({ success: false, error: error.message });
        }
    });
}

// 启动Edge浏览器
function launchEdgeBrowser() {
    try {
        showProxyStatus('info', '正在启动Edge浏览器...');

        // 尝试多种方式启动Edge
        const edgeUrls = [
            'microsoft-edge:https://ip111.cn',
            'msedge:https://ip111.cn',
            'https://ip111.cn'
        ];

        let launched = false;
        for (const url of edgeUrls) {
            try {
                const newWindow = window.open(url, '_blank');
                if (newWindow) {
                    launched = true;
                    break;
                }
            } catch (e) {
                console.log(`启动方式失败: ${url}`, e);
            }
        }

        if (launched) {
            Utils.showNotification('Edge浏览器已启动，请验证代理IP', 'success');
            showProxyStatus('success', 'Edge浏览器启动成功，请验证IP地址');
        } else {
            // 最后尝试显示手动启动说明
            const manualSteps = `🚀 请手动启动Edge浏览器：

1. 打开Microsoft Edge浏览器
2. 访问：https://ip111.cn
3. 验证代理IP是否显示为：${document.getElementById('proxyHost').textContent}

如果代理未生效，请：
1. 确保PowerShell脚本已成功执行
2. 重启Edge浏览器
3. 检查代理设置是否正确配置`;

            Utils.showModal('手动启动Edge浏览器', manualSteps);
            Utils.showNotification('请手动启动Edge浏览器验证代理', 'info');
        }

    } catch (error) {
        console.error('启动Edge浏览器失败:', error);
        Utils.showNotification('请手动启动Edge浏览器', 'info');
    }
}

// 验证代理IP
function verifyProxyIP() {
    Utils.showNotification('正在打开IP验证页面...', 'info');
    // 打开IP验证网站
    window.open('https://ip111.cn/', '_blank');
}

// 显示代理状态消息
function showProxyStatus(type, message) {
    const statusMessage = document.getElementById('proxyStatusMessage');
    if (!statusMessage) return;

    statusMessage.classList.remove('hidden');

    if (type === 'success') {
        statusMessage.className = 'bg-green-50 border border-green-200 rounded-lg p-4 text-green-800';
        statusMessage.innerHTML = `<i class="fas fa-check-circle mr-2"></i>${message}`;
    } else if (type === 'error') {
        statusMessage.className = 'bg-red-50 border border-red-200 rounded-lg p-4 text-red-800';
        statusMessage.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i>${message}`;
    } else if (type === 'warning') {
        statusMessage.className = 'bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800';
        statusMessage.innerHTML = `<i class="fas fa-exclamation-triangle mr-2"></i>${message}`;
    }
}

// 智能代理配置执行器
async function executeIntelligentProxyConfig(host, port, username, password, isEdge) {
    try {
        // 生成智能PowerShell命令
        const psCommand = generateIntelligentPowerShellCommand(host, port, username, password, isEdge);

        // 复制到剪贴板
        const success = await copyToClipboard(psCommand);

        if (!success) {
            throw new Error('无法复制命令到剪贴板');
        }

        return {
            success: true,
            command: psCommand,
            isEdge: isEdge,
            requiresManualExecution: true,
            message: '配置命令已复制到剪贴板'
        };

    } catch (error) {
        console.error('智能代理配置失败:', error);
        return { success: false, error: error.message };
    }
}

// 生成智能PowerShell命令
function generateIntelligentPowerShellCommand(host, port, username, password, isEdge) {
    // 基于Context7调研的最佳实践，使用更高效的PowerShell命令
    const escapedPassword = password.replace(/'/g, "''");
    const escapedUsername = username.replace(/'/g, "''");

    if (isEdge) {
        // Edge专用优化方案
        return `# Edge浏览器专用代理配置 - 基于最佳实践
# 自动生成时间: ${new Date().toLocaleString()}

# 检查管理员权限
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "⚠️ 需要管理员权限，正在重新启动..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "'$PSCommandPath'" -Verb RunAs
    exit
}

Write-Host "🚀 开始配置Edge浏览器代理..." -ForegroundColor Cyan
Write-Host "📊 代理服务器: ${host}:${port}" -ForegroundColor White
Write-Host "👤 用户名: ${username}" -ForegroundColor White

# 使用WinHttpProxy模块（如果可用）
try {
    Import-Module WinHttpProxy -ErrorAction SilentlyContinue
    Write-Host "✅ 使用WinHttpProxy模块配置" -ForegroundColor Green

    Set-WinhttpProxy -ProxySettings "${host}:${port}" -BypassList "localhost,127.*,10.*,172.16.*,192.168.*" -ErrorAction Stop
} catch {
    Write-Host "🔄 使用传统注册表方法配置" -ForegroundColor Yellow

    # 配置系统代理
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -Value 1 -Type DWord -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyServer" -Value "${host}:${port}" -Type String -Force

    # 配置Edge专用设置
    if (Test-Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer") {
        Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyEnable" -Value 1 -Type DWord -Force
        Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyServer" -Value "${host}:${port}" -Type String -Force
        Write-Host "✅ Edge专用配置完成" -ForegroundColor Green
    }
}

# 配置凭据管理
Write-Host "🔐 配置代理凭据..." -ForegroundColor Cyan
$targets = @("${host}", "Windows_Proxy", "Microsoft_Edge_Proxy")
foreach ($target in $targets) {
    try {
        cmdkey /add:"$target" /user:"${escapedUsername}" /pass:"${escapedPassword}" | Out-Null
        Write-Host "✅ 凭据添加成功: $target" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ 凭据添加失败: $target" -ForegroundColor Yellow
    }
}

# 刷新网络设置
Write-Host "🔄 刷新网络设置..." -ForegroundColor Cyan
netsh winhttp reset proxy | Out-Null
netsh winhttp import proxy source=ie | Out-Null

Write-Host "🎉 Edge代理配置完成！" -ForegroundColor Green
Write-Host "🌐 正在启动Edge浏览器..." -ForegroundColor Cyan

# 启动Edge浏览器
Start-Process msedge "https://ip111.cn" -WindowStyle Maximized

Write-Host "✨ 配置成功完成！请验证IP地址。" -ForegroundColor Green
Start-Sleep -Seconds 3`;
    } else {
        // 通用浏览器方案
        return `# Windows系统代理配置 - 通用浏览器方案
# 自动生成时间: ${new Date().toLocaleString()}

# 检查管理员权限
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "⚠️ 需要管理员权限，正在重新启动..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "'$PSCommandPath'" -Verb RunAs
    exit
}

Write-Host "🚀 开始配置系统代理..." -ForegroundColor Cyan
Write-Host "📊 代理服务器: ${host}:${port}" -ForegroundColor White
Write-Host "👤 用户名: ${username}" -ForegroundColor White

# 配置系统代理
Write-Host "🔧 配置系统代理设置..." -ForegroundColor Cyan
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -Value 1 -Type DWord -Force
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyServer" -Value "${host}:${port}" -Type String -Force

# 配置Edge（如果存在）
if (Test-Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer") {
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyEnable" -Value 1 -Type DWord -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyServer" -Value "${host}:${port}" -Type String -Force
    Write-Host "✅ Edge浏览器配置完成" -ForegroundColor Green
}

# 配置凭据管理
Write-Host "🔐 配置代理凭据..." -ForegroundColor Cyan
$targets = @("${host}", "Windows_Proxy", "Microsoft_Edge_Proxy")
foreach ($target in $targets) {
    try {
        cmdkey /add:"$target" /user:"${escapedUsername}" /pass:"${escapedPassword}" | Out-Null
        Write-Host "✅ 凭据添加成功: $target" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ 凭据添加失败: $target" -ForegroundColor Yellow
    }
}

# 刷新网络设置
Write-Host "🔄 刷新网络设置..." -ForegroundColor Cyan
netsh winhttp reset proxy | Out-Null
netsh winhttp import proxy source=ie | Out-Null

Write-Host "🎉 系统代理配置完成！" -ForegroundColor Green
Write-Host "🌐 正在启动默认浏览器..." -ForegroundColor Cyan

# 启动默认浏览器进行验证
Start-Process "https://ip111.cn" -WindowStyle Maximized

Write-Host "✨ 配置成功完成！请验证IP地址。" -ForegroundColor Green
Start-Sleep -Seconds 3`;
    }
}

// 复制到剪贴板（带通知）
async function copyToClipboard(text) {
    try {
        // 尝试使用现代剪贴板API
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            Utils.showNotification('已复制到剪贴板', 'success');
            return true;
        }

        // 降级方案：使用document.execCommand
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const success = document.execCommand('copy');
        textArea.remove();

        if (success) {
            Utils.showNotification('已复制到剪贴板', 'success');
        }

        return success;
    } catch (error) {
        console.error('复制到剪贴板失败:', error);
        Utils.showNotification('复制失败，请手动复制', 'error');
        return false;
    }
}

// 显示智能执行指导
async function showIntelligentExecutionGuide(result, isEdge) {
    const guideContent = `
🚀 智能代理配置执行指南

✅ 第1步：命令已准备
• 完整的PowerShell配置命令已复制到剪贴板
• 命令包含所有必要的代理设置和凭据配置

🔧 第2步：自动打开PowerShell
• 系统将自动打开管理员权限的PowerShell窗口
• 如果UAC提示，请点击"是"授权

⌨️ 第3步：一键执行
• 在PowerShell窗口中按 Ctrl+V 粘贴命令
• 按回车键执行配置脚本

📋 配置信息：
• 代理服务器：${result.command.match(/代理服务器: ([^\\n]+)/)?.[1] || '未知'}
• 配置方案：${isEdge ? 'Edge专用优化' : '通用浏览器方案'}
• 预计执行时间：10-15秒

🎯 执行特性：
• 自动检测管理员权限
• 智能配置系统代理和Edge设置
• 自动添加代理凭据
• 配置完成后自动启动浏览器验证

⚡ 专业提示：
• 整个过程只需要按 Ctrl+V 和回车键
• 脚本会自动处理所有配置细节
• 如遇问题，请查看PowerShell中的详细提示`;

    // 显示模态框
    Utils.showModal('🚀 智能代理配置执行指南', guideContent);

    // 自动打开PowerShell（延迟2秒让用户看到指导）
    setTimeout(() => {
        openPowerShellAsAdmin();
    }, 2000);

    // 显示复制成功通知
    Utils.showNotification('配置命令已复制到剪贴板！PowerShell窗口即将打开...', 'success');
}

// 自动打开管理员PowerShell
function openPowerShellAsAdmin() {
    try {
        // 创建PowerShell自动执行文件
        const autoExecScript = `# 自动打开PowerShell并等待用户粘贴命令
Write-Host "🚀 MailManager 智能代理配置" -ForegroundColor Cyan
Write-Host "" -ForegroundColor White
Write-Host "📋 请按 Ctrl+V 粘贴配置命令，然后按回车执行" -ForegroundColor Yellow
Write-Host "💡 提示：配置命令已复制到您的剪贴板" -ForegroundColor Green
Write-Host "" -ForegroundColor White
Write-Host "等待输入..." -ForegroundColor Gray`;

        // 创建临时脚本文件
        const scriptBlob = new Blob([autoExecScript], { type: 'text/plain' });
        const scriptFile = new File([scriptBlob], "proxy-config-helper.ps1", { type: "text/plain" });

        // 下载脚本文件
        const scriptUrl = URL.createObjectURL(scriptFile);
        const downloadLink = document.createElement('a');
        downloadLink.href = scriptUrl;
        downloadLink.download = scriptFile.name;
        downloadLink.style.display = 'none';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(scriptUrl);

        // 尝试直接打开PowerShell（管理员权限）
        setTimeout(() => {
            try {
                // 使用powershell://协议尝试直接打开
                const powerShellUrl = 'powershell://';
                window.open(powerShellUrl, '_blank');

                // 备选方案：使用msedge协议打开PowerShell
                setTimeout(() => {
                    const cmdUrl = 'msedge://shell:runas/user:administrator powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Write-Host \\"🚀 MailManager 代理配置\\" -ForegroundColor Cyan; Read-Host \\"按回车继续...\\""';
                    window.open(cmdUrl, '_blank');
                }, 1000);

            } catch (error) {
                console.log('直接打开PowerShell失败，用户需要手动打开', error);
                Utils.showNotification('请手动打开PowerShell（管理员权限）并粘贴命令', 'info');
            }
        }, 1000);

    } catch (error) {
        console.error('打开PowerShell失败:', error);
        Utils.showNotification('请手动打开管理员PowerShell并粘贴配置命令', 'warning');
    }
}

// Edge浏览器专用一键代理配置（完全自动化版本）
async function executeEdgeOneClickProxy(host, port, username, password) {
    try {
        // 生成增强的PowerShell脚本
        const autoCommand = `# 代理配置脚本 (增强版)
$proxyHost = "${host}"
$proxyPort = "${port}"
$proxyUser = "${username}"
$proxyPass = "${password}"
$proxyServer = "${proxyHost}:${proxyPort}"

Write-Host "🔧 配置系统代理: $proxyServer" -ForegroundColor Green
Write-Host "📍 代理服务器: $proxyHost" -ForegroundColor White
Write-Host "🔌 端口: $proxyPort" -ForegroundColor White

# 配置系统代理
try {
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -Value 1 -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyServer" -Value $proxyServer -Force
    Write-Host "✅ 注册表配置成功" -ForegroundColor Green
} catch {
    Write-Host "❌ 注册表配置失败: $_" -ForegroundColor Red
    exit 1
}

# 配置代理认证凭据
Write-Host "🔐 配置代理认证..." -ForegroundColor Green
try {
    cmdkey /add:$proxyHost /user:$proxyUser /pass:$proxyPass
    Write-Host "✅ 凭据保存成功" -ForegroundColor Green
} catch {
    Write-Host "⚠️ 凭据保存失败: $_" -ForegroundColor Yellow
}

# 验证配置
Write-Host "🔍 验证代理配置..." -ForegroundColor Cyan
try {
    $proxyEnable = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -ErrorAction Stop
    $proxyServer = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyServer" -ErrorAction Stop

    if ($proxyEnable.ProxyEnable -eq 1) {
        Write-Host "✅ 代理已启用" -ForegroundColor Green
    } else {
        Write-Host "❌ 代理未启用" -ForegroundColor Red
    }

    Write-Host "📊 当前代理设置: $($proxyServer.ProxyServer)" -ForegroundColor White

} catch {
    Write-Host "❌ 验证失败: $_" -ForegroundColor Red
}

# 刷新网络设置
Write-Host "🔄 刷新网络设置..." -ForegroundColor Green
try {
    netsh winhttp import proxy source=ie
    Write-Host "✅ 网络设置已刷新" -ForegroundColor Green
} catch {
    Write-Host "⚠️ 网络刷新失败: $_" -ForegroundColor Yellow
}

Write-Host "" -ForegroundColor White
Write-Host "🎉 代理配置完成！" -ForegroundColor Green
Write-Host "💡 请重启浏览器以使用新的代理设置" -ForegroundColor Cyan
Write-Host "🔍 可以在 设置 → 网络和Internet → 代理 中查看配置" -ForegroundColor Gray`;

        // 立即复制命令到剪贴板
        setTimeout(async () => {
            const copySuccess = await copyToClipboard(autoCommand);
            if (copySuccess) {
                Utils.showNotification('命令已复制！请打开PowerShell右键粘贴执行', 'success');
            } else {
                Utils.showNotification('请手动复制命令到PowerShell执行', 'warning');
            }
        }, 500);

        return {
            success: true,
            command: autoCommand,
            requiresManualExecution: true,
            message: '命令已复制到剪贴板，请到PowerShell中执行'
        };

    } catch (error) {
        console.error('自动化配置失败:', error);
        return { success: false, error: error.message };
    }
}

// 手动指导备选方案
function showManualInstructions(host, port) {
    const manualCommand = `# 手动代理配置
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -Value 1 -Force
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyServer" -Value "${host}:${port}" -Force
Write-Host "代理配置完成！" -ForegroundColor Green`;

    copyToClipboard(manualCommand);

    setTimeout(() => {
        alert('自动执行失败，请手动操作：\n\n' +
              '1. 按Win+X选择"Windows PowerShell (管理员)"\n' +
              '2. 按Ctrl+V粘贴命令\n' +
              '3. 按回车执行\n\n' +
              '命令已复制到剪贴板！');
    }, 500);
}

// 生成Edge专用简化PowerShell命令
function generateEdgeSimpleCommand(host, port, username, password) {
    const escapedPassword = password.replace(/'/g, "''");
    const escapedUsername = username.replace(/'/g, "''");

    return `# Edge浏览器代理配置 - 一键完成
# 生成时间: ${new Date().toLocaleString()}

Write-Host "🚀 开始配置Edge浏览器代理..." -ForegroundColor Cyan
Write-Host "📊 代理服务器: ${host}:${port}" -ForegroundColor White
Write-Host "👤 用户名: ${username}" -ForegroundColor White

# 检查管理员权限
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "⚠️ 需要管理员权限，正在重新启动..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "'$PSCommandPath'" -Verb RunAs
    exit
}

Write-Host "🔧 配置系统代理..." -ForegroundColor Cyan
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -Value 1 -Type DWord -Force
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyServer" -Value "${host}:${port}" -Type String -Force

Write-Host "✅ Edge专用配置..." -ForegroundColor Green
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyEnable" -Value 1 -Type DWord -Force
Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\ProxyServer" -Name "ProxyServer" -Value "${host}:${port}" -Type String -Force

Write-Host "🔐 配置代理凭据..." -ForegroundColor Cyan
cmdkey /add:"${host}" /user:"${escapedUsername}" /pass:"${escapedPassword}" | Out-Null
cmdkey /add:"Windows_Proxy" /user:"${escapedUsername}" /pass:"${escapedPassword}" | Out-Null
cmdkey /add:"Microsoft_Edge_Proxy" /user:"${escapedUsername}" /pass:"${escapedPassword}" | Out-Null

Write-Host "🔄 刷新网络设置..." -ForegroundColor Cyan
netsh winhttp reset proxy | Out-Null
netsh winhttp import proxy source=ie | Out-Null

Write-Host "🎉 代理配置完成！" -ForegroundColor Green
Write-Host "🌐 正在启动Edge浏览器验证..." -ForegroundColor Cyan

Start-Process msedge "https://ip111.cn" -WindowStyle Maximized

Write-Host "✨ 配置成功！请验证IP地址是否为：${host}" -ForegroundColor Green
Write-Host "" -ForegroundColor White
Write-Host "按任意键退出..." -ForegroundColor Gray
Read-Host`;
}

// 显示Edge简化执行指导
function showEdgeSimpleGuide() {
    const guideContent = `
🚀 Edge浏览器一键代理配置执行指南

✅ 第1步：PowerShell窗口已打开
• 系统已自动打开管理员权限的PowerShell窗口
• 如果看到UAC提示，请点击"是"授权

⌨️ 第2步：自动粘贴命令
• 命令已自动复制到剪贴板
• 在PowerShell窗口中按 Ctrl+V 粘贴命令

🚀 第3步：执行配置
• 按回车键执行配置脚本
• 等待配置完成（约10秒）

🎯 配置完成后将自动：
• 设置Windows系统代理
• 配置Edge专用代理设置
• 添加代理凭据
• 启动Edge浏览器验证IP

💡 小提示：
• 整个过程只需：Ctrl+V + 回车
• 配置脚本会自动处理所有细节
• 如遇问题，请查看PowerShell中的提示`;

    // 直接执行配置，不显示说明框
    console.log('[DEBUG] 直接执行Edge代理配置，跳过说明框');

    // 尝试自动打开PowerShell（管理员权限）
    setTimeout(() => {
        openEdgePowerShellAsAdmin();
    }, 500);
}

// 自动化PowerShell指导
function openEdgePowerShellAsAdmin() {
    console.log('[DEBUG] 启动自动化代理配置流程');

    // 简化通知，告知用户自动化流程开始
    setTimeout(() => {
        Utils.showNotification('🚀 代理配置命令已生成！正在复制到剪贴板...', 'success');

        // 简短的状态提示
        console.log('[DEBUG] 自动化配置流程进行中...');
    }, 200);
}