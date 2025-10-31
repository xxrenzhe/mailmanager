const EmailService = require('./server/emailService.js');

function debugExtractionProcess() {
    console.log('=== 调试���证码提取过程 ===\n');

    const emailService = new EmailService();

    // 使用你提供的真实邮件内容
    const realEmailContent = `
Welcome to Comet
Comet is your personal assistant, study buddy and tutor. Our goal is simple: help you get your work done faster while getting better grades.
Explore Comet
Ways Comet can help you

Turn any webpage into your study partner
Watching a lecture at 2x speed? Ask Comet for the key points or create a study guide without taking notes.

Get your assignments done faster
Essay coming up? Comet retrieves relevant research, drafts outlines, suggests thesis statements, and organizes citations in seconds.
Master any subject with AI-powered study tools
Generate custom flashcards from your readings, create practice quizzes from lecture notes, or get step-by-step explanations of complex problems.
Never lose track of your academic life
Automatically organize your class schedule, sync assignment deadlines to your calendar, and keep all your academic resources in one intelligent workspace.

Explore Comet
Quick-start checklist:

1) Make Comet your default browser
Go to Settings → Default browser
2) Import from your old browser
Go to Settings → Import
3) Set advertising preferences
Go to Settings → Privacy → Ad block
See the detailed guide
Helpful information
Your data and privacy
To see how we protect your data, visit our privacy page.
Share your feedback
Go to Menu > Share feedback or
use this form.

Follow along for Comet use cases & updates













© 2025 Perplexity. 115 Sansome St, Suite 900, San Francisco, CA 94104
Unsubscribe | Privacy Policy | Terms and conditions
    `;

    const testEmail = {
        Subject: 'Welcome to Comet',
        From: { EmailAddress: { Name: 'Perplexity', Address: 'team@mail.perplexity.ai' } },
        Body: { Content: realEmailContent },
        ReceivedDateTime: '2025-10-29T21:46:28Z'
    };

    console.log('📧 邮件主题:', testEmail.Subject);
    console.log('📄 邮件正文长度:', testEmail.Body.Content.length);

    // 逐步调试提取过程
    console.log('\n🔍 步骤1: 清理HTML内容');
    let bodyContent = testEmail.Body.Content;
    console.log('原始内容包含HTML标签:', bodyContent.includes('<'));

    if (bodyContent && bodyContent.includes('<')) {
        bodyContent = bodyContent
            .replace(/<script[^>]*>.*?<\/script>/gis, '') // 移除脚本
            .replace(/<style[^>]*>.*?<\/style>/gis, '')   // 移除样式
            .replace(/<[^>]*>/g, ' ')                      // 移除HTML标签
            .replace(/\s+/g, ' ')                         // 合并空白字符
            .trim();
    }

    console.log('清理后内容长度:', bodyContent.length);
    console.log('清理后内容前200字符:', bodyContent.substring(0, 200));

    const emailContent = `${testEmail.Subject} ${bodyContent}`;
    console.log('\n🔍 步骤2: 查找所有4-8位数字');
    const allNumbers = emailContent.match(/\b\d{4,8}\b/g);
    console.log('找到的数字:', allNumbers);

    console.log('\n🔍 步骤3: 测试每个验证模式');
    const verificationPatterns = [
        /\b\d{4,8}\b/g,  // 4-8位数字
        /(?:code|verification|验证码)[\s:：]*(\d{4,8})/gi,
        /(?:verification code|验证码)[\s:：]*(\d{4,8})/gi,
        /(?:pin|密码)[\s:：]*(\d{4,8})/gi,
        /^\[.*?(\d{4,8}).*?\]/gm,
        /(?:验证|verification).*?(\d{4,8})/gi
    ];

    verificationPatterns.forEach((pattern, index) => {
        const matches = emailContent.match(pattern);
        if (matches) {
            console.log(`模式 ${index + 1} 匹配:`, matches);
        }
    });

    console.log('\n🔍 步骤4: 使用完整算法');
    const results = emailService.extractVerificationCodes([testEmail]);
    console.log('最终提取结果:', results);

    console.log('\n📊 结论:');
    if (results.length === 0) {
        console.log('✅ 正确：从真实的Welcome to Comet邮件中没有提取到验证码');
        console.log('✅ 这说明之前数据库中的"4138"可能是错误提取的结果');
    } else {
        console.log('❌ 问题：仍然提取到了验证码:', results[0].code);
    }
}

debugExtractionProcess();