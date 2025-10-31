/**
 * 验证码提取调试脚本
 * 用于分析和优化验证码识别算法
 */

const EmailService = require('./server/emailService.js');

// 模拟这两个邮箱的邮件内容（基于实际提取结果推测）
const mockEmails = {
    'JoseGunteruk@outlook.com': [
        {
            Subject: 'Welcome to Comet',
            From: { EmailAddress: { Name: 'Perplexity', Address: 'noreply@perplexity.ai' } },
            Body: {
                Content: `
                    <html>
                    <body>
                        <p>Welcome to Comet!</p>
                        <p>Your account has been created successfully.</p>
                        <p>Your temporary code: 000000</p>
                        <p>Please use this code to verify your account.</p>
                        <p>Generated on: 2025-10-29</p>
                        <p>Ticket ID: 12345678</p>
                    </body>
                    </html>
                `
            },
            ReceivedDateTime: '2025-10-29T22:03:19Z'
        }
    ],
    'NormanBarrerasij@outlook.com': [
        {
            Subject: 'Welcome to Comet',
            From: { EmailAddress: { Name: 'Perplexity', Address: 'noreply@perplexity.ai' } },
            Body: {
                Content: `
                    <html>
                    <body>
                        <p>Welcome to Comet!</p>
                        <p>Your account has been created successfully.</p>
                        <p>Your verification code: 4138</p>
                        <p>But the real code should be: 680616</p>
                        <p>Please use 4138 to proceed.</p>
                        <p>Reference: 2025-10-29-4138</p>
                    </body>
                    </html>
                `
            },
            ReceivedDateTime: '2025-10-29T21:46:28Z'
        }
    ]
};

console.log('=== 验证码提取调试分析 ===\n');

const emailService = new EmailService();

// 分析第一个邮箱的问题
console.log('🔍 分析 JoseGunteruk@outlook.com (提取到 "000000"):');
const joseEmails = mockEmails['JoseGunteruk@outlook.com'];
const joseResults = emailService.extractVerificationCodes(joseEmails);
console.log('提取结果:', joseResults);
console.log('问题分析: 可能匹配了临时代码 "000000"，但这不是真正的验证码\n');

// 分析第二个邮箱的问题
console.log('🔍 分析 NormanBarrerasij@outlook.com (提取到 "4138" 而不是 "680616"):');
const normanEmails = mockEmails['NormanBarrerasij@outlook.com'];
const normanResults = emailService.extractVerificationCodes(normanEmails);
console.log('提取结果:', normanResults);
console.log('问题分析: 提取了 "4138" 但可能 "680616" 是正确的验证码\n');

// 测试改进后的算法
console.log('💡 测试改进后的验证码提取算法:');
console.log('1. 优先匹配包含 "verification code", "验证码", "code" 的模式');
console.log('2. 过滤掉明显不合理的验证码 (如 "000000", "123456")');
console.log('3. 按验证码长度和格式优化匹配优先级\n');

// 显示当前正则表达式的问题
console.log('📋 当前正则表达式分析:');
const patterns = [
    /\b\d{4,8}\b/g,
    /(?:code|verification|验证码)[\s:：]*(\d{4,8})/gi,
    /(?:verification code|验证码)[\s:：]*(\d{4,8})/gi,
    /(?:pin|密码)[\s:：]*(\d{4,8})/gi,
    /^\[.*?(\d{4,8}).*?\]/gm,
    /(?:验证|verification).*?(\d{4,8})/gi
];

patterns.forEach((pattern, index) => {
    console.log(`${index + 1}. ${pattern}`);

    // 测试每个模式对两个邮件的匹配结果
    joseEmails.forEach(email => {
        const content = `${email.Subject} ${email.Body.Content}`;
        const matches = content.match(pattern);
        if (matches) {
            console.log(`   - 匹配到: ${matches.join(', ')}`);
        }
    });
});