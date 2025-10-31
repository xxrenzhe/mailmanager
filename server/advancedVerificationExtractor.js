/**
 * 高级验证码提取优化器
 * 提供更智能的验证码识别和上下文分析
 */

class AdvancedVerificationExtractor {
    constructor() {
        // 分层级的验证码模式 - 按可信度排序
        this.verificationPatterns = {
            // 高可信度模式 - 明确的验证码上下文
            high: [
                // 验证码关键词紧邻模式
                /(?:verification code|验证码|vertification code)[\s:：\n\-]*(\d{4,8})/gi,
                /(?:code|码)[\s:：\n\-]*(\d{4,8})/gi,
                /(?:pin|密码)[\s:：\n\-]*(\d{4,8})/gi,
                /(?:your code is|您的验证码是)[\s:：\n]*(\d{4,8})/gi,
                /(?:enter|input|请输入)[\s:：\n]*(\d{4,8})/gi,
                // 邮件标题中的验证码模式
                /^\[(\d{4,8})\]/gmi,
                /^verification[:\s]*(\d{4,8})/gmi
            ],
            // 中等可信度模式 - 可能的验证码上下文
            medium: [
                // 包含验证相关词汇
                /(?:verify|confirm|confirm|activate|激活|确认)[\s\S]{0,50}?(\d{4,8})/gi,
                /(?:secure|安全|access|登录)[\s\S]{0,30}?(\d{4,8})/gi,
                /(?:otp|one time|一次性)[\s\S]{0,30}?(\d{4,8})/gi,
                /(?:temporary|临时)[\s\S]{0,30}?(\d{4,8})/gi
            ],
            // 低可信度模式 - 单独的数字，需要更多上下文验证
            low: [
                /\b(\d{4,8})\b/g
            ]
        };

        // 验证码上下文权重系统
        this.contextWeights = {
            // 邮件部分权重
            subject: {
                weight: 3.0,
                patterns: [/^\d{4,8}$/, /\[(\d{4,8})\]/, /verification[:\s]*(\d{4,8})/i]
            },
            greeting: {
                weight: 2.5,
                patterns: [/(?:welcome|hi|hello|dear).*?(\d{4,8})/gi]
            },
            firstParagraph: {
                weight: 3.0,
                patterns: this.verificationPatterns.high
            },
            // 关键词权重
            keywords: {
                high: ['verification code', '验证码', 'your code is', '您的验证码是', 'enter this code'],
                medium: ['verify', 'confirm', 'activate', 'security', 'access', 'login', 'otp'],
                low: ['code', 'pin', 'number', 'temporary']
            },
            // 格式权重
            format: {
                isolated: 2.0,        // 独立成行的验证码
                spaced: 1.5,          // 周围有空格
                attached: 0.8         // 紧贴其他文字
            }
        };

        // 无效验证码模式 - 更全面的过滤
        this.invalidPatterns = [
            // 重复数字
            /^(\d)\1{3,8}$/,
            // 连续数字
            /^(?:1234|12345|123456|1234567|12345678)$/,
            // 年份
            /^20(1[5-9]|2[0-9]|3[0-5])$/,
            // 美国邮编
            /^\d{5}$/,
            // 常见服务号码
            /^(800|888|900|555)\d{4}$/,
            // 序列号模式
            /^(?:ID|id|Id)\d+$/,
            // 价格数字（包含小数点的上下文）
            /\$\d+\.\d{2}/,
            // 百分比
            /\d+%/,
            // 电话号码模式
            /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/,
            // 常见的非验证码ID
            /^(?:ref|Ref|REF)\d+$/,
            /^(?:order|Order|ORDER)\d+$/,
            /^(?:invoice|Invoice|INVOICE)\d+$/,
            // 日期相关
            /^(?:19|20)\d{2}$/
        ];
    }

    /**
     * 智能清理邮件内容
     */
    cleanEmailContent(htmlContent) {
        if (!htmlContent) return '';

        let content = htmlContent;

        // 移除脚本和样式
        content = content
            .replace(/<script[^>]*>.*?<\/script>/gis, '')
            .replace(/<style[^>]*>.*?<\/style>/gis, '')
            .replace(/<link[^>]*>/gi, '')
            .replace(/<meta[^>]*>/gi, '');

        // 移除HTML注释
        content = content.replace(/<!--.*?-->/gs, '');

        // 处理常见邮件HTML结构
        content = content
            .replace(/<td[^>]*>/gi, ' [TD] ')
            .replace(/<\/td>/gi, ' [/TD] ')
            .replace(/<div[^>]*>/gi, ' [DIV] ')
            .replace(/<\/div>/gi, ' [/DIV] ')
            .replace(/<p[^>]*>/gi, ' [P] ')
            .replace(/<\/p>/gi, ' [/P] ')
            .replace(/<br[^>]*>/gi, '\n')
            .replace(/<li[^>]*>/gi, '\n• ')
            .replace(/<\/li>/gi, '\n');

        // 移除所有剩余HTML标签
        content = content.replace(/<[^>]*>/g, ' ');

        // 清理多余的空白字符
        content = content
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .trim();

        return content;
    }

    /**
     * 分析验证码出现的上下文
     */
    analyzeContext(content, code, position) {
        const score = { total: 0, factors: [] };

        // 获取代码前后的上下文
        const beforeText = content.substring(Math.max(0, position - 100), position);
        const afterText = content.substring(position + code.length, Math.min(content.length, position + code.length + 100));
        const fullContext = beforeText + code + afterText;

        // 检查关键词权重
        for (const [level, keywords] of Object.entries(this.contextWeights.keywords)) {
            for (const keyword of keywords) {
                if (fullContext.toLowerCase().includes(keyword.toLowerCase())) {
                    const weight = level === 'high' ? 3.0 : level === 'medium' ? 2.0 : 1.0;
                    score.total += weight;
                    score.factors.push({ type: 'keyword', value: keyword, weight });
                }
            }
        }

        // 检查格式权重
        const beforeChar = content.charAt(position - 1);
        const afterChar = content.charAt(position + code.length);

        if (beforeChar === ' ' && afterChar === ' ') {
            score.total += this.contextWeights.format.spaced;
            score.factors.push({ type: 'format', value: 'spaced', weight: this.contextWeights.format.spaced });
        } else if (beforeChar === '\n' || afterChar === '\n' || beforeChar === ' ' && afterChar === '\n') {
            score.total += this.contextWeights.format.isolated;
            score.factors.push({ type: 'format', value: 'isolated', weight: this.contextWeights.format.isolated });
        } else {
            score.total += this.contextWeights.format.attached;
            score.factors.push({ type: 'format', value: 'attached', weight: this.contextWeights.format.attached });
        }

        // 检查位置权重（是否在邮件开头）
        if (position < content.length * 0.3) {
            score.total += 1.5;
            score.factors.push({ type: 'position', value: 'early', weight: 1.5 });
        }

        return score;
    }

    /**
     * 验证验证码的有效性 - 增强版
     */
    isValidVerificationCode(code, content, context = null) {
        // 基本长度检查
        if (!code || code.length < 4 || code.length > 8) {
            return { valid: false, reason: 'Invalid length' };
        }

        // 检查无效模式
        for (const pattern of this.invalidPatterns) {
            if (pattern.test(code)) {
                return { valid: false, reason: 'Matches invalid pattern' };
            }
        }

        // 检查是否包含非数字字符（清理后）
        if (!/^\d+$/.test(code)) {
            return { valid: false, reason: 'Contains non-digit characters' };
        }

        // 上下文分析
        if (content) {
            const lowerContent = content.toLowerCase();

            // 必须有至少一个验证相关关键词
            const hasVerificationKeyword = [
                ...this.contextWeights.keywords.high,
                ...this.contextWeights.keywords.medium,
                ...this.contextWeights.keywords.low
            ].some(keyword => lowerContent.includes(keyword.toLowerCase()));

            if (!hasVerificationKeyword) {
                return { valid: false, reason: 'No verification keywords found' };
            }

            // 特殊检查：如果只是普通数字且没有强验证上下文，则无效
            const strongContext = this.contextWeights.keywords.high.some(keyword =>
                lowerContent.includes(keyword.toLowerCase())
            );

            if (!strongContext && this.contextWeights.keywords.low.some(keyword =>
                lowerContent.includes(keyword.toLowerCase())
            )) {
                // 只有弱关键词，需要更严格的验证
                return { valid: false, reason: 'Insufficient verification context' };
            }
        }

        return { valid: true, reason: 'Valid verification code' };
    }

    /**
     * 从邮件中提取验证码 - 主函数
     */
    extractVerificationCodes(messages) {
        const results = [];

        for (const message of messages) {
            const messageData = this.parseMessage(message);
            if (!messageData) continue;

            const candidates = this.findVerificationCandidates(messageData);

            for (const candidate of candidates) {
                const validation = this.isValidVerificationCode(
                    candidate.code,
                    messageData.fullContent,
                    candidate.context
                );

                if (validation.valid) {
                    results.push({
                        ...candidate,
                        ...messageData,
                        validation,
                        score: candidate.context?.total || 1.0
                    });
                }
            }
        }

        // 按分数和时间排序
        return results.sort((a, b) => {
            // 首先按可信度分数排序
            if (Math.abs(a.score - b.score) > 0.1) {
                return b.score - a.score;
            }
            // 分数相同时按时间排序
            return new Date(b.received_at) - new Date(a.received_at);
        });
    }

    /**
     * 解析邮件消息
     */
    parseMessage(message) {
        try {
            const subject = message.Subject || message.subject || '无标题';
            const from = message.From || message.from;
            const receivedDateTime = message.ReceivedDateTime || message.receivedDateTime;
            const messageId = message.Id || message.id;

            let bodyContent = message.Body?.Content || message.body?.content || message.body?.preview || '';

            // 清理HTML内容
            const cleanContent = this.cleanEmailContent(bodyContent);
            const fullContent = `${subject} ${cleanContent}`;

            return {
                subject,
                sender: from?.EmailAddress?.Name || from?.emailAddress?.name || from?.emailAddress?.address || '未知发件人',
                received_at: receivedDateTime,
                messageId,
                fullContent,
                cleanContent
            };
        } catch (error) {
            console.error('[AdvancedExtractor] 消息解析失败:', error);
            return null;
        }
    }

    /**
     * 查找验证码候选
     */
    findVerificationCandidates(messageData) {
        const candidates = [];
        const { subject, fullContent } = messageData;

        // 按优先级检查模式
        for (const [priority, patterns] of Object.entries(this.verificationPatterns)) {
            for (const pattern of patterns) {
                let match;
                const regex = new RegExp(pattern);

                while ((match = regex.exec(fullContent)) !== null) {
                    const code = match[1] || match[0]; // 有些模式有捕获组

                    if (code && /^\d{4,8}$/.test(code)) {
                        const position = match.index;
                        const context = this.analyzeContext(fullContent, code, position);

                        candidates.push({
                            code,
                            priority,
                            position,
                            context,
                            pattern: pattern.toString(),
                            surroundingText: fullContent.substring(
                                Math.max(0, position - 50),
                                Math.min(fullContent.length, position + code.length + 50)
                            )
                        });
                    }
                }
            }
        }

        return candidates;
    }
}

module.exports = AdvancedVerificationExtractor;