# 基本原则
1. 使用中文进行沟通和文档输出
2. 遵循KISS原则，在确保实现业务需求的情况下，简化代码实现，提高可维护性

# 🚀 快速开始

## 单容器部署（推荐）

### 🐳 Docker 部署
```bash
# 拉取最新镜像
docker pull ghcr.io/xxrenzhe/mailmanager:prod-latest

# 运行容器（支持WebSocket）
docker run -d \
  --name mailmanager \
  -p 80:80 \
  -p 3002:3002 \
  -e NODE_ENV=production \
  -e PROXY_PORT=3001 \
  -e WS_PORT=3002 \
  --restart unless-stopped \
  ghcr.io/xxrenzhe/mailmanager:prod-latest

# 访问应用
open http://localhost

# 健康检查
curl http://localhost/health
curl http://localhost/ws-health
```

**可选镜像标签:**
- `ghcr.io/xxrenzhe/mailmanager:prod-latest` - 主分支最新版本 (推荐)
- `ghcr.io/xxrenzhe/mailmanager:dev-latest` - 开发版本
- `ghcr.io/xxrenzhe/mailmanager:prod-v2.0.0` - WebSocket升级版本

### 🔧 环境变量配置
```bash
docker run -d \
  --name mailmanager \
  -p 80:80 \
  -p 3002:3002 \
  -e NODE_ENV=production \
  -e PROXY_PORT=3001 \
  -e WS_PORT=3002 \
  --restart unless-stopped \
  ghcr.io/xxrenzhe/mailmanager:prod-latest
```

### 📊 服务状态检查
```bash
# 检查容器状态
docker ps

# 查看服务日志
docker logs mailmanager

# 健康检查
curl http://localhost/health

# WebSocket健康检查
curl http://localhost/ws-health

# 检查端口占用
netstat -tulpn | grep -E ':(80|3002)'
```

### 🔧 带数据持久化部署
```bash
# 创建数据目录
mkdir -p ./mailmanager-data ./mailmanager-logs

# 运行容器（带数据卷挂载）
docker run -d \
  --name mailmanager \
  -p 80:80 \
  -p 3002:3002 \
  -v $(pwd)/mailmanager-data:/app/data \
  -v $(pwd)/mailmanager-logs:/app/logs \
  -e NODE_ENV=production \
  -e PROXY_PORT=3001 \
  -e WS_PORT=3002 \
  --restart unless-stopped \
  ghcr.io/xxrenzhe/mailmanager:prod-latest
```

### 📊 服务状态检查
```bash
# 检查容器状态
docker ps

# 查看服务日志
docker logs mailmanager

# 健康检查
curl http://localhost/health
```

## 本地开发环境

### 📋 前置要求
- Node.js 18+
- npm 或 yarn

### 🛠️ 安装和运行
```bash
# 1. 克隆仓库
git clone https://github.com/xxrenzhe/mailmanager.git
cd mailmanager

# 2. 安装依赖
npm install

# 3. 启动服务
node proxy-server.js

# 4. 访问应用
open http://localhost:3001
```

# 系统架构、功能描述和技术方案

## 系统概述

MailManager 是一个现代化的邮件账户管理系统，主要功能是批量管理 Microsoft Outlook 邮箱账户，自动提取验证码，并提供实时监控功能。系统采用单容器部署架构，集成了 nginx 反向代理和 Node.js 应用，提供高性能、高可用的邮件管理服务。

### 🎯 核心价值
- **批量管理**: 高效管理大量Outlook邮箱账户
- **智能监控**: 实时监控邮件并自动提取验证码
- **多用户支持**: 完全隔离架构，支持200+并发用户
- **异步导入**: 5秒内完成邮箱验证，智能重试和并发处理
- **单容器部署**: 简化部署运维，降低基础设施复杂度
- **实时更新**: WebSocket + SSE双重保障，毫秒级数据同步
- **安全可靠**: 自动重新授权机制，服务持续可用

## 核心功能

### 1. 邮箱账户管理
- **批量导入**: 支持文本格式批量导入邮箱账户信息（email, client_id, refresh_token）
- **状态管理**: 实时跟踪账户授权状态（pending/authorized/reauth_needed）
- **序列号管理**: 为每个账户分配唯一的序列号，支持排序和管理
- **本地存储**: 所有账户数据安全存储在浏览器 LocalStorage 中

### 2. Microsoft Outlook 集成
- **REST API**: 使用 Microsoft Outlook REST API 进行邮件操作
- **Token 管理**: 直接调用 Microsoft OAuth token endpoint刷新 access_token
- **邮件检索**: 获取最近5封邮件，支持智能验证码提取
- **CORS 代理**: 内置代理服务器解决跨域访问问题

### 3. 智能验证码提取
- **多层级识别**: 高/中/低可信度验证码模式匹配
- **上下文分析**: 基于邮件标题、发件人、内容的智能分析
- **实时提取**: 自动从新邮件提取验证码并实时显示
- **历史记录**: 保存最近10个验证码，包含来源和评分信息

### 4. 实时监控系统
- **WebSocket通信**: 双向实时连接，毫秒级响应
- **1分钟监控**: 复制邮箱后自动启动60秒监控
- **自动停止**: 监控任务15秒检查一次，60秒后自动停止
- **状态同步**: 实时同步"监控中"指标和账户状态

### 5. 异步导入系统
- **即时保存**: 导入时立即保存为pending状态，不阻塞用户操作
- **并发验证**: 最多12个账户同时验证，2秒内完成批量处理
- **智能重试**: 过期token自动标记需重新授权，不中断导入流程
- **实时反馈**: WebSocket推送详细导入进度和验证结果

### 6. 多用户架构 (KISS优化)
- **会话隔离**: 每浏览器独立会话，数据完全本地存储
- **连接限制**: 每会话最多5个WebSocket连接，防止资源滥用
- **事件路由**: 精确事件路由到对应会话，无跨用户干扰
- **高并发支持**: 200+用户并发访问，性能线性扩展

### 7. 用户界面
- **响应式设计**: 基于 Tailwind CSS 的现代化界面
- **实时统计**: 显示总数、已授权、待处理、监控中的账户数量
- **搜索过滤**: 支持按邮箱地址、状态进行快速筛选
- **批量操作**: 清空数据、刷新状态等批量管理功能

## 系统架构

### 整体架构设计
```
┌─────────────────┐    HTTP/SSE     ┌──────────────────┐    API     ┌─────────────────┐
│                 │    ─────────→    │                  │   ─────→   │                 │
│  Browser Client │                 │  Proxy Server    │             │  Microsoft      │
│  (Frontend)     │    ←────────     │   (Node.js)      │   ←──────   │  Outlook API    │
│                 │      WebSocket   │                  │             │                 │
└─────────────────┘                 └──────────────���───┘             └─────────────────┘
         │                                   │
         │                                   │
    LocalStorage                         Event Emitter
    (账户缓存)                            (实时事件)
```

**多用户架构特点:**
- **会话隔离**: 每个浏览器独立会话，完全隔离
- **事件路由**: Session Router精确路由事件到对应会话
- **无限并发**: 支持无限用户同时使用

### 前端架构 (Browser Client)

**核心技术栈:**
- HTML5 + CSS3 + Vanilla JavaScript
- Tailwind CSS (UI框架)
- Font Awesome (图标库)
- SSE (Server-Sent Events)

**核心模块:**
1. **MailManager 类**: 主应用控制器
   - 账户数据管理 (CRUD)
   - UI 渲染和事件处理
   - SSE 连接管理
   - 统计信息更新

2. **EmailSequenceManager 类**: 序列号管理器
   - 邮箱到序列号的映射管理
   - 本地缓存机制
   - 自动序列号分配

3. **数据持久化**:
   - LocalStorage 存储账户数据
   - 自动序列化/反序列化
   - 数据版本兼容性

### 后端架构 (Proxy Server)

**核心技术栈:**
- Node.js + Express.js
- CORS 代理中间件
- Event Emitter (SSE)
- Node-fetch (HTTP客户端)

**核心组件:**
1. **CORS 代理服务器**: 解决跨域问题
   - Microsoft Token 端点代理
   - Outlook API 代理
   - 请求转发和响应处理

2. **实时监控系统**:
   - `activeMonitors` Map 管理监控任务
   - 定时器调度 (15秒间隔)
   - 自动停止机制 (60秒超时)
   - SSE 事件广播

3. **邮件服务集成**:
   - Microsoft OAuth 2.0 流程
   - Access Token 自动刷新
   - 邮件获取和验证码提取

### 数据流架构

**账户导入流程:**
```
用户输入 → 前端解析 → 序列号分配 → LocalStorage存储 → 后端授权检查 → 邮件获取 → 验证码提取
```

**实时监控流程:**
```
复制邮箱 → API触发 → 监控任务创建 → 定时邮件检查 → 验证码发现 → SSE推送 → 前端更新
```

**数据存储策略:**
- **前端**: LocalStorage (账户信息、验证码、序列号)
- **后端**: 内存临时存储 (监控任务、SSE连接)
- **外部**: Microsoft Outlook API (邮件数据源)

## 技术方案详解

### 1. Microsoft Outlook 集成方案

**Token刷新机制:**
- 直接调用 Microsoft OAuth token endpoint
- Client ID + Refresh Token → Access Token
- Access Token 1小时有效期，refresh_token 长期有效

**API 端点:**
- Token刷新: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- 邮件: `https://outlook.office.com/api/v2.0/me/messages`
- 权限范围: `IMAP.AccessAsUser.All`, `Mail.ReadWrite`, `SMTP.Send`

**实现方式:**
```bash
curl -s https://login.microsoftonline.com/common/oauth2/v2.0/token \
  -d 'client_id=CLIENT_ID' \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=REFRESH_TOKEN'
```

### 2. 智能验证码提取算法

**分层识别策略:**
```javascript
// 高可信度模式 (权重: 3.0)
/(?:verification code|验证码)[\s:：\n\-]*(\d{4,8})/gi
/your code is|您的验证码是[\s:：\n]*(\d{4,8})/gi

// 中等可信度模式 (权重: 2.0)
/(?:verify|confirm|activate)[\s\S]{0,50}?(\d{4,8})/gi

// 低可信度模式 (权重: 1.0)
/\b(\d{4,8})\b/g
```

**评分系统:**
- 邮件标题权重: ×3.0
- 首段内容权重: ×3.0
- 关键词匹配权重: ×2.0
- 格式独立权重: ×1.5

### 3. 实时通信方案

**WebSocket + SSE 双重保障:**

**WebSocket事件类型（主要）:**
```javascript
{
  type: 'connection_established',
  clientId: 'ws_xxx',
  sessionId: 'session_xxx',
  timestamp: '2025-01-01T12:00:00Z'
}
{
  type: 'verification_code_found',
  sessionId: 'session_xxx',
  account_id: 'xxx',
  code: '123456',
  sender: 'service@site.com',
  received_at: '2025-01-01T12:00:00Z'
}
{
  type: 'account_status_changed',
  sessionId: 'session_xxx',
  account_id: 'xxx',
  status: 'authorized'
}
```

**SSE事件类型（备用）:**
```javascript
{
  type: 'monitoring_started',
  account_id: 'xxx',
  email: 'user@example.com',
  message: '开始监控...'
}
{
  type: 'verification_code_found',
  account_id: 'xxx',
  code: '123456',
  sender: 'service@site.com',
  received_at: '2025-01-01T12:00:00Z'
}
```

**连接策略:**
- **本地开发**: 直连 `ws://localhost:3002`
- **生产HTTP**: 代理 `ws://domain.com/ws`
- **生产HTTPS**: 安全连接 `wss://domain.com/ws`
- **自动降级**: WebSocket失败时使用SSE

### 4. 性能优化策略

**前端优化:**
- 分页显示 (每页50条记录)
- 虚拟滚动 (大数据量时)
- 防抖搜索 (300ms延迟)
- 数据缓存 (减少重复请求)

**后端优化:**
- 连接池管理 (复用HTTP连接)
- 事件去重 (避免重复推送)
- 内存缓存 (监控任务状态)
- 速率限制 (防止API滥用)

### 5. 安全机制

**前端安全:**
- 敏感数据加密存储 (refresh_token)
- XSS 防护 (内容转义)
- CSRF 保护 (同源检查)

**后端安全:**
- CORS 策略配置
- 请求大小限制 (50MB)
- 速率限制 (15分钟200请求)
- Token 过期验证

**数据安全:**
- 不在服务端存储敏感信息
- 客户端数据自主管理
- 最小权限原则 (仅请求必要API权限)

## 部署架构

### 开发环境
```
浏览器 → http://localhost:3001 → proxy-server.js → Microsoft API
```

### 生产环境
```
用户A浏览器 → https://www.mailmanager.dev → Docker容器 → Session Router → Microsoft API
用户B浏览器 → https://www.mailmanager.dev → Docker容器 → Session Router → Microsoft API
用户C浏览器 → https://www.mailmanager.dev → Docker容器 → Session Router → Microsoft API
(无限并发用户)
```

**Docker 容器化:**
- 多阶段构建优化镜像大小
- 健康检查机制
- 环境变量配置
- 日志聚合

**CI/CD 流程:**
- GitHub Actions 自动构建
- 多环境镜像标签管理
- 自动化测试集成
- 滚动更新部署

## 扩展性设计

### 水平扩展
- 无状态服务设计
- 负载均衡支持
- 数据库分离
- 缓存层抽象

### 功能扩展
- 插件化验证码提取器
- 多邮件服务提供商支持
- 自定义监控规则
- API 版本兼容性

### 监控和运维
- 应用性能监控 (APM)
- 错误日志聚合
- 用户行为分析
- 自动化告警

## 故障排除和最佳实践

### 常见问题和解决方案

#### 1. SSE连接错误 (ERR_CONNECTION_REFUSED)
**症状**: 浏览器控制台显示 `GET http://localhost:3001/api/events/stream net::ERR_CONNECTION_REFUSED`

**原因**: 代理服务器 `proxy-server.js` 未运行

**解决方案**:
```bash
# 启动代理服务器
node proxy-server.js

# 检查服务器状态
curl http://localhost:3001/api/health
```

#### 2. Microsoft Token刷新失败 (AADSTS70000)
**症状**: 账户状态显示为"需重新授权"，错误信息包含 `AADSTS70000: The request was denied because one or more scopes requested are unauthorized or expired`

**原因**: Refresh Token 已过期

**解决方案**:
- 重新获取有效的 Microsoft refresh_token
- 确认 Azure 应用注册的 client_id 正确
- 确认应用有正确的API权限（Mail.Read, IMAP.AccessAsUser.All等）

**自动恢复机制**: 系统会自动调用Token刷新API处理失效的refresh_token

#### 3. 邮件同步失败
**症状**: 账户状态为"已授权"但无法获取邮件

**可能原因**:
- Access Token 过期（系统会自动刷新）
- API权限不足
- 网络连接问题

**解决方案**: 检查服务器日志中的详细错误信息

#### 4. 验证码提取失败
**症状**: 有新邮件但未提取到验证码

**解决方案**:
- 检查邮件内容是否符合验证码模式
- 查看服务器日志中的提取过程
- 验证码格式应为4-8位数字

### 开发环境配置

#### 本地开发设置
```bash
# 1. 安装依赖
npm install

# 2. 启动代理服务器
node proxy-server.js

# 3. 访问应用
open http://localhost:3001
```

#### 端口配置
- **代理服务器**: 3001 (默认)
- **SSE端点**: `http://localhost:3001/api/events/stream`
- **健康检查**: `http://localhost:3001/api/health`

### 性能优化建议

#### 前端优化
- 使用分页显示大量账户（每页50条）
- 启用浏览器缓存减少重复请求
- 使用防抖搜索（300ms延迟）

#### 后端优化
- 监控任务每15秒执行一次，避免频繁API调用
- Token刷新有60秒冷却期，防止频率限制
- 使用事件驱动架构减少轮询

### 安全最佳实践

#### 数据安全
- 敏感信息（refresh_token）存储在浏览器LocalStorage
- 服务端不存储用户敏感数据
- 使用HTTPS进行生产环境部署

#### API安全
- 实施速率限制（15分钟200请求）
- 验证所有API输入
- 使用CORS策略限制跨域访问

### 调试技巧

#### 启用详细日志
```javascript
// 在浏览器控制台启用调试
localStorage.setItem('debug', 'true');

// 查看SSE连接状态
// 控制台会显示所有SSE事件
```

#### 监控API调用
```bash
# 监控服务器日志
tail -f /var/log/mailmanager.log

# 测试API端点
curl -X POST http://localhost:3001/api/microsoft/token \
  -H "Content-Type: application/json" \
  -d '{"client_id":"test","refresh_token":"test","grant_type":"refresh_token"}'
```

### 版本更新和维护

#### 代码更新流程
1. 更新前端代码 (`simple-mail-manager.html`)
2. 更新后端服务 (`proxy-server.js`)
3. 重启服务器应用更改
4. 测试所有核心功能

#### 数据备份
- 用户数据存储在浏览器LocalStorage中
- 定期导出重要的账户配置
- 使用版本控制管理代码变更


# 📖 使用指南

## 🚀 快速上手

### 第一步：访问系统
- Docker 部署：`http://localhost`
- 本地开发：`http://localhost:3001`

### 第二步：批量导入邮箱
1. 点击"导入邮箱"按钮
2. 按格式输入邮箱信息（每行一个）：
   ```
   邮箱地址,客户端ID,刷新令牌
   user@outlook.com,client_id,refresh_token
   ```
3. 点击"导入"开始批量处理

### 第三步：监控验证码
1. 复制需要监控的邮箱地址
2. 系统自动启动 60 秒监控
3. 新邮件中的验证码会实时显示

## 🔧 高级功能

### 实时监控特性
- **自动触发**: 复制邮箱地址即开始监控
- **智能时长**: 60秒自动停止，避免资源浪费
- **实时更新**: SSE 技术实现毫秒级数据同步
- **自动重授权**: 令牌过期时自动刷新

### 验证码提取算法
```javascript
// 高可信度模式 (权重: 3.0)
/(?:verification code|验证码)[\s:：\n\-]*(\d{4,8})/gi

// 中等可信度模式 (权重: 2.0)
/(?:verify|confirm|activate)[\s\S]{0,50}?(\\d{4,8})/gi

// 低可信度模式 (权重: 1.0)
/\b(\d{4,8})\b/g
```

### 邮件同步策略
- 获取最近 5 封邮件进行分析
- 基于发件人智能分类和评分
- 历史验证码记录（最近 10 个）
- 支持多种验证码格式识别

## ⚡ 性能优化

### 前端优化
- 分页显示（每页 50 条记录）
- 防抖搜索（300ms 延迟）
- 数据缓存减少重复请求
- 响应式设计适配各种设备

### 异步导入优化
- **即时保存**: 导入时立即保存，不阻塞用户操作
- **并发验证**: 最多3个账户同时验证，提升吞吐量
- **快速失败**: 无效token立即跳过，3秒内完成验证
- **批量处理**: 200ms批次间隔，避免API限制
- **实时反馈**: SSE推送详细进度，用户体验流畅

### 后端优化
- 连接池管理复用 HTTP 连接
- 事件去重避免重复推送
- 内存缓存监控任务状态
- 速率限制防止 API 滥用
- **会话隔离**: Map结构高效管理会话状态

## 🔒 安全配置

### 数据安全
- 客户端数据完全自主管理
- 服务端不存储敏感信息
- 最小权限原则
- HTTPS 生产环境部署

### 访问控制
- CORS 策略配置
- 请求大小限制（50MB）
- 速率限制（15分钟200请求）
- Token 过期验证

## 🚨 故障排除

### 常见问题

#### 1. 容器启动失败
```bash
# 检查端口占用
netstat -tulpn | grep :80

# 查看容器日志
docker logs mailmanager

# 重启容器
docker restart mailmanager
```

#### 2. 邮箱授权失败
- **现象**: 账户状态显示"需重新授权"
- **原因**: Refresh Token 已过期（90天有效期）
- **解决**: 重新获取有效的 Microsoft refresh_token

#### 3. 验证码提取失败
- **检查邮件内容是否符合验证码模式**
- **确认邮件格式为 4-8 位数字**
- **查看服务器日志中的提取过程**

#### 4. 多用户事件串扰
- **现象**: 看到其他用户的监控事件或验证码
- **原因**: 会话ID生成冲突或事件路由错误
- **解决**: 清除浏览器缓存，重新打开页面
- **检查**: 确认每个浏览器都有唯一的sessionId

#### 5. 导入进度卡住
- **现象**: 导入进度显示停滞在某个百分比
- **原因**: 后端验证任务阻塞或网络问题
- **解决**: 检查后端日志，重启Docker容器

#### 6. 监控功能异常
```bash
# 检查 SSE 连接
curl -N http://localhost/api/events/stream

# 验证 API 端点
curl http://localhost/api/health
```

## 📋 监控和维护

### 健康检查
```bash
# 服务健康状态
curl http://localhost/health

# 详细的系统状态
curl http://localhost/api/health
```

### 日志管理
```bash
# 容器日志
docker logs -f mailmanager

# 应用日志（容器内）
docker exec mailmanager tail -f /app/logs/mailmanager.log
```

### 数据备份
- 用户数据存储在浏览器 LocalStorage
- 定期导出重要的账户配置
- 使用版本控制管理代码变更

## 🔧 开发指南

### 本地开发设置
```bash
# 克隆项目
git clone https://github.com/xxrenzhe/mailmanager.git
cd mailmanager

# 安装依赖
npm install

# 启动开发服务器
node proxy-server.js

# 访问应用
open http://localhost:3001
```

### 调试技巧
```javascript
// 启用详细日志
localStorage.setItem('debug', 'true');

// 查看 SSE 连接状态
// 浏览器开发者工具 Network 标签
```

### API 测试
```bash
# 测试 Token 端点
curl -X POST http://localhost:3001/api/microsoft/token \
  -H "Content-Type: application/json" \
  -d '{"client_id":"test","refresh_token":"test","grant_type":"refresh_token"}'
```

# 系统信息

## 1. 域名和服务
- **生产环境**: https://www.mailmanager.dev
- **Docker 环境**: http://localhost (端口 80)
- **开发环境**: http://localhost:3001
- **API代理**: http://localhost/api

## 2. 代码分支策略
- **main分支**: 生产环境代码，自动触发Docker镜像构建
- **develop分支**: 开发环境代码，用于测试和集成
- **feature/***分支**: 功能开发分支

## 3. 部署流程（GitHub Actions）

### 3.1 Docker镜像构建
部署流程分为两个步骤：

**第一步：GitHub Actions自动构建Docker镜像**
- 监控代码推送到main分支
- 自动构建production环境Docker镜像
- 镜像推送到Container Registry

**第二步：手动部署到生产环境**
- 在ClawCloud管理界面配置镜像拉取
- 部署新版本到生产环境
- 验证部署结果

### 3.2 镜像标签策略
- **main分支**: `ghcr.io/xxrenzhe/mailmanager:prod-latest`
- **版本标签**: `ghcr.io/xxrenzhe/mailmanager:prod-[tag]` (如v1.0.0)
- **开发分支**: `ghcr.io/xxrenzhe/mailmanager:dev-latest`

## 4. 技术栈和依赖

### 前端技术
- **核心**: HTML5 + CSS3 + Vanilla JavaScript
- **UI框架**: Tailwind CSS
- **图标**: Font Awesome 6.4.0
- **实时通信**: WebSocket (主要) + Server-Sent Events (备用)
- **重连机制**: 指数退避算法，自动降级

### 后端技术
- **运行时**: Node.js
- **框架**: Express.js
- **代理**: CORS代理中间件
- **实时通信**: WebSocket服务器 + EventEmitter
- **进程管理**: Supervisord (Docker容器内)

### 外部服务
- **邮件服务**: Microsoft Outlook REST API
- **认证**: Microsoft OAuth 2.0
- **API权限**:
  - `https://outlook.office.com/Mail.Read`
  - `https://outlook.office.com/IMAP.AccessAsUser.All`
  - `https://outlook.office.com/POP.AccessAsUser.All`
  - `https://outlook.office.com/SMTP.Send`

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

### 核心端点
- `GET /` - 主页
- `POST /api/microsoft/token` - Microsoft Token刷新
- `GET /api/outlook/*` - Outlook API代理
- `POST /api/monitor/copy-trigger` - 触发邮件监控
- `GET /api/events/stream` - SSE实时事件流
- `GET /api/health` - 健康检查
- `POST /api/accounts/get` - 账户信息查询

### SSE事件类型
- `connection` - 连接确认
- `heartbeat` - 心跳保活
- `monitoring_started` - 监控开始
- `monitoring_progress` - 监控进度
- `monitoring_ended` - 监控结束
- `monitoring_error` - 监控错误
- `verification_code_found` - 发现验证码
- `account_status_changed` - 账户状态变更

## 8. 监控和日志

### 服务器监控
- **端口检查**: `curl http://localhost:3001/api/health`
- **日志输出**: 控制台实时日志
- **错误追踪**: 详细错误信息和堆栈

### 前端调试
- **SSE连接**: 浏览器开发者工具Network标签
- **控制台日志**: 详细的操作和错误日志
- **本地存储**: 开发者工具Application标签查看LocalStorage

## 9. 安全配置

### CORS配置
```javascript
{
  origin: true, // 允许所有来源（开发环境）
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}
```

### 速率限制
- **普通API**: 15分钟200请求
- **批量导入**: 15分钟1000请求
- **请求体大小**: 最大50MB

## 10. 部署架构

### 容器化部署（单容器架构）

**架构特点：**
- nginx 反向代理 + Node.js + WebSocket 服务器集成在单个容器
- 使用 supervisord 同时管理 nginx、Node.js 和 WebSocket 服务
- 端口 80 对外提供 HTTP 服务，内部 3001 端口运行 Node.js，3002 端口运行 WebSocket
- WebSocket 协议优化配置，支持双向实时通信
- SSE 作为备用方案，确保服务连续性

**Dockerfile 结构：**
```dockerfile
# 多阶段构建：Node.js 应用构建
FROM node:18-alpine AS node-builder

# Nginx 反向代理阶段
FROM nginx:alpine AS nginx
# 集成 supervisord 管理多进程
# 内置 nginx 配置（端口 80 → 3001, WebSocket代理 80 → 3002）
# WebSocket 和 SSE 流特殊配置优化
EXPOSE 80
CMD ["supervisord"]
```

**服务组件：**
- **nginx** (端口 80): 反向代理，静态文件服务，WebSocket 代理，SSL 终结
- **Node.js** (内部端口 3001): 邮件管理 API，SSE 服务
- **WebSocket** (内部端口 3002): 实时双向通信服务
- **supervisord**: 进程管理器，自动重启和日志管理
- **健康检查**: 内置 `/health` 和 `/ws-health` 端点监控服务状态

### 单容器部署配置

**Nginx 内置配置（自动生成）：**
```nginx
server {
    listen 80;

    # 主要应用代理
    location / {
        proxy_pass http://127.0.0.1:3001;
        client_max_body_size 50M;
    }

    # WebSocket 代理配置
    location /ws {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache off;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # SSE 流处理（WebSocket备用方案）
    location /api/events/stream {
        proxy_pass http://127.0.0.1:3001;
        proxy_cache off;
        proxy_buffering off;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }

    # 健康检查
    location /health {
        return 200 "healthy\n";
    }

    # WebSocket健康检查
    location /ws-health {
        return 200 "websocket-healthy\n";
    }
}
```

**进程管理（supervisord）：**
```ini
[supervisord]
nodaemon=true

[program:nginx]
command=nginx -g "daemon off;"
autorestart=true

[program:mailmanager]
command=node /app/proxy-server.js
user=mailmanager
autorestart=true

[program:health-check]
command=curl -f http://localhost/health
autorestart=true
```

## 🚀 版本更新日志

### v2.1.0 - WebSocket实时通信升级版本 (2025-10-31)
**重大更新:**
- 🔄 **WebSocket实时通信**: 替代SSE，提供更稳定的连接
- 🔌 **双重保障机制**: WebSocket主要 + SSE备用
- 🤖 **智能重连**: 指数退避算法，自动恢复连接
- 📡 **多端口支持**: HTTP(80) + WebSocket(3002) 双端口架构
- 🛠️ **连接策略**: 本地/生产环境自适应连接方式

**技术改进:**
- WebSocket服务器独立进程管理
- 前端智能连接降级机制
- Nginx WebSocket代理优化配置
- 实时通信性能大幅提升
- 连接状态可视化管理

### v2.0.0 - 单容器架构版本 (2025-10-31)
**重大更新:**
- 🐳 **单容器部署**: 集成 nginx + Node.js + supervisord
- 🚀 **GitHub Actions**: 自动化 Docker 构建和安全扫描
- 📚 **完整文档**: 从快速开始到故障排除的全覆盖指南
- 🔧 **架构优化**: 生产级部署配置和健康检查

**技术改进:**
- 多阶段构建优化镜像大小
- 内置反向代理和负载均衡
- 进程管理和自动重启机制
- SSE 长连接优化配置

### v1.5.0 - 智能监控版本
**核心功能:**
- 📊 **实时监控系统**: 60秒智能监控机制
- 🔄 **SSE 实时更新**: 毫秒级数据同步
- 🎯 **验证码提取算法**: 多层级智能识别
- 🔧 **Token自动刷新**: 直接调用Microsoft API刷新失效token

### v1.0.0 - 基础版本
**初始功能:**
- 邮箱账户批量管理
- Microsoft Outlook API 集成
- 基础验证码提取
- 本地存储数据持久化

## 📞 技术支持

如有问题或建议，请通过以下方式联系：
- **GitHub Issues**: https://github.com/xxrenzhe/mailmanager/issues
- **文档更新**: 参考 `docs/MustKnowV1.md`
- **社区讨论**: 欢迎 Pull Request 和代码贡献

---

*最后更新: 2025-10-31*
*版本: v2.1.0*
