# 基本原则
1. 使用中文进行沟通和文档输出
2. 遵循KISS原则，在确保实现业务需求的情况下，简化代码实现，提高可维护性
3. 不要为了简化，而破坏业务核心功能和逻辑，简化不是无脑删除，而是在保持业务价值的前提下提升代码质量和可维护性
4. 不要模拟测试，而是使用真实的数据进行测试

# 🚀 快速开始

## Docker 部署（推荐）

```bash
# 拉取并运行
docker run -d \
  --name mailmanager \
  -p 80:80 \
  -p 3002:3002 \
  --restart unless-stopped \
  ghcr.io/xxrenzhe/mailmanager:prod-latest

# 访问应用
open http://localhost

# 健康检查
curl http://localhost/health
```

## 本地开发

```bash
# 克隆并运行
git clone https://github.com/xxrenzhe/mailmanager.git
cd mailmanager
npm install
node balanced-proxy-server.js

# 访问应用
open http://localhost:3001
```

# MailManager 邮件管理系统

## 系统概述

MailManager 是一个遵循KISS原则的邮件管理系统，专注于Microsoft Outlook邮箱的验证码自动提取和实时监控。系统采用平衡架构，代码从3326行优化到765行（减少77%），在保持完整功能的同时显著提升可维护性。

**核心价值:**
- 批量管理Outlook邮箱账户
- 智能监控并自动提取验证码
- 实时WebSocket + SSE双重通信
- 单容器部署，开箱即用
- 多用户支持，会话完全隔离

## 核心功能

### 1. 邮箱管理
- **批量导入**: 支持邮箱数组导入 `[{email, password, client_id, refresh_token}]`
- **序列管理**: 自动分配序列号，Map存储
- **客户端存储**: 数据存储在浏览器LocalStorage
- **OAuth集成**: 完整的Microsoft OAuth 2.0流程

### 2. Outlook 集成
- **REST API**: 调用Microsoft Outlook API
- **Token管理**: 自动刷新access_token
- **邮件检索**: 获取最新邮件，提取验证码
- **CORS代理**: 内置代理解决跨域问题

### 3. 验证码提取
- **智能识别**: 多层级验证码模式匹配
- **实时提取**: 自动从新邮件提取验证码
- **历史记录**: 保存最近10个验证码
- **时间过滤**: 基于最新邮件时间监控

### 4. 实时监控
- **双重通信**: WebSocket + SSE保障
- **1分钟监控**: 复制邮箱自动启动60秒监控
- **自动停止**: 监控任务60秒后自动停止
- **状态同步**: 实时同步监控状态

### 5. 多用户支持
- **会话隔离**: 每浏览器独立会话
- **事件路由**: 精确路由到对应会话
- **高并发**: 支持200+并发用户

### 6. 用户界面
- **响应式设计**: 基于Tailwind CSS
- **实时统计**: 显示账户状态和数量
- **搜索过滤**: 快速筛选账户
- **批量操作**: 数据管理和状态刷新

## 系统架构

### 架构概览
```
Browser → Proxy Server → Microsoft API
   ↓              ↓               ↓
LocalStorage    WebSocket      Outlook API
```

**架构特点:**
- **会话隔离**: 每浏览器独立会话
- **事件路由**: 精确路由到对应会话
- **高并发**: 支持多用户同时使用

### 技术栈
**前端:**
- HTML5 + CSS3 + JavaScript
- Tailwind CSS (UI框架)
- SSE + WebSocket (实时通信)

**后端:**
- Node.js + Express.js
- WebSocket服务器
- 简单Map存储
- CORS代理

### 数据流程
**导入流程:**
```
用户输入 → 验证 → 分配序列号 → 存储 → 通知完成
```

**监控流程:**
```
复制邮箱 → 启动监控 → 检查邮件 → 提取验证码 → 实时通知
```

**存储策略:**
- 前端: LocalStorage (账户数据)
- 后端: 内存Map存储 (监控状态)
- 外部: Microsoft Outlook API (邮件源)

## 技术方案详解

### 1. Microsoft Outlook 集成

**Token刷新机制:**
- 标准OAuth格式：Client ID + Refresh Token → Access Token
- 不包含scope参数，使用原始授权scope
- Access Token 1小时有效，refresh_token长期有效

**API端点:**
- Token刷新: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- 邮件API: `https://outlook.office.com/api/v2.0/me/messages`
- 权限: `IMAP.AccessAsUser.All`, `Mail.ReadWrite`, `SMTP.Send`, `POP.AccessAsUser.All`

### 2. 智能验证码提取

**识别策略:**
- 高可信度：匹配"验证码"关键词
- 中等可信度：verify/confirm/activate关键词
- 低可信度：纯数字模式

**评分权重:**
- 邮件标题: ×3.0
- 首段内容: ×3.0
- 关键词匹配: ×2.0
- 格式独立: ×1.5

### 3. 实时通信

**双重保障:**
- **WebSocket**: 主要实时通信
- **SSE**: 备用推送方案

**连接策略:**
- 本地: `ws://localhost:3002`
- 生产: `wss://domain.com/ws`
- 自动降级: WebSocket失败时切换SSE

### 4. 性能优化

**前端:**
- 分页显示 (50条/页)
- 防抖搜索 (300ms)
- 数据缓存

**后端:**
- 连接池管理
- 事件去重
- 内存缓存
- 速率限制

### 5. 安全机制

**前端安全:**
- 敏感数据加密存储
- XSS/CSRF 防护

**后端安全:**
- CORS 策略配置
- 请求大小限制
- Token 过期验证

**数据安全:**
- 客户端数据自主管理
- 最小权限原则

## 部署架构

### 开发环境
```
浏览器 → http://localhost:3001 → proxy-server.js → Microsoft API
```

### 生产环境
```
用户浏览器 → HTTPS → Docker容器 → Session Router → Microsoft API
```

**容器化特性:**
- 多阶段构建优化
- 健康检查机制
- 环境变量配置
- GitHub Actions CI/CD

**扩展性:**
- 无状态服务设计
- 负载均衡支持
- 水平扩展能力
- 监控和告警系统

## 故障排除

### 常见问题

**1. 连接错误**
- 症状: `ERR_CONNECTION_REFUSED`
- 解决: 启动 `node proxy-server.js`

**2. Token刷新失败**
- 症状: 账户状态"需重新授权"
- 解决: 重新获取refresh_token，检查client_id

**3. 邮件同步失败**
- 症状: "已授权"但无法获取邮件
- 解决: 检查API权限和网络连接

**4. 验证码提取失败**
- 症状: 有邮件但无验证码
- 解决: 检查邮件内容格式和服务器日志
- 验证码格式应为6位纯数字

### 开发配置

**本地启动:**
```bash
npm install
node proxy-server.js
open http://localhost:3001
```

**端口配置:**
- 代理服务器: 3001
- SSE端点: `/api/events/stream`
- 健康检查: `/api/health`

**优化建议:**
- 前端: 分页显示，防抖搜索
- 后端: 15秒监控间隔，事件驱动
- 安全: HTTPS部署，速率限制
- 调试: 浏览器控制台日志


# 📖 使用指南

## 🚀 快速上手

**访问系统:**
- Docker: `http://localhost`
- 本地: `http://localhost:3001`

**获取Microsoft授权:**

1. **Azure应用注册**
   - 访问 Azure Portal → 应用注册 → 新注册
   - 配置API权限: `Mail.Read`, `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`
   - 记录应用程序(客户端) ID

2. **获取Refresh Token**
   ```bash
   # 标准OAuth 2.0 Token刷新方式
   curl -s https://login.microsoftonline.com/common/oauth2/v2.0/token \
     -d 'client_id=YOUR_CLIENT_ID' \
     -d 'grant_type=refresh_token' \
     -d 'refresh_token=YOUR_REFRESH_TOKEN'
   ```

**批量导入邮箱:**
```
邮箱地址,密码,客户端ID,刷新令牌
user@outlook.com,password123,YOUR_CLIENT_ID,YOUR_REFRESH_TOKEN
```

**监控验证码:**
1. 复制邮箱地址
2. 自动启动60秒监控
3. 实时显示验证码

**API测试方式:**
```bash
# 通过后端接口测试邮箱授权和邮件获取
curl -X POST http://localhost:3001/api/monitor/copy-trigger \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@outlook.com",
    "password": "password123",
    "client_id": "YOUR_CLIENT_ID",
    "refresh_token": "YOUR_REFRESH_TOKEN",
    "sessionId": "test-session-123"
  }'
```

## 🔧 高级功能

**实时监控:**
- 复制邮箱自动触发60秒监控
- SSE技术实现毫秒级同步
- 令牌过期自动刷新

**验证码提取:**
- 多层识别算法，智能评分
- 支持6位纯数字格式
- 基于发件人智能分类

**性能优化:**
- 前端: 分页显示，防抖搜索
- 异步导入，并发验证
- 后端: 连接池，事件去重
- 会话隔离，速率限制

**安全配置:**
- 客户端数据自主管理
- HTTPS生产部署
- CORS策略，访问控制
- 最小权限原则

## 🚨 故障排除

**常见问题:**

1. **容器启动失败**
   ```bash
   docker logs mailmanager
   docker restart mailmanager
   ```

2. **授权失败 (AADSTS70000/9002313)**
   - 重新获取refresh_token
   - 检查Client ID配置
   - 验证Azure应用权限设置

3. **验证码提取失败**
   - 确认邮件包含6位纯数字验证码
   - 查看服务器日志中的邮件解析结果
   - 检查发件人是否被正确识别
   - 验证邮件内容是否包含验证码相关关键词

4. **监控异常**
   ```bash
   # 本地开发
   curl http://localhost:3001/api/health
   curl -N http://localhost:3001/api/events/stream/test-session-123

   # Docker部署
   curl http://localhost/api/health
   curl -N http://localhost/api/events/stream/test-session-123
   ```

5. **连接错误**
   - 确认服务器正在运行
   - 检查端口配置: 3001(代理), 3002(WebSocket)
   - 查看控制台日志获取详细错误信息

**维护:**
- 数据: 浏览器LocalStorage (账户信息)
- 备份: 定期导出配置
- ���志: `docker logs -f mailmanager` 或控制台输出

## 🔧 开发指南

**本地开发:**
```bash
git clone https://github.com/xxrenzhe/mailmanager.git
cd mailmanager
npm install
node balanced-proxy-server.js
open http://localhost:3001
```

**Azure应用注册:**
1. 登录 Azure Portal → 应用注册 → 新注册
2. 配置权限: `Mail.Read`, `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`
3. 记录 Client ID
4. 获取 refresh_token

**导入格式:**
```
邮箱地址,密码,Client ID,Refresh Token
```

**API测试:**
```bash
curl http://localhost:3001/api/health
curl -X POST http://localhost:3001/api/microsoft/token
```

**调试:**
- 浏览器控制台: `localStorage.setItem('debug', 'true')`
- 查看SSE连接状态

**系统信息:**

**域名服务:**
- 生产: https://www.mailmanager.dev
- Docker: http://localhost
- 开发: http://localhost:3001

**分支策略:**
- main: 生产环境，自动构建
- develop: 开发测试
- feature: 功能开发

**部署流程:**
1. GitHub Actions自动构建Docker镜像
2. 推送到Container Registry
3. 手动部署到生产环境

**镜像标签:**
- prod-latest (main分支)
- prod-[tag] (版本标签)
- dev-latest (开发分支)

**技术栈:**

**前端:**
- HTML5 + CSS3 + Vanilla JavaScript
- Tailwind CSS + Font Awesome
- WebSocket + SSE (双重通信)

**后端:**
- Node.js + Express.js
- CORS代理 + WebSocket服务器
- 内存存储 + EventEmitter

**外部服务:**
- Microsoft Outlook REST API
- OAuth 2.0 认证

## 5. 环境配置

### 开发环境变量
```bash
PROXY_PORT=3001
NODE_ENV=development
```

### 生产环境变量
```bash
PROXY_PORT=3001
NODE_ENV=production
PORT=3000
```

## 6. 数据存储

### 客户端数据
- **位置**: 浏览���LocalStorage
- **内容**: 账户信息、验证码、序列号
- **格式**: JSON序列化
- **安全性**: 客户端完全控制，服务端不存储敏感数据

### 服务端数据
- **类型**: 内存临时存储
- **内容**: 监控任务状态、SSE连接
- **生命周期**: 服务重启时清空

## 7. API端点

### 核心端点（平衡版本 - 完整功能）
- `GET /` - 主页
- `GET /api/health` - 健康检查
- `GET /api/info` - 服务信息
- `POST /api/emails` - 处理邮箱列表
- `POST /api/accounts/batch-import` - 批量导入账户（前端兼容）
- `POST /api/accounts` - 单账户创建
- `GET /api/sequence/:email` - 查询邮箱序列
- `GET /api/stats` - 基本统计
- `POST /api/microsoft/token` - Microsoft Token刷新
- `GET /api/outlook/*` - Outlook API代理
- `POST /api/monitor/copy-trigger` - 监控触发（完整功能）
- `GET /api/events/stream/:sessionId` - SSE事件流（前端兼容）

### WebSocket事件类型（平衡版本）
- `ping/pong` - 连接测试和心跳
- `connection_established` - 连接建立确认
- `verification_code_found` - 验证码发现通知
- `account_status_changed` - 账户状态变更
- `monitoring_started` - 监控开始通知
- `emails_processed` - 邮箱处理完成通知

### SSE事件类型（备用保障）
- `monitoring_started` - 监控开始
- `verification_code_found` - 验证码发现
- `account_status_changed` - 状态变更

### 与原版本对比
- **端点数量**: 保持所有核心端点，无功能缺失
- **复杂度**: 优化架构实现，简化代码逻辑
- **功能**: 保持完整业务功能，双重通信保障

## 8. 监控和日志

### 服务器监控
- **端口检查**: `curl http://localhost:3001/api/health`
- **日志输出**: 控制台实时日志
- **错误追踪**: 详细错误信息和堆栈

### 前端调试
- **SSE连接**: 浏览器开发者工具Network标签
- **控制台日志**: 详细的操作和错误日志
- **本地存储**: 开发者工具Application标签查看LocalStorage

**安全配置:**
- CORS: 允许所有来源
- 速率限制: 15分钟200请求
- 请求体: 最大50MB

**部署架构:**

**单容器部署:**
- nginx反向代理 + Node.js + WebSocket
- supervisord进程管理
- 端口80对外，内部3001(Node.js) + 3002(WebSocket)
- SSE作为备用方案

**服务组件:**
- nginx (80): 反向代理，WebSocket代理
- Node.js (3001): 邮件API，SSE服务
- WebSocket (3002): 实时双向通信
- supervisord: 进程管理
- 健康检查: `/health`, `/ws-health`

## 🚀 版本更新日志

**v3.2.2 - URL转义修复版本 (2025-11-01) ⭐ 当前版本**
- 🛠️ **URL转义修复**: 解决Node.js https模块OData查询参数转义问题
- ✅ **API调用优化**: 正确处理Microsoft Outlook API特殊字符
- 📚 **文档更新**: 添加标准OAuth 2.0授权流程和API测试方法
- 🎯 **验证通过**: 真实邮箱数据测试成功，验证码提取正常

**v3.2.1 - AADSTS70000修复版本 (2025-11-01)**
- 🔧 Token刷新机制修复：解决AADSTS70000错误
- ✅ 用户体验优化：用户主动监控无冷却限制
- 🛠️ 错误处理增强：详细错误代码解析
- 🎯 兼容性提升：兼容所有refresh_token格式

**v3.2.0 - 最终平衡版本 (2025-11-01)**
- 🎯 代码优化：3326行→765行（减少77%，保持功能）
- 🔧 架构优化：SSE + WebSocket双重通信
- 📦 功能完整：恢复所有核心业务功能
- ✅ 前端兼容：保持所有API端点
- ✅ 智能验证码提取算法

**技术改进:**
- 双重通信保障：WebSocket + SSE
- 完整错误处理和日志记录
- 会话隔离和事件路由优化

**历史版本:**
- **v3.0.0**: KISS极简版本（过度简化）
- **v2.1.0**: WebSocket实时通信升级
- **v2.0.0**: 单容器架构
- **v1.5.0**: 智能监控系统
- **v1.0.0**: 基础版本

## 📞 技术支持

- **GitHub Issues**: https://github.com/xxrenzhe/mailmanager/issues
- **文档**: 参考 `docs/MustKnowV1.md`
- **贡献**: 欢迎 Pull Request

---

*最后更新: 2025-11-01 | v3.2.2 (URL转义修复版本)*
