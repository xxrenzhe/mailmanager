# MailManager 真实邮箱测试指南

## 🎯 测试目标
使用提供的真实Outlook邮箱账户测试所有功能，确保与原始simple-mail-manager.html完全一致。

## 📧 测试邮箱数据
```
JoelGrundydi@outlook.com----MOoyopg947------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$$
```

## 🔧 访问方式
1. 打开浏览器访问：`http://localhost:3001`
2. 或者直接打开：`file:///Users/jason/Documents/Kiro/mailmanager/index.html`

## 🧪 功能测试清单

### 1. 页面加载测试 ✅
- [x] 页面正常加载，显示"MailManager - 简化管理界面"
- [x] 统计区域显示5个统计项（总账户数、已授权、待授权、失败、监控中）
- [x] 核心功能和数据安全说明正确显示
- [x] 所有模态框默认隐藏
- [x] 表格区域显示"暂无邮箱账户"提示

### 2. 导入邮箱功能测试 📋
- [ ] 点击"导入邮箱"按钮
- [ ] 确认导入模态框正确显示
- [ ] 模态框标题显示"导入邮箱"
- [ ] 格式说明正确显示
- [ ] 文本框焦点正确设置
- [ ] 粘贴提供的测试邮箱数据
- [ ] 点击"导入邮箱"按钮开始导入
- [ ] 观察进度条和状态更新
- [ ] 等待导入完成
- [ ] 确认表格中显示导入的邮箱

### 3. 搜索和过滤测试 📋
- [ ] 在搜索框中输入"JoelGrundydi"
- [ ] 确认能搜索到对应的邮箱
- [ ] 测试状态过滤器（全部、待授权、已授权、需重新授权）
- [ ] 测试每页显示选项（20、50、100）
- [ ] 验证分页功能正常

### 4. 清空数据功能测试 📋
- [ ] 点击"清空数据"按钮
- [ ] 确认清空确认模态框正确显示
- [ ] 警告文本正确显示
- [ ] 勾选确认复选框
- [ ] 点击"确认清空"按钮
- [ ] 确认所有数据被清空
- [ ] 页面恢复到初始状态

### 5. 实时更新测试 📋
- [ ] 观察WebSocket连接状态（服务器日志）
- [ ] 测试邮件收取功能（如果有邮件）
- [ ] 验证验证码显示
- [ ] 测试手动取件功能

### 6. 界面一致性验证 ✅
- [x] 按钮样式与原始一致
- [x] 模态框布局与原始一致
- [x] 文案文本与原始一致
- [x] 统计区域与原始一致
- [x] 表格结构与原始一致

## 🔍 预期结果

### 成功导入后的状态：
1. **统计区域更新**：
   - 总账户数：1
   - 状态：待授权（需要OAuth授权）

2. **表格显示**：
   - 序号：1
   - 状态：待授权
   - 邮箱：JoelGrundydi@outlook.com
   - 操作按钮：手动取件、重新授权等

3. **功能可用**：
   - 搜索功能正常
   - 过滤功能正常
   - 分页功能正常
   - 清空数据功能正常

## ⚠️ 注意事项

1. **OAuth授权**：如果邮箱需要OAuth授权，点击相应按钮进行授权流程
2. **数据存储**：所有数据存储在浏览器localStorage中
3. **实时更新**：WebSocket连接提供实时邮件更新
4. **安全性**：所有操作都在前端进行，不上传到服务器

## 🐛 问题排查

如果遇到问题：
1. 检查浏览器控制台是否有JavaScript错误
2. 检查服务器是否正常运行（端口3001和3002）
3. 检查网络连接状态
4. 刷新页面重试

## 📝 测试记录

测试开始时间：______
测试结束时间：______
测试结果：______
发现问题：______
解决方案：______