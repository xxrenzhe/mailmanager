# 📧 Outlook 邮箱重新授权指南

## 📊 当前状态分析

- **总账户数**: 1100
- **显示授权**: 1100
- **需要重新授权**: 0
- **估计有效token**: 1100
- **估计过期token**: 0

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
   - 打开 `auth_url_generator.html`
   - 批量生成授权URL
   - 逐个点击进行授权

2. **使用预生成的URL列表**
   - 查看 `reauth_urls.json` 文件
   - 包含所有账户的授权URL

### 方案2: 逐个重新授权

1. 访问授权URL
2. 登录Microsoft账户
3. 同意授权
4. 系统会自动更新认证信息

## 📋 需要重新授权的账户

### 立即需要重新授权 (50 个)

- **AnaGarzaxq@outlook.com** - 缺少有效认证信息
- **AnitaMckeithanvk@outlook.com** - 缺少有效认证信息
- **ArdisDillsw@outlook.com** - 缺少有效认证信息
- **BerthaPetittq@outlook.com** - 缺少有效认证信息
- **CarmelitaStoltzfuszk@outlook.com** - 缺少有效认证信息
- **CarolynHoymansn@outlook.com** - 缺少有效认证信息
- **CassandraLasalams@outlook.com** - 缺少有效认证信息
- **ChristyHowardhq@outlook.com** - 缺少有效认证信息
- **DanaCamperpv@outlook.com** - 缺少有效认证信息
- **DebraSandovallr@outlook.com** - 缺少有效认证信息
- **DerekJettgf@outlook.com** - 缺少有效认证信息
- **DonGrillomo@outlook.com** - 缺少有效认证信息
- **DorineTorresxj@outlook.com** - 缺少有效认证信息
- **FernandoWilliamsrx@outlook.com** - 缺少有效认证信息
- **FrankBaumeisterss@outlook.com** - 缺少有效认证信息
- **IreneHeftms@outlook.com** - 缺少有效认证信息
- **JamesLipsonrr@outlook.com** - 缺少有效认证信息
- **JayWaagefz@outlook.com** - 缺少有效认证信息
- **JayeNorgardkh@outlook.com** - 缺少有效认证信息
- **JeremyDevillebd@outlook.com** - 缺少有效认证信息


... 还有 30 个账户，详见 `reauth_list.json`

### 建议验证的账户 (1050 个)

- **AaronFarmerri@outlook.com** - 需要验证token是否仍然有效
- **AaronGipsonrj@outlook.com** - 需要验证token是否仍然有效
- **AaronHendricksonft@outlook.com** - 需要验证token是否仍然有效
- **AaronWaltonlq@outlook.com** - 需要验证token是否仍然有效
- **AbrahamStearnsnb@outlook.com** - 需要验证token是否仍然有效
- **AdeleColling@outlook.com** - 需要验证token是否仍然有效
- **AidaBakerid@outlook.com** - 需要验证token是否仍然有效
- **AlanBattlezi@outlook.com** - 需要验证token是否仍然有效
- **AlanLongleybi@outlook.com** - 需要验证token是否仍然有效
- **AlbertFreemancw@outlook.com** - 需要验证token是否仍然有效


... 还有 1040 个账户

## 🚀 快速操作步骤

### 批量操作 (推荐)

1. **准备阶段**
   ```bash
   # 生成所有授权URL
   node create_reauth_guide.js
   ```

2. **批量授权**
   - 打开 `auth_url_generator.html`
   - 复制邮箱列表到文本框
   - 点击"生成授权URL"
   - 逐个点击"打开授权页面"

3. **验证结果**
   ```bash
   # 检查授权状态
   sqlite3 data/mailmanager.db "SELECT status, COUNT(*) FROM accounts GROUP BY status"
   ```

### 单个操作

1. **生成单个授权URL**
   ```bash
   # 使用邮箱地址生成URL
   node generate_single_auth.js user@example.com
   ```

2. **手动授权**
   - 访问生成的URL
   - 登录并同意授权
   - 检查系统是否更新

## 🔍 验证授权状态

授权完成后，验证是否成功：

```bash
# 查看账户状态
sqlite3 data/mailmanager.db "SELECT email, status FROM accounts WHERE status = 'authorized' LIMIT 10"

# 测试邮件提取
node test_single_account.js user@example.com
```

## ⚡ 自动化监控

重新授权完成后，系统会：

1. **自动检测**: 每5分钟检查授权状态
2. **自动标记**: 将失效的token标记为需要重新授权
3. **通知提醒**: 在界面显示需要重新授权的账户

## 📞 技术支持

如果遇到问题：

1. **检查Client ID**: 确保 `OUTLOOK_CLIENT_ID` 环境变量正确
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

**生成时间**: 2025/10/31 12:02:24
**系统状态**: 需要用户手动重新授权
**预计完成时间**: 30-60分钟 (取决于账户数量)