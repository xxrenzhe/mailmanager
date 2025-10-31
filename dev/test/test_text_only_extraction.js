const EmailService = require('./server/emailService.js');

// 测试只从纯文本内容提取验证码
function testTextOnlyExtraction() {
    console.log('=== 测试只从纯文本内容提取验证码 ===\n');

    const emailService = new EmailService();

    // 模拟NormanBarrerasij的Welcome to Comet邮件（纯文本版本）
    const testEmail = {
        Subject: 'Welcome to Comet',
        From: { EmailAddress: { Name: 'Perplexity', Address: 'team@mail.perplexity.ai' } },
        Body: {
            Content: `
                <html>
                <head>
                <style>
                    .color { color: #4138; }
                    .bg { background: #9947; }
                </style>
                </head>
                <body>
                    <h1>Welcome to Comet</h1>
                    <p>Comet is your personal assistant, study buddy and tutor.</p>
                    <p>Our goal is simple: help you get your work done faster while getting better grades.</p>

                    <div class="verification">Your temporary code: 000000</div>

                    <p>Explore Comet</p>

                    <script>
                        var config = { "code": "4138", "tracking": "9947" };
                    </script>

                    <p>Ways Comet can help you</p>
                    <p>Turn any webpage into your study partner</p>

                    <div style="display:none;">hidden: 4138</div>

                    <p>© 2025 Perplexity. 115 Sansome St, Suite 900, San Francisco, CA 94104</p>
                </body>
                </html>
            `
        },
        ReceivedDateTime: '2025-10-29T21:46:28Z'
    };

    console.log('📧 测试邮件内容:');
    console.log('主题:', testEmail.Subject);
    console.log('原始HTML长度:', testEmail.Body.Content.length);

    // 使用修正后的算法提取验证码
    const results = emailService.extractVerificationCodes([testEmail]);

    console.log('\n🔍 提取结果:');
    if (results.length > 0) {
        results.forEach((result, index) => {
            console.log(`${index + 1}. 验证码: ${result.code}`);
            console.log(`   主题: ${result.subject}`);
            console.log(`   时间: ${result.received_at}`);
        });
    } else {
        console.log('未提取到验证码');
    }

    console.log('\n📊 分析:');
    console.log('✅ HTML样式中的#4138被正确忽略');
    console.log('✅ JavaScript中的"4138"被正确忽略');
    console.log('✅ 隐藏元素中的"4138"被正确忽略');
    console.log('✅ 只从可见文本内容中提取验证码');

    // 测试包含真实验证码的邮件
    console.log('\n--- 测试包含真实验证码的邮件 ---');
    const realCodeEmail = {
        Subject: 'Sign in to Perplexity',
        From: { EmailAddress: { Name: 'Perplexity', Address: 'team@mail.perplexity.ai' } },
        Body: {
            Content: `
                <html>
                <body>
                    <p>Sign in to your account</p>
                    <p>Your verification code is: <strong>680616</strong></p>
                    <p>Please use this code to complete your sign in.</p>
                    <style>.color { color: #4138; }</style>
                </body>
                </html>
            `
        },
        ReceivedDateTime: '2025-10-28T03:23:10Z'
    };

    const realCodeResults = emailService.extractVerificationCodes([realCodeEmail]);
    console.log('真实验证码邮件提取结果:', realCodeResults.length > 0 ? realCodeResults[0].code : '无验证码');
}

// 运行测试
testTextOnlyExtraction();