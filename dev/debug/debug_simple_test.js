/**
 * 调试验证码提取的简化测试
 */

const ImprovedVerificationExtractor = require('./improved_verification_extraction.js');

console.log('=== 调试验证码提取问题 ===\n');

// 测试邮件内容
const testEmail1 = {
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
};

const testEmail2 = {
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
};

const extractor = new ImprovedVerificationExtractor();

console.log('🔧 测试1: JoseGunteruk - 临时代码问题');
console.log('邮件内容:', testEmail1.Body.Content.trim());

const content1 = `${testEmail1.Subject} ${testEmail1.Body.Content}`;
console.log('\n📋 提取的数字序列:');
const numbers1 = content1.match(/\b\d{4,8}\b/g);
console.log('所有4-8位数字:', numbers1);

const result1 = extractor.extractVerificationCodes([testEmail1]);
console.log('提取结果:', result1);
console.log('期望结果: 空数组 (过滤掉000000)\n');

console.log('🔧 测试2: NormanBarrerasij - 错误代码问题');
console.log('邮件内容:', testEmail2.Body.Content.trim());

const content2 = `${testEmail2.Subject} ${testEmail2.Body.Content}`;
console.log('\n📋 提取的数字序列:');
const numbers2 = content2.match(/\b\d{4,8}\b/g);
console.log('所有4-8位数字:', numbers2);

const result2 = extractor.extractVerificationCodes([testEmail2]);
console.log('提取结果:', result2);
console.log('期望结果: 应该提取680616而不是4138\n');

console.log('📊 算法改进效果分析:');
console.log('1. 第一个邮件：', result1.length === 0 ? '✅ 成功过滤掉000000' : '❌ 仍有问题');
console.log('2. 第二个邮件：', result2.length > 0 ? '✅ 提取到验证码' : '❌ 没有提取到验证码');
if (result2.length > 0) {
    console.log('   提取的验证码:', result2[0].code);
    console.log('   是否正确:', result2[0].code === '680616' ? '✅ 正确' : '❌ 仍需改进');
}