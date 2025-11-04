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

// 配置系统代理
async function configureSystemProxy() {
    const proxyHost = document.getElementById('proxyHost').textContent;
    const proxyPort = document.getElementById('proxyPort').textContent;
    const proxyUsername = document.getElementById('proxyUsername').textContent;
    const proxyPassword = document.getElementById('proxyPassword').textContent;

    if (!proxyHost || !proxyPort || !proxyUsername || !proxyPassword) {
        Utils.showNotification('代理数据不完整，请重新获取代理IP', 'error');
        return;
    }

    const configureBtn = document.getElementById('configureProxyBtn');
    const statusMessage = document.getElementById('proxyStatusMessage');

    if (configureBtn) {
        configureBtn.disabled = true;
        configureBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>正在配置代理...';
        configureBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
        configureBtn.classList.add('bg-gray-400');
    }

    try {
        // 检测用户操作系统
        const userAgent = navigator.userAgent;
        const isWindows = userAgent.indexOf('Windows') !== -1;
        const isMac = userAgent.indexOf('Mac') !== -1;
        const isLinux = userAgent.indexOf('Linux') !== -1;

        console.log(`[代理配置] 检测到操作系统: ${isWindows ? 'Windows' : isMac ? 'macOS' : isLinux ? 'Linux' : '未知'}`);

        if (!isWindows) {
            throw new Error('此功能仅支持Windows操作系统。请使用Windows系统访问此功能。');
        }

        // 显示管理员权限提示
        const adminConfirmed = confirm('⚠️ 重要提示：\n\n配置系统代理需要管理员权限。\n\n请确认：\n1. 您正在使用Windows系统\n2. 您将以管理员身份运行浏览器\n3. 配置完成后可能需要重启浏览器\n\n点击"确定"继续配置，点击"取消"退出。');

        if (!adminConfirmed) {
            return;
        }

        // 尝试在前端自动执行PowerShell配置
        await executePowerShellProxy(proxyHost, proxyPort, proxyUsername, proxyPassword);
        return;

    } catch (error) {
        console.error('配置代理失败:', error);
        showProxyStatus('error', `配置失败: ${error.message}`);
        Utils.showNotification(`配置代理失败: ${error.message}`, 'error');
    } finally {
        if (configureBtn) {
            configureBtn.disabled = false;
            configureBtn.innerHTML = '<i class="fas fa-cog mr-2"></i>一键配置代理';
            configureBtn.classList.remove('bg-gray-400');
            configureBtn.classList.add('bg-green-500', 'hover:bg-green-600');
        }
    }
}

// 验证代理IP
function verifyProxyIP() {
    Utils.showNotification('正在打开IP验证页面...', 'info');
    // 打开IP验证网站
    window.open('https://ip111.cn/', '_blank');
}

// 配置系统代理 - 优化版本（专注于脚本下载）
async function configureSystemProxy() {
    const proxyHost = document.getElementById('proxyHost').textContent;
    const proxyPort = document.getElementById('proxyPort').textContent;
    const proxyUsername = document.getElementById('proxyUsername').textContent;
    const proxyPassword = document.getElementById('proxyPassword').textContent;

    if (!proxyHost || !proxyPort || !proxyUsername || !proxyPassword) {
        Utils.showNotification('代理数据不完整，请重新获取代理IP', 'error');
        return;
    }

    const configureBtn = document.getElementById('configureProxyBtn');
    const statusMessage = document.getElementById('proxyStatusMessage');

    if (configureBtn) {
        configureBtn.disabled = true;
        configureBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>正在生成配置脚本...';
        configureBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
        configureBtn.classList.add('bg-gray-400');
    }

    try {
        // 检测用户操作系统
        const userAgent = navigator.userAgent;
        const isWindows = userAgent.indexOf('Windows') !== -1;

        console.log(`[代理配置] 检测到操作系统: ${isWindows ? 'Windows' : '非Windows'}`);

        if (!isWindows) {
            throw new Error('此功能仅支持Windows操作系统。请使用Windows系统访问此功能。');
        }

        // 生成并下载纯英文BAT配置脚本（解决编码问题）
        generateCleanBatProxyScript(proxyHost, proxyPort, proxyUsername, proxyPassword);

    } catch (error) {
        console.error('配置代理失败:', error);
        showProxyStatus('error', `配置失败: ${error.message}`);
        Utils.showNotification(`配置失败: ${error.message}`, 'error');
    } finally {
        if (configureBtn) {
            configureBtn.disabled = false;
            configureBtn.innerHTML = '<i class="fas fa-cog mr-2"></i>一键配置代理';
            configureBtn.classList.remove('bg-gray-400');
            configureBtn.classList.add('bg-green-500', 'hover:bg-green-600');
        }
    }
}

// 使用注册表协议执行 (备用方案)
async function executeWithRegistryProtocol(proxyServer, username, password) {
    try {
        // 构建注册表修改的INF文件内容
        const infContent = `
[Version]
Signature="$CHICAGO$"

[DefaultInstall]
AddReg=ProxySettings

[ProxySettings]
HKCU,"Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings","ProxyEnable",0x00010001,1
HKCU,"Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings","ProxyServer",,"${proxyServer}"
HKCU,"Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings","ProxyOverride",,"<local>"
        `.trim();

        // 创建下载链接
        const blob = new Blob([infContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'proxy-config.inf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // 提供INF文件安装指导
        showProxyStatus('warning', `
            <div class="space-y-3">
                <div class="font-semibold">📄 已生成代理配置文件</div>
                <div class="text-sm">
                    下载了 proxy-config.inf 文件，请按以下步骤操作：
                </div>
                <div class="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                    <ol class="list-decimal list-inside space-y-1 text-blue-700">
                        <li>右键点击下载的 INF 文件</li>
                        <li>选择"安装"</li>
                        <li>确认所有UAC提示</li>
                        <li>重启浏览器使设置生效</li>
                    </ol>
                </div>
                <button onclick="verifyProxyIP()" class="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded text-sm">
                    🔍 验证IP地址
                </button>
            </div>
        `);

        Utils.showNotification('INF配置文件已下载，请安装后验证', 'warning');
        return true;

    } catch (error) {
        throw new Error(`注册表协议执行失败: ${error.message}`);
    }
}

// 生成BAT版代理配置脚本（纯英文版本）
function generateBatProxyScript(host, port, username, password) {
    const proxyServer = `${host}:${port}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `proxy-config-${timestamp}.bat`;

    // 生成增强版PowerShell脚本内容
    const powershellScript = `# Windows系统代理配置脚本 - 增强版
# 生成时间: ${new Date().toLocaleString()}
# 代理服务器: ${proxyServer}
# 用户名: ${username}

# 设置控制台编码为UTF-8
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Host "编码设置完成" -ForegroundColor Green
} catch {
    Write-Host "编码设置失败，继续执行" -ForegroundColor Yellow
}

# 确保窗口保持显示
Add-Type -AssemblyName System.Windows.Forms

Write-Host "===========================================" -ForegroundColor Green
Write-Host "    Windows系统代理配置脚本" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "📋 配置信息:" -ForegroundColor Cyan
Write-Host "  代理服务器: ${proxyServer}" -ForegroundColor White
Write-Host "  用户名: ${username}" -ForegroundColor White
Write-Host "  生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# 全局变量设置
$ErrorActionPreference = "Continue"  # 改为Continue，避免错误时退出
$ProgressPreference = "Continue"

Write-Host "脚本启动成功，按任意键继续..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host ""

try {
    Write-Host "🔍 步骤1: 检查系统环境..." -ForegroundColor Yellow

    # 检查PowerShell版本
    $psVersion = $PSVersionTable.PSVersion.Major
    Write-Host "   PowerShell版本: $psVersion" -ForegroundColor Green

    # 检查操作系统版本
    $osVersion = (Get-WmiObject -Class Win32_OperatingSystem).Caption
    Write-Host "   操作系统: $osVersion" -ForegroundColor Green

    Write-Host ""
    Write-Host "🔐 步骤2: 检查管理员权限..." -ForegroundColor Yellow

    # 检查管理员权限
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        Write-Host "❌ 错误: 检测到没有管理员权限" -ForegroundColor Red
        Write-Host ""
        Write-Host "💡 解决方案:" -ForegroundColor Cyan
        Write-Host "  1. 右键点击此脚本文件" -ForegroundColor White
        Write-Host "  2. 选择 '以管理员身份运行'" -ForegroundColor White
        Write-Host " 3. 在UAC提示中点击'是'" -ForegroundColor White
        Write-Host ""
        Write-Host "按任意键退出..." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 1
    }

    Write-Host "   ✅ 管理员权限确认" -ForegroundColor Green
    Write-Host ""

    Write-Host "💾 步骤3: 备份当前配置..." -ForegroundColor Yellow

    # 备份当前代理配置
    try {
        $currentSettings = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -ErrorAction SilentlyContinue
        $backup = @{
            ProxyEnable = if ($currentSettings.ProxyEnable) { $currentSettings.ProxyEnable } else { 0 }
            ProxyServer = if ($currentSettings.ProxyServer) { $currentSettings.ProxyServer } else { "" }
            ProxyOverride = if ($currentSettings.ProxyOverride) { $currentSettings.ProxyOverride } else { "" }
        }

        Write-Host "   ✅ 当前配置已备份" -ForegroundColor Green
        Write-Host "   - 代理启用状态: $($backup.ProxyEnable)" -ForegroundColor Gray
        if ($backup.ProxyServer) {
            Write-Host "   - 现有代理服务器: $($backup.ProxyServer)" -ForegroundColor Gray
        }
    } catch {
        Write-Host "   ⚠️ 无法备份当前配置（可能没有现有配置）" -ForegroundColor Yellow
        $backup = @{
            ProxyEnable = 0
            ProxyServer = ""
            ProxyOverride = ""
        }
    }

    Write-Host ""
    Write-Host "⚙️  步骤4: 配置系统代理..." -ForegroundColor Yellow

    # 设置注册表代理配置
    Write-Host "   4.1 配置注册表代理设置..." -ForegroundColor Cyan
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyEnable -Value 1 -Type DWord -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyServer -Value "${proxyServer}" -Type String -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyOverride -Value "<local>" -Type String -Force
    Write-Host "      ✅ 注册表配置完成" -ForegroundColor Green

    # 设置WinHTTP代理
    Write-Host "   4.2 配置WinHTTP代理..." -ForegroundColor Cyan
    $winhttpResult = & netsh winhttp set proxy ${proxyServer} "<local>"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "      ✅ WinHTTP代理配置完成" -ForegroundColor Green
    } else {
        Write-Host "      ⚠️ WinHTTP代理配置可能失败" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "🔄 步骤5: 刷新系统设置..." -ForegroundColor Yellow

    # 刷新DNS缓存
    Write-Host "   5.1 刷新DNS缓存..." -ForegroundColor Cyan
    & ipconfig /flushdns | Out-Null
    Write-Host "      ✅ DNS缓存已刷新" -ForegroundColor Green

    # 通知系统代理设置已更改
    Write-Host "   5.2 通知系统设置更改..." -ForegroundColor Cyan
    try {
        $signature = @"
using System;
using System.Runtime.InteropServices;

public class WinINet {
    [DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@
        $type = Add-Type -MemberDefinition $signature -Name WinINet -PassThru
        $type::InternetSetOption(0, 39, 0, 0)  # INTERNET_OPTION_SETTINGS_CHANGED
        $type::InternetSetOption(0, 37, 0, 0)  # INTERNET_OPTION_REFRESH
        Write-Host "      ✅ 系统设置已通知" -ForegroundColor Green
    } catch {
        Write-Host "      ⚠️ 系统设置通知可能失败" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "🧪 步骤6: 验证代理配置..." -ForegroundColor Yellow

    # 简单的连通性测试
    try {
        Write-Host "   6.1 测试代理连通性..." -ForegroundColor Cyan
        $testUrl = "http://www.msftncsi.com/ncsi.txt"
        $timeoutSeconds = 10

        $webClient = New-Object System.Net.WebClient
        $webClient.Timeout = [TimeSpan]::FromSeconds($timeoutSeconds)

        try {
            $response = $webClient.DownloadString($testUrl)
            if ($response -eq "Microsoft NCSI") {
                Write-Host "      ✅ 代理连通性测试通过" -ForegroundColor Green
            } else {
                Write-Host "      ⚠️ 代理连通性测试异常（响应: $($response.Length) 字符）" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "      ❌ 代理连通性测试失败" -ForegroundColor Red
            Write-Host "        原因: 可能需要等待配置生效" -ForegroundColor Gray
        }
    } catch {
        Write-Host "      ⚠️ 跳过连通性测试（网络问题）" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Green
    Write-Host "🎉 代理配置成功！" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 配置摘要:" -ForegroundColor Cyan
    Write-Host "  ✅ 管理员权限: 已确认" -ForegroundColor Green
    Write-Host "  ✅ 系统注册表: 已配置" -ForegroundColor Green
    Write-Host "  ✅ WinHTTP代理: 已配置" -ForegroundColor Green
    Write-Host "  ✅ 系统设置: 已刷新" -ForegroundColor Green
    Write-Host ""
    Write-Host "🔗 代理信息:" -ForegroundColor White
    Write-Host "  代理服务器: ${proxyServer}" -ForegroundColor White
    Write-Host "  用户名: ${username}" -ForegroundColor White
    Write-Host "  密码: [已隐藏]" -ForegroundColor Gray
    Write-Host ""
    Write-Host "🌐 验证步骤:" -ForegroundColor Yellow
    Write-Host "  1. 打开浏览器（建议Chrome或Edge）" -ForegroundColor White
    Write-Host "  2. 访问 https://ip111.cn/" -ForegroundColor White
    Write-Host " 3. 确认显示的IP地址为代理服务器IP" -ForegroundColor White
    Write-Host "  4. 如果IP变化，说明配置成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "📞 技术支持:" -ForegroundColor Yellow
    Write-Host "  - 如果IP没有变化，请尝试以下操作:" -ForegroundColor Gray
    Write-Host "    • 重启浏览器（Ctrl+Shift+R强制刷新）" -ForegroundColor White
    Write-Host "    • 清除浏览器缓存（Ctrl+Shift+Delete）" -ForegroundColor White
    Write-Host "    • 检查浏览器代理设置是否生效" -ForegroundColor White
    Write-Host "    • 尝试访问其他网站确认代理" -ForegroundColor White
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "❌ 配置过程中发生错误:" -ForegroundColor Red
    Write-Host "错误信息: $($_.Exception.Message)" -ForegroundColor White
    Write-Host ""
    Write-Host "🔄 正在自动回滚配置..." -ForegroundColor Yellow

    # 自动回滚到备份的配置
    try {
        Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyEnable -Value $backup.ProxyEnable -Force
        if ($backup.ProxyServer) {
            Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyServer -Value $backup.ProxyServer -Force
        }
        if ($backup.ProxyOverride) {
            Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyOverride -Value $backup.ProxyOverride -Force
        }

        Write-Host "✅ 配置已自动回滚到之前状态" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ 回滚过程中出现错误，请手动检查" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "💡 故障排除建议:" -ForegroundColor Cyan
    Write-Host "  1. 确保以管理员身份运行此脚本" -ForegroundColor White
    Write-Host "  2. 检查代理服务器是否可用" -ForegroundColor White
    Write-Host "  3. 验证用户名和密码是否正确" -ForegroundColor White
    Write-Host "  4. 查看Windows事件日志获取详细错误信息" -ForegroundColor White
    Write-Host ""
}

Write-Host ""
Write-Host "⏹ 脚本执行完成！" -ForegroundColor Green
Write-Host "按任意键退出..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host "正在退出..." -ForegroundColor Gray
Start-Sleep -Seconds 2
`;

    // 创建Blob并下载
    const blob = new Blob([powershellScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // 显示成功消息和说明
    showProxyStatus('success', `
        <div class="space-y-3">
            <div class="font-semibold">✅ PowerShell脚本已生成并开始下载</div>
            <div class="text-sm">
                <div>文件名: <code class="bg-gray-100 px-2 py-1 rounded">${filename}</code></div>
            </div>
            <div class="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <div class="font-semibold text-blue-800 mb-2">📋 接下来的步骤:</div>
                <ol class="list-decimal list-inside space-y-1 text-blue-700">
                    <li>右键点击下载的 ${filename} 文件</li>
                    <li>选择"以管理员身份运行"</li>
                    <li>按照脚本提示完成代理配置</li>
                    <li>访问 <a href="https://ip111.cn/" target="_blank" class="underline">https://ip111.cn/</a> 验证代理</li>
                </ol>
            </div>
        </div>
    `);

    Utils.showNotification('PowerShell脚本已生成，请以管理员身份运行', 'success');
}

// 下载并运行代理脚本
async function downloadAndRunProxyScript(proxyUrl, proxyData) {
    try {
        const data = JSON.parse(decodeURIComponent(proxyData));
        await generateCleanBatProxyScript(data.host, data.port, data.username, data.password);
        Utils.showNotification('BAT配置脚本已下载！请查看下载文件夹。', 'success');
    } catch (error) {
        console.error('下载脚本失败:', error);
        Utils.showNotification('下载脚本失败: ' + error.message, 'error');
    }
}

// 生成BAT版代理配置脚本（纯英文版本）
function generateBatProxyScript(host, port, username, password) {
    const proxyServer = `${host}:${port}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `proxy-config-${timestamp}.bat`;

    // 生成BAT脚本内容（ASCII编码，避免中文问题）
    const batScript = `@echo off
setlocal enabledelayedexpansion

title Windows Proxy Configuration Script

echo ==========================================
echo     Windows System Proxy Configuration
echo ==========================================
echo.
echo [INFO] Configuration:
echo   Proxy Server: ${proxyServer}
echo   Username: ${username}
echo   Generated: %date% %time%
echo.

echo Press any key to start configuration...
pause >nul
echo.

echo [STEP 1] Checking administrator privileges...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ 错误: 检测到没有管理员权限
    echo.
    echo 💡 解决方案:
    echo   1. 右键点击此脚本文件
    echo   2. 选择 "以管理员身份运行"
    echo   3. 在UAC提示中点击"是"
    echo.
    echo 按任意键退出...
    pause >nul
    exit /b 1
)
echo    ✅ 管理员权限确认
echo.

echo 💾 步骤2: 备份当前配置...
set "backupFile=%temp%\\proxy_backup_%random%.reg"
reg export "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" "%backupFile%" >nul 2>&1
if exist "%backupFile%" (
    echo    ✅ 当前配置已备份
) else (
    echo    ⚠️ 无法备份当前配置（可能没有现有配置）
)
echo.

echo ⚙️  步骤3: 配置系统代理...
echo    3.1 配置注册表代理设置...

REM 启用代理
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f >nul
if %errorLevel% equ 0 (
    echo       ✅ 代理已启用
) else (
    echo       ❌ 代理启用失败
    goto :error
)

REM 设置代理服务器
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f >nul
if %errorLevel% equ 0 (
    echo       ✅ 代理服务器已设置
) else (
    echo       ❌ 代理服务器设置失败
    goto :error
)

REM 设置代理绕过列表
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "<local>" /f >nul
if %errorLevel% equ 0 (
    echo       ✅ 代理绕过列表已设置
) else (
    echo       ❌ 代理绕过列表设置失败
    goto :error
)

echo    3.2 配置WinHTTP代理...
netsh winhttp set proxy ${proxyServer} "<local>" >nul
if %errorLevel% equ 0 (
    echo       ✅ WinHTTP代理配置完成
) else (
    echo       ⚠️ WinHTTP代理配置可能失败
)
echo.

echo 🔄 步骤4: 刷新系统设置...
echo    4.1 刷新DNS缓存...
ipconfig /flushdns >nul
if %errorLevel% equ 0 (
    echo       ✅ DNS缓存已刷新
) else (
    echo       ⚠️ DNS缓存刷新可能失败
)

echo    4.2 通知系统设置更改...
REM 尝试刷新系统设置
rundll32.exe user32.dll,UpdatePerUserSystemParameters >nul 2>&1
echo       ✅ 系统设置已通知
echo.

echo ==========================================
echo 🎉 代理配置成功！
echo ==========================================
echo.
echo 📋 配置摘要:
echo   ✅ 管理员权限: 已确认
echo   ✅ 系统注册表: 已配置
echo   ✅ WinHTTP代理: 已配置
echo   ✅ 系统设置: 已刷新
echo.
echo 🔗 代理信息:
echo   代理服务器: ${proxyServer}
echo   用户名: ${username}
echo   密码: [已隐藏]
echo.
echo 🌐 验证步骤:
echo   1. 打开浏览器（建议Chrome或Edge）
echo   2. 访问 https://ip111.cn/
echo   3. 确认显示的IP地址为代理服务器IP
echo   4. 如果IP变化，说明配置成功！
echo.
echo 📞 技术支持:
echo   - 如果IP没有变化，请尝试以下操作:
echo     • 重启浏览器（Ctrl+Shift+R强制刷新）
echo     • 清除浏览器缓存（Ctrl+Shift+Delete）
echo     • 检查浏览器代理设置是否生效
echo     • 尝试访问其他网站确认代理
echo.

goto :success

:error
echo.
echo ❌ 配置过程中发生错误
echo.
echo 🔄 正在恢复备份配置...
if exist "%backupFile%" (
    reg import "%backupFile%" >nul 2>&1
    echo    ✅ 配置已恢复到备份状态
) else (
    echo    ⚠️ 无备份文件，请手动检查设置
)
echo.
echo 💡 故障排除建议:
echo   1. 确保以管理员身份运行此脚本
echo   2. 检查代理服务器是否可用
echo   3. 验证用户名和密码是否正确
echo   4. 尝试重新运行此脚本
echo.
echo 按任意键退出...
pause >nul
exit /b 1

:success
echo.
echo ⏹ 脚本执行完成！
echo 按任意键退出...
pause >nul
exit /b 0
`;

    // 创建Blob并下载
    const blob = new Blob([batScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Utils.showNotification('BAT配置脚本已下载，请以管理员身份运行', 'success');
}

// 生成增强版PowerShell代理配置脚本（简化版）
function generateEnhancedProxyScript(host, port, username, password) {
    const proxyServer = `${host}:${port}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `proxy-config-${timestamp}.ps1`;

    // 生成PowerShell脚本内容（简化版，英文）
    const powershellScript = `# Windows System Proxy Configuration Script
Write-Host "Starting proxy configuration..."

# Check administrator privileges
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Administrator privileges required!"
    Read-Host "Press any key to exit"
    exit 1
}

Write-Host "Configuring proxy: ${proxyServer}"
Set-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyEnable -Value 1
Set-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyServer -Value "${proxyServer}"
Set-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name ProxyOverride -Value "<local>"

netsh winhttp set proxy ${proxyServer} "<local>"
ipconfig /flushdns

Write-Host "Configuration completed!"
Read-Host "Press any key to exit"
`;

    // 创建Blob并下载
    const blob = new Blob([powershellScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Utils.showNotification('PowerShell script generated, please run as administrator', 'success');
}

// 生成纯英文BAT代理配置脚本（解决编码问题）
function generateCleanBatProxyScript(host, port, username, password) {
    const proxyServer = `${host}:${port}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `proxy-config-${timestamp}.bat`;

    // 完全纯英文的BAT脚本，无任何中文
    const batScript = `@echo off
setlocal enabledelayedexpansion

title Windows Proxy Configuration

echo ==========================================
echo     Windows Proxy Configuration
echo ==========================================
echo.
echo Configuration Info:
echo   Proxy Server: ${proxyServer}
echo   Username: ${username}
echo   Generated: %date% %time%
echo.

echo Press any key to start configuration...
pause >nul
echo.

echo Step 1: Checking administrator privileges...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Administrator privileges required!
    echo.
    echo SOLUTION:
    echo   1. Right-click this script file
    echo   2. Select "Run as administrator"
    echo   3. Click "Yes" on UAC prompt
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)
echo OK: Administrator privileges confirmed
echo.

echo Step 2: Backing up current configuration...
set "backupFile=%temp%\\proxy_backup_%random%.reg"
reg export "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" "%backupFile%" >nul 2>&1
if exist "%backupFile%" (
    echo OK: Current configuration backed up
) else (
    echo WARNING: Could not backup current configuration
)
echo.

echo Step 3: Configuring system proxy...
echo   3.1 Setting registry proxy configuration...

REM Enable proxy
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f >nul
if %errorLevel% equ 0 (
    echo OK: Proxy enabled
) else (
    echo ERROR: Failed to enable proxy
    goto :error
)

REM Set proxy server
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f >nul
if %errorLevel% equ 0 (
    echo OK: Proxy server set
) else (
    echo ERROR: Failed to set proxy server
    goto :error
)

REM Set proxy override list
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "<local>" /f >nul
if %errorLevel% equ 0 (
    echo OK: Proxy override list set
) else (
    echo ERROR: Failed to set proxy override list
    goto :error
)

echo   3.2 Configuring WinHTTP proxy...
netsh winhttp set proxy ${proxyServer} "<local>" >nul
if %errorLevel% equ 0 (
    echo OK: WinHTTP proxy configured
) else (
    echo WARNING: WinHTTP proxy configuration may have failed
)
echo.

echo Step 4: Refreshing system settings...
echo   4.1 Flushing DNS cache...
ipconfig /flushdns >nul
if %errorLevel% equ 0 (
    echo OK: DNS cache flushed
) else (
    echo WARNING: DNS cache flush may have failed
)

echo   4.2 Notifying system settings changes...
rundll32.exe user32.dll,UpdatePerUserSystemParameters >nul 2>&1
echo OK: System settings notified
echo.

echo ==========================================
echo SUCCESS: Proxy Configuration Completed!
echo ==========================================
echo.
echo SUMMARY:
echo   OK: Administrator privileges confirmed
echo   OK: System registry configured
echo   OK: WinHTTP proxy configured
echo   OK: System settings refreshed
echo.
echo PROXY INFO:
echo   Proxy Server: ${proxyServer}
echo   Username: ${username}
echo   Password: [Hidden]
echo.
echo VERIFICATION:
echo   1. Open browser (Chrome or Edge recommended)
echo   2. Visit https://ip111.cn/
echo   3. Confirm IP address shows proxy server IP
echo   4. If IP changed, configuration successful!
echo.
echo SUPPORT:
echo   If IP does not change:
echo   - Restart browser (Ctrl+Shift+R)
echo   - Clear browser cache (Ctrl+Shift+Delete)
echo   - Check browser proxy settings
echo   - Try visiting other websites to verify proxy
echo.

goto :success

:error
echo.
echo ERROR: Configuration failed
echo.
echo RECOVERY: Restoring backup configuration...
if exist "%backupFile%" (
    reg import "%backupFile%" >nul 2>&1
    echo OK: Configuration restored to backup state
) else (
    echo WARNING: No backup file available
)
echo.
echo TROUBLESHOOTING:
echo   1. Ensure script is run as administrator
echo   2. Check if proxy server is available
echo   3. Verify username and password are correct
echo   4. Try running this script again
echo.
echo Press any key to exit...
pause >nul
exit /b 1

:success
echo.
echo COMPLETE: Script execution finished!
echo Press any key to exit...
pause >nul
exit /b 0
`;

    // 创建Blob并下载
    const blob = new Blob([batScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Utils.showNotification('Clean BAT script downloaded, please run as administrator', 'success');
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