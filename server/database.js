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
          // 启用外键约束
          this.db.run('PRAGMA foreign_keys = ON', (pragmaErr) => {
            if (pragmaErr) {
              console.warn('[SimpleDB] 启用外键约束失败:', pragmaErr.message);
            } else {
              console.log('[SimpleDB] 外键约束已启用');
            }
            this.createTables().then(resolve).catch(reject);
          });
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
        access_token TEXT,
        access_token_expires_at TEXT,
        import_seq INTEGER,
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
      )`,

      `CREATE TABLE IF NOT EXISTS email_processing_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        processing_time_ms INTEGER,
        codes_found INTEGER DEFAULT 0,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`
    ];

    // 简单���引（只添加必要的）
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_accounts_sequence ON accounts(import_seq)',
      'CREATE INDEX IF NOT EXISTS idx_codes_account_id ON codes(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_codes_valid_received ON codes(is_valid, received_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_email_processing_account_id ON email_processing_history(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_email_processing_message_id ON email_processing_history(message_id)',
      'CREATE INDEX IF NOT EXISTS idx_email_processing_processed_at ON email_processing_history(processed_at)'
    ];

    // 数据库迁移 - 添加新列
    const migrations = [
      'ALTER TABLE accounts ADD COLUMN access_token TEXT',
      'ALTER TABLE accounts ADD COLUMN access_token_expires_at TEXT',
      'ALTER TABLE accounts ADD COLUMN import_seq INTEGER'
    ];

    try {
      for (const table of tables) {
        await this.run(table);
      }
      for (const index of indexes) {
        await this.run(index);
      }

      // 执行数据库迁移（忽略已存在的列错误）
      for (const migration of migrations) {
        try {
          await this.run(migration);
          console.log(`[SimpleDB] 执行迁移: ${migration}`);
        } catch (migrationError) {
          // 忽略"重复列名"错误，因为列可能已经存在
          if (!migrationError.message.includes('duplicate column name')) {
            console.warn(`[SimpleDB] 迁移警告: ${migrationError.message}`);
          }
        }
      }

      console.log('[SimpleDB] 表、索引和迁移完成');
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
    const { page = 1, pageSize = 50, filters = {}, sortBy = 'import_seq', order = 'asc' } = options;
    const offset = (page - 1) * pageSize;

    // 检查缓存
    const cacheKey = `accounts_${page}_${pageSize}_${JSON.stringify(filters)}_${sortBy}_${order}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // 单次查询获取账户和最新验证码 - 只显示数字验证码，优先使用邮件时间作为活跃时间
    const sql = `
      SELECT
        a.id, a.email, a.client_id, a.status, a.import_seq, a.created_at, a.updated_at,
        COALESCE(latest_email.received_at, a.last_active_at) as last_active_at,
        latest_code.code as latest_code,
        latest_code.received_at as latest_code_received_at,
        latest_code.sender as latest_code_sender,
        latest_code.subject as latest_code_subject
      FROM accounts a
      LEFT JOIN (
        SELECT DISTINCT
          account_id,
          received_at,
          code,
          sender,
          subject,
          ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY received_at DESC) as rn
        FROM codes
        WHERE is_valid = 1 AND code GLOB '*[0-9]*' AND code NOT GLOB '*[A-Za-z]*'
      ) latest_code ON a.id = latest_code.account_id AND latest_code.rn = 1
      LEFT JOIN (
        SELECT
          account_id,
          MAX(received_at) as received_at
        FROM codes
        WHERE is_valid = 1
        GROUP BY account_id
      ) latest_email ON a.id = latest_email.account_id
      WHERE a.is_active = 1
      ${filters.email ? 'AND a.email LIKE ?' : ''}
      ${filters.status ? 'AND a.status = ?' : ''}
      ORDER BY ${this.safeSortField(sortBy)} ${order === 'asc' ? 'ASC' : 'DESC'}
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

  // 获取下一个导入序号
  async getNextImportSequence() {
    const sql = 'SELECT COALESCE(MAX(import_seq), 0) + 1 as next_sequence FROM accounts';
    const result = await this.get(sql);
    return result.next_sequence;
  }

  // 安全的字段名处理
  safeSortField(field) {
    const allowedFields = ['id', 'email', 'status', 'last_active_at', 'latest_code_received_at', 'import_seq', 'created_at', 'updated_at'];
    return allowedFields.includes(field) ? field : 'import_seq';
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
    // 获取下一个序号
    const sequence = await this.getNextImportSequence();

    const sql = `INSERT INTO accounts (email, client_id, refresh_token_enc, import_seq, status, last_active_at, created_at, updated_at, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`;
    const params = [
      accountData.email,
      accountData.client_id,
      accountData.refresh_token_enc,
      sequence,
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

  // 更新访问令牌
  async updateAccessToken(id, accessToken, expiresIn) {
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const sql = `UPDATE accounts SET access_token = ?, access_token_expires_at = ?, updated_at = ? WHERE id = ?`;
    await this.run(sql, [accessToken, expiresAt, new Date().toISOString(), id]);
    this.clearCache();
    console.log(`[SimpleDB] 更新账户 ${id} 的access_token，过期时间: ${expiresAt}`);
  }

  // 获取有效的访问令牌
  async getValidAccessToken(id) {
    const sql = `
      SELECT access_token, access_token_expires_at
      FROM accounts
      WHERE id = ? AND access_token IS NOT NULL AND access_token_expires_at > datetime('now')
    `;
    const result = await this.get(sql, [id]);
    return result ? result.access_token : null;
  }

  async getAccount(id) {
    const sql = `
      SELECT a.*, c.code as latest_code, c.received_at as latest_code_received_at
      FROM accounts a
      LEFT JOIN codes c ON a.id = c.account_id AND c.is_valid = 1 AND c.code GLOB '*[0-9]*' AND c.code NOT GLOB '*[A-Za-z]*'
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
      LEFT JOIN codes c ON a.id = c.account_id AND c.is_valid = 1 AND c.code GLOB '*[0-9]*' AND c.code NOT GLOB '*[A-Za-z]*'
      LEFT JOIN codes c2 ON a.id = c2.account_id AND c2.is_valid = 1 AND c2.received_at > c.received_at
      WHERE a.email = ? AND a.is_active = 1
      AND (c.id IS NULL OR c2.id IS NULL)
    `;
    return this.get(sql, [email]);
  }

  // 完全删除账户及其所有相关数据
  async deleteAccountCompletely(id) {
    console.log(`[SimpleDB] 开始完全删除账户 ${id} 的所有数据...`);

    try {
      // 首先检查账户是否存在
      const account = await this.get('SELECT email FROM accounts WHERE id = ?', [id]);
      if (!account) {
        console.log(`[SimpleDB] 账户 ${id} 不存在，无需删除`);
        return false;
      }

      console.log(`[SimpleDB] 正在删除账户: ${account.email}`);

      // 由于外键约束设置了 ON DELETE CASCADE，删除账户会自动删除:
      // - codes 表中的所有相关验证码记录
      // - messages 表中的所有相关消息记录

      const result = await this.run('DELETE FROM accounts WHERE id = ?', [id]);

      if (result.changes > 0) {
        console.log(`[SimpleDB] 账户 ${account.email} 及其所有相关数据已完全删除`);
        this.clearCache(); // 清除缓存
        return true;
      } else {
        console.log(`[SimpleDB] 账户 ${id} 删除失败，可能已被删除`);
        return false;
      }
    } catch (error) {
      console.error(`[SimpleDB] 完全删除账户 ${id} 失败:`, error);
      throw error;
    }
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
    const sql = 'SELECT * FROM codes WHERE account_id = ? AND is_valid = 1 AND code GLOB \'*[0-9]*\' AND code NOT GLOB \'*[A-Za-z]*\' ORDER BY received_at DESC LIMIT 1';
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
    const sql = 'SELECT * FROM codes WHERE account_id = ? AND code GLOB \'*[0-9]*\' AND code NOT GLOB \'*[A-Za-z]*\' ORDER BY received_at DESC LIMIT ?';
    return this.all(sql, [accountId, limit]);
  }

  // 提取最近24小时的邮件验证码（使用真实邮件API）
  async extractRecentCodes(account, emailService) {
    try {
      if (!emailService) {
        console.warn('[SimpleDB] 未提供EmailService，无法提取验证码');
        return [];
      }

      const codes = await emailService.extractRecentCodes(account);

      // 保存到数据库
      if (codes.length > 0) {
        for (const codeData of codes) {
          await this.createCode({
            account_id: account.id,
            ...codeData,
            created_at: new Date().toISOString()
          });
        }
        console.log(`[SimpleDB] 为账户 ${account.id} 提取到 ${codes.length} 个最近24小时的验证码`);
      }

      return codes;
    } catch (error) {
      console.error(`[SimpleDB] 提取最近验证码失败:`, error);
      return [];
    }
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

  // 清空所有数据
  async clearAllData() {
    console.log('[SimpleDB] 开始清空所有数据...');

    await this.run('BEGIN TRANSACTION');

    try {
      // 清空所有表（按依赖关系倒序）
      await this.run('DELETE FROM messages');
      console.log('[SimpleDB] 已清空 messages 表');

      await this.run('DELETE FROM codes');
      console.log('[SimpleDB] 已清空 codes 表');

      await this.run('DELETE FROM accounts');
      console.log('[SimpleDB] 已清空 accounts 表');

      // 重置自增ID
      await this.run('DELETE FROM sqlite_sequence WHERE name IN ("accounts", "codes", "messages")');
      console.log('[SimpleDB] 已重置自增ID');

      await this.run('COMMIT');

      // 清空缓存
      this.clearCache();

      console.log('[SimpleDB] 所有数据清空完成');
    } catch (error) {
      await this.run('ROLLBACK');
      console.error('[SimpleDB] 清空数据失败:', error);
      throw error;
    }
  }

  // 批量插入方法 - 性能优化
  async batchInsert(table, data, batchSize = 100) {
    if (!data || data.length === 0) return [];

    const results = [];
    const fields = Object.keys(data[0]);
    const placeholders = fields.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`;

    await this.run('BEGIN TRANSACTION');

    try {
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const stmt = this.db.prepare(sql);

        for (const row of batch) {
          const values = fields.map(field => row[field]);
          stmt.run(values, function(err) {
            if (err) throw err;
            results.push({ id: this.lastID, changes: this.changes });
          });
        }

        stmt.finalize();
      }

      await this.run('COMMIT');
      console.log(`[SimpleDB] 批量插入完成: ${data.length} 条记录到 ${table} 表`);
      return results;
    } catch (error) {
      await this.run('ROLLBACK');
      console.error(`[SimpleDB] 批量插入失败:`, error);
      throw error;
    }
  }

  // 批量查询方法 - 减少数据库往返
  async batchGetAccountsByEmails(emails) {
    if (!emails || emails.length === 0) return [];

    const placeholders = emails.map(() => '?').join(', ');
    const sql = `
      SELECT id, email, import_seq
      FROM accounts
      WHERE email IN (${placeholders}) AND is_active = 1
    `;

    return await this.all(sql, emails);
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

  // 邮件处理历史记录操作
  async createEmailProcessingHistory(historyData) {
    const sql = `INSERT INTO email_processing_history (account_id, message_id, processed_at, processing_time_ms, codes_found, status, error_message)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      historyData.account_id,
      historyData.message_id,
      historyData.processed_at,
      historyData.processing_time_ms,
      historyData.codes_found,
      historyData.status || 'success',
      historyData.error_message || null
    ];
    return this.run(sql, params);
  }

  // 检查邮件是否已被处理过
  async isEmailProcessed(accountId, messageId) {
    const sql = 'SELECT id FROM email_processing_history WHERE account_id = ? AND message_id = ?';
    const result = await this.get(sql, [accountId, messageId]);
    return !!result;
  }

  // 获取最近的邮件处理历史
  async getRecentEmailProcessingHistory(accountId, limit = 10) {
    const sql = `SELECT * FROM email_processing_history
                   WHERE account_id = ?
                   ORDER BY processed_at DESC
                   LIMIT ?`;
    return this.all(sql, [accountId, limit]);
  }

  // 清理旧的邮件处理历史记录（保留最近30天）
  async cleanupEmailProcessingHistory(daysToKeep = 30) {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
    const sql = 'DELETE FROM email_processing_history WHERE processed_at < ?';
    return this.run(sql, [cutoffDate]);
  }

  // 获取邮件处理统计信息
  async getEmailProcessingStats(accountId, hours = 24) {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const sql = `SELECT
                    COUNT(*) as total_processed,
                    COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_processed,
                    COUNT(CASE WHEN codes_found > 0 THEN 1 END) as with_codes,
                    AVG(processing_time_ms) as avg_processing_time_ms,
                    MAX(processing_time_ms) as max_processing_time_ms,
                    MIN(processing_time_ms) as min_processing_time_ms
                   FROM email_processing_history
                   WHERE account_id = ? AND processed_at >= ?`;
    return this.get(sql, [accountId, cutoffTime]);
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