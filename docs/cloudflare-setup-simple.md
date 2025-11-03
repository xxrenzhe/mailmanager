# Cloudflare CDN 简化配置指南

## 🚀 5分钟快速部署

### 1. DNS设置 (2分钟)
```
类型    名称                内容              代理状态
A       mailmanager.dev     YOUR_SERVER_IP    橙色云朵 🟠
A       www                 YOUR_SERVER_IP    橙色云朵 🟠
```

**域名重定向**: 服务器端自动将 mailmanager.dev → www.mailmanager.dev

### 2. SSL/TLS设置 (1分钟)
```
SSL/TLS → Overview → Flexible (推荐)
```

### 3. WebSocket确认 (默认开启)
```
Network → WebSockets: ON ✅ (免费版支持)
```

### 4. 安全设置 (1分钟)
```
Security → Level: Medium
Security → Browser Integrity Check: OFF (避免影响WebSocket)
```

## 📋 核心 Page Rules (使用免费版3个规则)

### 规则1: CSS样式缓存
```
URL: yourdomain.com/css/*
Cache Level: Everything
Edge Cache TTL: 1年
Browser Cache TTL: 4小时
```

### 规则2: JavaScript缓存
```
URL: yourdomain.com/js/*
Cache Level: Everything
Edge Cache TTL: 1年
Browser Cache TTL: 4小时
```

### 规则3: API不缓存
```
URL: yourdomain.com/api/*
Cache Level: Bypass
Edge Cache TTL: 尊重源站
Browser Cache TTL: 尊重源站
```

## ✅ 验证部署

### 测试命令
```bash
# 测试静态资源 (应该看到 cf-ray 头)
curl -I https://yourdomain.com/css/complete-styles.css

# 测试API (应该看到 cf-ray 头)
curl -I https://yourdomain.com/api/health

# 测试WebSocket
wscat -c wss://yourdomain.com/ws
```

### 期望看到的HTTP头
```http
CF-RAY: 8xxxxxxx
CF-IPCountry: US
Server: cloudflare
```

## 🔧 缓存管理

### 清理缓存
```
Caching → Configuration → Purge Cache
Custom Purge: 输入需要清理的URL
```

### 常用清理模式
```bash
# 清理所有CSS文件
yourdomain.com/css/*

# 清理所有JS文件
yourdomain.com/js/*

# 清理主页
yourdomain.com/
```

## 🚨 故障排除

### 常见问题速查

**WebSocket连不上?**
- 检查 Network → WebSockets 是否为 ON
- 确认 SSL/TLS 设置正确

**静态资源更新慢?**
- 清理 CDN 缓存
- 检查 Page Rules 是否正确

**API请求被拒绝?**
- 检查 CORS 配置
- 确认域名在允许列表中

## 📊 性能效果预期

**优化效果:**
- 静态资源加载速度提升 60-80%
- API响应延迟降低 30-50%
- 全球访问体验优化

**关键指标:**
- 页面加载时间: < 2秒
- 缓存命中率: > 80%
- WebSocket连接成功率: > 95%