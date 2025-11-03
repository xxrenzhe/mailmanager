# 基本原则和项目信息
1. 使用中文进行沟通和文档输出
2. 遵循KISS原则，在确保实现业务需求的情况下，简化代码实现，提高可维护性
3. 不要为了简化，而破坏业务核心功能和逻辑，简化不是无脑删除，而是在保持业务价值的前提下提升代码质量和可维护性
4. 不要模拟测试，而是使用真实的数据进行测试
5. 始终先验证当前实际使用的文件和配置，不要基于假设进行分析，也不要重复造轮子
6. 先验证，再修复 - 假设是调试之敌，实际检查是解决之基
7. 修复前必先全面检查依赖关系，增量修复优于整体重写，确保所有现有功能完整保留
8. 分析数据流问题时，必须逆向检查所有fallback和默认值逻辑，因为异常路径往往比正常路径更容易隐藏真正的问题根源
9. 修复特定问题时，必须严格限制修改范围，只触碰与问题直接相关的代码，并在修改后立即验证所有核心功能是否正常
10. 请自行访问GCP完成更新：使用secrets目录下的gcp_codex_dev.json密钥文件
- GCP服务账号：codex-dev@gen-lang-client-0944935873.iam.gserviceaccount.com
- GCP_Project_ID：gen-lang-client-0944935873
- GCP_REGION：asia-northeast1
11. secrets目录和其下的所有文件都不能上传Github，也不能打包进入镜像
12. 301跳转实现：使用Cloudflare CDN配置域名重定向（mailmanager.dev → www.mailmanager.dev），避免在应用层实现，遵循单一职责原则
13. 代码分支和部署流程（Github Actions）
   部署流程主要分两步，第一步：推送代码到Github，触发Github Actions，生成镜像；第二部：手动拉取镜像并部署到ClawCloud
   - 代码推送到main分支，触发production环境镜像构建：标注 docker image tag 为 prod-latest 和 prod-[commitid]
   - 当打了tag（如v3.0.0），触发production环境镜像构建：标注 docker image tag 为 prod-[tag] 和 prod-[commitid]
   - 除了main分支外，不要创建额外的分支

# MailManager 邮件管理系统

## 系统概述

MailManager 是一个专注于Microsoft Outlook邮箱验证码管理的系统，支持批量导入、实时监控和自动提取验证码。采用纯前端架构，数据存储在浏览器本地，支持多用户并发使用。

## 核心功能

- **批量管理**: 支持导入多个Outlook邮箱账户
- **实时监控**: 自动监控邮件并提取验证码
- **智能提取**: 精确识别邮件中的验证码
- **双重通信**: WebSocket + SSE保障实时更新
- **多用户支持**: 每个浏览器独立会话，数据隔离
- **本地存储**: 邮箱数据完全存储在浏览器本地

## 技术架构

### 前端
- **技术栈**: HTML5 + CSS3 + JavaScript
- **UI框架**: Tailwind CSS
- **实时通信**: WebSocket + Server-Sent Events
- **数据存储**: 浏览器 LocalStorage

### 后端
- **服务器**: Node.js + Express.js
- **API代理**: Microsoft Outlook API代理
- **实时通信**: WebSocket服务器 + SSE
- **速率限制**: Microsoft API调用频率管理

## 📖 用户操作指南

### 1. 系统访问
- **本地开发**: `http://localhost:3001`
- **Docker部署**: `http://localhost`

### 2. 准备工作 - Microsoft OAuth配置

**步骤1: Azure应用注册**
1. 访问 [Azure Portal](https://portal.azure.com)
2. 进入"应用注册" → "新注册"
3. 配置API权限：
   - `Mail.Read` - 读取邮件
   - `IMAP.AccessAsUser.All` - IMAP访问
   - `SMTP.Send` - 发送邮件
   - `offline_access` - 刷新令牌
4. 记录"应用程序(客户端) ID"

**步骤2: 获取Refresh Token**
```bash
curl -s https://login.microsoftonline.com/common/oauth2/v2.0/token \
  -d 'client_id=YOUR_CLIENT_ID' \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=YOUR_REFRESH_TOKEN'
```

### 3. 邮箱导入

**数据格式**:
```
邮箱地址,密码,客户端ID,刷新令牌
user@outlook.com,password123,YOUR_CLIENT_ID,YOUR_REFRESH_TOKEN
```

**导入步骤**:
1. 点击"导入邮箱"按钮
2. 在弹窗中粘贴邮箱数据
3. 点击"导入邮箱"开始处理
4. 等待导入完成，系统会显示处理结果

### 4. 邮箱管理

**主要操作**:
- **搜索**: 通过邮箱地址快速查找
- **筛选**: 按状态筛选（全部/待授权/已授权）
- **排序**: 点击列标题进行排序
- **分页**: 支持每页显示10/20/50/100条

**操作列功能**:
- **复制邮箱**: 一键复制邮箱地址（调用 `/api/monitor/copy-trigger`）
- **复制验证码**: 复制最新验证码（本地数据，无需API调用）
- **查看详情**: 显示账户详细信息和验证码历史

### 5. 验证码监控

**自动监控**:
- 复制邮箱地址自动启动60秒监控
- 系统实时检查新邮件
- 发现验证码立即显示通知
- 60秒后自动停止监控

**验证码提取**:
- 智能识别邮件中的6位数字验证码
- 自动过滤邮政编码、电话号码等非验证码数字
- 显示验证码发件人和时间
- 支持验证码历史记录

## 🔧 高级功能

### 实时更新
- **WebSocket**: 主要实时通信通道
- **SSE备用**: WebSocket失败时自动切换
- **自动重连**: 连接断开自动重新连接

### 数据安全
- **本地存储**: 敏感数据不上传服务器
- **会话隔离**: 每个浏览器独立数据
- **OAuth标准**: 使用Microsoft官方认证流程

### 性能优化
- **速率限制**: 遵循Microsoft API调用限制
- **缓存机制**: 智能缓存提升响应速度
- **批量处理**: 支持大量邮箱并发处理

## 🚨 故障排除

### 常见问题

**1. 无法访问系统**
- 确认服务器运行：`curl http://localhost:3001/api/health`
- 检查端口配置：确保3001端口可用

**2. 邮箱授权失败**
- 重新获取refresh_token
- 检查Client ID配置
- 验证Azure应用权限设置

**3. 无法获取邮件**
- 检查网络连接
- 验证API权限
- 查看控制台错误日志

**4. 验证码提取失败**
- 确认邮件包含6位数字验证码
- 检查邮件格式和发件人
- 查看服务器详细日志

**5. 实时更新异常**
- 检查WebSocket连接状态
- 尝试刷新页面重新连接
- 查看浏览器控制台Network标签

### 开发调试

**控制台调试**:
```javascript
// 开启调试模式
localStorage.setItem('debug', 'true');

// 查看连接状态
console.log('WebSocket状态:', window.mailManagerInstance?.ws?.readyState);
```

**API测试**:
```bash
# 健康检查
curl http://localhost:3001/api/health

# 手动触发监控
curl -X POST http://localhost:3001/api/monitor/copy-trigger \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@outlook.com",
    "password": "password",
    "client_id": "YOUR_CLIENT_ID",
    "refresh_token": "YOUR_REFRESH_TOKEN",
    "sessionId": "test-session"
  }'
```

## 🚀 部署指南

### 本地开发
```bash
git clone https://github.com/xxrenzhe/mailmanager.git
cd mailmanager
npm install
node balanced-proxy-server-simple.js
```

### Docker部署
```bash
# 构建镜像
docker build -t mailmanager .

# 运行容器
docker run -d -p 80:3000 mailmanager
```

### 生产部署
1. GitHub Actions自动构建Docker镜像
2. 手动拉取镜像并部署到生产环境
3. 配置HTTPS和域名

## 📊 系统架构

```
用户浏览器 → Nginx → Node.js → Microsoft Outlook API
     ↓            ↓        ↓              ↓
LocalStorage   WebSocket  API代理         邮件数据
```

**组件说明**:
- **Nginx**: 反向代理和负载均衡
- **Node.js**: 业务逻辑和API代理
- **WebSocket**: 实时双向通信
- **Microsoft Outlook API**: 邮件数据源

## 🔌 API接口对应关系

### 前端操作与后端API映射

| 前端操作 | 后端API接口 | 功能说明 |
|---------|------------|----------|
| **邮箱导入** | `POST /api/accounts/batch-import` | 批量导入邮箱账户 |
| **复制邮箱地址** | `POST /api/monitor/copy-trigger` | 复制邮箱并启动60秒监控 |
| **手动获取邮件** | `POST /api/manual-fetch-emails` | 手动触发指定账户的邮件获取 |
| **OAuth授权** | `GET /oauth/authorize` | 跳转到Microsoft授权页面 |
| **OAuth回调** | `GET /oauth/callback` | 处理授权回调 |
| **获取Token** | `POST /oauth/token` | 刷新或获取访问令牌 |
| **验证邮箱格式** | `POST /api/validate-email` | 验证邮箱地址格式 |
| **提取验证码** | `POST /api/extract-verification-codes` | 批量提取邮件中的验证码 |
| **账户状态同步** | `POST /api/accounts/verify-sync` | 同步账户状态信息 |
| **刷新Token** | `POST /api/accounts/refresh-token-direct` | 直接刷新单个账户的令牌 |
| **清空数据** | `POST /api/accounts/clear-all` | 清空所有数据 |
| **系统信息** | `GET /api/info` | 获取系统版本信息 |
| **统计数据** | `GET /api/stats` | 获取账户统计信息 |
| **健康检查** | `GET /api/health` | 检查服务健康状态 |

### 实时通信接口

| 通信方式 | 接口地址 | 功能说明 |
|---------|----------|----------|
| **WebSocket** | `ws://localhost:3002` | 主要实时通信通道 |
| **SSE备用** | `GET /api/events/stream/:sessionId` | WebSocket失败时的备用方案 |
| **事件触发** | `POST /api/events/trigger` | 手动触发事件通知 |

### API调用特点

- **无状态设计**: 每个请求独立处理，不依赖服务器状态
- **本地存储**: 邮箱数据完全存储在浏览器Local Storage中
- **会话隔离**: 通过sessionId实现多用户数据隔离
- **实时更新**: WebSocket + SSE双重保障���时性
- **速率限制**: 遵循Microsoft API调用频率限制（每秒2次，每分钟30次）

---

*最后更新: 2025-11-03 | 完整版*