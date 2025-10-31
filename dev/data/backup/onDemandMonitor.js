const Database = require('./database');

class OnDemandMonitor {
  constructor() {
    this.activeSessions = new Map(); // accountId -> session data
    this.clients = new Map(); // accountId -> Set of SSE connections
    this.database = new Database();
    this.intervals = new Map(); // accountId -> interval ID
  }

  async init() {
    await this.database.init();
    // 恢复可能存在的活跃会话
    await this.restoreActiveSessions();
  }

  // 启动账户监控（由取件按钮触发）
  async startAccountMonitor(accountId, sessionId = null, settings = {}) {
    try {
      const account = await this.database.getAccount(accountId);
      if (!account) {
        throw new Error('账户不存在');
      }

      if (account.status !== 'authorized' || !account.refresh_token_enc) {
        throw new Error('账户未授权或无有效令牌');
      }

      // 停止该账户的其他监控会话
      await this.stopAccountMonitor(accountId);

      const sessionData = {
        accountId,
        sessionId: sessionId || await this.database.createMonitorSession({
          account_id: accountId,
          session_type: 'pickup',
          status: 'active',
          check_interval: settings.checkInterval || 5000,
          started_at: new Date().toISOString(),
          settings: JSON.stringify(settings),
          created_at: new Date().toISOString()
        }),
        settings: {
          checkInterval: settings.checkInterval || 5000,
          duration: settings.duration || 60000, // 默认监控1分钟
          autoStopOnNewCode: settings.autoStopOnNewCode !== false,
          ...settings
        },
        startTime: Date.now(),
        lastCheckTime: 0,
        totalChecks: 0,
        newCodesFound: 0,
        lastCodeCount: 0
      };

      this.activeSessions.set(accountId, sessionData);

      // 立即执行一次检查
      await this.checkAccount(accountId);

      // 设置定时检查
      const intervalId = setInterval(async () => {
        await this.checkAccount(accountId);

        // 检查是否应该停止监控
        const session = this.activeSessions.get(accountId);
        if (session && this.shouldStopSession(session)) {
          await this.stopAccountMonitor(accountId, '监控时间已结束');
        }
      }, sessionData.settings.checkInterval);

      this.intervals.set(accountId, intervalId);

      console.log(`[OnDemandMonitor] 启动账户监控: ${account.email} (ID: ${accountId})`);

      // 通知客户端
      this.broadcastToAccount(accountId, {
        type: 'monitor_started',
        accountId,
        email: account.email,
        sessionId: sessionData.sessionId,
        settings: sessionData.settings,
        message: `开始监控 ${account.email} 的新邮件`
      });

      return sessionData.sessionId;

    } catch (error) {
      console.error(`[OnDemandMonitor] 启动监控失败:`, error);
      throw error;
    }
  }

  // 从邮箱复制触发的监控
  async startEmailMonitor(email, settings = {}) {
    try {
      const account = await this.database.getAccountByEmail(email);
      if (!account) {
        throw new Error('邮箱账户不存在');
      }

      return this.startAccountMonitor(account.id, null, {
        ...settings,
        sessionType: 'copy'
      });

    } catch (error) {
      console.error(`[OnDemandMonitor] 启动邮箱监控失败:`, error);
      throw error;
    }
  }

  // 检查单个账户
  async checkAccount(accountId) {
    try {
      const session = this.activeSessions.get(accountId);
      if (!session) return;

      session.totalChecks++;
      session.lastCheckTime = Date.now();

      const account = await this.database.getAccount(accountId);
      if (!account) {
        await this.stopAccountMonitor(accountId, '账户不存在');
        return;
      }

      // 刷新访问令牌并获取最新邮件
      const result = await this.fetchAccountEmails(account);

      if (result.hasNewCode) {
        session.newCodesFound++;

        // 通知客户端发现新验证码
        this.broadcastToAccount(accountId, {
          type: 'new_code_detected',
          accountId,
          email: account.email,
          code: result.code,
          subject: result.subject,
          sender: result.sender,
          received_at: result.received_at,
          message: `发现新验证码: ${result.code}`
        });

        // 如果设置了自动停止，发现验证码后停止监控
        if (session.settings.autoStopOnNewCode) {
          setTimeout(() => {
            this.stopAccountMonitor(accountId, '已发现新验证码');
          }, 3000); // 延迟3秒停止，确保用户能看到结果
        }
      }

      // 更新监控会话状态
      await this.database.updateMonitorSession(session.sessionId, {
        last_check_at: new Date().toISOString(),
        total_checks: session.totalChecks,
        new_codes_found: session.newCodesFound
      });

      // 发送心跳信息
      this.broadcastToAccount(accountId, {
        type: 'monitor_heartbeat',
        accountId,
        totalChecks: session.totalChecks,
        newCodesFound: session.newCodesFound,
        remainingTime: Math.max(0, session.settings.duration - (Date.now() - session.startTime))
      });

    } catch (error) {
      console.error(`[OnDemandMonitor] 检查账户 ${accountId} 失败:`, error);

      this.broadcastToAccount(accountId, {
        type: 'monitor_error',
        accountId,
        error: error.message,
        message: '检查邮件时出错'
      });
    }
  }

  // 获取账户邮件（从现有代码提取）
  async fetchAccountEmails(account) {
    const { refreshTokenOutlook, fetchLatestMessageOutlook, extractCodeFromText } = require('./index');

    let rt = this.decryptPlaceholder(account.refresh_token_enc);
    if (rt) rt = String(rt).replace(/\s+$/,'').replace(/\n?EOF\n?$/,'');
    if (!rt) throw new Error('无有效refresh_token');

    const tok = await refreshTokenOutlook(rt, account.client_id);

    // 如果获得新的refresh_token，更新数据库
    if (tok.refresh_token && tok.refresh_token !== rt) {
      await this.database.updateAccount(account.id, {
        refresh_token_enc: this.encryptPlaceholder(tok.refresh_token)
      });
    }

    const msg = await fetchLatestMessageOutlook(tok.access_token);
    if (!msg) {
      return { hasNewCode: false, message: '无邮件' };
    }

    const received = msg.ReceivedDateTime;
    const subject = msg.Subject || '';
    const sender = (msg.From && msg.From.EmailAddress && msg.From.EmailAddress.Address) || '';
    const preview = msg.BodyPreview || '';
    const code = extractCodeFromText(subject + ' ' + preview);

    // 检查是否为新消息
    const existingMessage = await this.database.isMessageExists(account.id, msg.Id);
    let hasNewCode = false;

    if (!existingMessage) {
      // 保存消息记录
      await this.database.createMessage({
        account_id: account.id,
        message_id: msg.Id,
        received_at: received,
        subject,
        sender,
        has_code: code ? 1 : 0,
        created_at: new Date().toISOString()
      });
    }

    if (code && (!existingMessage || !await this.database.isCodeExists(account.id, code, msg.Id))) {
      // 保存新验证码
      await this.database.createCode({
        account_id: account.id,
        code,
        source: 'auto_detect',
        subject,
        sender,
        received_at: received,
        raw_message_id: msg.Id,
        created_at: new Date().toISOString()
      });
      hasNewCode = true;

      console.log(`[OnDemandMonitor] 发现新验证码 [${account.email}]: ${code}`);
    }

    // 更新账户活跃时间
    await this.database.updateAccount(account.id, {
      last_active_at: received
    });

    return {
      hasNewCode,
      code: code || null,
      subject,
      sender,
      received_at: received,
      isNewMessage: !existingMessage
    };
  }

  // 停止账户监控
  async stopAccountMonitor(accountId, reason = '手动停止') {
    const session = this.activeSessions.get(accountId);
    if (!session) return;

    console.log(`[OnDemandMonitor] 停止监控账户 ${accountId}: ${reason}`);

    // 清除定时器
    const intervalId = this.intervals.get(accountId);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(accountId);
    }

    // 更新数据库会话状态
    await this.database.updateMonitorSession(session.sessionId, {
      status: 'stopped',
      stopped_at: new Date().toISOString()
    });

    // 通知客户端
    const account = await this.database.getAccount(accountId);
    this.broadcastToAccount(accountId, {
      type: 'monitor_stopped',
      accountId,
      email: account?.email || 'Unknown',
      reason,
      totalChecks: session.totalChecks,
      newCodesFound: session.newCodesFound,
      duration: Date.now() - session.startTime,
      message: `监控已停止: ${reason}`
    });

    // 清理内存中的会话
    this.activeSessions.delete(accountId);
  }

  // 判断是否应该停止会话
  shouldStopSession(session) {
    // 检查是否超时
    if (Date.now() - session.startTime > session.settings.duration) {
      return true;
    }

    // 检查是否发现新验证码且设置了自动停止
    if (session.settings.autoStopOnNewCode && session.newCodesFound > 0) {
      // 延迟停止，确保用户有足够时间复制验证码
      return Date.now() - session.startTime > 10000; // 至少监控10秒
    }

    return false;
  }

  // 添加SSE客户端连接
  addClient(accountId, res) {
    if (!this.clients.has(accountId)) {
      this.clients.set(accountId, new Set());
    }

    this.clients.get(accountId).add(res);

    res.on('close', () => {
      const clientSet = this.clients.get(accountId);
      if (clientSet) {
        clientSet.delete(res);
        if (clientSet.size === 0) {
          this.clients.delete(accountId);
        }
      }
    });

    console.log(`[OnDemandMonitor] 客户端连接到账户 ${accountId}，当前连接数: ${this.clients.get(accountId)?.size || 0}`);

    // 发送初始状态
    this.sendToClient(res, {
      type: 'connected',
      accountId,
      timestamp: new Date().toISOString(),
      message: '已连接到监控服务'
    });

    // 发送当前监控状态
    const session = this.activeSessions.get(accountId);
    if (session) {
      this.sendToClient(res, {
        type: 'monitor_status',
        accountId,
        sessionId: session.sessionId,
        isMonitoring: true,
        totalChecks: session.totalChecks,
        newCodesFound: session.newCodesFound,
        remainingTime: Math.max(0, session.settings.duration - (Date.now() - session.startTime)),
        settings: session.settings
      });
    }
  }

  // 向特定账户的客户端广播消息
  broadcastToAccount(accountId, data) {
    const clientSet = this.clients.get(accountId);
    if (!clientSet || clientSet.size === 0) return;

    console.log(`[OnDemandMonitor] 向账户 ${accountId} 的 ${clientSet.size} 个客户端广播:`, data.type);

    clientSet.forEach(client => {
      this.sendToClient(client, data);
    });
  }

  // 向单个客户端发送消息
  sendToClient(res, data) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error('[OnDemandMonitor] 发送消息失败:', error);
      // 连接已断开，清理客户端
      this.clients.forEach((clientSet, accountId) => {
        clientSet.delete(res);
        if (clientSet.size === 0) {
          this.clients.delete(accountId);
        }
      });
    }
  }

  // 获取监控状态
  getMonitorStatus(accountId = null) {
    if (accountId) {
      const session = this.activeSessions.get(accountId);
      if (!session) return null;

      return {
        isMonitoring: true,
        accountId,
        sessionId: session.sessionId,
        totalChecks: session.totalChecks,
        newCodesFound: session.newCodesFound,
        remainingTime: Math.max(0, session.settings.duration - (Date.now() - session.startTime)),
        settings: session.settings,
        clientCount: this.clients.get(accountId)?.size || 0
      };
    }

    // 返回所有活跃会话
    const allSessions = Array.from(this.activeSessions.entries()).map(([accountId, session]) => ({
      accountId,
      sessionId: session.sessionId,
      totalChecks: session.totalChecks,
      newCodesFound: session.newCodesFound,
      remainingTime: Math.max(0, session.settings.duration - (Date.now() - session.startTime)),
      clientCount: this.clients.get(accountId)?.size || 0
    }));

    return {
      totalActiveSessions: allSessions.length,
      sessions: allSessions,
      totalClients: Array.from(this.clients.values()).reduce((sum, set) => sum + set.size, 0)
    };
  }

  // 恢复活跃会话（服务器重启后）
  async restoreActiveSessions() {
    try {
      const activeSessions = await this.database.getActiveMonitorSessions();

      for (const session of activeSessions) {
        // 标记会话为已停止（服务器重启）
        await this.database.updateMonitorSession(session.id, {
          status: 'stopped',
          stopped_at: new Date().toISOString()
        });

        console.log(`[OnDemandMonitor] 恢复时停止会话: 账户 ${session.account_id}, 会话 ${session.id}`);
      }
    } catch (error) {
      console.error('[OnDemandMonitor] 恢复会话失败:', error);
    }
  }

  // 清理超时会话
  async cleanupExpiredSessions() {
    for (const [accountId, session] of this.activeSessions.entries()) {
      if (this.shouldStopSession(session)) {
        await this.stopAccountMonitor(accountId, '监控时间已结束');
      }
    }
  }

  // 工具方法（从原代码复制）
  encryptPlaceholder(text) {
    return text || null; // 保持占位实现
  }

  decryptPlaceholder(text) {
    return text || null; // 保持占位实现
  }

  // 优雅关闭
  async shutdown() {
    console.log('[OnDemandMonitor] 开始优雅关闭...');

    // 停止所有监控会话
    const accountIds = Array.from(this.activeSessions.keys());
    for (const accountId of accountIds) {
      await this.stopAccountMonitor(accountId, '服务器关闭');
    }

    // 关闭数据库连接
    await this.database.close();

    console.log('[OnDemandMonitor] 优雅关闭完成');
  }
}

module.exports = OnDemandMonitor;