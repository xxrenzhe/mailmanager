const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class OptimizedDatabase {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'mailmanager.db');
    this.ensureDataDir();
    this.db = null;
    this.queryCache = new Map(); // 查询缓存
    this.cacheTimeout = 30000; // 30秒缓存
    this.connectionPool = [];
    this.maxPoolSize = 10;
  }

  ensureDataDir() {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  async init() {
    return new Promise((resolve, reject) => {
      // 配置SQLite性能优化
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('[Database] 连接失败:', err);
          reject(err);
        } else {
          console.log('[Database] SQLite数据库已连接');
          this.optimizePerformance();
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  // 性能优化配置
  async optimizePerformance() {
    const optimizations = [
      'PRAGMA journal_mode = WAL', // 写前日志模式，提升并发性能
      'PRAGMA synchronous = NORMAL', // 降低同步频率
      'PRAGMA cache_size = 10000', // 10MB缓存
      'PRAGMA temp_store = MEMORY', // 临时表存储在内存
      'PRAGMA mmap_size = 268435456', // 256MB内存映射
      'PRAGMA busy_timeout = 30000', // 30秒超时
      'PRAGMA wal_autocheckpoint = 1000', // 自动检查点
      'PRAGMA optimize' // 优化数据库
    ];

    for (const pragma of optimizations) {
      await this.run(pragma);
    }
    console.log('[Database] 性能优化配置完成');
  }

  async createTables() {
    const tables = [
      // 优化后的账户表
      `CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        client_id TEXT NOT NULL,
        refresh_token_enc TEXT,
        status TEXT DEFAULT 'pending',
        import_seq INTEGER,
        last_active_at TEXT,
        delta_link TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        -- 性能优化字段
        is_active INTEGER DEFAULT 1, -- 软删除标记
        priority INTEGER DEFAULT 0, -- 监控优先级
        last_check_at TEXT, -- 最后检查时间
        check_count INTEGER DEFAULT 0, -- 检查次数
        error_count INTEGER DEFAULT 0 -- 错误次数
      )`,

      // 验证码表（添加复合索引）
      `CREATE TABLE IF NOT EXISTS codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        code TEXT NOT NULL,
        source TEXT DEFAULT NULL,
        subject TEXT,
        sender TEXT,
        received_at TEXT NOT NULL,
        raw_message_id TEXT,
        created_at TEXT NOT NULL,

        -- 性能优化字段
        is_valid INTEGER DEFAULT 1, -- 验证码有效性
        is_used INTEGER DEFAULT 0, -- 是否已使用
        expires_at TEXT, -- 过期时间

        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`,

      // 消息表
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        subject TEXT,
        sender TEXT,
        has_code INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,

        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`,

      // 监控会话表
      `CREATE TABLE IF NOT EXISTS monitor_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        session_type TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        check_interval INTEGER DEFAULT 5000,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        last_check_at TEXT,
        total_checks INTEGER DEFAULT 0,
        new_codes_found INTEGER DEFAULT 0,
        settings TEXT,
        created_at TEXT NOT NULL,

        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`,

      // 统计表（预计算）
      `CREATE TABLE IF NOT EXISTS account_stats (
        account_id INTEGER PRIMARY KEY,
        total_codes INTEGER DEFAULT 0,
        latest_code TEXT,
        latest_code_received_at TEXT,
        last_message_received_at TEXT,
        total_messages INTEGER DEFAULT 0,
        updated_at TEXT,

        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`
    ];

    // 高性能索引
    const indexes = [
      // 账户表索引
      'CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_last_active ON accounts(last_active_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_status_active ON accounts(status, is_active)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_priority ON accounts(priority DESC)',

      // 验证码表索引
      'CREATE INDEX IF NOT EXISTS idx_codes_account_id_received ON codes(account_id, received_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_codes_account_id_valid ON codes(account_id, is_valid, received_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_codes_received_at ON codes(received_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_codes_valid_received ON codes(is_valid, received_at DESC)',

      // 消息表索引
      'CREATE INDEX IF NOT EXISTS idx_messages_account_id_received ON messages(account_id, received_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC)',

      // 监控会话索引
      'CREATE INDEX IF NOT EXISTS idx_monitor_sessions_status ON monitor_sessions(status)',
      'CREATE INDEX IF NOT EXISTS idx_monitor_sessions_account_status ON monitor_sessions(account_id, status)',

      // 统计表索引
      'CREATE INDEX IF NOT EXISTS idx_account_stats_updated ON account_stats(updated_at DESC)'
    ];

    try {
      for (const table of tables) {
        await this.run(table);
      }
      for (const index of indexes) {
        await this.run(index);
      }

      // 创建触发器自动更新统计
      await this.createTriggers();

      console.log('[Database] 优化表和索引创建完成');
    } catch (error) {
      console.error('[Database] 创建表失败:', error);
      throw error;
    }
  }

  // 创建触发器自动维护统计表
  async createTriggers() {
    const triggers = [
      // 新增验证码时更新统计
      `CREATE TRIGGER IF NOT EXISTS update_stats_on_new_code
       AFTER INSERT ON codes
       BEGIN
         INSERT OR REPLACE INTO account_stats
         (account_id, total_codes, latest_code, latest_code_received_at, updated_at)
         VALUES
         (NEW.account_id,
          COALESCE((SELECT total_codes FROM account_stats WHERE account_id = NEW.account_id), 0) + 1,
          NEW.code,
          NEW.received_at,
          datetime('now'));
       END`,

      // 删除验证码时更新统计
      `CREATE TRIGGER IF NOT EXISTS update_stats_on_delete_code
       AFTER DELETE ON codes
       BEGIN
         UPDATE account_stats
         SET total_codes = total_codes - 1,
             updated_at = datetime('now')
         WHERE account_id = OLD.account_id;
       END`
    ];

    for (const trigger of triggers) {
      await this.run(trigger);
    }
  }

  // 连接池管理
  async getConnection() {
    return new Promise((resolve, reject) => {
      if (this.connectionPool.length > 0) {
        resolve(this.connectionPool.pop());
      } else if (this.maxPoolSize > 0) {
        this.maxPoolSize--;
        const db = new sqlite3.Database(this.dbPath);
        this.optimizePerformance().then(() => resolve(db)).catch(reject);
      } else {
        // 等待可用连接
        setTimeout(() => this.getConnection().then(resolve).catch(reject), 100);
      }
    });
  }

  releaseConnection(db) {
    if (this.connectionPool.length < 10) {
      this.connectionPool.push(db);
    } else {
      this.maxPoolSize++;
      db.close();
    }
  }

  // 缓存查询结果
  getCachedResult(cacheKey) {
    const cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCachedResult(cacheKey, data) {
    this.queryCache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });

    // 定期清理过期缓存
    if (this.queryCache.size > 100) {
      this.cleanExpiredCache();
    }
  }

  cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.queryCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.queryCache.delete(key);
      }
    }
  }

  // 高性能分页查询（解决N+1问题）
  async getAccountsWithLatestCodes(options = {}) {
    const {
      page = 1,
      pageSize = 50,
      sort = 'last_active_at',
      order = 'desc',
      filters = {}
    } = options;

    const cacheKey = `accounts_page_${page}_${pageSize}_${sort}_${order}_${JSON.stringify(filters)}`;
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      return cached;
    }

    const offset = (page - 1) * pageSize;

    // 单次查询获取账户和最新验证码
    const sql = `
      SELECT
        a.id, a.email, a.client_id, a.status, a.import_seq,
        a.last_active_at, a.created_at, a.updated_at, a.is_active,
        a.priority, a.last_check_at, a.check_count, a.error_count,
        s.latest_code, s.latest_code_received_at, s.total_codes, s.total_messages
      FROM accounts a
      LEFT JOIN account_stats s ON a.id = s.account_id
      WHERE a.is_active = 1
      ${filters.email ? 'AND a.email LIKE ?' : ''}
      ${filters.status ? 'AND a.status = ?' : ''}
      ORDER BY a.${this.escapeIdentifier(sort)} ${order.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    const params = [];
    if (filters.email) {
      params.push(`%${filters.email}%`);
    }
    if (filters.status) {
      params.push(filters.status);
    }
    params.push(pageSize, offset);

    const results = await this.all(sql, params);

    // 缓存结果
    this.setCachedResult(cacheKey, results);

    return results;
  }

  // 获取总数（优化版本）
  async getTotalAccounts(filters = {}) {
    const cacheKey = `total_accounts_${JSON.stringify(filters)}`;
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      return cached;
    }

    let sql = 'SELECT COUNT(*) as total FROM accounts WHERE is_active = 1';
    const params = [];

    if (filters.email) {
      sql += ' AND email LIKE ?';
      params.push(`%${filters.email}%`);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    const result = await this.get(sql, params);
    this.setCachedResult(cacheKey, result.total);
    return result.total;
  }

  // 批量操作优化
  async batchUpdateAccounts(updates) {
    const db = await this.getConnection();

    try {
      await new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          const stmt = db.prepare(`
            UPDATE accounts
            SET status = ?, updated_at = ?, last_check_at = ?, check_count = ?, error_count = ?
            WHERE id = ?
          `);

          updates.forEach(update => {
            stmt.run([
              update.status,
              update.updated_at || new Date().toISOString(),
              update.last_check_at,
              update.check_count || 0,
              update.error_count || 0,
              update.id
            ]);
          });

          stmt.finalize((err) => {
            if (err) {
              db.run('ROLLBACK');
              reject(err);
            } else {
              db.run('COMMIT', (commitErr) => {
                if (commitErr) reject(commitErr);
                else resolve();
              });
            }
          });
        });
      });

      // 清理相关缓存
      this.cleanAccountCache();
    } finally {
      this.releaseConnection(db);
    }
  }

  // 清理账户相关缓存
  cleanAccountCache() {
    const keysToDelete = [];
    for (const key of this.queryCache.keys()) {
      if (key.startsWith('accounts_') || key.startsWith('total_accounts_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.queryCache.delete(key));
  }

  // 软删除账户
  async softDeleteAccount(accountId) {
    await this.run(
      'UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), accountId]
    );
    this.cleanAccountCache();
  }

  // 批量插入验证码（优化版本）
  async batchInsertCodes(codes) {
    if (codes.length === 0) return;

    const db = await this.getConnection();

    try {
      await new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          const stmt = db.prepare(`
            INSERT INTO codes
            (account_id, code, source, subject, sender, received_at, raw_message_id, created_at, is_valid, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          `);

          codes.forEach(code => {
            stmt.run([
              code.account_id,
              code.code,
              code.source,
              code.subject,
              code.sender,
              code.received_at,
              code.raw_message_id,
              code.created_at,
              code.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24小时后过期
            ]);
          });

          stmt.finalize((err) => {
            if (err) {
              db.run('ROLLBACK');
              reject(err);
            } else {
              db.run('COMMIT', (commitErr) => {
                if (commitErr) reject(commitErr);
                else resolve();
              });
            }
          });
        });
      });

      // 清理验证码相关缓存
      this.cleanCodesCache();
    } finally {
      this.releaseConnection(db);
    }
  }

  cleanCodesCache() {
    const keysToDelete = [];
    for (const key of this.queryCache.keys()) {
      if (key.includes('codes') || key.includes('stats')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.queryCache.delete(key));
  }

  // 数据库维护操作
  async maintenance() {
    console.log('[Database] 开始维护操作...');

    try {
      // 清理过期验证码
      const expiredResult = await this.run(
        'UPDATE codes SET is_valid = 0 WHERE expires_at < datetime("now") AND is_valid = 1'
      );
      console.log(`[Database] 清理过期验证码: ${expiredResult.changes} 条`);

      // 清理旧的监控会话
      const sessionResult = await this.run(
        'UPDATE monitor_sessions SET status = "expired" WHERE started_at < datetime("now", "-7 days") AND status = "active"'
      );
      console.log(`[Database] 清理过期会话: ${sessionResult.changes} 条`);

      // 优化数据库
      await this.run('PRAGMA optimize');
      await this.run('VACUUM');

      // 清理缓存
      this.cleanExpiredCache();

      console.log('[Database] 维护操作完成');
    } catch (error) {
      console.error('[Database] 维护操作失败:', error);
    }
  }

  // 安全的标识符转义
  escapeIdentifier(identifier) {
    return identifier.replace(/[^a-zA-Z0-9_]/g, '');
  }

  // 通用查询方法（添加连接池支持）
  async run(sql, params = []) {
    const db = await this.getConnection();
    try {
      return await new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, changes: this.changes });
        });
      });
    } finally {
      this.releaseConnection(db);
    }
  }

  async get(sql, params = []) {
    const db = await this.getConnection();
    try {
      return await new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    } finally {
      this.releaseConnection(db);
    }
  }

  async all(sql, params = []) {
    const db = await this.getConnection();
    try {
      return await new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      this.releaseConnection(db);
    }
  }

  // 保持原有API兼容性
  async createAccount(accountData) {
    const sql = `INSERT INTO accounts (email, client_id, refresh_token_enc, status, import_seq, last_active_at, delta_link, created_at, updated_at, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`;
    const params = [
      accountData.email,
      accountData.client_id,
      accountData.refresh_token_enc,
      accountData.status || 'pending',
      accountData.import_seq,
      accountData.last_active_at,
      accountData.delta_link,
      accountData.created_at,
      accountData.updated_at
    ];
    const result = await this.run(sql, params);

    // 初始化统计
    await this.run(
      'INSERT INTO account_stats (account_id, total_codes, total_messages, updated_at) VALUES (?, 0, 0, ?)',
      [result.id, new Date().toISOString()]
    );

    this.cleanAccountCache();
    return result.id;
  }

  async updateAccount(id, updates) {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(id);

    const sql = `UPDATE accounts SET ${fields}, updated_at = ? WHERE id = ?`;
    const updatedAt = new Date().toISOString();
    values.splice(values.length - 1, 0, updatedAt);

    await this.run(sql, values);
    this.cleanAccountCache();
  }

  async getAccount(id) {
    const sql = `
      SELECT a.*, s.latest_code, s.latest_code_received_at, s.total_codes, s.total_messages
      FROM accounts a
      LEFT JOIN account_stats s ON a.id = s.account_id
      WHERE a.id = ? AND a.is_active = 1
    `;
    return this.get(sql, [id]);
  }

  async getAccountByEmail(email) {
    const sql = `
      SELECT a.*, s.latest_code, s.latest_code_received_at, s.total_codes, s.total_messages
      FROM accounts a
      LEFT JOIN account_stats s ON a.id = s.account_id
      WHERE a.email = ? AND a.is_active = 1
    `;
    return this.get(sql, [email]);
  }

  async getAccounts(options = {}) {
    return this.getAccountsWithLatestCodes(options);
  }

  async getTotalAccounts(filters = {}) {
    return this.getTotalAccounts(filters);
  }

  // 验证码相关方法
  async createCode(codeData) {
    await this.batchInsertCodes([codeData]);
  }

  async getLatestCode(accountId) {
    const cacheKey = `latest_code_${accountId}`;
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.get(
      'SELECT * FROM codes WHERE account_id = ? AND is_valid = 1 ORDER BY received_at DESC LIMIT 1',
      [accountId]
    );

    this.setCachedResult(cacheKey, result);
    return result;
  }

  async getCodes(accountId, limit = 10) {
    return this.all(
      'SELECT * FROM codes WHERE account_id = ? ORDER BY received_at DESC LIMIT ?',
      [accountId, limit]
    );
  }

  async isCodeExists(accountId, code, messageId) {
    const result = await this.get(
      'SELECT id FROM codes WHERE account_id = ? AND code = ? AND raw_message_id = ?',
      [accountId, code, messageId]
    );
    return !!result;
  }

  // 消息相关方法
  async createMessage(messageData) {
    const sql = `INSERT INTO messages (account_id, message_id, received_at, subject, sender, has_code, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      messageData.account_id,
      messageData.message_id,
      messageData.received_at,
      messageData.subject,
      messageData.sender,
      messageData.has_code,
      messageData.created_at
    ];
    await this.run(sql, params);
  }

  async isMessageExists(accountId, messageId) {
    const result = await this.get(
      'SELECT id FROM messages WHERE account_id = ? AND message_id = ?',
      [accountId, messageId]
    );
    return !!result;
  }

  // 监控会话管理
  async createMonitorSession(sessionData) {
    const sql = `INSERT INTO monitor_sessions (account_id, session_type, status, check_interval, started_at, settings, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      sessionData.account_id,
      sessionData.session_type,
      sessionData.status || 'active',
      sessionData.check_interval || 5000,
      sessionData.started_at,
      sessionData.settings || null,
      sessionData.created_at
    ];
    const result = await this.run(sql, params);
    return result.id;
  }

  async updateMonitorSession(id, updates) {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(id);

    const sql = `UPDATE monitor_sessions SET ${fields} WHERE id = ?`;
    await this.run(sql, values);
  }

  async getActiveMonitorSessions(accountId = null) {
    let sql = 'SELECT * FROM monitor_sessions WHERE status = "active"';
    const params = [];

    if (accountId) {
      sql += ' AND account_id = ?';
      params.push(accountId);
    }

    return this.all(sql, params);
  }

  async stopMonitorSession(id) {
    await this.updateMonitorSession(id, {
      status: 'stopped',
      stopped_at: new Date().toISOString()
    });
  }

  async stopAccountMonitorSessions(accountId) {
    const sql = 'UPDATE monitor_sessions SET status = "stopped", stopped_at = ? WHERE account_id = ? AND status = "active"';
    await this.run(sql, [new Date().toISOString(), accountId]);
  }

  // 数据迁移（从JSON）
  async migrateFromJson(jsonData) {
    console.log('[Database] 开始从JSON迁移数据...');

    try {
      // 批量插入账户
      if (jsonData.accounts && jsonData.accounts.length > 0) {
        const accountPromises = jsonData.accounts.map(account =>
          this.createAccount(account).catch(err => {
            if (err.message.includes('UNIQUE constraint failed')) {
              return this.updateAccount(account.id, {
                client_id: account.client_id,
                refresh_token_enc: account.refresh_token_enc,
                status: account.status,
                last_active_at: account.last_active_at,
                delta_link: account.delta_link
              });
            }
            throw err;
          })
        );
        await Promise.all(accountPromises);
        console.log(`[Database] 账户迁移完成: ${jsonData.accounts.length} 个`);
      }

      // 批量插入验证码
      if (jsonData.codes && jsonData.codes.length > 0) {
        await this.batchInsertCodes(jsonData.codes);
        console.log(`[Database] 验证码迁移完成: ${jsonData.codes.length} 个`);
      }

      // 批量插入消息
      if (jsonData.messages && jsonData.messages.length > 0) {
        const messagePromises = jsonData.messages.map(message =>
          this.createMessage(message).catch(err =>
            console.warn(`[Database] 消息迁移失败 ${message.id}:`, err.message)
          )
        );
        await Promise.all(messagePromises);
        console.log(`[Database] 消息迁移完成: ${jsonData.messages.length} 个`);
      }

      console.log('[Database] 数据迁移完成');
    } catch (error) {
      console.error('[Database] 数据迁移失败:', error);
      throw error;
    }
  }

  async close() {
    // 关闭所有连接池连接
    for (const db of this.connectionPool) {
      db.close();
    }
    this.connectionPool = [];

    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('[Database] 关闭数据库失败:', err);
          } else {
            console.log('[Database] 数据库已关闭');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = OptimizedDatabase;