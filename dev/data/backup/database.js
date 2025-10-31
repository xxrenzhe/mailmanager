const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'mailmanager.db');
    this.ensureDataDir();
    this.db = null;
    this.init();
  }

  ensureDataDir() {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('[Database] 连接失败:', err);
          reject(err);
        } else {
          console.log('[Database] SQLite数据库已连接');
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
        import_seq INTEGER,
        last_active_at TEXT,
        delta_link TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

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
      )`,

      `CREATE TABLE IF NOT EXISTS monitor_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        session_type TEXT NOT NULL, -- 'pickup' | 'copy'
        status TEXT DEFAULT 'active', -- 'active' | 'stopped' | 'completed'
        check_interval INTEGER DEFAULT 5000,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        last_check_at TEXT,
        total_checks INTEGER DEFAULT 0,
        new_codes_found INTEGER DEFAULT 0,
        settings TEXT, -- JSON settings
        created_at TEXT NOT NULL,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)',
      'CREATE INDEX IF NOT EXISTS idx_codes_account_id ON codes(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_codes_received_at ON codes(received_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_messages_account_id ON messages(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id)',
      'CREATE INDEX IF NOT EXISTS idx_monitor_sessions_account_id ON monitor_sessions(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_monitor_sessions_status ON monitor_sessions(status)'
    ];

    try {
      for (const table of tables) {
        await this.run(table);
      }
      for (const index of indexes) {
        await this.run(index);
      }
      console.log('[Database] 数据库表和索引创建完成');
    } catch (error) {
      console.error('[Database] 创建表失败:', error);
      throw error;
    }
  }

  // 通用查询方法
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // 账户管理
  async createAccount(accountData) {
    const sql = `INSERT INTO accounts (email, client_id, refresh_token_enc, status, import_seq, last_active_at, delta_link, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
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
  }

  async getAccount(id) {
    return this.get('SELECT * FROM accounts WHERE id = ?', [id]);
  }

  async getAccountByEmail(email) {
    return this.get('SELECT * FROM accounts WHERE email = ?', [email]);
  }

  async getAccounts(filters = {}) {
    let sql = 'SELECT * FROM accounts WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.email) {
      sql += ' AND email LIKE ?';
      params.push(`%${filters.email}%`);
    }

    if (filters.sort) {
      const order = filters.order || 'desc';
      sql += ` ORDER BY ${filters.sort} ${order}`;
    }

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        sql += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    return this.all(sql, params);
  }

  async getTotalAccounts(filters = {}) {
    let sql = 'SELECT COUNT(*) as total FROM accounts WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.email) {
      sql += ' AND email LIKE ?';
      params.push(`%${filters.email}%`);
    }

    const result = await this.get(sql, params);
    return result.total;
  }

  // 验证码管理
  async createCode(codeData) {
    const sql = `INSERT INTO codes (account_id, code, source, subject, sender, received_at, raw_message_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      codeData.account_id,
      codeData.code,
      codeData.source,
      codeData.subject,
      codeData.sender,
      codeData.received_at,
      codeData.raw_message_id,
      codeData.created_at
    ];
    const result = await this.run(sql, params);
    return result.id;
  }

  async getLatestCode(accountId) {
    return this.get('SELECT * FROM codes WHERE account_id = ? AND code REGEXP "^[0-9]+$" ORDER BY received_at DESC LIMIT 1', [accountId]);
  }

  async getCodes(accountId, limit = 10) {
    return this.all('SELECT * FROM codes WHERE account_id = ? ORDER BY received_at DESC LIMIT ?', [accountId, limit]);
  }

  async isCodeExists(accountId, code, messageId) {
    const result = await this.get(
      'SELECT id FROM codes WHERE account_id = ? AND code = ? AND raw_message_id = ?',
      [accountId, code, messageId]
    );
    return !!result;
  }

  // 消息管理
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
    const result = await this.run(sql, params);
    return result.id;
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
      // 迁移账户
      for (const account of jsonData.accounts || []) {
        try {
          await this.createAccount(account);
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) {
            // 账户已存在，更新
            await this.updateAccount(account.id, {
              client_id: account.client_id,
              refresh_token_enc: account.refresh_token_enc,
              status: account.status,
              last_active_at: account.last_active_at,
              delta_link: account.delta_link
            });
          } else {
            throw error;
          }
        }
      }
      console.log(`[Database] 账户迁移完成: ${jsonData.accounts?.length || 0} 个`);

      // 迁移验证码
      for (const code of jsonData.codes || []) {
        try {
          await this.createCode(code);
        } catch (error) {
          console.warn(`[Database] 验证码迁移失败 ${code.id}:`, error.message);
        }
      }
      console.log(`[Database] 验证码迁移完成: ${jsonData.codes?.length || 0} 个`);

      // 迁移消息
      for (const message of jsonData.messages || []) {
        try {
          await this.createMessage(message);
        } catch (error) {
          console.warn(`[Database] 消息迁移失败 ${message.id}:`, error.message);
        }
      }
      console.log(`[Database] 消息迁移完成: ${jsonData.messages?.length || 0} 个`);

      console.log('[Database] 数据迁移完成');
    } catch (error) {
      console.error('[Database] 数据迁移失败:', error);
      throw error;
    }
  }

  // 清理旧数据
  async cleanupOldData(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffString = cutoffDate.toISOString();

    // 清理旧的验证码
    await this.run('DELETE FROM codes WHERE received_at < ?', [cutoffString]);

    // 清理旧的消息
    await this.run('DELETE FROM messages WHERE received_at < ?', [cutoffString]);

    // 清理旧的监控会话
    await this.run('DELETE FROM monitor_sessions WHERE started_at < ? AND status != "active"', [cutoffString]);

    console.log(`[Database] 清理 ${daysToKeep} 天前的旧数据完成`);
  }

  async close() {
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

module.exports = Database;