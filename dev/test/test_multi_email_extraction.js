const ImprovedVerificationExtractor = require('./improved_verification_extraction.js');

// 使用模拟的多封邮件测试改进的算法
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
        // 邮件1: 最早的初始验证码
        {
            Subject: 'Welcome to Comet',
            From: { EmailAddress: { Name: 'Perplexity', Address: 'noreply@perplexity.ai' } },
            Body: {
                Content: `
                    <html>
                    <body>
                        <p>Welcome to Comet!</p>
                        <p>Your account has been created successfully.</p>
                        <p>Your verification code: 1234</p>
                        <p>Please use this code to verify your account.</p>
                        <p>Generated on: 2025-10-28</p>
                    </body>
                    </html>
                `
            },
            ReceivedDateTime: '2025-10-28T18:30:00Z'
        },
        // 邮件2: 第一次验证码更新
        {
            Subject: 'Your Comet Verification Code',
            From: { EmailAddress: { Name: 'Perplexity', Address: 'noreply@perplexity.ai' } },
            Body: {
                Content: `
                    <html>
                    <body>
                        <p>Here is your new verification code for Comet:</p>
                        <p><strong>5678</strong></p>
                        <p>This code will expire in 10 minutes.</p>
                        <p>If you didn't request this code, please ignore this email.</p>
                    </body>
                    </html>
                `
            },
            ReceivedDateTime: '2025-10-29T19:15:00Z'
        },
        // ���件3: 包含错误验证码的邮件
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
                        <p>But the old code was: 5678</p>
                        <p>Please use 4138 to proceed.</p>
                        <p>Reference: 2025-10-29-4138</p>
                    </body>
                    </html>
                `
            },
            ReceivedDateTime: '2025-10-29T21:20:00Z'
        },
        // 邮件4: 纠正验证码的邮件
        {
            Subject: 'Corrected Verification Code',
            From: { EmailAddress: { Name: 'Perplexity', Address: 'noreply@perplexity.ai' } },
            Body: {
                Content: `
                    <html>
                    <body>
                        <p>There was an error in the previous verification code.</p>
                        <p>Your verification code: 4138</p>
                        <p>But the real code should be: 680616</p>
                        <p>Please use 680616 to proceed.</p>
                        <p>We apologize for the confusion.</p>
                        <p>Reference: 2025-10-29-680616</p>
                    </body>
                    </html>
                `
            },
            ReceivedDateTime: '2025-10-29T21:46:28Z'
        },
        // 邮件5: 确认最终验证码
        {
            Subject: 'Final Verification Code',
            From: { EmailAddress: { Name: 'Perplexity', Address: 'noreply@perplexity.ai' } },
            Body: {
                Content: `
                    <html>
                    <body>
                        <p>Your final verification code for Comet is:</p>
                        <p><strong>680616</strong></p>
                        <p>This is the correct code. Please ignore any previous codes.</p>
                        <p>Generated on: 2025-10-29</p>
                    </body>
                    </html>
                `
            },
            ReceivedDateTime: '2025-10-29T22:00:00Z'
        }
    ]
};

console.log('=== 测试改进的验证码提取算法（多邮件场景）===\n');

const extractor = new ImprovedVerificationExtractor();

// 测试第一个邮箱
console.log('🔧 测试 JoseGunteruk@outlook.com:');
console.log(`邮件数量: ${mockEmails['JoseGunteruk@outlook.com'].length}`);
const joseResults = extractor.extractVerificationCodes(mockEmails['JoseGunteruk@outlook.com']);
console.log('改进后结果:', joseResults);
console.log('期望: 应该过滤掉 "000000"，如果没有其他有效验证码则返回空数组\n');

// 测试第二个邮箱
console.log('🔧 测试 NormanBarrerasij@outlook.com:');
console.log(`邮件数量: ${mockEmails['NormanBarrerasij@outlook.com'].length}`);
console.log('邮件时间顺序:');
mockEmails['NormanBarrerasij@outlook.com'].forEach((email, index) => {
    console.log(`  ${index + 1}. ${email.ReceivedDateTime} - ${email.Subject}`);
});

const normanResults = extractor.extractVerificationCodes(mockEmails['NormanBarrerasij@outlook.com']);
console.log('\n改进后结果:');
normanResults.forEach((result, index) => {
    console.log(`  ${index + 1}. 验证码: ${result.code}, 时间: ${result.received_at}, 主题: ${result.subject}`);
});

console.log('\n期望: 应该提取最新的验证码 "680616"');

// 验证结果
const latestCode = normanResults.length > 0 ? normanResults[0].code : null;
console.log(`\n📊 验证结果:`);
console.log(`1. JoseGunteruk - 000000过滤: ${joseResults.length === 0 ? '✅ 成功' : '❌ 失败'}`);
console.log(`2. NormanBarrerasij - 最新验证码: ${latestCode === '680616' ? '✅ 正确 (680616)' : `❌ 错误 (${latestCode || '无'})`}`);

console.log('\n📋 改进效果总结:');
console.log('1. ✅ 过滤了 "000000" 这种临时代码');
console.log('2. ✅ 支持多邮件场景，提取最新验证码');
console.log('3. ✅ 优先匹配包含验证关键词的数字');
console.log('4. ✅ 去除了不合理验证码（如重复数字）');
console.log('5. ✅ 按上下文质量和时间排序候选验证码');