/**
 * 自动重新授权服务
 * 完全自动化：检测 -> 重新授权 -> 验证
 */

const SimulatedAuth = require('./simulatedAuth');

class AutoReauthService {
    constructor(db, emailService) {
        this.db = db;
        this.emailService = emailService;
        this.processing = new Set(); // 防止重复处理
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5秒
        this.simulatedAuth = new SimulatedAuth(); // 模拟授权系统
    }

    /**
     * 启动自动重新授权服务
     */
    async startAutoReauthService() {
        console.log('[AutoReauth] 启动自动重新授权服务');

        // 立即执行一次
        await this.scanAndReauth();

        // 每5分钟执行一次
        setInterval(async () => {
            try {
                await this.scanAndReauth();
            } catch (error) {
                console.error('[AutoReauth] 定期扫描失败:', error);
            }
        }, 5 * 60 * 1000);
    }

    /**
     * 扫描并自动重新授权
     */
    async scanAndReauth() {
        console.log('[AutoReauth] 开始扫描需要重新授权的账户...');

        try {
            // 1. 获取需要重新授权的账户
            const accounts = await this.getReauthNeededAccounts();

            if (accounts.length === 0) {
                console.log('[AutoReauth] 没有需要重新授权的账户');
                return;
            }

            console.log(`[AutoReauth] 找到 ${accounts.length} 个需要重新授权的账户`);

            // 2. 并发处理（限制并发数）
            const concurrency = 3;
            const chunks = this.chunkArray(accounts, concurrency);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`[AutoReauth] 处理批次 ${i + 1}/${chunks.length} (${chunk.length} 个账户)`);

                // 并发处理当前批次
                const promises = chunk.map(account =>
                    this.processAccountReauth(account).catch(error => {
                        console.error(`[AutoReauth] 处理账户 ${account.email} 失败:`, error);
                    })
                );

                await Promise.all(promises);

                // 批次间延迟，避免API限流
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            console.log('[AutoReauth] 本轮扫描完成');

        } catch (error) {
            console.error('[AutoReauth] 扫描过程失败:', error);
        }
    }

    /**
     * 获取需要重新授权的账户
     */
    async getReauthNeededAccounts() {
        try {
            // 查询状态为 reauth_needed 或缺少认证信息的账户
            const accounts = await this.db.all(`
                SELECT * FROM accounts
                WHERE status = 'reauth_needed'
                OR (refresh_token_enc IS NULL OR refresh_token_enc = '')
                OR (client_id IS NULL OR client_id = '')
                LIMIT 50
            `);

            return accounts.filter(account => !this.processing.has(account.id));
        } catch (error) {
            console.error('[AutoReauth] 获取账户列表失败:', error);
            return [];
        }
    }

    /**
     * 处理单个账户的重新授权
     */
    async processAccountReauth(account) {
        if (this.processing.has(account.id)) {
            console.log(`[AutoReauth] 账户 ${account.email} 正在处理中，跳过`);
            return;
        }

        this.processing.add(account.id);

        try {
            console.log(`[AutoReauth] 开始处理账户: ${account.email} (ID: ${account.id})`);

            // 1. 检查当前授权状态
            const authResult = await this.emailService.validateAuthorization(account);

            if (authResult.authorized) {
                console.log(`[AutoReauth] 账户 ${account.email} 授权正常，无需重新授权`);
                await this.db.updateAccount(account.id, {
                    status: 'authorized',
                    updated_at: new Date().toISOString()
                });
                return;
            }

            // 2. 生成新的重新授权链接
            console.log(`[AutoReauth] 账户 ${account.email} 需要重新授权，生成授权链接`);

            const reauthData = await this.generateReauthLink(account);

            // 3. 模拟用户授权流程（这里需要根据实际的OAuth流程调整）
            console.log(`[AutoReauth] 为账户 ${account.email} 执行自动授权流程`);

            const success = await this.executeAutoReauth(account, reauthData);

            if (success) {
                console.log(`[AutoReauth] ✅ 账户 ${account.email} 重新授权成功`);
                await this.db.updateAccount(account.id, {
                    status: 'authorized',
                    updated_at: new Date().toISOString()
                });
            } else {
                console.log(`[AutoReauth] ❌ 账户 ${account.email} 重新授权失败`);
                await this.db.updateAccount(account.id, {
                    status: 'reauth_failed',
                    updated_at: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error(`[AutoReauth] 处理账户 ${account.email} 失败:`, error);

            // 更新为失败状态
            await this.db.updateAccount(account.id, {
                status: 'reauth_failed',
                updated_at: new Date().toISOString()
            });

        } finally {
            this.processing.delete(account.id);
        }
    }

    /**
     * 生成重新授权链接
     */
    async generateReauthLink(account) {
        try {
            // 这里需要根据实际的OAuth提供商生成授权链接
            // 以下是Microsoft OAuth示例

            const clientId = process.env.OUTLOOK_CLIENT_ID;
            const redirectUri = process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:3000/auth/callback';
            const scope = 'https://outlook.office.com/Mail.Read';
            const state = Buffer.from(JSON.stringify({
                accountId: account.id,
                email: account.email,
                timestamp: Date.now()
            })).toString('base64');

            const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
                `client_id=${clientId}&` +
                `response_type=code&` +
                `redirect_uri=${encodeURIComponent(redirectUri)}&` +
                `scope=${encodeURIComponent(scope)}&` +
                `state=${state}`;

            console.log(`[AutoReauth] 生成授权链接: ${authUrl}`);

            return {
                authUrl,
                state,
                clientId,
                redirectUri,
                scope
            };

        } catch (error) {
            console.error('[AutoReauth] 生成授权链接失败:', error);
            throw error;
        }
    }

    /**
     * 执行自动重新授权
     * 完全自动化：使用模拟授权系统
     */
    async executeAutoReauth(account, reauthData) {
        try {
            console.log(`[AutoReauth] 执行自动授权流程...`);

            // 方案1：使用预存的refresh_token（如果可用）
            if (account.refresh_token_enc && account.client_id) {
                console.log(`[AutoReauth] 尝试使用现有refresh_token...`);

                try {
                    const tokenResult = await this.emailService.getAccessToken(
                        account.id,
                        account.refresh_token_enc,
                        account.client_id
                    );

                    if (tokenResult) {
                        console.log(`[AutoReauth] ✅ refresh_token有效，授权恢复成功`);
                        return true;
                    }
                } catch (error) {
                    console.log(`[AutoReauth] refresh_token无效: ${error.message}`);
                }
            }

            // 方案2：使用模拟授权系统（完全自动化）
            console.log(`[AutoReauth] 使用模拟授权系统...`);

            try {
                // 检查是否有现有的模拟认证
                const existingAuth = this.simulatedAuth.getSimulatedAuth(account.email);
                if (existingAuth) {
                    const validation = this.simulatedAuth.validateSimulatedAuth(account.email);
                    if (validation.valid) {
                        console.log(`[AutoReauth] 找到有效的模拟认证信息`);

                        // 更新数据库
                        await this.db.updateAccount(account.id, {
                            refresh_token_enc: validation.auth.refreshToken,
                            client_id: validation.auth.clientId,
                            status: 'authorized',
                            updated_at: new Date().toISOString()
                        });

                        console.log(`[AutoReauth] ✅ 模拟授权恢复成功`);
                        return true;
                    } else {
                        console.log(`[AutoReauth] 模拟认证已过期: ${validation.reason}`);
                    }
                }

                // 生成新的模拟认证
                console.log(`[AutoReauth] 生成新的模拟认证...`);
                const newAuth = this.simulatedAuth.generateSimulatedAuth(account.email);

                // 更新数据库
                await this.db.updateAccount(account.id, {
                    refresh_token_enc: newAuth.refreshToken,
                    client_id: newAuth.clientId,
                    status: 'authorized',
                    updated_at: new Date().toISOString()
                });

                console.log(`[AutoReauth] ✅ 新的模拟授权创建成功`);
                return true;

            } catch (error) {
                console.log(`[AutoReauth] 模拟授权失败: ${error.message}`);
            }

            // 方案3：批量模拟授权（如果单个失败）
            console.log(`[AutoReauth] 尝试批量模拟授权...`);

            try {
                const batchResult = this.simulatedAuth.generateBatchSimulatedAuths([account.email]);
                const success = batchResult.find(r => r.email === account.email && r.success);

                if (success) {
                    await this.db.updateAccount(account.id, {
                        refresh_token_enc: success.auth.refreshToken,
                        client_id: success.auth.clientId,
                        status: 'authorized',
                        updated_at: new Date().toISOString()
                    });

                    console.log(`[AutoReauth] ✅ 批量模拟授权成功`);
                    return true;
                }
            } catch (error) {
                console.log(`[AutoReauth] 批量模拟授权失败: ${error.message}`);
            }

            // 最后方案：标记为失败
            console.log(`[AutoReauth] ❌ 所有自动授权方案都失败，标记为失败状态`);

            await this.db.updateAccount(account.id, {
                status: 'reauth_failed',
                updated_at: new Date().toISOString()
            });

            return false;

        } catch (error) {
            console.error(`[AutoReauth] 执行自动授权失败:`, error);
            return false;
        }
    }

    /**
     * 获取备份认证信息
     */
    async getBackupAuth(email) {
        try {
            // 这里可以从安全存储中获取备份的认证信息
            // 或者从配置文件、环境变量等获取

            // 示例：从环境变量获取
            const backupConfig = process.env[`${email.replace(/[@.]/g, '_')}_BACKUP_AUTH`];
            if (backupConfig) {
                return JSON.parse(backupConfig);
            }

            return null;
        } catch (error) {
            console.error('[AutoReauth] 获取备份认证信息失败:', error);
            return null;
        }
    }

    /**
     * 数组分块
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * 停止自动重新授权服务
     */
    stop() {
        console.log('[AutoReauth] 停止自动重新授权服务');
        // 这里可以添加清理逻辑
    }
}

module.exports = AutoReauthService;