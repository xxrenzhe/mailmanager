const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const AdvancedVerificationExtractor = require('./advancedVerificationExtractor');

class EmailService {
    constructor() {
        this.db = null; // 将在初始化时注入
        this.advancedExtractor = new AdvancedVerificationExtractor();
        this.useAdvancedExtractor = true; // 可以通过配置控制是否使用高级提取器
    }

    /**
     * 设置数据库连接
     */
    setDatabase(db) {
        this.db = db;
    }

    /**
     * 使用refresh token获取新的access token（仅支持Microsoft Outlook）
     * 带缓存机制，优先使用数据库中的有效token
     */
    async getAccessToken(accountId, refreshToken, clientId) {
        try {
            // 首先检查数据库中是否有有效的token
            if (this.db && accountId) {
                const cachedToken = await this.db.getValidAccessToken(accountId);
                if (cachedToken) {
                    console.log(`[EmailService] 使用缓存的有效token，账户ID: ${accountId}`);
                    return cachedToken;
                }
            }

            // 获取新的token
            const newToken = await this.getMicrosoftAccessToken(refreshToken, clientId);

            // 如果获取成功且有数据库连接，缓存token
            if (this.db && accountId && newToken) {
                // Microsoft通常返回3600秒（1小时）的过期时间
                const expiresIn = 3600;
                await this.db.updateAccessToken(accountId, newToken, expiresIn);
                console.log(`[EmailService] 缓存新的access_token，账户ID: ${accountId}`);
            }

            return newToken;
        } catch (error) {
            console.error('[EmailService] 获取access token失败:', error);
            throw error;
        }
    }

    /**
     * 获取Microsoft Access Token
     */
    async getMicrosoftAccessToken(refreshToken, clientId) {
        const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('refresh_token', refreshToken);
        params.append('grant_type', 'refresh_token');
        params.append('scope', 'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/Mail.ReadWrite https://outlook.office.com/SMTP.Send');

        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params
        });

        if (!response.ok) {
            throw new Error(`Microsoft token refresh failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.access_token;
    }

    /**
     * 检查邮箱的最近邮件（仅支持Outlook）
     * 增强版本：支持去重机制和性能优化
     */
    async checkEmails(accountId, refreshToken, clientId, sinceHours = 24) {
        try {
            const accessToken = await this.getAccessToken(accountId, refreshToken, clientId);
            return await this.checkOutlookEmails(accessToken, accountId, sinceHours);
        } catch (error) {
            console.error('[EmailService] 检查邮件失败:', error);
            throw error;
        }
    }

  
    /**
     * 检查Outlook邮箱的最近邮件（使用Outlook REST API）
     * 增强版本：支持去重机制和性能优化
     */
    async checkOutlookEmails(accessToken, accountId = null, sinceHours = 24) {
        const startTime = Date.now();
        try {
            console.log(`[EmailService] 开始处理账户 ${accountId || 'unknown'} 的邮件检查`);

            // 移除时间限制，只获取最近5封邮件
            const endpoint = `https://outlook.office.com/api/v2.0/me/messages?$orderby=ReceivedDateTime desc&$top=5`;

            const fetchStartTime = Date.now();
            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                }
            });
            const fetchTime = Date.now() - fetchStartTime;
            console.log(`[EmailService] API调用耗时: ${fetchTime}ms`);

            if (!response.ok) {
                throw new Error(`Outlook API调用失败: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const messages = data.value || [];
            console.log(`[EmailService] 获取到 ${messages.length} 封邮件`);

            // 处理邮件去重和验证码提取
            const results = await this.processMessagesWithDeduplication(messages, accountId);

            const totalTime = Date.now() - startTime;
            console.log(`[EmailService] 邮件处理完成，总耗时: ${totalTime}ms`);

            return results;
        } catch (error) {
            console.error('[EmailService] Outlook检查失败:', error);
            throw error;
        }
    }

    /**
     * 从邮件中提取验证码 - 支持高级和基础两种模式
     */
    extractVerificationCodes(messages) {
        try {
            if (this.useAdvancedExtractor) {
                console.log(`[EmailService] 使用高级验证码提取器处理 ${messages.length} 封邮件`);
                const advancedResults = this.advancedExtractor.extractVerificationCodes(messages);
                console.log(`[EmailService] 高级提取器找到 ${advancedResults.length} 个验证码候选`);

                // 转换为标准格式并过滤
                const filteredResults = advancedResults
                    .filter(item => item.validation && item.validation.valid)
                    .map(item => ({
                        code: item.code,
                        subject: item.subject,
                        sender: item.sender,
                        received_at: item.received_at,
                        messageId: item.messageId,
                        score: item.score,
                        priority: item.priority,
                        reason: item.validation?.reason || 'Valid'
                    }));

                console.log(`[EmailService] 高级提取器最终验证通过: ${filteredResults.length} 个验证码`);

                // 去重（保留最高分数的）
                const uniqueCodes = this.deduplicateVerificationCodes(filteredResults);
                return uniqueCodes;
            } else {
                // 使用原有的基础提取器
                return this.extractVerificationCodesBasic(messages);
            }
        } catch (error) {
            console.error('[EmailService] 高级提取器失败，回退到基础提取器:', error);
            return this.extractVerificationCodesBasic(messages);
        }
    }

    /**
     * 基础验证码提取器（原有逻辑）
     */
    extractVerificationCodesBasic(messages) {
        console.log(`[EmailService] 使用基础验证码提取器处理 ${messages.length} 封邮件`);

        const verificationCodes = [];
        const verificationPatterns = [
            // 常见的验证码模式
            /\b\d{4,8}\b/g,  // 4-8位数字
            /(?:code|verification|验证码)[\s:：]*(\d{4,8})/gi,
            /(?:verification code|验证码)[\s:：]*(\d{4,8})/gi,
            /(?:pin|密码)[\s:：]*(\d{4,8})/gi,
            // 邮件标题中的验证码
            /^\[.*?(\d{4,8}).*?\]/gm,
            // 包含"验证"的数字组合
            /(?:验证|verification).*?(\d{4,8})/gi
        ];

        for (const message of messages) {
            // 支持Outlook REST API和Microsoft Graph API两种格式
            const subject = message.Subject || message.subject || '无标题';
            const from = message.From || message.from;
            const receivedDateTime = message.ReceivedDateTime || message.receivedDateTime;
            const messageId = message.Id || message.id;

            // 支持不同的body格式，但只提取纯文本内容
            let bodyContent = message.Body?.Content || message.body?.content || message.body?.preview || '';

            // 清理HTML内容，只保留可见文本
            if (bodyContent && bodyContent.includes('<')) {
                // 简单的HTML标签清理
                bodyContent = bodyContent
                    .replace(/<script[^>]*>.*?<\/script>/gis, '') // 移除脚本
                    .replace(/<style[^>]*>.*?<\/style>/gis, '')   // 移除样式
                    .replace(/<[^>]*>/g, ' ')                      // 移除HTML标签
                    .replace(/\s+/g, ' ')                         // 合并空白字符
                    .trim();
            }

            const emailContent = `${subject} ${bodyContent}`;

            // 获取发件人信息
            const senderName = from?.EmailAddress?.Name || from?.emailAddress?.name || from?.emailAddress?.address || '未知发件人';

            for (const pattern of verificationPatterns) {
                const matches = emailContent.match(pattern);
                if (matches) {
                    for (const match of matches) {
                        const code = match.replace(/\D/g, ''); // 只保留数字
                        if (code.length >= 4 && code.length <= 8) {
                            // 改进：过滤明显不合理的验证码
                            if (this.isValidVerificationCode(code, emailContent)) {
                                verificationCodes.push({
                                    code,
                                    subject,
                                    sender: senderName,
                                    received_at: receivedDateTime,
                                    messageId,
                                    source: 'basic'
                                });
                                break; // 一封邮件只取一个验证码
                            }
                        }
                    }
                    break; // 找到验证码就停止尝试其他模式
                }
            }
        }

        // 去重并按时间排序
        const uniqueCodes = this.deduplicateVerificationCodes(verificationCodes);
        console.log(`[EmailService] 基础提取器最终验证通过: ${uniqueCodes.length} 个验证码`);

        return uniqueCodes.sort((a, b) =>
            new Date(b.received_at) - new Date(a.received_at)
        );
    }

    /**
     * 验证码去重 - 保留最高分数的版本
     */
    deduplicateVerificationCodes(codes) {
        const codeMap = new Map();

        for (const codeItem of codes) {
            const existing = codeMap.get(codeItem.code);

            if (!existing ||
                (codeItem.score && codeItem.score > (existing.score || 0)) ||
                (!codeItem.score && new Date(codeItem.received_at) > new Date(existing.received_at))) {

                codeMap.set(codeItem.code, {
                    code: codeItem.code,
                    subject: codeItem.subject,
                    sender: codeItem.sender,
                    received_at: codeItem.received_at,
                    messageId: codeItem.messageId,
                    source: codeItem.source || 'advanced',
                    score: codeItem.score || 1.0,
                    priority: codeItem.priority || 'medium',
                    reason: codeItem.reason || 'Valid'
                });
            }
        }

        return Array.from(codeMap.values())
            .sort((a, b) => {
                // 首先按分数排序
                if (Math.abs(a.score - b.score) > 0.1) {
                    return b.score - a.score;
                }
                // 分数相同时按时间排序
                return new Date(b.received_at) - new Date(a.received_at);
            });
    }

    /**
     * 检查单个账户的邮件（用于监控器）
     */
    async checkAccountEmails(account, db = null) {
        const startTime = Date.now();
        try {
            const { refresh_token_enc, client_id, id } = account;

            if (!refresh_token_enc || !client_id) {
                throw new Error('账户缺少认证信息');
            }

            // 设置数据库连接以支持去重功能
            if (db) {
                this.setDatabase(db);
            }

            console.log(`[EmailService] 开始检查账户 ${id} 的邮件`);
            const codes = await this.checkEmails(id, refresh_token_enc, client_id, 1); // 只检查最近1小时
            const processingTime = Date.now() - startTime;
            console.log(`[EmailService] 账户 ${id} 邮件检查完成，耗时: ${processingTime}ms`);

            if (codes.length > 0) {
                const latestCode = codes[0];

                // 如果有数据库连接，更新账户的最后活跃时间为最新邮件时间
                if (db && latestCode.received_at) {
                    try {
                        await db.updateAccount(id, {
                            last_active_at: latestCode.received_at
                        });
                        console.log(`[EmailService] 更新账户 ${id} 活跃时间: ${latestCode.received_at}`);
                    } catch (dbError) {
                        console.warn(`[EmailService] 更新活跃时间失败:`, dbError.message);
                    }
                }

                return {
                    hasNewCode: true,
                    code: latestCode.code,
                    subject: latestCode.subject,
                    sender: latestCode.sender,
                    received_at: latestCode.received_at,
                    messageId: latestCode.messageId
                };
            }

            return {
                hasNewCode: false,
                message: '无新验证码'
            };
        } catch (error) {
            console.error('[EmailService] 检查账户邮件失败:', error);
            return {
                hasNewCode: false,
                error: error.message
            };
        }
    }

    /**
     * 验证账户授权（增强版本：真实API测试）
     */
    async validateAuthorization(account) {
        try {
            const { refresh_token_enc, client_id, id } = account;

            if (!refresh_token_enc || !client_id) {
                console.warn('[EmailService] 账户缺少认证信息，无法验证授权');
                return { authorized: false, error: '缺少认证信息', needsReauth: true };
            }

            console.log(`[EmailService] 验证账户 ${id} 的授权状态...`);

            // 1. 尝试获取access token
            const accessToken = await this.getAccessToken(id, refresh_token_enc, client_id);

            if (!accessToken) {
                console.log(`[EmailService] 账户 ${id} 授权验证失败：无法获取access token`);
                return { authorized: false, error: '无法获取access token', needsReauth: true };
            }

            // 2. 真实API测试 - 尝试获取最新1封邮件
            try {
                const testEndpoint = `https://outlook.office.com/api/v2.0/me/messages?$orderby=ReceivedDateTime desc&$top=1`;
                const response = await fetch(testEndpoint, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    }
                });

                if (response.ok) {
                    console.log(`[EmailService] 账户 ${id} 授权验证成功（API测试通过）`);
                    return { authorized: true, accessToken: true };
                } else if (response.status === 401) {
                    console.log(`[EmailService] 账户 ${id} API测试失败：401 Unauthorized`);
                    return { authorized: false, error: 'API访问权限不足', needsReauth: true };
                } else if (response.status === 503) {
                    console.log(`[EmailService] 账户 ${id} API测试失败：503 Service Unavailable`);
                    return { authorized: false, error: 'Outlook服务不可用', needsReauth: false };
                } else {
                    console.log(`[EmailService] 账户 ${id} API测试失败：${response.status} ${response.statusText}`);
                    return { authorized: false, error: `API错误: ${response.status}`, needsReauth: true };
                }
            } catch (apiError) {
                console.log(`[EmailService] 账户 ${id} API测试异常：${apiError.message}`);
                return { authorized: false, error: `API测试失败: ${apiError.message}`, needsReauth: true };
            }

        } catch (error) {
            console.error(`[EmailService] 账户授权验证失败:`, error.message);
            return { authorized: false, error: error.message, needsReauth: true };
        }
    }

  /**
     * 处理邮件去重和验证码提取
     * @param {Array} messages - 邮件列表
     * @param {number} accountId - 账户ID
     * @returns {Array} 验证码列表
     */
    async processMessagesWithDeduplication(messages, accountId) {
        if (!this.db || !accountId) {
            console.log(`[EmailService] 数据库未连接或账户ID为空，跳过去重检查`);
            return this.extractVerificationCodes(messages);
        }

        const startTime = Date.now();
        const uniqueMessages = [];
        const duplicateCount = [];
        let processedCount = 0;
        let skippedCount = 0;

        console.log(`[EmailService] 开始邮件去重检查，共 ${messages.length} 封邮件`);

        // 检查每封邮件是否已经处理过
        for (const message of messages) {
            const messageId = message.Id || message.id;
            if (!messageId) {
                console.warn(`[EmailService] 邮件缺少ID，跳过去重检查`);
                uniqueMessages.push(message);
                continue;
            }

            try {
                // 检查邮件是否已经处理过
                const isProcessed = await this.db.isEmailProcessed(accountId, messageId);

                if (isProcessed) {
                    console.log(`[EmailService] 跳过已处理的邮件: ${messageId}`);
                    skippedCount++;
                    duplicateCount.push(messageId);
                    continue;
                }

                uniqueMessages.push(message);
                processedCount++;

                // 记录处理历史（在异步处理，不阻塞主流程）
                this.recordEmailProcessingAsync(accountId, messageId, startTime).catch(error => {
                    console.warn(`[EmailService] 记录邮件处理历史失败:`, error.message);
                });

            } catch (error) {
                console.error(`[EmailService] 检查邮件处理状态失败:`, error.message);
                // 如果检查失败，仍然处理这封邮件
                uniqueMessages.push(message);
                processedCount++;
            }
        }

        console.log(`[EmailService] 去重完成: 处理 ${processedCount} 封，跳过 ${skippedCount} 封重复邮件`);

        // 提取验证码
        const extractStartTime = Date.now();
        const results = this.extractVerificationCodes(uniqueMessages);
        const extractTime = Date.now() - extractStartTime;

        const totalTime = Date.now() - startTime;
        console.log(`[EmailService] 验证码提取耗时: ${extractTime}ms，总处理耗时: ${totalTime}ms`);

        // 异步记录处理统计信息
        this.recordProcessingStatsAsync(accountId, processedCount, skippedCount, totalTime).catch(error => {
            console.warn(`[EmailService] 记录处理统计失败:`, error.message);
        });

        return results;
    }

    /**
     * 异步记录邮件处理历史
     */
    async recordEmailProcessingAsync(accountId, messageId, startTime) {
        try {
            const processingTime = Date.now() - startTime;
            await this.db.createEmailProcessingHistory({
                account_id: accountId,
                message_id: messageId,
                processed_at: new Date().toISOString(),
                processing_time_ms: processingTime,
                codes_found: 0, // 将在提取后更新
                status: 'success'
            });
        } catch (error) {
            console.error(`[EmailService] 记录邮件处理历史失败:`, error);
        }
    }

    /**
     * 异步记录处理统计信息
     */
    async recordProcessingStatsAsync(accountId, processedCount, skippedCount, totalTime) {
        try {
            console.log(`[EmailService] 账户 ${accountId} 处理统计: 处理 ${processedCount} 封，跳过 ${skippedCount} 封，耗时 ${totalTime}ms`);

            // 可以在这里添加更多的统计逻辑，比如更新缓存等
            if (totalTime > 5000) {
                console.warn(`[EmailService] 警告: 账户 ${accountId} 处理时间超过5秒: ${totalTime}ms`);
            }
        } catch (error) {
            console.error(`[EmailService] 记录处理统计失败:`, error);
        }
    }

    /**
     * 批量提取最近24小时的验证码（用于新导入的账户）
     */
    async extractRecentCodes(account) {
        try {
            const { refresh_token_enc, client_id, id } = account;

            if (!refresh_token_enc || !client_id) {
                console.warn('[EmailService] 账户缺少认证信息，跳过验证码提取');
                return [];
            }

            const codes = await this.checkEmails(id, refresh_token_enc, client_id, 24);
            console.log(`[EmailService] 为账户 ${id} 提取到 ${codes.length} 个验证码`);

            return codes;
        } catch (error) {
            console.error('[EmailService] 提取最近验证码失败:', error);
            return [];
        }
    }
  /**
     * 批量授权验证 - 性能优化版本
     * @param {Array} accounts 账户列表
     * @param {number} concurrency 并发数量
     * @returns {Array} 验证结果
     */
    async batchValidateAuthorization(accounts, concurrency = 10) {
        if (!accounts || accounts.length === 0) return [];

        console.log(`[EmailService] 开始批量授权验证: ${accounts.length} 个账户，并发数: ${concurrency}`);

        const results = [];
        const chunks = this.chunkArray(accounts, concurrency);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`[EmailService] 处理批次 ${i + 1}/${chunks.length} (${chunk.length} 个账户)`);

            const chunkPromises = chunk.map(async (account, index) => {
                // 小延迟避免API速率限制
                await new Promise(resolve => setTimeout(resolve, 50 * index));
                return await this.validateAuthorization(account);
            });

            const chunkResults = await Promise.allSettled(chunkPromises);
            results.push(...chunkResults);

            // 批次间延迟
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        const successful = results.filter(r => r.value?.authorized).length;
        const failed = results.length - successful;
        console.log(`[EmailService] 批量授权完成: ${successful} 成功, ${failed} 失败`);

        return results;
    }

    /**
     * 批量提取验证码 - 性能优化版本
     * @param {Array} accounts 账户列表
     * @param {number} concurrency 并发数量
     * @returns {Array} 提取结果
     */
    async batchExtractRecentCodes(accounts, concurrency = 5) {
        if (!accounts || accounts.length === 0) return [];

        console.log(`[EmailService] 开始批量提取验证码: ${accounts.length} 个账户，并��数: ${concurrency}`);

        const results = [];
        const chunks = this.chunkArray(accounts, concurrency);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`[EmailService] 提取批次 ${i + 1}/${chunks.length} (${chunk.length} 个账户)`);

            const chunkPromises = chunk.map(async (account, index) => {
                // 延迟避免API冲突
                await new Promise(resolve => setTimeout(resolve, 200 * index));
                return {
                    accountId: account.id,
                    codes: await this.extractRecentCodes(account)
                };
            });

            const chunkResults = await Promise.allSettled(chunkPromises);
            results.push(...chunkResults);

            // 批次间延迟
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const totalCodes = results.reduce((sum, r) => sum + (r.value?.codes?.length || 0), 0);
        console.log(`[EmailService] 批量提取完成: ${totalCodes} 个验证码`);

        return results;
    }

    /**
     * 数组分块工具方法
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * 智能重试机制 - 带指数退避
     */
    async withRetry(operation, maxRetries = 3, baseDelay = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const isRetryable = this.isRetryableError(error);
                const isRateLimit = error.message?.includes('rate limit') || error.status === 429;

                if (!isRetryable || attempt === maxRetries) {
                    throw error;
                }

                const delay = isRateLimit
                    ? baseDelay * Math.pow(2, attempt - 1) * 2 // 速率限制时加倍延迟
                    : baseDelay * Math.pow(2, attempt - 1);

                console.log(`[EmailService] 第 ${attempt} 次重试，延迟 ${delay}ms: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * 判断错误是否可重试
     */
    isRetryableError(error) {
        const retryablePatterns = [
            /rate limit/i,
            /timeout/i,
            /network/i,
            /connection/i,
            /ECONNRESET/i,
            /ETIMEDOUT/i,
            /502/i,
            /503/i,
            /504/i
        ];

        return retryablePatterns.some(pattern => pattern.test(error.message)) ||
               [429, 502, 503, 504].includes(error.status);
    }

    /**
     * 验证验证码的有效性 - 改进版本
     */
    isValidVerificationCode(code, content) {
        // 基本长度检查
        if (!code || code.length < 4 || code.length > 8) {
            return false;
        }

        // 过滤明显不合理的验证码
        const invalidCodes = [
            '000000', '111111', '222222', '333333', '444444', '555555',
            '666666', '777777', '888888', '999999', '123456', '12345678'
        ];

        if (invalidCodes.includes(code)) {
            console.log(`[EmailService] 过滤无效验证码: ${code}`);
            return false;
        }

        // 过滤年份（2020-2030）和其他明显的非验证码数字
        const yearRegex = /^20(2[0-9]|3[0-9])$/;
        if (yearRegex.test(code)) {
            console.log(`[EmailService] 过滤年份数字: ${code}`);
            return false;
        }

        // 过滤常见的ID、序列号等
        const commonIds = ['12345', '1234567', '987654', '1234567'];
        if (commonIds.includes(code)) {
            console.log(`[EmailService] 过滤常见ID: ${code}`);
            return false;
        }

        // 过滤美国邮编（5位数字）
        if (/^\d{5}$/.test(code)) {
            console.log(`[EmailService] 过滤美国邮编: ${code}`);
            return false;
        }

        // 过滤常见电话号码模式
        if (code.startsWith('800') || code.startsWith('888') || code.startsWith('900')) {
            console.log(`[EmailService] 过滤电话号码: ${code}`);
            return false;
        }

        // 检查是否在合理的上下文中
        const lowerContent = content.toLowerCase();

        // 验证相关的关键词
        const verificationKeywords = [
            'verification', 'code', '验证码', '验证', 'confirm', '确认',
            'access', '登录', 'login', 'authenticate', '授权',
            'otp', 'pin', 'password', '密码', 'security', '安全',
            'welcome', 'temporary', 'final'
        ];

        const hasKeyword = verificationKeywords.some(keyword =>
            lowerContent.includes(keyword)
        );

        // 如果没有验证相关关键词，可能是其他数字（如年份、电话等）
        if (!hasKeyword) {
            console.log(`[EmailService] 过滤非验证码上下文: ${code}`);
            return false;
        }

        // 特殊处理：如果包含"temporary"关键词，则该验证码可能是临时的
        if (lowerContent.includes('temporary') || lowerContent.includes('临时')) {
            console.log(`[EmailService] 警告: 可能是临时代码: ${code}`);
            // 仍然返回true，但记录警告
        }

        return true;
    }
}

module.exports = EmailService;