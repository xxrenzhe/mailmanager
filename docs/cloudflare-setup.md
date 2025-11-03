# Cloudflare CDN 配置指南

## 域名配置

### 1. DNS设置
```
类型    名称      内容              代理状态
A       @         YOUR_SERVER_IP    已代理橙色云朵
A       www       YOUR_SERVER_IP    已代理橙色云朵
```

### 2. SSL/TLS配置
```
SSL/TLS → Overview → Full (推荐)
Full: 端到端加密 (用户 ↔ Cloudflare ↔ 服务器)
Flexible: 仅用户到Cloudflare加密
```

## Page Rules配置

### 静态资源缓存规则
```
1. mailmanager.dev/css/*
   Cache Level: Everything
   Edge Cache TTL: 1年
   Browser Cache TTL: 4小时
   Cache Key Everything: OFF

2. mailmanager.dev/js/*
   Cache Level: Everything
   Edge Cache TTL: 1年
   Browser Cache TTL: 4小时
   Cache Key Everything: OFF
```

### API和实时通信规则
```
3. mailmanager.dev/api/*
   Cache Level: Bypass
   Edge Cache TTL: 尊重源站
   Browser Cache TTL: 尊重源站

4. mailmanager.dev/ws*
   Cache Level: Bypass
   Edge Cache TTL: 尊重源站
   Browser Cache TTL: 尊重源站

5. mailmanager.dev/api/events/stream*
   Cache Level: Bypass
   Edge Cache TTL: 尊重源站
   Browser Cache TTL: 尊重源站
```

### 主页面规则
```
6. mailmanager.dev/*
   Cache Level: Everything
   Edge Cache TTL: 4小时
   Browser Cache TTL: 30分钟
```

## Network设置

### WebSocket配置
```
Network → WebSockets: ON (免费版支持)
```

### 安全设置
```
Security → Level: Medium (平衡安全性和性能)
Security → Browser Integrity Check: OFF (避免误伤WebSocket)
```

## 缓存清理配置

### 自动清理
```
当以下文件更新时自动清理CDN缓存:
- js/core/SimpleMailManager.js
- js/global-functions.js
- css/complete-styles.css
- index.html
```

### 手动清理
```
进入 Caching → Configuration → Purge Cache
- Custom Purge: 清除特定URL
- Custom Purge: mailmanager.dev/css/*
- Custom Purge: mailmanager.dev/js/*
```

## 性能监控

### 分析工具
```
进入 Analytics → Overview
- 监控流量变化
- 检查缓存命中率
- 观察WebSocket连接统计
```

### Real User Monitoring (RUM)
```
进入 Speed → Optimization
- 监控页面加载时间
- 检查资源优化建议
```

## 安全增强

### WAF规则
```
Security → WAF → Custom Rules
创建规则保护API端点:
- 限制API请求频率
- 防止恶意请求
- 保护WebSocket连接
```

### DDoS防护
```
Security → Protection
- HTTP DDoS Attack Protection: ON
- Advanced Protection: 根据需要调整
```

## 域名验证

### 测试CDN���能
```bash
# 测试静态资源缓存
curl -I https://mailmanager.dev/css/complete-styles.css

# 测试API代理
curl -I https://mailmanager.dev/api/health

# 测试WebSocket连接
wscat -c wss://mailmanager.dev/ws
```

### 检查HTTP头
```bash
# 检查Cloudflare头
curl -I https://mailmanager.dev/api/health
# 应该看到:
# CF-RAY: xxx
# CF-IPCountry: XX
# Server: cloudflare
```

## 故障排除

### 常见问题

1. **WebSocket连接失败**
   - 检查WebSockets是否开启
   - 确认SSL/TLS配置正确
   - 验证Page Rules没有错误拦截

2. **API请求被CORS拦截**
   - 检查服务器CORS配置
   - 确认域名在允许列表中
   - 验证SSL证书配置

3. **静态资源缓存不更新**
   - 手动清理CDN缓存
   - 检查文件版本号
   - 确认缓存规则正确

4. **性能未提升**
   - 检查DNS解析是否正确
   - 确认橙色云朵已启用
   - 验证缓存规则生效

## 监控指标

### 关键指标
- 缓存命中率: 目标 > 80%
- 页面加载时间: 目标 < 2秒
- WebSocket连接成功率: 目标 > 95%
- API响应时间: 目标 < 500ms

### 告警设置
```
设置监控告警:
- 缓存命中率下降 > 20%
- API错误率 > 5%
- WebSocket连接失败率 > 10%
```