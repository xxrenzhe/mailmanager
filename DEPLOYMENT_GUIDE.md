# 邮件验证码管理系统 - 浏览器版部署指南

## 📋 概述

本系统已完全迁移到浏览器端运行，所有数据存储在用户浏览器本地，无需后端服务器。支持完整的邮件管理功能，包括账户管理、验证码提取、批量导入等。

## 🚀 快速部署

### 方法一：直接访问
最简单的部署方式，直接用浏览器打开HTML文件：
```bash
# 用浏览器打开
open browser-version.html
```

### 方法二：本地HTTP服务器
推荐使用HTTP服务器以避免某些浏览器的安全限制：

```bash
# 使用Python内置服务器
cd /Users/jason/Documents/Kiro/mailmanager
python3 -m http.server 8000
# 访问 http://localhost:8000/browser-version.html

# 使用Node.js serve
npx serve -s . -p 8000
# 访问 http://localhost:8000/browser-version.html

# 使用PHP内置服务器
php -S localhost:8000
# 访问 http://localhost:8000/browser-version.html
```

### 方法三：静态网站托管
部署到免费的静态网站托管服务：

#### GitHub Pages
```bash
# 1. 创建GitHub仓库
git init
git add browser-version.html
git commit -m "Add mail manager"
git branch -M main
git remote add origin https://github.com/yourusername/mailmanager.git
git push -u origin main

# 2. 在GitHub仓库设置中启用GitHub Pages
# 3. 访问 https://yourusername.github.io/mailmanager/browser-version.html
```

#### Netlify
```bash
# 1. 拖拽browser-version.html到 https://netlify.com/drop
# 2. 获得自动生成的URL，如：https://random-name-123456.netlify.app
```

#### Vercel
```bash
# 1. 安装Vercel CLI
npm i -g vercel

# 2. 部署
vercel --prod
```

#### Firebase Hosting
```bash
# 1. 安装Firebase CLI
npm install -g firebase-tools

# 2. 初始化项目
firebase init hosting

# 3. 部署
firebase deploy
```

## 🔧 配置说明

### OAuth应用配置
为了使用真实的Outlook授权，需要配置Microsoft OAuth应用：

1. **注册Azure应用**
   - 访问 https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps
   - 点击"新注册"
   - 名称：邮件验证码管理器
   - 支持的账户类型：任何组织目录(任何 Azure AD 目录 - 多租户)中的账户
   - 重定向URI：添加你的部署URL，如 `https://yourdomain.com/browser-version.html`

2. **获取应用凭据**
   - 在应用页面点击"证书和密码"
   - 创建新的客户端密码
   - 复制应用程序(客户端)ID和客户端密钥的值

3. **配置API权限**
   - 点击"API权限"
   - 添加权限：Microsoft Graph → Mail.Read
   - 选择"委托的权限"

4. **更新配置**
   在 `browser-version.html` 中找到 `oauthConfig` 对象，更新配置：
   ```javascript
   this.oauthConfig = {
       clientId: 'YOUR_CLIENT_ID', // 替换为你的客户端ID
       redirectUri: 'https://yourdomain.com/browser-version.html', // 你的部署URL
       scopes: ['https://graph.microsoft.com/Mail.Read'],
       authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
   };
   ```

## 📊 功能特性

### 核心功能
- ✅ **账户管理**：添加、编辑、删除邮箱账户
- ✅ **OAuth授权**：完整的Outlook/Microsoft 365授权流程
- ✅ **验证码提取**：自动从邮件中提取验证码
- ✅ **实时同步**：定时检查新邮件和验证码
- ✅ **批量导入**：支持批量导入大量邮箱账户
- ✅ **数据导出**：完整的备份和恢复功能

### 高级功能
- ✅ **智能搜索**：支持邮箱地址和显示名称搜索
- ✅ **状态过滤**：按授权状态筛选账户
- ✅ **多字段排序**：支持状态、邮箱、验证码、时间等排序
- ✅ **分页显示**：高效处理大量账户数据
- ✅ **批量操作**：批量同步、批量删除等
- ✅ **存储监控**：实时显示本地存储使用情况

### 用户体验
- ✅ **响应式设计**：完美支持桌面和移动设备
- ✅ **现代化UI**：Material Design风格的界面
- ✅ **实时反馈**：操作进度和结果提示
- ✅ **键盘快捷键**：支持Ctrl+N添加账户等快捷键
- ✅ **离线缓存**：支持离线查看已缓存数据

## 💾 数据存储

### 存储方式
- **主存储**：IndexedDB（现代浏览器默认支持）
- **降级存储**：LocalStorage（兼容旧浏览器）
- **存储容量**：通常5-10MB（取决于浏览器）

### 数据结构
```javascript
{
    accounts: [
        {
            id: "唯一ID",
            email: "邮箱地址",
            name: "显示名称",
            status: "authorized|pending|reauth_needed",
            codes: [
                {
                    code: "验证码",
                    sender: "发件人",
                    received_at: "接收时间",
                    extracted_at: "提取时间"
                }
            ],
            access_token: "访问令牌",
            refresh_token: "刷新令牌",
            token_expires_at: "令牌过期时间",
            created_at: "创建时间",
            updated_at: "更新时间",
            last_sync: "最后同步时间"
        }
    ],
    version: "2.0",
    lastUpdated: "最后更新时间"
}
```

### 数据备份
- **自动备份**：建议用户定期导出数据
- **手动备份**：点击"导出数据"按钮
- **备份格式**：JSON格式，包含完整账户和验证码数据
- **恢复功能**：支持导入之前备份的数据

## 🔒 安全考虑

### 客户端安全
- ✅ **本地存储**：所有数据存储在用户浏览器本地
- ✅ **HTTPS传输**：生产环境必须使用HTTPS
- ✅ **令牌管理**：访问令牌安全存储在本地
- ✅ **权限最小化**：只请求必要的邮件读取权限

### 隐私保护
- ✅ **数据不出本地**：用户数据不离开浏览器
- ✅ **无服务器存储**：没有中央数据库可被攻击
- ✅ **用户控制**：用户完全控制自己的数据
- ✅ **随时删除**：用户可随时清除所有数据

### 安全建议
1. **使用HTTPS**：确保部署环境使用HTTPS
2. **定期备份**：提醒用户定期导出数据备份
3. **浏览器更新**：建议用户使用最新版浏览器
4. **设备安全**：确保用户设备安全，避免恶意软件

## 🚀 性能优化

### 前端优化
- ✅ **虚拟滚动**：处理大量数据时的性能优化
- ✅ **延迟加载**：按需加载数据
- ✅ **缓存策略**：智能缓存常用数据
- ✅ **代码分割**：按需加载功能模块

### 数据优化
- ✅ **数据压缩**：压缩存储的验证码数据
- ✅ **定期清理**：自动清理过期的验证码
- ✅ **去重处理**：避免重复存储相同验证码
- ✅ **索引优化**：优化搜索和排序性能

## 📱 移动端支持

### 响应式设计
- ✅ **自适应布局**：支持各种屏幕尺寸
- ✅ **触摸优化**：优化触摸操作体验
- ✅ **移动导航**：友好的移动端导航
- ✅ **性能优化**：移动端性能优化

### 移动端特性
- ✅ **PWA支持**：可安装到主屏幕
- ✅ **离线功能**：支持离线查看数据
- ✅ **推送通知**：新验证码到达通知
- ✅ **手势操作**：支持滑动手势

## 🔧 故障排除

### 常见问题

#### 1. OAuth授权失败
**问题**：点击授权后无法完成授权流程
**解决方案**：
- 检查客户端ID和重定向URI配置
- 确保重定向URI在Azure应用中正确配置
- 检查浏览器是否阻止了弹窗

#### 2. 数据丢失
**问题**：刷新页面后数据消失
**解决方案**：
- 检查浏览器是否支持IndexedDB
- 尝试清除浏览器缓存后重新加载
- 检查浏览器隐私设置是否阻止本地存储

#### 3. 存储空间不足
**问题**：添加账户时提示存储空间不足
**解决方案**：
- 导出并清理旧数据
- 删除不需要的账户和验证码
- 使用支持更大存储空间的浏览器

#### 4. 验证码提取失败
**问题**：无法自动提取验证码
**解决方案**：
- 检查账户授权状态
- 确认网络连接正常
- 手动触发同步操作

### 调试模式
开启调试模式查看详细日志：
```javascript
// 在浏览器控制台执行
localStorage.setItem('mailmanager_debug', 'true');
```

## 📈 监控和维护

### 性能监控
- **存储使用情况**：实时监控本地存储使用量
- **同步成功率**：监控邮件同步的成功率
- **响应时间**：监控各操作的响应时间

### 维护建议
1. **定期清理**：建议用户定期清理过期数据
2. **备份提醒**：定期提醒用户备份数据
3. **版本更新**：保持系统版本更新
4. **安全检查**：定期检查安全配置

## 🆘 技术支持

### 获取帮助
- 📧 **邮件支持**：support@example.com
- 📖 **文档中心**：查看完整使用文档
- 🐛 **问题反馈**：通过GitHub Issues报告问题
- 💬 **社区支持**：加入用户交流群

### 贡献代码
欢迎提交代码贡献和改进建议：
1. Fork项目仓库
2. 创建功能分支
3. 提交代码更改
4. 发起Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证，详情请查看 LICENSE 文件。

---

**部署完成后，用户即可享受完全本地化的邮件验证码管理体验，无需担心数据隐私和安全问题！**