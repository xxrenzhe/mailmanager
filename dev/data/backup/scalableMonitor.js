const EventEmitter = require('events');

class ScalableMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    // 并发控制配置
    this.maxConcurrentChecks = options.maxConcurrentChecks || 10; // 最大并发检查数
    this.checkQueue = []; // 检查队列
    this.activeChecks = new Set(); // 活跃检查
    this.checkResults = new Map(); // 检查结果缓存

    // 监控会话管理
    this.activeSessions = new Map(); // accountId -> session data
    this.sessionTimeout = options.sessionTimeout || 300000; // 5分钟超时
    this.cleanupInterval = options.cleanupInterval || 60000; // 1分钟清理间隔

    // 限流配置
    this.rateLimiter = new Map(); // accountId -> { lastCheck, checkCount }
    this.rateLimitWindow = 60000; // 1分钟窗口
    this.maxChecksPerWindow = 20; // 每分钟最大检查次数

    // 连接池管理
    this.clientPool = [];
    this.maxPoolSize = options.maxPoolSize || 50;
    this.poolTimeout = options.poolTimeout || 30000;

    // 性能监控
    this.metrics = {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      averageResponseTime: 0,
      queueLength: 0,
      activeSessions: 0,
      memoryUsage: 0
    };

    this.init();
  }

  init() {
    // 启动清理定时器
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    // 启动性能监控
    this.metricsTimer = setInterval(() => {
      this.updateMetrics();
    }, 10000);

    console.log('[ScalableMonitor] 可扩展监控系统已初始化');
  }

  // 启动账户监控
  async startAccountMonitor(accountId, settings = {}) {
    const sessionData = {
      accountId,
      settings: {
        checkInterval: settings.checkInterval || 5000,
        duration: settings.duration || 60000,
        autoStopOnNewCode: settings.autoStopOnNewCode !== false,
        maxRetries: settings.maxRetries || 3,
        priority: settings.priority || 1,
        ...settings
      },
      startTime: Date.now(),
      lastCheck: 0,
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      newCodesFound: 0,
      status: 'active',
      checkTimer: null
    };

    // 停止该账户的其他监控
    await this.stopAccountMonitor(accountId);

    this.activeSessions.set(accountId, sessionData);

    // 设置检查定时器
    this.scheduleNextCheck(accountId);

    console.log(`[ScalableMonitor] 启动监控: 账户 ${accountId}`);
    this.emit('sessionStarted', { accountId, sessionData });

    return sessionData;
  }

  // 停止账户监控
  async stopAccountMonitor(accountId, reason = '手动停止') {
    const session = this.activeSessions.get(accountId);
    if (!session) return;

    // 清除定时器
    if (session.checkTimer) {
      clearTimeout(session.checkTimer);
    }

    // 从活跃检查中移除
    this.activeChecks.delete(accountId);

    // 更新会话状态
    session.status = 'stopped';
    session.stopReason = reason;
    session.stopTime = Date.now();

    this.activeSessions.delete(accountId);

    console.log(`[ScalableMonitor] 停止监控: 账户 ${accountId}, 原因: ${reason}`);
    this.emit('sessionStopped', { accountId, reason, session });
  }

  // 调度下次检查
  scheduleNextCheck(accountId) {
    const session = this.activeSessions.get(accountId);
    if (!session || session.status !== 'active') return;

    // 检查是否超时
    if (Date.now() - session.startTime > session.settings.duration) {
      this.stopAccountMonitor(accountId, '监控时间已结束');
      return;
    }

    // 检查是否发现新验证码且设置了自动停止
    if (session.settings.autoStopOnNewCode && session.newCodesFound > 0) {
      // 给用户10秒时间复制验证码
      if (Date.now() - session.lastNewCodeTime > 10000) {
        this.stopAccountMonitor(accountId, '已发现新验证码');
        return;
      }
    }

    // 计算下次检查时间
    const nextCheckTime = session.settings.checkInterval;

    session.checkTimer = setTimeout(() => {
      this.queueCheck(accountId);
    }, nextCheckTime);
  }

  // 将检查加入队列
  queueCheck(accountId) {
    const session = this.activeSessions.get(accountId);
    if (!session || session.status !== 'active') return;

    // 检查限流
    if (!this.checkRateLimit(accountId)) {
      console.log(`[ScalableMonitor] 账户 ${accountId} 触发限流，延迟检查`);
      this.scheduleNextCheck(accountId);
      return;
    }

    // 加入队列
    this.checkQueue.push({
      accountId,
      priority: session.settings.priority,
      timestamp: Date.now()
    });

    this.metrics.queueLength = this.checkQueue.length;

    // 尝试处理队列
    this.processQueue();
  }

  // 处理检查队列
  async processQueue() {
    while (this.checkQueue.length > 0 && this.activeChecks.size < this.maxConcurrentChecks) {
      const checkJob = this.checkQueue.shift();
      await this.executeCheck(checkJob.accountId);
    }
  }

  // 执行检查
  async executeCheck(accountId) {
    const session = this.activeSessions.get(accountId);
    if (!session) return;

    // 添加到活跃检查
    this.activeChecks.add(accountId);
    session.totalChecks++;

    const startTime = Date.now();

    try {
      // 获取客户端
      const client = await this.getClient();

      // 执行检查
      const result = await this.performCheck(accountId, client, session);

      // 处理结果
      await this.handleCheckResult(accountId, result, session);

      // 更新成功统计
      session.successfulChecks++;
      this.metrics.successfulChecks++;

      // 计算响应时间
      const responseTime = Date.now() - startTime;
      this.updateAverageResponseTime(responseTime);

      console.log(`[ScalableMonitor] 检查完成: 账户 ${accountId}, 耗时: ${responseTime}ms`);

    } catch (error) {
      console.error(`[ScalableMonitor] 检查失败: 账户 ${accountId}`, error);

      // 更新失败统计
      session.failedChecks++;
      this.metrics.failedChecks++;

      // 错误处理
      await this.handleCheckError(accountId, error, session);

    } finally {
      // 从活跃检查中移除
      this.activeChecks.delete(accountId);
      session.lastCheck = Date.now();

      // 释放客户端
      this.releaseClient(client);

      // 更新总检查数
      this.metrics.totalChecks++;

      // 继续处理队列
      this.processQueue();

      // 调度下次检查
      this.scheduleNextCheck(accountId);
    }
  }

  // 执行实际检查
  async performCheck(accountId, client, session) {
    // 这里调用具体的检查逻辑
    // 从数据库获取账户信息
    const account = await this.getAccountById(accountId);
    if (!account) {
      throw new Error('账户不存在');
    }

    if (account.status !== 'authorized' || !account.refresh_token_enc) {
      throw new Error('账户未授权或无有效令牌');
    }

    // 模拟检查过程（实际应用中这里会调用Outlook API）
    const result = await this.checkAccountEmails(account, session);

    return result;
  }

  // 检查账户邮件（模拟实现）
  async checkAccountEmails(account, session) {
    // 模拟API延迟
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));

    // 模拟检查结果
    const hasNewCode = Math.random() > 0.7; // 30%概率发现新验证码
    const hasNewMessage = Math.random() > 0.5; // 50%概率有新邮件

    let code = null;
    let subject = '测试邮件';
    let sender = 'test@example.com';

    if (hasNewCode) {
      code = Math.random().toString().substring(2, 8); // 6位数字验证码
      subject = '验证码邮件';
      sender = 'verification@service.com';
    }

    return {
      hasNewCode,
      hasNewMessage,
      code,
      subject,
      sender,
      received_at: new Date().toISOString(),
      isNewMessage: hasNewMessage
    };
  }

  // 处理检查结果
  async handleCheckResult(accountId, result, session) {
    if (result.hasNewCode) {
      session.newCodesFound++;
      session.lastNewCodeTime = Date.now();

      // 保存验证码到数据库
      await this.saveCode(accountId, {
        code: result.code,
        subject: result.subject,
        sender: result.sender,
        received_at: result.received_at
      });

      // 发送事件
      this.emit('newCodeDetected', {
        accountId,
        code: result.code,
        subject: result.subject,
        sender: result.sender,
        session
      });
    }

    if (result.isNewMessage) {
      // 保存消息到数据库
      await this.saveMessage(accountId, {
        subject: result.subject,
        sender: result.sender,
        received_at: result.received_at,
        has_code: result.hasNewCode ? 1 : 0
      });
    }

    // 更新账户活跃时间
    await this.updateAccountActivity(accountId, result.received_at);
  }

  // 处理检查错误
  async handleCheckError(accountId, error, session) {
    session.failedChecks++;

    // 如果失败次数过多，停止监控
    if (session.failedChecks >= session.settings.maxRetries) {
      await this.stopAccountMonitor(accountId, `检查失败次数过多: ${session.failedChecks}`);
      return;
    }

    // 发送错误事件
    this.emit('checkError', {
      accountId,
      error: error.message,
      failedChecks: session.failedChecks,
      session
    });
  }

  // 限流检查
  checkRateLimit(accountId) {
    const now = Date.now();
    const limiter = this.rateLimiter.get(accountId);

    if (!limiter) {
      this.rateLimiter.set(accountId, {
        lastCheck: now,
        checkCount: 1,
        windowStart: now
      });
      return true;
    }

    // 检查是否需要重置窗口
    if (now - limiter.windowStart > this.rateLimitWindow) {
      limiter.windowStart = now;
      limiter.checkCount = 1;
      limiter.lastCheck = now;
      return true;
    }

    // 检查是否超过限制
    if (limiter.checkCount >= this.maxChecksPerWindow) {
      return false;
    }

    limiter.checkCount++;
    limiter.lastCheck = now;
    return true;
  }

  // 获取客户端
  async getClient() {
    if (this.clientPool.length > 0) {
      return this.clientPool.pop();
    }

    if (this.clientPool.length < this.maxPoolSize) {
      // 创建新客户端（模拟）
      return {
        id: `client_${Date.now()}_${Math.random()}`,
        created: Date.now(),
        used: 0
      };
    }

    // 等待可用客户端
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.clientPool.length > 0) {
          clearInterval(checkInterval);
          resolve(this.clientPool.pop());
        }
      }, 100);
    });
  }

  // 释放客户端
  releaseClient(client) {
    client.used++;

    // 检查客户端是否需要回收
    if (client.used > 100 || Date.now() - client.created > this.poolTimeout) {
      // 回收客户端
      return;
    }

    if (this.clientPool.length < this.maxPoolSize) {
      this.clientPool.push(client);
    }
  }

  // 清理过期资源
  cleanup() {
    const now = Date.now();

    // 清理超时的会话
    for (const [accountId, session] of this.activeSessions.entries()) {
      if (now - session.startTime > this.sessionTimeout) {
        this.stopAccountMonitor(accountId, '会话超时');
      }
    }

    // 清理过期的限流记录
    for (const [accountId, limiter] of this.rateLimiter.entries()) {
      if (now - limiter.windowStart > this.rateLimitWindow * 2) {
        this.rateLimiter.delete(accountId);
      }
    }

    // 清理过期的客户端
    this.clientPool = this.clientPool.filter(client =>
      Date.now() - client.created < this.poolTimeout && client.used < 100
    );

    console.log(`[ScalableMonitor] 清理完成: 活跃会话 ${this.activeSessions.size}, 队列 ${this.checkQueue.length}, 客户端池 ${this.clientPool.length}`);
  }

  // 更新性能指标
  updateMetrics() {
    this.metrics.activeSessions = this.activeSessions.size;
    this.metrics.queueLength = this.checkQueue.length;

    // 内存使用估算
    const memoryUsage =
      this.activeSessions.size * 1024 + // 会话数据
      this.checkQueue.length * 512 +     // 队列数据
      this.clientPool.length * 2048 +    // 客户端池
      this.rateLimiter.size * 256;      // 限流数据

    this.metrics.memoryUsage = memoryUsage;

    this.emit('metricsUpdated', this.metrics);
  }

  // 更新平均响应时间
  updateAverageResponseTime(responseTime) {
    const alpha = 0.1; // 平滑因子
    this.metrics.averageResponseTime =
      this.metrics.averageResponseTime * (1 - alpha) + responseTime * alpha;
  }

  // 获取监控状态
  getMonitorStatus() {
    const sessions = Array.from(this.activeSessions.values()).map(session => ({
      accountId: session.accountId,
      status: session.status,
      totalChecks: session.totalChecks,
      successfulChecks: session.successfulChecks,
      failedChecks: session.failedChecks,
      newCodesFound: session.newCodesFound,
      runningTime: Date.now() - session.startTime,
      remainingTime: Math.max(0, session.settings.duration - (Date.now() - session.startTime))
    }));

    return {
      metrics: { ...this.metrics },
      sessions,
      queueLength: this.checkQueue.length,
      activeChecks: this.activeChecks.size,
      clientPoolSize: this.clientPool.length
    };
  }

  // 数据库操作接口（需要与实际数据库集成）
  async getAccountById(accountId) {
    // 实际实现需要查询数据库
    return { id: accountId, email: `account${accountId}@outlook.com`, status: 'authorized' };
  }

  async saveCode(accountId, codeData) {
    // 保存验证码到数据库
    console.log(`[ScalableMonitor] 保存验证码: 账户 ${accountId}, 代码 ${codeData.code}`);
  }

  async saveMessage(accountId, messageData) {
    // 保存消息到数据库
    console.log(`[ScalableMonitor] 保存消息: 账户 ${accountId}`);
  }

  async updateAccountActivity(accountId, timestamp) {
    // 更新账户活跃时间
    console.log(`[ScalableMonitor] 更新活跃时间: 账户 ${accountId}`);
  }

  // 优雅关闭
  async shutdown() {
    console.log('[ScalableMonitor] 开始优雅关闭...');

    // 停止所有定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    // 停止所有监控会话
    const sessionIds = Array.from(this.activeSessions.keys());
    for (const accountId of sessionIds) {
      await this.stopAccountMonitor(accountId, '服务器关闭');
    }

    // 清理资源
    this.clientPool = [];
    this.checkQueue = [];
    this.activeChecks.clear();
    this.rateLimiter.clear();

    console.log('[ScalableMonitor] 优雅关闭完成');
  }
}

module.exports = ScalableMonitor;