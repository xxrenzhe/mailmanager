const ImprovedVerificationExtractor = require('./improved_verification_extraction.js');

// 简化的测试：只测试最后一封邮件
const finalEmail = {
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
};

const extractor = new ImprovedVerificationExtractor();

console.log('=== 详细调试验证码提取 ===\n');

console.log('📧 测试邮件内容:');
console.log('标题:', finalEmail.Subject);
console.log('内容:', finalEmail.Body.Content.trim());

const content = `${finalEmail.Subject} ${finalEmail.Body.Content}`;
console.log('\n🔍 提取的数字序列:');
const numbers = content.match(/\b\d{4,8}\b/g);
console.log('所有4-8位数字:', numbers);

console.log('\n🧪 逐步分析算法流程:');

// 手动测试高优先级模式
const highPriorityPatterns = [
    /(?:verification\s+code|验证码|your\s+code|code\s+is)[\s:：\n]*(\d{4,8})/gi,
    /(?:enter\s+the\s+code|please\s+use|use\s+this\s+code)[\s:：\n]*(\d{4,8})/gi,
    /(?:your\s+one-time|temporary|access)\s+code[\s:：\n]*(\d{4,8})/gi,
    /(?:security\s+code|authentication\s+code)[\s:：\n]*(\d{4,8})/gi
];

console.log('\n1. 高优先级模式匹配:');
highPriorityPatterns.forEach((pattern, index) => {
    const matches = content.match(pattern);
    if (matches) {
        console.log(`   模式${index + 1} 匹配:`, matches);
    } else {
        console.log(`   模式${index + 1}: 无匹配`);
    }
});

// 手动测试中等优先级模式
const mediumPriorityPatterns = [
    /^\[.*?(?:code|verification|验证|confirm).*?(\d{4,8})/im,
    /^\[.*?(\d{4,8}).*?(?:code|verification|验证|confirm).*?\]$/im,
    /(?:code|verification|验证|confirm)[\s:：\n]*(?:is|:|=)?\s*(\d{4,8})/gi
];

console.log('\n2. 中等优先级模式匹配:');
mediumPriorityPatterns.forEach((pattern, index) => {
    const matches = content.match(pattern);
    if (matches) {
        console.log(`   模式${index + 1} 匹配:`, matches);
    } else {
        console.log(`   模式${index + 1}: 无匹配`);
    }
});

// 手动测试低优先级模式
const lowPriorityPatterns = [
    /(?:^|\s)(?!0{6}|123456|000000|111111|222222|333333|444444|555555|666666|777777|888888|999999)(\d{4,8})(?!\d)/gm,
    /real code (?:should be|is)[\s:：\n]*(\d{4,8})/gi
];

console.log('\n3. 低优先级模式匹配:');
lowPriorityPatterns.forEach((pattern, index) => {
    const matches = content.match(pattern);
    if (matches) {
        console.log(`   模式${index + 1} 匹配:`, matches);
    } else {
        console.log(`   模式${index + 1}: 无匹配`);
    }
});

// 运行完整算法
console.log('\n🔄 完整算法结果:');
const result = extractor.extractVerificationCodes([finalEmail]);
console.log('提取结果:', result);

// 手动测试质量验证
console.log('\n🧪 手动质量验证:');
if (numbers && numbers.length > 0) {
    numbers.forEach(number => {
        console.log(`\n数字: ${number}`);
        console.log(`- 长度检查: ${number.length >= 4 && number.length <= 8 ? '✅ 通过' : '❌ 失败'}`);
        console.log(`- 无效代码检查: ${!['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '123456', '12345678'].includes(number) ? '✅ 通过' : '❌ 失败'}`);
        console.log(`- 上下文关键词检查: ${content.toLowerCase().includes('verification') || content.toLowerCase().includes('code') ? '✅ 通过' : '❌ 失败'}`);
    });
}