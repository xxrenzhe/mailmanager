/**
 * 模拟授权系统
 * 为测试和演示提供自动重新授权功能
 */

class SimulatedAuth {
    constructor() {
        this.authStore = new Map(); // 存储模拟的认证信息
        this.loadSimulatedData();
    }

    /**
     * 加载模拟的认证数据
     */
    loadSimulatedData() {
        // 模拟一些预设的认证信息
        const simulatedAuths = [
            {
                email: 'KellyCollinsjn@outlook.com',
                refreshToken: 'simulated_refresh_token_' + Math.random().toString(36).substring(7),
                clientId: 'simulated_client_id_' + Math.random().toString(36).substring(7),
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90天后过期
            },
            {
                email: 'JoseGunteruk@outlook.com',
                refreshToken: 'simulated_refresh_token_' + Math.random().toString(36).substring(7),
                clientId: 'simulated_client_id_' + Math.random().toString(36).substring(7),
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
            },
            {
                email: 'NormanBarrerasij@outlook.com',
                refreshToken: 'simulated_refresh_token_' + Math.random().toString(36).substring(7),
                clientId: 'simulated_client_id_' + Math.random().toString(36).substring(7),
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
            }
        ];

        simulatedAuths.forEach(auth => {
            this.authStore.set(auth.email, auth);
        });

        console.log(`[SimulatedAuth] 加载了 ${simulatedAuths.length} 个模拟认证数据`);
    }

    /**
     * 检查是否有模拟的认证信息
     */
    hasSimulatedAuth(email) {
        return this.authStore.has(email);
    }

    /**
     * 获取模拟的认证信息
     */
    getSimulatedAuth(email) {
        return this.authStore.get(email);
    }

    /**
     * 生成新的模拟认证信息
     */
    generateSimulatedAuth(email) {
        const auth = {
            email,
            refreshToken: 'simulated_refresh_token_' + Math.random().toString(36).substring(7),
            clientId: 'simulated_client_id_' + Math.random().toString(36).substring(7),
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90天后过期
            createdAt: new Date()
        };

        this.authStore.set(email, auth);
        console.log(`[SimulatedAuth] 为 ${email} 生成新的模拟认证信息`);

        return auth;
    }

    /**
     * 验证模拟认证的有效性
     */
    validateSimulatedAuth(email) {
        const auth = this.authStore.get(email);
        if (!auth) {
            return { valid: false, reason: '未找到认证信息' };
        }

        if (auth.expiresAt < new Date()) {
            return { valid: false, reason: '认证已过期' };
        }

        return { valid: true, auth };
    }

    /**
     * 刷新模拟认证
     */
    refreshSimulatedAuth(email) {
        const existingAuth = this.authStore.get(email);
        if (existingAuth) {
            // 刷新现有认证
            existingAuth.refreshToken = 'simulated_refresh_token_' + Math.random().toString(36).substring(7);
            existingAuth.expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
            existingAuth.refreshedAt = new Date();

            console.log(`[SimulatedAuth] 刷新了 ${email} 的模拟认证信息`);
            return existingAuth;
        } else {
            // 生成新认证
            return this.generateSimulatedAuth(email);
        }
    }

    /**
     * 批量生成模拟认证信息
     */
    generateBatchSimulatedAuths(emails) {
        const results = [];

        for (const email of emails) {
            try {
                const auth = this.generateSimulatedAuth(email);
                results.push({ email, success: true, auth });
            } catch (error) {
                results.push({ email, success: false, error: error.message });
            }
        }

        console.log(`[SimulatedAuth] 批量生成完成: ${results.filter(r => r.success).length}/${results.length} 成功`);
        return results;
    }

    /**
     * 获取所有模拟认证信息
     */
    getAllSimulatedAuths() {
        return Array.from(this.authStore.entries()).map(([email, auth]) => ({
            email,
            ...auth,
            expiresAt: auth.expiresAt.toISOString(),
            createdAt: auth.createdAt ? auth.createdAt.toISOString() : null
        }));
    }

    /**
     * 清理过期的认证信息
     */
    cleanupExpiredAuths() {
        const now = new Date();
        let cleanedCount = 0;

        for (const [email, auth] of this.authStore.entries()) {
            if (auth.expiresAt < now) {
                this.authStore.delete(email);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[SimulatedAuth] 清理了 ${cleanedCount} 个过期的认证信息`);
        }

        return cleanedCount;
    }
}

module.exports = SimulatedAuth;