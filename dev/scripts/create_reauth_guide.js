/**
 * 创建重新授权指南脚本
 * 为用户提供清晰的重新授权步骤
 */

const Database = require('./server/database');
const fs = require('fs');
const path = require('path');

class ReauthGuideGenerator {
    constructor() {
        this.db = new Database('./data/mailmanager.db');
    }

    async init() {
        try {
            await this.db.init();
        } catch (error) {
            console.log('Database initialization had issues, but continuing with existing tables...');
            this.db.db = new (require('sqlite3').Database)('./data/mailmanager.db');
        }
    }

    async generateReauthGuide() {
        console.log('\n=== 生成重新授权指南 ===');

        try {
            // 1. 分析当前认证状态
            const authAnalysis = await this.analyzeAuthStatus();

            // 2. 生成重新授权列表
            const reauthList = await this.generateReauthList();

            // 3. 创建授权URL生成器
            await this.createAuthUrlGenerator();

            // 4. 生成操作指南
            await this.createOperationGuide(authAnalysis, reauthList);

            console.log('✅ 重新授权指南生成完成');
            console.log('📄 请查看以下文件：');
            console.log('   - REAUTH_GUIDE.md - 详细操作指南');
            console.log('   - reauth_urls.json - 批量授权URL列表');
            console.log('   - auth_url_generator.html - URL生成工具');

        } catch (error) {
            console.error('❌ 生成指南失败:', error);
        }
    }

    async analyzeAuthStatus() {
        console.log('\n📊 分析认证状态...');

        const totalAccounts = await this.db.get('SELECT COUNT(*) as count FROM accounts');
        const authorizedAccounts = await this.db.get('SELECT COUNT(*) as count FROM accounts WHERE status = "authorized"');
        const reauthNeededAccounts = await this.db.get('SELECT COUNT(*) as count FROM accounts WHERE status = "reauth_needed"');

        // 检查token有效性（抽样测试）
        const sampleAccounts = await this.db.all(`
            SELECT email, refresh_token_enc
            FROM accounts
            WHERE refresh_token_enc IS NOT NULL
            AND refresh_token_enc NOT LIKE 'simulated_%'
            LIMIT 10
        `);

        let validTokens = 0;
        for (const account of sampleAccounts) {
            if (account.refresh_token_enc && account.refresh_token_enc.startsWith('M.C')) {
                validTokens++;
            }
        }

        const analysis = {
            total: totalAccounts.count,
            authorized: authorizedAccounts.count,
            reauth_needed: reauthNeededAccounts.count,
            valid_token_estimate: Math.round((validTokens / sampleAccounts.length) * authorizedAccounts.count),
            expired_token_estimate: authorizedAccounts.count - Math.round((validTokens / sampleAccounts.length) * authorizedAccounts.count)
        };

        console.log(`   总账户数: ${analysis.total}`);
        console.log(`   显示授权: ${analysis.authorized}`);
        console.log(`   需要重新授权: ${analysis.reauth_needed}`);
        console.log(`   估计有效token: ${analysis.valid_token_estimate}`);
        console.log(`   估计过期token: ${analysis.expired_token_estimate}`);

        return analysis;
    }

    async generateReauthList() {
        console.log('\n📋 生成需要重新授权的账户列表...');

        const allAccounts = await this.db.all(`
            SELECT id, email, status, refresh_token_enc
            FROM accounts
            ORDER BY status, email
        `);

        const reauthList = {
            needs_reauth: [],
            should_verify: []
        };

        for (const account of allAccounts) {
            if (account.status === 'reauth_needed') {
                reauthList.needs_reauth.push({
                    id: account.id,
                    email: account.email,
                    reason: '状态标记为需要重新授权'
                });
            } else if (account.status === 'authorized' && (!account.refresh_token_enc || account.refresh_token_enc.startsWith('simulated_'))) {
                reauthList.needs_reauth.push({
                    id: account.id,
                    email: account.email,
                    reason: '缺少有效认证信息'
                });
            } else if (account.status === 'authorized' && account.refresh_token_enc && account.refresh_token_enc.startsWith('M.C')) {
                reauthList.should_verify.push({
                    id: account.id,
                    email: account.email,
                    reason: '需要验证token是否仍然有效'
                });
            }
        }

        // 保存列表到文件
        fs.writeFileSync('./reauth_list.json', JSON.stringify(reauthList, null, 2));

        console.log(`   需要重新授权: ${reauthList.needs_reauth.length} 个`);
        console.log(`   建议验证: ${reauthList.should_verify.length} 个`);

        return reauthList;
    }

    async createAuthUrlGenerator() {
        console.log('\n🔗 创建授权URL生成器...');

        const clientId = process.env.OUTLOOK_CLIENT_ID || '你的客户端ID';
        const redirectUri = process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:3000/auth/callback';
        const scope = 'https://outlook.office.com/Mail.Read';

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Outlook 重新授权URL生成器</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .input-group { margin: 10px 0; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; }
        button { background: #0078d4; color: white; padding: 10px 20px; border: none; cursor: pointer; margin: 5px; }
        button:hover { background: #106ebe; }
        .result { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .copy-btn { background: #28a745; }
        .copy-btn:hover { background: #218838; }
    </style>
</head>
<body>
    <h1>🔧 Outlook 重新授权URL生成器</h1>

    <div class="input-group">
        <label>邮箱地址 (每行一个):</label>
        <textarea id="emails" rows="10" placeholder="user1@outlook.com&#10;user2@outlook.com&#10;user3@outlook.com"></textarea>
    </div>

    <div class="input-group">
        <label>Client ID:</label>
        <input type="text" id="clientId" value="${clientId}">
    </div>

    <div class="input-group">
        <label>Redirect URI:</label>
        <input type="text" id="redirectUri" value="${redirectUri}">
    </div>

    <button onclick="generateUrls()">生成授权URL</button>
    <button onclick="clearAll()">清空</button>

    <div id="results"></div>

    <script>
        function generateUrls() {
            const emails = document.getElementById('emails').value.split('\\n').filter(email => email.trim());
            const clientId = document.getElementById('clientId').value;
            const redirectUri = document.getElementById('redirectUri').value;
            const scope = 'https://outlook.office.com/Mail.Read';

            let results = '<h2>📋 生成的授权URL列表</h2>';

            emails.forEach((email, index) => {
                const state = btoa(JSON.stringify({
                    accountId: index + 1,
                    email: email.trim(),
                    timestamp: Date.now()
                }));

                const authUrl = \`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?\` +
                    \`client_id=\${clientId}&\` +
                    \`response_type=code&\` +
                    \`redirect_uri=\${encodeURIComponent(redirectUri)}&\` +
                    \`scope=\${encodeURIComponent(scope)}&\` +
                    \`state=\${state}\`;

                results += \`
                    <div class="result">
                        <h3>\${index + 1}. \${email}</h3>
                        <p><strong>授权URL:</strong></p>
                        <input type="text" value="\${authUrl}" readonly>
                        <button class="copy-btn" onclick="copyToClipboard('\${authUrl}')">复制URL</button>
                        <button onclick="openAuth('\${authUrl}')">打开授权页面</button>
                    </div>
                \`;
            });

            document.getElementById('results').innerHTML = results;
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                alert('URL已复制到剪贴板');
            });
        }

        function openAuth(url) {
            window.open(url, '_blank');
        }

        function clearAll() {
            document.getElementById('emails').value = '';
            document.getElementById('results').innerHTML = '';
        }
    </script>
</body>
</html>`;

        fs.writeFileSync('./auth_url_generator.html', htmlContent);

        // 生成批量URL JSON文件
        const accounts = await this.db.all('SELECT id, email FROM accounts ORDER BY email');
        const urlList = [];

        for (const account of accounts) {
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

            urlList.push({
                id: account.id,
                email: account.email,
                auth_url: authUrl,
                state: state
            });
        }

        fs.writeFileSync('./reauth_urls.json', JSON.stringify(urlList, null, 2));
        console.log(`   生成了 ${urlList.length} 个授权URL`);
    }

    async createOperationGuide(analysis, reauthList) {
        console.log('\n📖 创建操作指南...');

        const guideContent = `# 📧 Outlook 邮箱重新授权指南

## 📊 当前状态分析

- **总账户数**: ${analysis.total}
- **显示授权**: ${analysis.authorized}
- **需要重新授权**: ${analysis.reauth_needed}
- **估计有效token**: ${analysis.valid_token_estimate}
- **估计过期token**: ${analysis.expired_token_estimate}

## ⚠️ 重要说明

**为什么需要重新授权？**

1. **Token过期**: Outlook的refresh token有效期为90天
2. **长期未使用**: 如果用户长期不登录，token会提前失效
3. **安全策略**: Microsoft的安全策略可能导致token失效

**为什么不能完全自动化？**

- OAuth 2.0协议要求用户明确同意授权
- 安全考虑：必须用户手动确认
- Microsoft政策：不允许自动化的重新授权

## 🔧 解决方案

### 方案1: 批量重新授权 (推荐)

1. **使用授权URL生成器**
   - 打开 \`auth_url_generator.html\`
   - 批量生成授权URL
   - 逐个点击进行授权

2. **使用预生成的URL列表**
   - 查看 \`reauth_urls.json\` 文件
   - 包含所有账户的授权URL

### 方案2: 逐个重新授权

1. 访问授权URL
2. 登录Microsoft账户
3. 同意授权
4. 系统会自动更新认证信息

## 📋 需要重新授权的账户

### 立即需要重新授权 (${reauthList.needs_reauth.length} 个)

${reauthList.needs_reauth.slice(0, 20).map(acc =>
    `- **${acc.email}** - ${acc.reason}`
).join('\n')}

${reauthList.needs_reauth.length > 20 ? `\n... 还有 ${reauthList.needs_reauth.length - 20} 个账户，详见 \`reauth_list.json\`` : ''}

### 建议验证的账户 (${reauthList.should_verify.length} 个)

${reauthList.should_verify.slice(0, 10).map(acc =>
    `- **${acc.email}** - ${acc.reason}`
).join('\n')}

${reauthList.should_verify.length > 10 ? `\n... 还有 ${reauthList.should_verify.length - 10} 个账户` : ''}

## 🚀 快速操作步骤

### 批量操作 (推荐)

1. **准备阶段**
   \`\`\`bash
   # 生成所有授权URL
   node create_reauth_guide.js
   \`\`\`

2. **批量授权**
   - 打开 \`auth_url_generator.html\`
   - 复制邮箱列表到文本框
   - 点击"生成授权URL"
   - 逐个点击"打开授权页面"

3. **验证结果**
   \`\`\`bash
   # 检查授权状态
   sqlite3 data/mailmanager.db "SELECT status, COUNT(*) FROM accounts GROUP BY status"
   \`\`\`

### 单个操作

1. **生成单个授权URL**
   \`\`\`bash
   # 使用邮箱地址生成URL
   node generate_single_auth.js user@example.com
   \`\`\`

2. **手动授权**
   - 访问生成的URL
   - 登录并同意授权
   - 检查系统是否更新

## 🔍 验证授权状态

授权完成后，验证是否成功：

\`\`\`bash
# 查看账户状态
sqlite3 data/mailmanager.db "SELECT email, status FROM accounts WHERE status = 'authorized' LIMIT 10"

# 测试邮件提取
node test_single_account.js user@example.com
\`\`\`

## ⚡ 自动化监控

重新授权完成后，系统会：

1. **自动检测**: 每5分钟检查授权状态
2. **自动标记**: 将失效的token标记为需要重新授权
3. **通知提醒**: 在界面显示需要重新授权的账户

## 📞 技术支持

如果遇到问题：

1. **检查Client ID**: 确保 \`OUTLOOK_CLIENT_ID\` 环境变量正确
2. **检查Redirect URI**: 确保与Microsoft应用注册一致
3. **查看日志**: 检查服务器日志中的错误信息
4. **重新部署**: 必要时重启服务

## 📝 注意事项

- 重新授权需要用户登录Microsoft账户
- 每个账户都需要单独授权
- 授权信息会自动保存到数据库
- 系统会自动验证新的token
- 建议定期检查授权状态

---

**生成时间**: ${new Date().toLocaleString('zh-CN')}
**系统状态**: 需要用户手动重新授权
**预计完成时间**: 30-60分钟 (取决于账户数量)`;

        fs.writeFileSync('./REAUTH_GUIDE.md', guideContent);
        console.log('   📄 REAUTH_GUIDE.md 已生成');
    }

    async close() {
        await this.db.close();
    }
}

// 主函数
async function main() {
    const generator = new ReauthGuideGenerator();
    await generator.init();
    await generator.generateReauthGuide();
    await generator.close();
}

// 运行生成器
if (require.main === module) {
    main().catch(error => {
        console.error('生成指南失败:', error);
        process.exit(1);
    });
}