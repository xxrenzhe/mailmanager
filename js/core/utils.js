/**
 * MailManager - 工具函数和邮箱序列管理器
 * 提供邮箱编号管理和通用工具函数
 */

// 邮箱序列管理器
class EmailSequenceManager {
    constructor() {
        this.sequenceCache = new Map(); // 缓存邮箱->编号映射
        this.maxSequenceCache = 0; // 缓存当前最大编号
        this.initialized = false;
    }

    // 初始化序列管理器
    async initialize(accounts = []) {
        if (this.initialized) return;

        console.log('[EmailSequence] 初始化邮箱序列管理器...');

        // 预加载现有邮箱的编号映射
        this.loadExistingSequences(accounts);

        this.initialized = true;
        console.log(`[EmailSequence] 初始化完成，当前最大编号: ${this.maxSequenceCache}`);
    }

    // 加载现有序列
    loadExistingSequences(accounts) {
        this.sequenceCache.clear();
        let maxSequence = 0;

        accounts.forEach(account => {
            if (account.sequence && account.sequence > 0) {
                const normalizedEmail = account.email.toLowerCase();
                this.sequenceCache.set(normalizedEmail, account.sequence);
                maxSequence = Math.max(maxSequence, account.sequence);
            }
        });

        this.maxSequenceCache = maxSequence;
        console.log(`[EmailSequence] 加载了 ${this.sequenceCache.size} 个邮箱编号映射`);
    }

    // 为邮箱分配序列号
    async assignSequence(email) {
        await this.initialize();

        const normalizedEmail = email.toLowerCase().trim();

        // 检查缓存中是否已有编号
        if (this.sequenceCache.has(normalizedEmail)) {
            const existingSequence = this.sequenceCache.get(normalizedEmail);
            console.log(`[EmailSequence] 邮箱 ${email} 使用现有编号: ${existingSequence}`);
            return existingSequence;
        }

        // 分配新编号
        const newSequence = this.maxSequenceCache + 1;

        // 更新缓存
        this.sequenceCache.set(normalizedEmail, newSequence);
        this.maxSequenceCache = newSequence;

        console.log(`[EmailSequence] 邮箱 ${email} 分配新编号: ${newSequence}`);
        return newSequence;
    }

    // 批量分配序列号
    async batchAssignSequences(emails) {
        await this.initialize();

        const result = new Map();
        const newAssignments = [];

        // 第一遍：检查已有编号
        for (const email of emails) {
            const normalizedEmail = email.toLowerCase().trim();

            if (this.sequenceCache.has(normalizedEmail)) {
                const existingSequence = this.sequenceCache.get(normalizedEmail);
                result.set(email, existingSequence);
            } else {
                // 需要分配新编号
                newAssignments.push(email);
            }
        }

        // 第二遍：批量分配新编号
        if (newAssignments.length > 0) {
            const startSequence = this.maxSequenceCache + 1;

            for (let i = 0; i < newAssignments.length; i++) {
                const email = newAssignments[i];
                const newSequence = startSequence + i;
                const normalizedEmail = email.toLowerCase().trim();

                // 直接更新缓存
                this.sequenceCache.set(normalizedEmail, newSequence);
                result.set(email, newSequence);
            }

            // 更新最大编号缓存
            this.maxSequenceCache = startSequence + newAssignments.length - 1;

            console.log(`[EmailSequence] 批量分配 ${newAssignments.length} 个新编号: ${startSequence}-${this.maxSequenceCache}`);
        }

        return result;
    }

    // 获取邮箱的编号
    getEmailSequence(email) {
        const normalizedEmail = email.toLowerCase().trim();
        return this.sequenceCache.get(normalizedEmail) || null;
    }

    // 重建编号序列
    rebuildSequence(accounts) {
        console.log('[EmailSequence] 开始重建编号序列...');

        this.sequenceCache.clear();
        let currentSequence = 0;

        // 按创建时间排序所有账户
        const sortedAccounts = accounts.sort((a, b) =>
            new Date(a.created_at) - new Date(b.created_at)
        );

        const seenEmails = new Set();

        for (const account of sortedAccounts) {
            const normalizedEmail = account.email.toLowerCase().trim();

            if (!seenEmails.has(normalizedEmail)) {
                currentSequence++;
                this.sequenceCache.set(normalizedEmail, currentSequence);
                account.sequence = currentSequence; // 直接更新账户对象的序列号
                seenEmails.add(normalizedEmail);
            }
        }

        this.maxSequenceCache = currentSequence;
        console.log(`[EmailSequence] 重建完成，处理了 ${seenEmails.size} 个邮箱，当前最大编号: ${currentSequence}`);

        return currentSequence;
    }

    // 获取编号统计信息
    getSequenceStats() {
        return {
            total_accounts: this.sequenceCache.size,
            max_sequence: this.maxSequenceCache,
            next_sequence: this.maxSequenceCache + 1
        };
    }
}

// 通用工具函数
const Utils = {
    // 深拷贝对象
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    },

    // 防抖函数
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // 节流函数
    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // 格式化日期
    formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');

        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    },

    // 相对时间格式化
    timeAgo(date) {
        const now = new Date();
        const target = new Date(date);
        const diff = now - target;

        const minute = 60 * 1000;
        const hour = minute * 60;
        const day = hour * 24;

        if (diff < minute) {
            return '刚刚';
        } else if (diff < hour) {
            return `${Math.floor(diff / minute)}分钟前`;
        } else if (diff < day) {
            return `${Math.floor(diff / hour)}小时前`;
        } else {
            return `${Math.floor(diff / day)}天前`;
        }
    },

    // 生成UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // 复制到剪贴板
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.error('复制失败:', err);
            return false;
        }
    },

    // 验证邮箱格式
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    // 提取域名
    extractDomain(email) {
        const match = email.match(/@(.+)/);
        return match ? match[1] : null;
    },

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 获取状态颜色类
    getStatusColorClass(status) {
        const colorMap = {
            'pending': 'status-pending',
            'authorized': 'status-authorized',
            'error': 'status-error',
            'monitoring': 'status-pending monitoring'
        };
        return colorMap[status] || 'status-pending';
    },

    // 获取状态文本
    getStatusText(status) {
        const textMap = {
            'pending': '待授权',
            'authorized': '已授权',
            'error': '错误',
            'monitoring': '监控中'
        };
        return textMap[status] || '未知';
    },

    // 获取状态配置（包含图标和文本）
    getStatusConfig(status) {
        const configMap = {
            'pending': {
                icon: '🔄',
                text: '待授权'
            },
            'authorized': {
                icon: '✅',
                text: '已授权'
            },
            'error': {
                icon: '❌',
                text: '错误'
            },
            'monitoring': {
                icon: '👁️',
                text: '监控中'
            }
        };
        return configMap[status] || {
            icon: '❓',
            text: '未知'
        };
    },

    // 🔧 新验证码判断工具 - 基于存储时间基准的判断逻辑
    isNewVerificationCodeForScenario(account, code, scenario) {
        if (!code || !code.received_at) {
            return false;
        }

        const receivedTime = new Date(code.received_at).getTime();

        // 获取账户之前存储的最新验证码时间基准
        const baselineTime = account.last_code_time ? new Date(account.last_code_time).getTime() : 0;

        // 判断逻辑：新获取的验证码收件时间必须晚于存储的基准时间
        const isNewCode = receivedTime > baselineTime;

        console.log(`[新验证码检查-${scenario}] ${account.email}: ${code.code} → ${isNewCode ? '新验证码' : '历史验证码'}`);

        return isNewCode;
    },

    // 解析导入行数据 - 从 simple-mail-manager.html 复制的工作版本
    parseImportLine(line) {
        // 预处理：移除行首行尾空白
        line = line.trim();
        if (!line) {
            return null;
        }
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
            console.warn(`[Parse] 无效数据格式，期望4个字段，实际${parts.length}个:`, line);
            console.warn(`[Parse] 字段详情:`, parts.map((p, i) => `字段${i+1}: "${p}"`));
            return null;
        }
        const [email, password, client_id, refresh_token_enc] = parts;
        // 验证每个字段
        if (!email || !email.includes('@')) {
            console.warn(`[Parse] 无效的邮箱地址: "${email}"`);
            return null;
        }
        if (!client_id || client_id.length < 10) {
            console.warn(`[Parse] 无效的client_id: "${client_id}"`);
            return null;
        }
        if (!refresh_token_enc || refresh_token_enc.length < 10) {
            console.warn(`[Parse] 无效的refresh_token: "${refresh_token_enc?.substring(0, 20)}..."`);
            return null;
        }
        const result = {
            email: email.trim(),
            password: password ? password.trim() : '',
            client_id: client_id.trim(),
            refresh_token: refresh_token_enc.trim()
        };
                return result;
    },

    // 显示通知
    showNotification(message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type} fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 transform transition-all duration-300 translate-x-full`;

        // 根据类型设置样式
        const typeStyles = {
            'success': 'bg-green-500 text-white',
            'error': 'bg-red-500 text-white',
            'warning': 'bg-yellow-500 text-white',
            'info': 'bg-blue-500 text-white'
        };

        // 添加样式类
        const styleClass = typeStyles[type] || typeStyles['info'];
        notification.className += ` ${styleClass}`;

        // 设置消息内容
        notification.innerHTML = `
            <div class="flex items-center">
                <div class="flex-1">${message}</div>
                <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        // 添加到页面
        document.body.appendChild(notification);

        // 动画显示
        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);

        // 自动移除
        setTimeout(() => {
            if (notification.parentElement) {
                notification.classList.add('translate-x-full');
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 5000);
    }
};

// 导出到全局作用域
window.EmailSequenceManager = EmailSequenceManager;
window.Utils = Utils;