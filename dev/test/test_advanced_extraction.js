/**
 * 高级验证码提取功能测试脚本
 * 比较高级提取器和基础提取器的性能和准确性
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const SimpleDB = require('./server/database');
const EmailService = require('./server/emailService');
const AdvancedVerificationExtractor = require('./server/advancedVerificationExtractor');

class AdvancedExtractionTester {
    constructor() {
        this.db = new SimpleDB('./data/mailmanager.db');
        this.emailService = new EmailService();
        this.advancedExtractor = new AdvancedVerificationExtractor();
        this.testResults = {
            basic: { total: 0, valid: 0, invalid: 0, details: [] },
            advanced: { total: 0, valid: 0, invalid: 0, details: [] },
            comparison: []
        };
    }

    async init() {
        await this.db.init();
        this.emailService.setDatabase(this.db);
    }

    /**
     * 获取有完整认证信息的账户（使用原生SQL）
     */
    async getAuthorizedAccounts(limit = 3) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT id, email, client_id, refresh_token_enc, status, last_active_at
                FROM accounts
                WHERE refresh_token_enc IS NOT NULL
                AND client_id IS NOT NULL
                AND is_active = 1
                ORDER BY last_active_at DESC
                LIMIT ?
            `;

            this.db.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * 测试单个账户的验证码提取
     */
    async testAccount(account) {
        console.log(`\n=== 测试账户: ${account.id} ===`);

        try {
            const { refresh_token_enc, client_id, id } = account;

            if (!refresh_token_enc || !client_id) {
                console.log(`❌ 账户 ${id} 缺少认证信息`);
                return null;
            }

            // 获取邮件数据
            const messages = await this.fetchEmailMessages(id, refresh_token_enc, client_id);

            if (!messages || messages.length === 0) {
                console.log(`ℹ️  账户 ${id} 无邮件数据`);
                return null;
            }

            console.log(`📧 获取到 ${messages.length} 封邮件`);

            // 测试基础提取器
            console.log('\n--- 基础提取器测试 ---');
            const basicResults = this.emailService.extractVerificationCodesBasic(messages);
            console.log(`基础提取器结果: ${basicResults.length} 个验证码`);

            // 测试高级提取器
            console.log('\n--- 高级提取器测试 ---');
            const advancedResults = this.advancedExtractor.extractVerificationCodes(messages);
            console.log(`高级提取器结果: ${advancedResults.length} 个验证码`);

            // 分析结果
            const analysis = this.analyzeResults(basicResults, advancedResults, messages);

            return {
                accountId: id,
                emailCount: messages.length,
                basicResults,
                advancedResults,
                analysis
            };

        } catch (error) {
            console.error(`❌ 测试账户 ${account.id} 失败:`, error.message);
            return {
                accountId: id,
                error: error.message
            };
        }
    }

    /**
     * 获取邮件消息（复制EmailService的逻辑但不提取验证码）
     */
    async fetchEmailMessages(accountId, refreshToken, clientId) {
        try {
            const accessToken = await this.emailService.getAccessToken(accountId, refreshToken, clientId);

            // 使用无时间限制的API
            const endpoint = `https://outlook.office.com/api/v2.0/me/messages?$orderby=ReceivedDateTime desc&$top=5`;

            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`Outlook API调用失败: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.value || [];

        } catch (error) {
            console.error(`[Tester] 获取邮件失败:`, error);
            return [];
        }
    }

    /**
     * 分析提取结果
     */
    analyzeResults(basicResults, advancedResults, messages) {
        const analysis = {
            basicStats: {
                total: basicResults.length,
                valid: basicResults.length,
                averageScore: 0,
                codes: basicResults.map(r => r.code)
            },
            advancedStats: {
                total: advancedResults.length,
                valid: advancedResults.length,
                averageScore: advancedResults.reduce((sum, r) => sum + (r.score || 1.0), 0) / advancedResults.length || 0,
                codes: advancedResults.map(r => r.code),
                priorities: advancedResults.map(r => r.priority || 'unknown')
            },
            differences: {
                basicOnly: [],
                advancedOnly: [],
                both: []
            },
            qualityAnalysis: {
                higherQuality: [],
                falsePositives: [],
                missedOpportunities: []
            }
        };

        // 找出差异
        const basicCodes = new Set(basicResults.map(r => r.code));
        const advancedCodes = new Set(advancedResults.map(r => r.code));

        analysis.differences.basicOnly = basicResults.filter(r => !advancedCodes.has(r.code));
        analysis.differences.advancedOnly = advancedResults.filter(r => !basicCodes.has(r.code));
        analysis.differences.both = basicResults.filter(r => advancedCodes.has(r.code));

        // 质量分析
        // 检查高级提取器是否发现了基础提取器遗漏的高质量验证码
        for (const advanced of analysis.differences.advancedOnly) {
            if (advanced.score >= 2.5) {
                analysis.qualityAnalysis.higherQuality.push(advanced);
            } else {
                analysis.qualityAnalysis.missedOpportunities.push(advanced);
            }
        }

        // 检查基础提取器的结果是否可能是误识别
        for (const basic of analysis.differences.basicOnly) {
            if (this.isLikelyFalsePositive(basic, messages)) {
                analysis.qualityAnalysis.falsePositives.push(basic);
            }
        }

        return analysis;
    }

    /**
     * 判断基础提取器的结果是否可能是误识别
     */
    isLikelyFalsePositive(basicResult, messages) {
        // 查找对应的邮件
        const message = messages.find(msg =>
            (msg.Id || msg.id) === basicResult.messageId
        );

        if (!message) return false;

        const content = `${message.Subject || message.subject || ''} ${message.Body?.Content || message.body?.content || ''}`.toLowerCase();

        // 检查是否有足够的验证相关关键词
        const verificationKeywords = [
            'verification', 'code', '验证码', '验证', 'confirm', '确认',
            'access', '登录', 'login', 'authenticate', '授权',
            'otp', 'pin', 'password', '密码', 'security', '安全'
        ];

        const keywordCount = verificationKeywords.filter(keyword => content.includes(keyword)).length;

        // 如果关键词少于2个，可能是误识别
        return keywordCount < 2;
    }

    /**
     * 生成详细的测试报告
     */
    generateReport(testResults) {
        let report = '\n' + '='.repeat(80) + '\n';
        report += '🧪 高级验证码提取功能测试报告\n';
        report += '='.repeat(80) + '\n\n';

        const successful = testResults.filter(r => !r.error);
        const failed = testResults.filter(r => r.error);

        report += `📊 测试概况:\n`;
        report += `   总测试账户: ${testResults.length}\n`;
        report += `   成功测试: ${successful.length}\n`;
        report += `   失败测试: ${failed.length}\n\n`;

        let allBasicResults = [];
        let allAdvancedResults = [];

        if (successful.length > 0) {
            // 统计所有结果
            allBasicResults = successful.flatMap(r => r.basicResults || []);
            allAdvancedResults = successful.flatMap(r => r.advancedResults || []);

            report += `📈 提取结果对比:\n`;
            report += `   基础提取器: ${allBasicResults.length} 个验证码\n`;
            report += `   高级提取器: ${allAdvancedResults.length} 个验证码\n`;
            report += `   平均分数: ${(allAdvancedResults.reduce((sum, r) => sum + (r.score || 1.0), 0) / allAdvancedResults.length || 0).toFixed(2)}\n\n`;

            // 优先级分布
            const priorityCounts = {};
            allAdvancedResults.forEach(r => {
                const priority = r.priority || 'unknown';
                priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
            });

            report += `🎯 优先级分布:\n`;
            Object.entries(priorityCounts).forEach(([priority, count]) => {
                report += `   ${priority}: ${count} 个\n`;
            });
            report += '\n';

            // 质量分析
            let totalHigherQuality = 0;
            let totalFalsePositives = 0;
            let totalMissedOpportunities = 0;

            successful.forEach(result => {
                if (result.analysis?.qualityAnalysis) {
                    const qa = result.analysis.qualityAnalysis;
                    totalHigherQuality += qa.higherQuality?.length || 0;
                    totalFalsePositives += qa.falsePositives?.length || 0;
                    totalMissedOpportunities += qa.missedOpportunities?.length || 0;
                }
            });

            report += `🔍 质量分析:\n`;
            report += `   高级提取器额外发现的高质量验证码: ${totalHigherQuality} 个\n`;
            report += `   基础提取器可能的误识别: ${totalFalsePositives} 个\n`;
            report += `   高级提取器遗漏的机会: ${totalMissedOpportunities} 个\n\n`;

            // 详细结果
            report += '📋 详细测试结果:\n';
            successful.forEach(result => {
                report += `\n--- 账户 ${result.accountId} ---\n`;
                report += `邮件数量: ${result.emailCount}\n`;
                report += `基础提取器: ${result.basicResults?.length || 0} 个验证码\n`;
                report += `高级提取器: ${result.advancedResults?.length || 0} 个验证码\n`;

                if (result.analysis?.differences) {
                    const diff = result.analysis.differences;
                    if (diff.advancedOnly.length > 0) {
                        report += `高级提取器额外发现: ${diff.advancedOnly.map(r => r.code).join(', ')}\n`;
                    }
                    if (diff.basicOnly.length > 0) {
                        report += `基础提取器独有: ${diff.basicOnly.map(r => r.code).join(', ')}\n`;
                    }
                }

                if (result.analysis?.qualityAnalysis?.higherQuality.length > 0) {
                    report += `✨ 高质量发现: ${result.analysis.qualityAnalysis.higherQuality.map(r => `${r.code}(${r.score?.toFixed(1)})`).join(', ')}\n`;
                }
            });
        }

        if (failed.length > 0) {
            report += '\n❌ 失败的测试:\n';
            failed.forEach(result => {
                report += `   账户 ${result.accountId}: ${result.error}\n`;
            });
        }

        // 结论和建议
        report += '\n' + '='.repeat(80) + '\n';
        report += '🎯 结论和建议:\n';
        report += '='.repeat(80) + '\n';

        let totalHigherQuality = 0;
        let totalFalsePositives = 0;
        let totalMissedOpportunities = 0;

        successful.forEach(result => {
            if (result.analysis?.qualityAnalysis) {
                const qa = result.analysis.qualityAnalysis;
                totalHigherQuality += qa.higherQuality?.length || 0;
                totalFalsePositives += qa.falsePositives?.length || 0;
                totalMissedOpportunities += qa.missedOpportunities?.length || 0;
            }
        });

        if (allAdvancedResults.length > allBasicResults.length) {
            report += '✅ 高级提取器发现了更多验证码，建议在生产环境中启用。\n';
        } else if (allAdvancedResults.length === allBasicResults.length) {
            report += '⚖️  两种提取器结果数量相同，高级提取器提供了更好的质量评估。\n';
        } else {
            report += '⚠️  高级提取器发现的验证码较少，但质量可能更高。\n';
        }

        if (totalFalsePositives > 0) {
            report += '🔧 建议启用高级提取器以减少误识别。\n';
        }

        if (totalHigherQuality > 0) {
            report += '🚀 高级提取器显著提升了验证码发现能力。\n';
        }

        report += '\n建议的配置:\n';
        report += `- 启用高级提取器: ${totalHigherQuality > 0 || totalFalsePositives > 0 ? '是' : '可选'}\n`;
        report += `- 分数阈值: 2.0 (过滤低质量结果)\n`;
        report += `- 优先级考虑: 高 > 中 > 低\n`;

        return report;
    }

    /**
     * 运行完整测试
     */
    async runFullTest(limit = 3) {
        console.log('🚀 开始高级验证码提取功能测试...');

        await this.init();

        try {
            // 使用原生SQL获取有完整认证信息的账户
            const accounts = await this.getAuthorizedAccounts(limit);
            console.log(`📧 获取到 ${accounts.length} 个测试账户`);

            const results = [];

            for (const account of accounts) {
                const result = await this.testAccount(account);
                if (result) {
                    results.push(result);
                }

                // 避免API限制
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 生成报告
            const report = this.generateReport(results);
            console.log(report);

            // 保存报告到文件
            const fs = require('fs').promises;
            await fs.writeFile('./test_advanced_extraction_report.md', report, 'utf8');
            console.log('\n📄 详细报告已保存到: test_advanced_extraction_report.md');

            return results;

        } catch (error) {
            console.error('❌ 测试过程中发生错误:', error);
            throw error;
        } finally {
            await this.db.close();
        }
    }
}

// 运行测试
if (require.main === module) {
    const tester = new AdvancedExtractionTester();
    const limit = process.argv[2] ? parseInt(process.argv[2]) : 3;

    tester.runFullTest(limit)
        .then(() => {
            console.log('\n✅ 测试完成!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ 测试失败:', error);
            process.exit(1);
        });
}

module.exports = AdvancedExtractionTester;