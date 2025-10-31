/**
 * 批量导入队列管理器
 * 处理大规模邮箱导入，避免触发API限制
 */

class BulkImportQueue {
    constructor(database, emailService, sequenceManager) {
        this.db = database;
        this.emailService = emailService;
        this.sequenceManager = sequenceManager;
        this.queue = [];
        this.processing = false;
        this.stats = {
            total: 0,
            processed: 0,
            successful: 0,
            failed: 0,
            pending: 0
        };

        // 优化后的批处理配置
        this.config = {
            batchSize: 50,           // 每批处理50个账户 (5x提升)
            batchDelay: 1000,        // 批次间隔1秒 (3x提升)
            authDelay: 100,          // 授权验证间隔100ms (5x提升)
            maxRetries: 3,           // 最大重试次数
            rateLimitDelay: 30000    // 触发限制时等待30秒 (2x提升)
        };

        // 导入会话管理
        this.sessions = new Map();
    }

    /**
     * 创建新的批量导入会话
     */
    createImportSession(importId, emails) {
        const session = {
            id: importId,
            emails: emails,
            startTime: new Date(),
            endTime: null,
            status: 'pending',
            results: [],
            errors: [],
            stats: {
                total: emails.length,
                processed: 0,
                successful: 0,
                failed: 0,
                pending: emails.length
            }
        };

        this.sessions.set(importId, session);
        console.log(`[BulkImport] 创建导入会话 ${importId}, 共 ${emails.length} 个邮箱`);

        return session;
    }

    /**
     * 启动批量导入
     */
    async startBulkImport(importId, emails) {
        const session = this.createImportSession(importId, emails);
        session.status = 'processing';

        try {
            // 立即将所有邮箱添加到数据库（状态为pending）
            const accountIds = await this.createAccountsInDatabase(emails);

            // 将账户ID加入会话
            session.accountIds = accountIds;

            // 异步开始授权处理，不阻塞前端响应
            this.processAuthorizationQueue(importId, accountIds);

            return {
                success: true,
                importId,
                message: `批量导入已启动，共 ${emails.length} 个邮箱，将在后台异步处理授权`,
                estimatedTime: this.calculateEstimatedTime(emails.length),
                stats: session.stats
            };

        } catch (error) {
            session.status = 'failed';
            session.errors.push(error.message);
            throw error;
        }
    }

    /**
     * 批量创建账户记录
     */
    async createAccountsInDatabase(emails) {
        console.log(`[BulkImport] 开始为 ${emails.length} 个邮箱分配序列编号...`);

        // 第一步：批量分配序列编号
        const emailList = emails.map(e => e.email);
        const sequenceMapping = await this.sequenceManager.assignSequencesBatch(emailList);

        const currentMaxSeq = await this.sequenceManager.getMaxSequence();
        const newSequencesCount = [...sequenceMapping.values()].filter(s => s > currentMaxSeq).length;
        console.log(`[BulkImport] 序列编号分配完成，其中 ${newSequencesCount} 个为新编号`);

        // 第二步：批量查询已存在的账户
        const existingAccounts = await this.db.batchGetAccountsByEmails(emailList);
        const existingEmailMap = new Map(existingAccounts.map(acc => [acc.email, acc]));

        // 第三步：准备数据
        const newAccounts = [];
        const accountIds = [];
        const updates = [];

        for (const emailData of emails) {
            const existingAccount = existingEmailMap.get(emailData.email);
            const assignedSequence = sequenceMapping.get(emailData.email);

            if (!assignedSequence) {
                console.error(`[BulkImport] 未找到邮箱的序列编号: ${emailData.email}`);
                continue;
            }

            if (existingAccount) {
                // 已存在的账户，检查是否需要更新序列编号
                if (existingAccount.import_seq !== assignedSequence) {
                    updates.push({
                        id: existingAccount.id,
                        import_seq: assignedSequence,
                        updated_at: new Date().toISOString()
                    });
                }
                accountIds.push(existingAccount.id);
            } else {
                // 新账户，准备批量插入数据
                newAccounts.push({
                    email: emailData.email.trim(),
                    client_id: emailData.client_id.trim(),
                    refresh_token_enc: emailData.refresh_token_enc.trim(),
                    import_seq: assignedSequence,
                    status: 'pending',
                    last_active_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    is_active: 1
                });
            }
        }

        // 第四步：批量执行数据库操作
        try {
            // 批量插入新账户
            if (newAccounts.length > 0) {
                const insertResults = await this.db.batchInsert('accounts', newAccounts, 100);
                insertResults.forEach(result => accountIds.push(result.id));
                console.log(`[BulkImport] 批量创建 ${newAccounts.length} 个新账户`);
            }

            // 批量更新序列编号（如果需要）
            if (updates.length > 0) {
                await this.db.run('BEGIN TRANSACTION');
                for (const update of updates) {
                    await this.db.run(
                        'UPDATE accounts SET import_seq = ?, updated_at = ? WHERE id = ?',
                        [update.import_seq, update.updated_at, update.id]
                    );
                }
                await this.db.run('COMMIT');
                console.log(`[BulkImport] 批量更新 ${updates.length} 个账户序列编号`);
            }

        } catch (error) {
            console.error('[BulkImport] 数据库操作失败:', error);
            throw error;
        }

        console.log(`[BulkImport] 成功处理 ${accountIds.length} 个账户记录`);
        return accountIds;
    }

    /**
     * 异步处理授权队列 - 修复版本
     */
    async processAuthorizationQueue(importId, accountIds) {
        const session = this.sessions.get(importId);
        if (!session) return;

        console.log(`[BulkImport] 开始异步授权处理: ${accountIds.length} 个账户`);

        let processedCount = 0;
        let errorCount = 0;

        // 分批处理授权验证
        for (let i = 0; i < accountIds.length; i += this.config.batchSize) {
            const batch = accountIds.slice(i, i + this.config.batchSize);
            console.log(`[BulkImport] 处理批次 ${Math.floor(i/this.config.batchSize) + 1}: ${batch.length} 个账户`);

            try {
                const results = await this.processBatchAuthorization(importId, batch);

                // 统计成功和失败的账户
                const successful = results.filter(r => r.status === 'success').length;
                const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length;

                processedCount += successful;
                errorCount += failed;

                console.log(`[BulkImport] 批次完成: 成功 ${successful}, 失败 ${failed}, 进度 ${processedCount}/${accountIds.length}`);

            } catch (error) {
                console.error(`[BulkImport] 批次 ${Math.floor(i/this.config.batchSize) + 1} 处理失败:`, error.message);
                errorCount += batch.length;

                // 检查是否是速率限制错误
                if (error.type === 'RATE_LIMIT_ERROR') {
                    console.log(`[BulkImport] 触发速率限制，等待 ${this.config.rateLimitDelay}ms`);
                    await new Promise(resolve => setTimeout(resolve, this.config.rateLimitDelay));
                }
            }

            // 批次间延迟
            if (i + this.config.batchSize < accountIds.length) {
                console.log(`[BulkImport] 等待 ${this.config.batchDelay}ms 后处理下一批...`);
                await new Promise(resolve => setTimeout(resolve, this.config.batchDelay));
            }
        }

        // 完成处理
        session.status = 'completed';
        session.endTime = new Date();
        session.stats.processed = processedCount;
        session.stats.successful = processedCount;
        session.stats.failed = errorCount;
        session.stats.pending = Math.max(0, accountIds.length - processedCount - errorCount);

        console.log(`[BulkImport] 导入会话 ${importId} 完成!`);
        console.log(`[BulkImport] 最终统计: 总计 ${accountIds.length}, 成功 ${processedCount}, 失败 ${errorCount}`);
    }

    /**
     * 处理单个批次的授权验证
     */
    async processBatchAuthorization(importId, accountIds) {
        const promises = accountIds.map(async (accountId, index) => {
            // 账户间的小延迟，避免并发过多请求
            await new Promise(resolve => setTimeout(resolve, this.config.authDelay * index));

            return await this.processSingleAccountAuthorization(importId, accountId);
        });

        const results = await Promise.allSettled(promises);
        return results;
    }

    /**
     * 处理单个账户的授权验证
     */
    async processSingleAccountAuthorization(importId, accountId) {
        const session = this.sessions.get(importId);
        if (!session) return;

        try {
            const account = await this.db.getAccount(accountId);
            if (!account || account.status === 'authorized') {
                return { accountId, status: 'skipped', reason: '账户已授权或不存在' };
            }

            console.log(`[BulkImport] 验证账户授权: ${account.email}`);

            // 执行授权验证
            const authorizationResult = await this.emailService.validateAuthorization(account);

            if (authorizationResult.authorized) {
                // 更新为已授权状态
                await this.db.updateAccount(accountId, {
                    status: 'authorized',
                    updated_at: new Date().toISOString()
                });

                // 安排后台邮件提取
                this.scheduleEmailExtraction(accountId);

                session.stats.successful++;

                return {
                    accountId,
                    email: account.email,
                    status: 'success',
                    message: '授权验证成功'
                };

            } else {
                // 授权失败，保持pending状态
                await this.db.updateAccount(accountId, {
                    status: 'pending',
                    updated_at: new Date().toISOString()
                });

                session.stats.failed++;
                session.errors.push({
                    accountId,
                    email: account.email,
                    error: authorizationResult.error
                });

                return {
                    accountId,
                    email: account.email,
                    status: 'failed',
                    error: authorizationResult.error
                };
            }

        } catch (error) {
            session.stats.failed++;
            session.errors.push({
                accountId,
                error: error.message
            });

            console.error(`[BulkImport] 账户 ${accountId} 授权验证失败:`, error.message);

            // 检查是否需要重试
            if (this.shouldRetry(error)) {
                return {
                    accountId,
                    status: 'retry',
                    error: error.message,
                    willRetry: true
                };
            }

            return {
                accountId,
                status: 'failed',
                error: error.message
            };
        } finally {
            session.stats.processed++;
            session.stats.pending = session.stats.total - session.stats.processed;
        }
    }

    /**
     * 安排后台邮件提取
     */
    scheduleEmailExtraction(accountId) {
        // 延迟提取，避免与授权验证冲突
        setTimeout(async () => {
            try {
                const account = await this.db.getAccount(accountId);
                if (account && account.status === 'authorized') {
                    const extractedCodes = await this.emailService.extractRecentCodes(account);

                    if (extractedCodes.length > 0) {
                        // 保存验证码到数据库（通过Database的方法）
                        for (const codeData of extractedCodes) {
                            await this.db.createCode({
                                account_id: accountId,
                                code: codeData.code,
                                subject: codeData.subject,
                                sender: codeData.sender,
                                received_at: codeData.received_at,
                                created_at: new Date().toISOString()
                            });
                        }

                        // 更新账户的最后活跃时间
                        const latestCode = extractedCodes[0];
                        await this.db.updateAccount(accountId, {
                            last_active_at: latestCode.received_at,
                            updated_at: new Date().toISOString()
                        });

                        console.log(`[BulkImport] 账户 ${accountId} 邮件提取完成: ${extractedCodes.length} 个验证码`);
                    }
                }
            } catch (error) {
                console.error(`[BulkImport] 账户 ${accountId} 邮件提取失败:`, error.message);
            }
        }, Math.random() * 5000 + 5000); // 5-10秒随机延迟
    }

    /**
     * 判断是否应该重试
     */
    shouldRetry(error) {
        // 速率限制错误应该重试
        if (error.type === 'RATE_LIMIT_ERROR') {
            return true;
        }

        // 网络错误应该重试
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            return true;
        }

        return false;
    }

    /**
     * 获取导入状态
     */
    getImportStatus(importId) {
        const session = this.sessions.get(importId);
        if (!session) {
            return { error: '导入会话不存在' };
        }

        return {
            importId: session.id,
            status: session.status,
            stats: session.stats,
            startTime: session.startTime,
            endTime: session.endTime,
            estimatedCompletion: this.calculateEstimatedCompletion(session),
            errors: session.errors.slice(-10) // 只返回最近10个错误
        };
    }

    /**
     * 计算预估处理时间
     */
    calculateEstimatedTime(count) {
        const { batchSize, batchDelay, authDelay } = this.config;
        const batchesNeeded = Math.ceil(count / batchSize);
        const totalBatchTime = batchesNeeded * batchDelay;
        const totalAuthTime = count * authDelay;
        const estimatedMs = totalBatchTime + totalAuthTime;

        return {
            milliseconds: estimatedMs,
            seconds: Math.ceil(estimatedMs / 1000),
            minutes: Math.ceil(estimatedMs / 60000)
        };
    }

    /**
     * 计算预估完成时间
     */
    calculateEstimatedCompletion(session) {
        if (session.status === 'completed') {
            return session.endTime;
        }

        const elapsed = Date.now() - session.startTime.getTime();
        const rate = session.stats.processed / elapsed;
        const remaining = session.stats.pending / rate;

        return new Date(Date.now() + remaining);
    }

    /**
     * 清理旧的导入会话
     */
    cleanupOldSessions(maxAge = 24 * 60 * 60 * 1000) { // 24小时
        const cutoff = Date.now() - maxAge;

        for (const [id, session] of this.sessions.entries()) {
            if (session.startTime.getTime() < cutoff) {
                this.sessions.delete(id);
                console.log(`[BulkImport] 清理过期会话: ${id}`);
            }
        }
    }
}

module.exports = BulkImportQueue;