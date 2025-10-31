const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class SimpleDatabase {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'mailmanager.db');
    this.db = null;
    this.cache = new Map(); // 简单内存缓存
    this.cacheTimeout = 60000; // 1分钟缓存
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('[SimpleDB] 数据库已连接');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        client_id TEXT NOT NULL,
        refresh_token_enc TEXT,
        status TEXT DEFAULT 'pending',
        last_active_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
      )`,

      `CREATE TABLE IF NOT EXISTS codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        code TEXT NOT NULL,
        subject TEXT,
        sender TEXT,
        received_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_valid INTEGER DEFAULT 1,
        expires_at TEXT,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`,

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
      )`
    ];

    // 简单索引（只添加必要的）
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_codes_account_id ON codes(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_codes_valid_received ON codes(is_valid, received_at DESC)'
    ];

    try {
      for (const table of tables) {
        await this.run(table);
      }
      for (const index of indexes) {
        await this.run(index);
      }
      console.log('[SimpleDB] 表和索引创建完成');
    } catch (error) {
      console.error('[SimpleDB] 创建表失败:', error);
      throw error;
    }
  }

  // KISS缓存 - 简单的内存缓存
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCached(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });

    // 简单的缓存清理 - 超过100个时清理一半
    if (this.cache.size > 100) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, 50);
      toDelete.forEach(([k]) => this.cache.delete(k));
    }
  }

  // 批量获取账户（解决N+1问题）
  async getAccountsWithLatestCodes(options = {}) {
    const { page = 1, pageSize = 50, filters = {} } = options;
    const offset = (page - 1) * pageSize;

    // 检查缓存
    const cacheKey = `accounts_${page}_${pageSize}_${JSON.stringify(filters)}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // 单次查询获取账户和最新验证码
    const sql = `
      SELECT
        a.id, a.email, a.client_id, a.status, a.last_active_at, a.created_at, a.updated_at,
        c.code as latest_code,
        c.received_at as latest_code_received_at,
        c.sender as latest_code_sender
      FROM accounts a
      LEFT JOIN codes c ON a.id = c.account_id AND c.is_valid = 1
      LEFT JOIN codes c2 ON a.id = c2.account_id AND c2.is_valid = 1 AND (c2.received_at > c.received_at OR (c2.received_at = c.received_at AND c2.created_at > c.created_at))
      WHERE a.is_active = 1
      ${filters.email ? 'AND a.email LIKE ?' : ''}
      ${filters.status ? 'AND a.status = ?' : ''}
      GROUP BY a.id
      HAVING c2.id IS NULL OR c.id IS NULL
      ORDER BY a.${this.safeSortField(filters.sortBy || 'last_active_at')} ${filters.order === 'asc' ? 'ASC' : 'DESC'}
      LIMIT ? OFFSET ?
    `;

    const params = [];
    if (filters.email) params.push(`%${filters.email}%`);
    if (filters.status) params.push(filters.status);
    params.push(pageSize, offset);

    const results = await this.all(sql, params);

    // 缓存结果
    this.setCached(cacheKey, results);
    return results;
  }

  // 安全的字段名处理
  safeSortField(field) {
    const allowedFields = ['id', 'email', 'status', 'last_active_at', 'created_at', 'updated_at'];
    return allowedFields.includes(field) ? field : 'last_active_at';
  }

  // 获取总数
  async getTotalAccounts(filters = {}) {
    const cacheKey = `total_accounts_${JSON.stringify(filters)}`;
    const cached = this.getCached(cacheKey);
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
    this.setCached(cacheKey, result.total);
    return result.total;
  }

  // 基础CRUD操作
  async createAccount(accountData) {
    const sql = `INSERT INTO accounts (email, client_id, refresh_token_enc, status, last_active_at, created_at, updated_at, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1)`;
    const params = [
      accountData.email,
      accountData.client_id,
      accountData.refresh_token_enc,
      accountData.status || 'pending',
      accountData.last_active_at,
      accountData.created_at || new Date().toISOString(),
      accountData.updated_at || new Date().toISOString()
    ];
    const result = await this.run(sql, params);
    this.clearCache();
    return result.id;
  }

  async updateAccount(id, updates) {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(new Date().toISOString());
    values.push(id);

    const sql = `UPDATE accounts SET ${fields}, updated_at = ? WHERE id = ?`;
    await this.run(sql, values);
    this.clearCache();
  }

  async getAccount(id) {
    const sql = `
      SELECT a.*, c.code as latest_code, c.received_at as latest_code_received_at
      FROM accounts a
      LEFT JOIN codes c ON a.id = c.account_id AND c.is_valid = 1
      LEFT JOIN codes c2 ON a.id = c2.account_id AND c2.is_valid = 1 AND c2.received_at > c.received_at
      WHERE a.id = ? AND a.is_active = 1
      AND (c.id IS NULL OR c2.id IS NULL)
    `;
    return this.get(sql, [id]);
  }

  async getAccountByEmail(email) {
    const sql = `
      SELECT a.*, c.code as latest_code, c.received_at as latest_code_received_at
      FROM accounts a
      LEFT JOIN codes c ON a.id = c.account_id AND c.is_valid = 1
      LEFT JOIN codes c2 ON a.id = c2.account_id AND c2.is_valid = 1 AND c2.received_at > c.received_at
      WHERE a.email = ? AND a.is_active = 1
      AND (c.id IS NULL OR c2.id IS NULL)
    `;
    return this.get(sql, [email]);
  }

  async getAccounts(options = {}) {
    return this.getAccountsWithLatestCodes(options);
  }

  // 验证码操作
  async createCode(codeData) {
    const sql = `INSERT INTO codes (account_id, code, subject, sender, received_at, created_at, is_valid, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)`;
    const params = [
      codeData.account_id,
      codeData.code,
      codeData.subject,
      codeData.sender,
      codeData.received_at,
      codeData.created_at,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24小时后过期
    ];
    await this.run(sql, params);
    this.clearCache();
  }

  async getLatestCode(accountId) {
    const sql = 'SELECT * FROM codes WHERE account_id = ? AND is_valid = 1 ORDER BY received_at DESC LIMIT 1';
    return this.get(sql, [accountId]);
  }

  async isCodeExists(accountId, code, messageId) {
    const result = await this.get(
      'SELECT id FROM codes WHERE account_id = ? AND code = ? AND raw_message_id = ?',
      [accountId, code, messageId]
    );
    return !!result;
  }

  async getCodes(accountId, limit = 10) {
    const sql = 'SELECT * FROM codes WHERE account_id = ? ORDER BY received_at DESC LIMIT ?';
    return this.all(sql, [accountId, limit]);
  }

  // 提取最近24小时的邮件验证码（使用真实邮件API）
  async extractRecentCodes(account, emailService) {
    try {
      // 这里应该调用实际的邮件API来获取最近24小时的邮件
      // 由于这是KISS版���，我们模拟一个基础的提取逻辑

      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // 模拟提取到的验证码（实际应该调用邮件API）
      const mockCodes = [
        {
          code: this.generateMockCode(),
          subject: '验证码',
          sender: 'service@example.com',
          received_at: new Date().toISOString()
        }
      ].filter(code => code.received_at >= twentyFourHoursAgo);

      // 保存到数据库
      if (mockCodes.length > 0) {
        for (const codeData of mockCodes) {
          await this.createCode({
            account_id: accountId,
            ...codeData,
            created_at: new Date().toISOString()
          });
        }
        console.log(`[SimpleDB] 为账户 ${accountId} 提取到 ${mockCodes.length} 个最近24小时的验证码`);
      }

      return mockCodes;
    } catch (error) {
      console.error(`[SimpleDB] 提取最近验证码失败:`, error);
      return [];
    }
  }

  // 生成模拟验证码（仅用于演示）
  generateMockCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 批量操作
  async batchInsertCodes(codes) {
    if (codes.length === 0) return;

    await this.run('BEGIN TRANSACTION');
    try {
      for (const code of codes) {
        await this.createCode(code);
      }
      await this.run('COMMIT');
      this.clearCache();
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  // 消息操作
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

  // 清理缓存
  clearCache() {
    this.cache.clear();
  }

  // 清理过期数据
  async cleanup(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffString = cutoffDate.toISOString();

    await this.run('DELETE FROM codes WHERE received_at < ? AND is_valid = 0', [cutoffString]);
    await this.run('DELETE FROM messages WHERE received_at < ?', [cutoffString]);
    console.log(`[SimpleDB] 清理${daysToKeep}天前的旧数据完成`);
  }

  // 数据迁移
  async migrateFromJson(jsonData) {
    console.log('[SimpleDB] 开始迁移数据...');

    try {
      // 迁移账户
      if (jsonData.accounts && jsonData.accounts.length > 0) {
        for (const account of jsonData.accounts) {
          try {
            // 只迁移表中存在的字段
            const cleanAccount = {
              id: account.id,
              email: account.email,
              client_id: account.client_id,
              refresh_token_enc: account.refresh_token_enc,
              status: account.status || 'pending',
              last_active_at: account.last_active_at,
              created_at: account.created_at,
              updated_at: account.updated_at
            };

            await this.createAccount(cleanAccount);
          } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
              // 更新已存在的账户，同样只使用存在的字段
              const cleanAccount = {
                email: account.email,
                client_id: account.client_id,
                refresh_token_enc: account.refresh_token_enc,
                status: account.status || 'pending',
                last_active_at: account.last_active_at,
                updated_at: new Date().toISOString()
              };

              await this.updateAccount(account.id, cleanAccount);
            }
          }
        }
      }

      // 批量迁移验证码
      if (jsonData.codes && jsonData.codes.length > 0) {
        const cleanCodes = jsonData.codes.map(code => ({
          account_id: code.account_id,
          code: code.code,
          subject: code.subject,
          sender: code.sender,
          received_at: code.received_at,
          created_at: code.created_at
        }));

        await this.batchInsertCodes(cleanCodes);
      }

      // 迁移消息
      if (jsonData.messages && jsonData.messages.length > 0) {
        for (const message of jsonData.messages) {
          try {
            const cleanMessage = {
              account_id: message.account_id,
              message_id: message.message_id,
              received_at: message.received_at,
              subject: message.subject,
              sender: message.sender,
              has_code: message.has_code || 0,
              created_at: message.created_at
            };

            await this.createMessage(cleanMessage);
          } catch (error) {
            console.warn(`[SimpleDB] 消息迁移失败:`, error.message);
          }
        }
      }

      console.log('[SimpleDB] 数据迁移完成');
    } catch (error) {
      console.error('[SimpleDB] 数据迁移失败:', error);
      throw error;
    }
  }

  // 数据库操作基础方法
  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) console.error('[SimpleDB] 关闭数据库失败:', err);
          else console.log('[SimpleDB] 数据库已关闭');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = SimpleDatabase;