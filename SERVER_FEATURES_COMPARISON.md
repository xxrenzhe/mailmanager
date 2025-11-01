# server/index.js 完整管理功能详解

## 🎯 核心架构组件

### 1. 数据库管理系统 (SQLite)

#### 数据表结构
```sql
-- 账户表
accounts (id, email, client_id, refresh_token_enc, access_token,
         import_seq, status, last_active_at, created_at, updated_at)

-- 验证码表
codes (id, account_id, code, subject, sender, received_at,
       created_at, is_valid, expires_at)

-- 邮件表
messages (id, account_id, message_id, received_at, subject,
          sender, has_code, created_at)

-- 邮件处理历史表
email_processing_history (id, account_id, message_id, processed_at,
                          processing_time_ms, codes_found, status, error_message)
```

#### 数据功能
- ✅ **数据持久化**: SQLite数据库，所有数据永久保存
- ✅ **事务处理**: 确保数据一致性
- ✅ **外键约束**: 维护数据完整性
- ✅ **索引优化**: 提高查询性能
- ✅ **数据迁移**: 自动处理数据库结构升级
- ✅ **缓存系统**: 内存缓存提高查询速度

### 2. 批量导入队列系统

#### 功能特性
```javascript
class BulkImportQueue {
    config: {
        batchSize: 50,           // 每批处理50个账户
        batchDelay: 1000,        // 批次间隔1秒
        authDelay: 100,          // 授权验证间隔100ms
        maxRetries: 3,           // 最大重试次数
        rateLimitDelay: 30000    // API限制等待时间
    }
}
```

#### 管理功能
- ✅ **会话管理**: 每个导入任务独立会话
- ✅ **进度跟踪**: 实时导入进度和状态
- ✅ **错误处理**: 详细的错误记录和重试机制
- ✅ **API限制处理**: 智能避开API调用限制
- ✅ **批量处理**: 高效的大规模邮箱导入
- ✅ **统计分析**: 导入成功率和处理时间统计

### 3. 邮箱序列编号管理

#### 功能特性
```javascript
class EmailSequenceManager {
    // 确保相同邮箱获得相同编号
    sequenceCache: Map<email, sequence_number>
    maxSequenceCache: number
}
```

#### 管理功能
- ✅ **序列号分配**: 自动分配唯一的导入序列号
- ✅ **重复邮箱处理**: 相同邮箱保持相同序列号
- ✅ **缓存优化**: 预加载现有邮箱编号映射
- ✅ **统计报告**: 邮箱编号使用统计
- ✅ **数据导出**: 序列编号数据导出功能

### 4. 自动重新授权服务

#### 功能特性
```javascript
class AutoReauthService {
    // 每30分钟检查一次过期token
    checkInterval: 30 * 60 * 1000
}
```

#### 管理功能
- ✅ **Token监控**: 自动检测即将过期的访问令牌
- ✅ **自动刷新**: 自动刷新过期的访问令牌
- ✅ **授权状态跟踪**: 跟踪账户授权状态变化
- ✅ **错误处理**: 授权失败时的错误处理和通知
- ✅ **批量处理**: 批量处理多个账户的授权更新

### 5. 缓存管理系统

#### 功能特性
```javascript
class CacheManager {
    // 多层缓存架构
    memoryCache: Map()      // 内存缓存
    diskCache: Map()        // 磁盘缓存
    lruQueue: Array()       // LRU淘汰队列
}
```

#### 管理功能
- ✅ **多层缓存**: 内存 + 磁盘双层缓存
- ✅ **LRU淘汰**: 最近最少使用算法
- ✅ **缓存预热**: 预加载热点数据
- ✅ **自动清理**: 过期数据自动清理
- ✅ **压缩存储**: 缓存数据压缩节省空间
- ✅ **统计报告**: 缓存命中率统计

### 6. 邮件服务集成

#### 功能特性
```javascript
class EmailService {
    // 邮件处理核心功能
    fetchNewEmails: Function
    extractVerificationCodes: Function
    checkAccountEmails: Function
    updateAccountWithCodes: Function
}
```

#### 管理功能
- ✅ **邮件获取**: 从Outlook API获取邮件
- ✅ **验证码提取**: 智能提取邮件中的验证码
- ✅ **去重处理**: 避免重复处理相同邮件
- ✅ **批量处理**: 高效的批量邮件处理
- ✅ **错误重试**: 网络错误自动重试机制

## 🌐 REST API端点

### 账户管理API

| 方法 | 端点 | 功能 | 特点 |
|------|------|------|------|
| GET | `/api/accounts/paged` | 分页获取账户列表 | 支持排序、过滤、搜索 |
| POST | `/api/accounts` | 创建新账户 | 自动验证授权 |
| PUT | `/api/accounts/:id` | 更新账户信息 | 支持状态更新 |
| DELETE | `/api/accounts/:id` | 删除账户 | 级联删除相关数据 |
| GET | `/api/accounts/export` | 导出账户数据 | CSV格式导出 |

### 批量导入API

| 方法 | 端点 | 功能 | 特点 |
|------|------|------|------|
| POST | `/api/bulk-import/parse` | 解析导入数据 | 支持CSV格式 |
| POST | `/api/bulk-import/start` | 开始批量导入 | 异步处理 |
| GET | `/api/bulk-import/status/:importId` | 获取导入状态 | 实时进度 |
| POST | `/api/bulk-import/cleanup` | 清理导入数据 | 内存管理 |
| POST | `/api/accounts/batch-import` | 批量导入账户 | 高效处理 |

### 监控管理API

| 方法 | 端点 | 功能 | 特点 |
|------|------|------|------|
| POST | `/api/monitor/start` | 开始监控 | 指定监控参数 |
| POST | `/api/monitor/stop` | 停止监控 | 清理监控资源 |
| GET | `/api/monitor/status` | 获取监控状态 | 实时状态查询 |
| POST | `/api/monitor/copy-trigger` | 复制触发监控 | 自动启动1分钟监控 |
| GET | `/api/events` | 获取事件流 | Server-Sent Events |

### 邮箱序列API

| 方法 | 端点 | 功能 | 特点 |
|------|------|------|------|
| GET | `/api/sequence/stats` | 获取序列统计 | 编号使用情况 |
| POST | `/api/sequence/rebuild` | 重建序列 | 修复序列编号 |
| GET | `/api/sequence/email/:email` | 查询邮箱序列 | 获取特定邮箱编号 |
| GET | `/api/sequence/export` | 导出序列数据 | CSV格式导出 |

### 系统管理API

| 方法 | 端点 | 功能 | 特点 |
|------|------|------|------|
| GET | `/api/status` | 系统状态 | 健康检查 |
| POST | `/api/cache/clear` | 清理缓存 | 性能优化 |
| DELETE | `/api/clear-all-data` | 清空所有数据 | 重置系统 |
| POST | `/api/codes` | 手动添加验证码 | 测试用途 |

## 🎨 前端界面功能

### 视图系统 (EJS模板)
- ✅ **主界面**: `accounts.ejs` - 完整的账户管理界面
- ✅ **响应式设计**: 8列表格布局，支持分页
- ✅ **实时更新**: Server-Sent Events实时数据更新
- ✅ **交互功能**: 复制邮箱、验证码、状态切换

### 数据展示功能
- ✅ **账户列表**: 分页显示，支持排序过滤
- ✅ **状态管理**: 实时显示授权状态
- ✅ **验证码显示**: 最新验证码高亮显示
- ✅ **时间追踪**: 账户最后活跃时间
- ✅ **统计信息**: 总账户数、状态分布统计

## 🔧 系统管理功能

### 1. 自动化任务
- ✅ **Token检查**: 每30分钟自动检查过期token
- ✅ **自动刷新**: 自动刷新即将过期的访问令牌
- ✅ **状态同步**: 实时同步账户状态
- ✅ **数据清理**: 定期清理过期数据

### 2. 性能优化
- ✅ **数据库索引**: 优化查询性能
- ✅ **缓存系统**: 多层缓存提升响应速度
- ✅ **批量处理**: 高效的批量数据处理
- ✅ **连接池**: 数据库连接复用

### 3. 安全管理
- ✅ **数据加密**: 敏感数据加密存储
- ✅ **访问控制**: 请求频率限制
- ✅ **错误处理**: 详细的错误日志记录
- ✅ **数据备份**: 自动数据备份机制

### 4. 监控与调试
- ✅ **健康检查**: 系统状态监控
- ✅ **日志记录**: 详细的操作日志
- ✅ **性能统计**: 处理时间和成功率统计
- ✅ **错误追踪**: 完整的错误追踪机制

## 📊 数据分析功能

### 1. 账户统计
- ✅ **总账户数**: 实时统计账户总数
- ✅ **状态分布**: 各状态账户数量统计
- ✅ **活跃度分析**: 账户活跃时间分析
- ✅ **导入统计**: 导入成功率和处理时间

### 2. 验证码分析
- ✅ **验证码统计**: 验证码提取数量统计
- ✅ **来源分析**: 验证码来源邮箱分析
- ✅ **时间分析**: 验证码接收时间分析
- ✅ **成功率统计**: 验证码提取成功率

### 3. 性能分析
- ✅ **处理速度**: 邮件处理速度统计
- ✅ **响应时间**: API响应时间分析
- ✅ **缓存命中率**: 缓存效率统计
- ✅ **错误率**: 系统错误率分析

## 🚀 部署与管理

### 1. 环境配置
- ✅ **环境变量**: 灵活的配置管理
- ✅ **生产环境**: 生产环境优化配置
- ✅ **开发环境**: 开发环境调试配置
- ✅ **日志配置**: 可配置的日志级别

### 2. 数据管理
- ✅ **数据库迁移**: 自动化数据库结构升级
- ✅ **数据备份**: 自动化数据备份
- ✅ **数据恢复**: 快速数据恢复机制
- ✅ **数据导出**: 多格式数据导出

### 3. 运维管理
- ✅ **进程管理**: 进程监控和自动重启
- ✅ **资源监控**: CPU、内存使用监控
- ✅ **性能调优**: 自动化性能优化
- ✅ **故障恢复**: 自动故障检测和恢复

---

## 📋 总结

**server/index.js** 提供的是一个**完整的企业级邮件管理系统**，包含：

1. **数据持久化** - SQLite数据库完整存储
2. **批量处理** - 高效的大规模邮箱导入
3. **自动化管理** - 自动授权、监控、维护
4. **性能优化** - 多层缓存、批量处理、索引优化
5. **企业功能** - 序列管理、统计分析、权限控制
6. **运维支持** - 监控、日志、备份、恢复

相比proxy-server.js的轻量级代理功能，server/index.js是一个**功能完整、可扩展、生产就绪**的企业级应用！