const EventEmitter = require('events');

class SimpleMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    // 简单的监控配置
    this.maxConcurrentMonitors = options.maxConcurrentMonitors || 9;
    this.monitorSessions = new Map(); // accountId -> session data
    this.activeMonitors = new Set(); // 当前活跃的监控

    // 基本的限流设置
    this.rateLimitMap = new Map(); // accountId -> { lastCheck, count }
    this.rateLimitWindow = 60000; // 1分钟
    this.maxChecksPerWindow = 20;

    // 定时清理
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000); // 30秒清理一次

    console.log('[SimpleMonitor] 简单监控系统已启动');
  }

  // 开始监控账户
  async startMonitoring(accountId, settings = {}) {
    // 停止该账户的其他监控
    this.stopMonitoring(accountId);

    const session = {
      accountId,
      startTime: Date.now(),
      checkCount: 0,
      successCount: 0,
      errorCount: 0,
      newCodesFound: 0,
      isActive: true,
      interval: settings.interval || 5000, // 5秒检查一次
      maxDuration: settings.maxDuration || 60000, // 1分钟最大监控时间（用于复制触发的监控）
      autoStopOnCode: settings.autoStopOnCode !== false
    };

    this.monitorSessions.set(accountId, session);
    this.scheduleNextCheck(accountId);

    console.log(`[SimpleMonitor] 开始监控账户: ${accountId}`);
    this.emit('monitoringStarted', { accountId });

    return session;
  }

  // 停止监控账户
  stopMonitoring(accountId, reason = '手动停止') {
    const session = this.monitorSessions.get(accountId);
    if (!session) return;

    session.isActive = false;
    session.endTime = Date.now();
    session.stopReason = reason;

    this.monitorSessions.delete(accountId);
    this.activeMonitors.delete(accountId);

    console.log(`[SimpleMonitor] 停止监控账户: ${accountId}, 原因: ${reason}`);
    this.emit('monitoringStopped', { accountId, reason, session });
  }

  // 调度下次检查
  scheduleNextCheck(accountId) {
    const session = this.monitorSessions.get(accountId);
    if (!session || !session.isActive) return;

    // 检查是否超时
    if (Date.now() - session.startTime > session.maxDuration) {
      this.stopMonitoring(accountId, '监控时间已结束');
      return;
    }

    // 检查是否发现新验证码且设置了自动停止
    if (session.autoStopOnCode && session.newCodesFound > 0) {
      // 给用户10秒时间复制验证码
      if (Date.now() - session.lastNewCodeTime > 10000) {
        this.stopMonitoring(accountId, '已发现验证码');
        return;
      }
    }

    // 检查并发限制
    if (this.activeMonitors.size >= this.maxConcurrentMonitors) {
      // 延迟重试
      setTimeout(() => this.scheduleNextCheck(accountId), 1000);
      return;
    }

    // 检查限流
    if (!this.checkRateLimit(accountId)) {
      setTimeout(() => this.scheduleNextCheck(accountId), 5000);
      return;
    }

    // 安排检查
    setTimeout(() => this.performCheck(accountId), session.interval);
  }

  // 执行检查
  async performCheck(accountId) {
    const session = this.monitorSessions.get(accountId);
    if (!session || !session.isActive) return;

    // 添加到活跃监控
    this.activeMonitors.add(accountId);
    session.checkCount++;

    try {
      // 使用真实的邮件服务检查邮件
      let result;
      if (this.emailService && this.db) {
        // 获取账户信息
        const account = await this.db.getAccount(accountId);
        if (account) {
          result = await this.emailService.checkAccountEmails(account, this.db);
        } else {
          result = await this.checkAccountEmails(accountId);
        }
      } else {
        result = await this.checkAccountEmails(accountId);
      }

      if (result.hasNewCode) {
        session.newCodesFound++;
        session.lastNewCodeTime = Date.now();

        // 保存验证码到数据库
        if (this.db && result.code) {
          try {
            await this.db.createCode({
              account_id: accountId,
              code: result.code,
              subject: result.subject,
              sender: result.sender,
              received_at: result.received_at,
              created_at: new Date().toISOString()
            });
            console.log(`[SimpleMonitor] 新验证码已保存: 账户${accountId} -> ${result.code}`);
          } catch (dbError) {
            console.error(`[SimpleMonitor] 保存验证码失败:`, dbError);
          }
        }

        // 发送新验证码事件
        this.emit('newCodeDetected', {
          accountId,
          code: result.code,
          subject: result.subject,
          sender: result.sender,
          received_at: result.received_at
        });

        // 如果设置了自动停止，收到验证码后停止监控
        if (session.autoStopOnCode) {
          console.log(`[SimpleMonitor] 收到验证码，自动停止监控: 账户${accountId}`);
          this.stopMonitoring(accountId, '收到验证码，自动停止');
          return;
        }
      }

      session.successCount++;
      console.log(`[SimpleMonitor] 检查完成: 账户 ${accountId}, 结果: ${result.hasNewCode ? '发现验证码' : '无验证码'}`);

    } catch (error) {
      session.errorCount++;
      console.error(`[SimpleMonitor] 检查失败: 账户 ${accountId}`, error.message);

      // 如果错误次数过多，停止监控
      if (session.errorCount >= 3) {
        this.stopMonitoring(accountId, `检查失败次数过多: ${session.errorCount}`);
        return;
      }

      this.emit('checkError', {
        accountId,
        error: error.message,
        errorCount: session.errorCount
      });

    } finally {
      // 从活跃监控中移除
      this.activeMonitors.delete(accountId);
      // 调度下次检查
      this.scheduleNextCheck(accountId);
    }
  }

  // 模拟邮件检查（实际应该调用真实的API）
  async checkAccountEmails(accountId) {
    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));

    // 模拟检查结果 - 20%概率发现新验证码
    const hasNewCode = Math.random() > 0.8;

    if (hasNewCode) {
      return {
        hasNewCode: true,
        code: Math.random().toString().substring(2, 8), // 6位数字
        subject: '验证码邮件',
        sender: 'verification@service.com',
        received_at: new Date().toISOString()
      };
    }

    return {
      hasNewCode: false,
      message: '无新验证码'
    };
  }

  // 限流检查
  checkRateLimit(accountId) {
    const now = Date.now();
    const limiter = this.rateLimitMap.get(accountId);

    if (!limiter) {
      this.rateLimitMap.set(accountId, {
        lastCheck: now,
        count: 1,
        windowStart: now
      });
      return true;
    }

    // 检查是否需要重置窗口
    if (now - limiter.windowStart > this.rateLimitWindow) {
      limiter.windowStart = now;
      limiter.count = 1;
      limiter.lastCheck = now;
      return true;
    }

    // 检查是否超过限制
    if (limiter.count >= this.maxChecksPerWindow) {
      return false;
    }

    limiter.count++;
    limiter.lastCheck = now;
    return true;
  }

  // 清理过期资源
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    // 清理过期的限流记录
    for (const [accountId, limiter] of this.rateLimitMap.entries()) {
      if (now - limiter.windowStart > this.rateLimitWindow * 2) {
        this.rateLimitMap.delete(accountId);
        cleanedCount++;
      }
    }

    // 清理非活跃的监控会话
    for (const [accountId, session] of this.monitorSessions.entries()) {
      if (!session.isActive || (now - session.startTime > session.maxDuration)) {
        this.stopMonitoring(accountId, '清理过期会话');
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[SimpleMonitor] 清理完成: ${cleanedCount} 项`);
    }
  }

  // 获取监控状态
  getStatus() {
    const sessions = Array.from(this.monitorSessions.values()).map(session => ({
      accountId: session.accountId,
      isActive: session.isActive,
      runningTime: Date.now() - session.startTime,
      checkCount: session.checkCount,
      successCount: session.successCount,
      errorCount: session.errorCount,
      newCodesFound: session.newCodesFound
    }));

    return {
      totalSessions: this.monitorSessions.size,
      activeMonitors: this.activeMonitors.size,
      maxConcurrentMonitors: this.maxConcurrentMonitors,
      sessions
    };
  }

  // 获取账户监控详情
  getAccountStatus(accountId) {
    const session = this.monitorSessions.get(accountId);
    if (!session) return null;

    return {
      accountId: session.accountId,
      isActive: session.isActive,
      startTime: session.startTime,
      runningTime: Date.now() - session.startTime,
      checkCount: session.checkCount,
      successCount: session.successCount,
      errorCount: session.errorCount,
      newCodesFound: session.newCodesFound
    };
  }

  // 获取所有活跃监控
  getActiveMonitors() {
    return Array.from(this.activeMonitors);
  }

  // 修改并发限制
  setMaxConcurrentMonitors(max) {
    this.maxConcurrentMonitors = Math.max(1, max);
    console.log(`[SimpleMonitor] 并发限制已调整为: ${this.maxConcurrentMonitors}`);
  }

  // 停止所有监控
  stopAllMonitors(reason = '系统停止') {
    const accountIds = Array.from(this.monitorSessions.keys());
    for (const accountId of accountIds) {
      this.stopMonitoring(accountId, reason);
    }
    console.log(`[SimpleMonitor] 所有监控已停止 (${accountIds.length} 个账户)`);
  }

  // 优雅关闭
  shutdown() {
    console.log('[SimpleMonitor] 开始关闭...');

    // 清理定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // 停止所有监控
    this.stopAllMonitors('系统关闭');

    // 清理资源
    this.monitorSessions.clear();
    this.activeMonitors.clear();
    this.rateLimitMap.clear();

    console.log('[SimpleMonitor] 关闭完成');
  }
}

module.exports = SimpleMonitor;