'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// 简化配置管理
const config = {
  port: process.env.PORT || 3000,
  dataDir: path.join(__dirname, '..', 'data'),
  outlook: {
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    apiUrl: 'https://outlook.office.com/api/v2.0/me/messages'
  }
};

const app = express();

// storage (JSON file-based)
const fs = require('fs');
if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
const storePath = path.join(config.dataDir, 'store.json');
if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, JSON.stringify({
  accounts: [], // {id,email,client_id,refresh_token_enc,status,import_seq,last_active_at,delta_link,created_at,updated_at}
  codes: [],    // {id,account_id,code,source,subject,sender,received_at,raw_message_id,created_at}
  messages: []  // {id,account_id,message_id,received_at,subject,sender,has_code,created_at}
}, null, 2));
function load(){ return JSON.parse(fs.readFileSync(storePath, 'utf8')); }
function save(data){ fs.writeFileSync(storePath, JSON.stringify(data, null, 2)); }
function nextId(arr){ return (arr.reduce((m,x)=> Math.max(m, x.id||0), 0) + 1); }

app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 统一错误处理中间件
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
      console.error('[Error]', err.message || err);
      res.status(500).json({ error: '服务错误，请重试' });
    });
  };
}

// helpers
function nowIso(){ return new Date().toISOString(); }
function encryptPlaceholder(t){ return t || null; } // keep plain for PoC
function decryptPlaceholder(t){ return t || null; }

function extractCodeFromText(text){
  if (!text) return null;
  const cleaned = String(text).replace(/\s+/g, ' ');
  console.log(`[ExtractCode] 开始提取验证码，文本长度: ${text.length}`);
  console.log(`[ExtractCode] 文本内容: "${text.substring(0, 200)}..."`);

  // 高精度验证码检测算法
  // 严格优先：纯数字 > 字母数字混合 > 其他

  // 预过滤：排除明显的英文单词（只包含字母的4-8位单词）
  const cleanText = cleaned.replace(/\b[A-Za-z]{4,8}\b/g, '');
  console.log(`[ExtractCode] 预过滤后的文本: "${cleanText.substring(0, 200)}..."`);

  // 1) 优先级1: 明确关键词后的验证码
  const exactPatterns = [
    // 中文关键词
    /(?:验证码|校验码|动态码|安全码|确认码)[：:\s\-]{0,3}(\d{4,8})/i,
    // 英文关键词
    /(?:verification\s*code|security\s*code|confirm\s*code|access\s*code)[：:\s\-]{0,3}(\d{4,8})/i,
    // 常见服务特定关键词
    /(?:otp|one\s*time\s*password|pin|code)[：:\s\-]{0,3}(\d{4,8})/i
  ];

  for (const pattern of exactPatterns) {
    const match = cleanText.match(pattern);
    if (match && isLikelyCode(match[1])) {
      return match[1];
    }
  }

  // 2) 优先级2: 上下文相关的验证码
  // 登录相关
  const loginContext = cleanText.match(/(?:login|sign\s*in|log\s*in|auth|authenticate)[^0-9]{0,20}(\d{4,8})/i);
  if (loginContext && isLikelyCode(loginContext[1])) {
    return loginContext[1];
  }

  // 3) 优先级3: 孤立的4-8位数字（验证码最常见格式，优先于字母数字混合）
  const standaloneNumbers = cleanText.match(/\b(\d{4,8})\b/g);
  if (standaloneNumbers) {
    console.log(`[ExtractCode] 找到独立数字: ${standaloneNumbers.join(', ')}`);

    // 过滤掉常见的非验证码数字
    const filtered = standaloneNumbers.filter(num => {
      const intNum = parseInt(num);
      // 排除年份、常见端口号等
      if (intNum >= 1900 && intNum <= 2100) return false; // 年份
      if (intNum === 1234 || intNum === 1111 || intNum === 0) return false; // 常见测试码
      if (intNum >= 8000 && intNum <= 9999) return false; // 常见端口范围

      // 检查是否在验证码上下文中
      const context = cleanText.substring(Math.max(0, cleanText.indexOf(num) - 50),
                                      Math.min(cleanText.length, cleanText.indexOf(num) + num.length + 50));
      return hasCodeContext(context);
    });

    if (filtered.length > 0) {
      console.log(`[ExtractCode] 过滤后数字: ${filtered.join(', ')}, 优先选择第一个: ${filtered[0]}`);
      return filtered[0]; // 优先返回纯数字验证码
    }
  }

  // 4) 优先级4: 字母数字混合验证码（���在无纯数字时考虑）
  // 注意：严格限制只选择纯数字，避免提取"directly"等英文词汇
  const alphaNumeric = cleanText.match(/\b([A-Za-z0-9]{4,8})\b/g);
  if (alphaNumeric) {
    console.log(`[ExtractCode] 找到字母数字混合: ${alphaNumeric.join(', ')}`);

    // 只选择包含数字的混合码，且必须以数字开头或结尾
    const withDigits = alphaNumeric.filter(code => {
      const hasDigit = /\d/.test(code);
      const startsOrEndsWithDigit = /^\d|\d$/.test(code);
      const hasEnoughDigits = (code.match(/\d/g) || []).length >= 2; // 至少2个数字

      return hasDigit && startsOrEndsWithDigit && hasEnoughDigits;
    });

    console.log(`[ExtractCode] 过滤后的混合码: ${withDigits.join(', ')}`);

    for (const candidate of withDigits) {
      if (isLikelyAlphaNumericCode(candidate)) {
        console.log(`[ExtractCode] 选择混合验证码: ${candidate}`);
        return candidate;
      }
    }
  }

  console.log('[ExtractCode] 未找到有效验证码');
  return null;
}

// 辅助函数：判断数字是否像验证码
function isLikelyCode(num) {
  // 验证码通常具有的特征
  const numStr = String(num);

  // 长度检查
  if (numStr.length < 4 || numStr.length > 8) return false;

  // 避免重复数字（如1111、2222）
  if (/^(\d)\1+$/.test(numStr)) return false;

  // 避免简单序列（如1234、5678）
  if (isSimpleSequence(numStr)) return false;

  return true;
}

// 辅助函数：判断字母数字混合码是否像验证码
function isLikelyAlphaNumericCode(code) {
  const upperCount = (code.match(/[A-Z]/g) || []).length;
  const digitCount = (code.match(/\d/g) || []).length;

  // 验证码通常包含至少一个数字
  if (digitCount === 0) return false;

  // 长度检查
  if (code.length < 4 || code.length > 8) return false;

  // 避免纯单词
  if (upperCount === code.length) return false;

  // 检查是否包含常见模式
  const commonPatterns = ['CODE', 'PASS', 'AUTH', 'OTP'];
  return !commonPatterns.some(pattern => code.toUpperCase().includes(pattern));
}

// 辅助函数：检查是否为简单序列
function isSimpleSequence(num) {
  const numStr = String(num);
  if (numStr.length < 3) return false;

  // 检查递增序列
  let isIncrementing = true;
  let isDecrementing = true;

  for (let i = 1; i < numStr.length; i++) {
    if (parseInt(numStr[i]) !== parseInt(numStr[i-1]) + 1) {
      isIncrementing = false;
    }
    if (parseInt(numStr[i]) !== parseInt(numStr[i-1]) - 1) {
      isDecrementing = false;
    }
    if (!isIncrementing && !isDecrementing) {
      return false;
    }
  }

  return isIncrementing || isDecrementing;
}

// 辅助函数：检查上下文是否包含验证码相关词汇
function hasCodeContext(context) {
  const codeKeywords = [
    'code', 'verify', 'verification', 'auth', 'login', 'password', 'pin', 'otp',
    '验证码', '校验码', '动态码', '安全码', '登录', '密码'
  ];

  const lowerContext = context.toLowerCase();
  return codeKeywords.some(keyword => lowerContext.includes(keyword));
}

async function refreshAccessTokenOutlook(refreshToken, clientId){
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshToken);
  const res = await fetch(config.outlook.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!res.ok) throw new Error('token http ' + res.status);
  const j = await res.json();
  if (j.error) throw new Error(j.error + ': ' + j.error_description);
  return j; // contains access_token, refresh_token?
}

async function fetchLatestMessageOutlook(accessToken){
  const url = `${config.outlook.apiUrl}?$top=1&$orderby=ReceivedDateTime desc&$select=Id,Subject,From,ReceivedDateTime,BodyPreview`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!res.ok) throw new Error('outlook http ' + res.status);
  const j = await res.json();
  const item = j && j.value && j.value[0];
  return item || null;
}

async function fetchRecentMessagesOutlook(accessToken, top){
  const url = `${config.outlook.apiUrl}?$top=${top}&$orderby=ReceivedDateTime desc&$select=Id,Subject,From,ReceivedDateTime,BodyPreview`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!res.ok) throw new Error('outlook http ' + res.status);
  const j = await res.json();
  return (j && j.value) || [];
}

async function fetchMessageFullOutlook(accessToken, id){
  const url = `${config.outlook.apiUrl}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!res.ok) throw new Error('outlook http ' + res.status);
  return await res.json();
}

// routes
app.get('/', (req, res) => {
  const sort = req.query.sort || 'last_active_at';
  const order = (req.query.order || 'desc').toLowerCase();
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.size) || 10;

  const data = load();
  let rows = data.accounts.slice();

  // 搜索过滤
  if (q) {
    rows = rows.filter(r =>
      r.email.toLowerCase().includes(q.toLowerCase()) ||
      r.status.toLowerCase().includes(q.toLowerCase())
    );
  }

  // 排序
  rows.sort((a,b) => {
    let av = a[sort] || '';
    let bv = b[sort] || '';

    // 特殊处理日期字段
    if (sort === 'last_active_at' || sort === 'created_at' || sort === 'updated_at') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    }

    if (av === bv) return 0;
    return (order === 'asc') ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  // 分页
  const total = rows.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const paginatedRows = rows.slice(start, start + pageSize);

  // 添加最新验证码信息
  const accounts = paginatedRows.map(r => {
    const latest = data.codes
      .filter(c => c.account_id === r.id)
      .sort((a,b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0];

    // 过滤非数字验证码：只显示纯数字的验证码
    const filteredLatest = latest && /^\d+$/.test(latest.code) ? latest : null;

    return { ...r, latestCode: filteredLatest };
  });

  res.render('accounts', {
    title: '账户',
    accounts,
    sort,
    order,
    q,
    pagination: {
      current: page,
      total: totalPages,
      pageSize,
      totalItems: total
    }
  });
});

// import page
app.get('/import', (req, res) => {
  res.render('import', { title: '导入' });
});

app.post('/accounts/import/preview', (req, res) => {
  const text = req.body?.text || '';
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const data = load();
  let seqBase = data.accounts.reduce((m,x)=> Math.max(m, x.import_seq||0), 0);
  const rows = lines.map((raw, idx) => {
    // 简化解析：使用正则表达式一次性提取4个部分
    const match = raw.match(/^([^@\s]+@outlook\.com)----(.+?)----([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})----(.+)$/);

    if (!match) {
      return { raw, parseStatus: '格式错误：账号----密码----clientId----授权码', acceptable: false, importSeq: seqBase + idx + 1 };
    }

    const [, email, password, clientId, codeLike] = match;

    return {
      raw,
      email,
      clientId,
      codeLike: codeLike.trim(),
      parseStatus: 'OK',
      acceptable: true,
      importSeq: seqBase + idx + 1
    };
  });
  res.json({ rows });
});

app.post('/accounts/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const data = load();
  const now = nowIso();
  for (const r of rows){
    // sanitize token (remove accidental heredoc markers and trailing whitespace)
    if (r.codeLike) {
      r.codeLike = String(r.codeLike).replace(/\n?EOF\n?$/,'').trim();
    }
    const exists = data.accounts.find(a => a.email === r.email && a.client_id === r.clientId);
    if (exists){
      exists.updated_at = now;
      if (r.codeLike) { exists.refresh_token_enc = encryptPlaceholder(r.codeLike); exists.status = 'authorized'; }
      continue;
    }
    data.accounts.push({
      id: nextId(data.accounts),
      email: r.email,
      client_id: r.clientId,
      refresh_token_enc: r.codeLike ? encryptPlaceholder(r.codeLike) : null,
      status: r.codeLike ? 'authorized' : 'pending',
      import_seq: r.importSeq,
      last_active_at: null,
      delta_link: null,
      created_at: now,
      updated_at: now
    });
  }
  save(data);
  res.json({ ok: true, count: rows.length });
});

app.post('/accounts/:id/pickup', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const data = load();
  const acc = data.accounts.find(a => a.id === id);
  if (!acc) return res.status(404).send('not found');

  let rt = decryptPlaceholder(acc.refresh_token_enc);
  if (rt) rt = String(rt).replace(/\s+$/,'').replace(/\n?EOF\n?$/,'');
  if (!rt) return res.status(400).send('no refresh_token');

  const tok = await refreshAccessTokenOutlook(rt, acc.client_id);
  if (tok.refresh_token && tok.refresh_token !== rt){
    acc.refresh_token_enc = encryptPlaceholder(tok.refresh_token);
    acc.updated_at = nowIso();
    save(data);
  }

  const msg = await fetchLatestMessageOutlook(tok.access_token);
  if (!msg){ return res.json({ ok: true, message: 'no messages' }); }

  const received = msg.ReceivedDateTime;
  const subject = msg.Subject || '';
  const sender = (msg.From && msg.From.EmailAddress && msg.From.EmailAddress.Address) || '';
  const preview = msg.BodyPreview || '';
  const code = extractCodeFromText(subject + ' ' + preview);

  // messages
  if (!data.messages.find(m => m.account_id === id && m.message_id === msg.Id)){
    data.messages.push({ id: nextId(data.messages), account_id: id, message_id: msg.Id, received_at: received, subject, sender, has_code: code ? 1 : 0, created_at: nowIso() });
  }
  if (code){
    data.codes.push({ id: nextId(data.codes), account_id: id, code, source: null, subject, sender, received_at: received, raw_message_id: msg.Id, created_at: nowIso() });
  }
  acc.last_active_at = received;
  acc.updated_at = nowIso();
  save(data);
  res.json({ ok: true, received_at: received, code: code || null });
}));

// 立即检查账户新邮件 (智能触发用)
app.post('/accounts/:id/check-now', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const data = load();
  const acc = data.accounts.find(a => a.id === id);
  if (!acc) return res.status(404).json({ error: '账户不存在' });

  let rt = decryptPlaceholder(acc.refresh_token_enc);
  if (rt) rt = String(rt).replace(/\s+$/,'').replace(/\n?EOF\n?$/,'');
  if (!rt) return res.status(400).json({ error: '无有效令牌' });

  try {
    const tok = await refreshAccessTokenOutlook(rt, acc.client_id);
    if (tok.refresh_token && tok.refresh_token !== rt){
      acc.refresh_token_enc = encryptPlaceholder(tok.refresh_token);
      acc.updated_at = nowIso();
      save(data);
    }

    const msg = await fetchLatestMessageOutlook(tok.access_token);
    if (!msg) {
      return res.json({
        ok: true,
        newMessages: 0,
        message: '暂无新邮件'
      });
    }

    const received = msg.ReceivedDateTime;
    const subject = msg.Subject || '';
    const sender = (msg.From && msg.From.EmailAddress && msg.From.EmailAddress.Address) || '';
    const preview = msg.BodyPreview || '';
    const code = extractCodeFromText(subject + ' ' + preview);

    // 检查是否为新消息
    const existingMessage = data.messages.find(m => m.account_id === id && m.message_id === msg.Id);
    let newMessagesCount = 0;

    if (!existingMessage) {
      data.messages.push({
        id: nextId(data.messages),
        account_id: id,
        message_id: msg.Id,
        received_at: received,
        subject,
        sender,
        has_code: code ? 1 : 0,
        created_at: nowIso()
      });
      newMessagesCount = 1;
    }

    if (code && (!existingMessage || !data.codes.find(c => c.account_id === id && c.raw_message_id === msg.Id))) {
      data.codes.push({
        id: nextId(data.codes),
        account_id: id,
        code,
        source: null,
        subject,
        sender,
        received_at: received,
        raw_message_id: msg.Id,
        created_at: nowIso()
      });
    }

    acc.last_active_at = received;
    acc.updated_at = nowIso();
    save(data);

    res.json({
      ok: true,
      newMessages: newMessagesCount,
      received_at: received,
      code: code || null,
      subject: subject,
      sender: sender
    });
  } catch (error) {
    console.error('[Check Now Error]', error);
    res.status(500).json({ error: '检查失败', message: error.message });
  }
}));

// 基于邮箱立即检查 (智能触发用)
app.post('/api/check-email-now', asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: '缺少邮箱参数' });

  const data = load();
  const acc = data.accounts.find(a => a.email === email);
  if (!acc) return res.status(404).json({ error: '账户不存在' });

  let rt = decryptPlaceholder(acc.refresh_token_enc);
  if (rt) rt = String(rt).replace(/\s+$/,'').replace(/\n?EOF\n?$/,'');
  if (!rt) return res.status(400).json({ error: '无有效令牌' });

  try {
    const tok = await refreshAccessTokenOutlook(rt, acc.client_id);
    if (tok.refresh_token && tok.refresh_token !== rt){
      acc.refresh_token_enc = encryptPlaceholder(tok.refresh_token);
      acc.updated_at = nowIso();
      save(data);
    }

    const msg = await fetchLatestMessageOutlook(tok.access_token);
    if (!msg) {
      return res.json({
        ok: true,
        newMessages: 0,
        message: '暂无新邮件'
      });
    }

    const received = msg.ReceivedDateTime;
    const subject = msg.Subject || '';
    const sender = (msg.From && msg.From.EmailAddress && msg.From.EmailAddress.Address) || '';
    const preview = msg.BodyPreview || '';
    const code = extractCodeFromText(subject + ' ' + preview);

    // 检查是否为新消息
    const existingMessage = data.messages.find(m => m.account_id === acc.id && m.message_id === msg.Id);
    let newMessagesCount = 0;

    if (!existingMessage) {
      data.messages.push({
        id: nextId(data.messages),
        account_id: acc.id,
        message_id: msg.Id,
        received_at: received,
        subject,
        sender,
        has_code: code ? 1 : 0,
        created_at: nowIso()
      });
      newMessagesCount = 1;
    }

    if (code && (!existingMessage || !data.codes.find(c => c.account_id === acc.id && c.raw_message_id === msg.Id))) {
      data.codes.push({
        id: nextId(data.codes),
        account_id: acc.id,
        code,
        source: null,
        subject,
        sender,
        received_at: received,
        raw_message_id: msg.Id,
        created_at: nowIso()
      });
    }

    acc.last_active_at = received;
    acc.updated_at = nowIso();
    save(data);

    res.json({
      ok: true,
      newMessages: newMessagesCount,
      received_at: received,
      code: code || null,
      subject: subject,
      sender: sender
    });
  } catch (error) {
    console.error('[Check Email Now Error]', error);
    res.status(500).json({ error: '检查失败', message: error.message });
  }
}));

// recent messages (last 3)
app.get('/accounts/:id/recent', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const data = load();
  const acc = data.accounts.find(a => a.id === id);
  if (!acc) return res.status(404).send('not found');

  let rt = decryptPlaceholder(acc.refresh_token_enc);
  if (!rt) return res.status(400).send('no refresh_token');
  rt = String(rt).replace(/\s+$/,'').replace(/\n?EOF\n?$/,'');

  const tok = await refreshAccessTokenOutlook(rt, acc.client_id);
  const items = await fetchRecentMessagesOutlook(tok.access_token, 3);
  const list = items.map(m => ({
    id: m.Id,
    subject: m.Subject || '',
    sender: (m.From && m.From.EmailAddress && m.From.EmailAddress.Address) || '',
    received_at: m.ReceivedDateTime,
    preview: m.BodyPreview || ''
  }));
  res.json({ ok: true, items: list });
}));

// message detail (full content)
app.get('/accounts/:id/messages/:mid', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const mid = req.params.mid;
  const data = load();
  const acc = data.accounts.find(a => a.id === id);
  if (!acc) return res.status(404).send('not found');

  let rt = decryptPlaceholder(acc.refresh_token_enc);
  if (!rt) return res.status(400).send('no refresh_token');
  rt = String(rt).replace(/\s+$/,'').replace(/\n?EOF\n?$/,'');

  const tok = await refreshAccessTokenOutlook(rt, acc.client_id);
  const full = await fetchMessageFullOutlook(tok.access_token, mid);
  res.json({ ok: true, message: full });
}));

// 实时邮件检测系统
class EmailMonitor {
  constructor() {
    this.isRunning = false;
    this.interval = null;
    this.clients = new Set(); // SSE客户端连接
    this.checkInterval = 5000; // 5秒检测一次
    this.lastCheckTime = new Date();
  }

  // 启动监控
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[EmailMonitor] 启动邮件监控，检测间隔:', this.checkInterval / 1000, '秒');

    this.interval = setInterval(() => {
      this.checkAllAccounts();
    }, this.checkInterval);

    // 立即执行一次检测
    this.checkAllAccounts();
  }

  // 停止监控
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[EmailMonitor] 停止邮件监控');
  }

  // 更新检查间隔
  updateCheckInterval(newInterval) {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.checkInterval = newInterval;
    console.log(`[EmailMonitor] 检查间隔已更新为 ${newInterval}ms`);

    if (wasRunning) {
      this.start();
    }
  }

  // 添加SSE客户端
  addClient(res) {
    this.clients.add(res);
    console.log(`[EmailMonitor] 新的SSE客户端连接，当前连接数: ${this.clients.size}`);

    res.on('close', () => {
      this.clients.delete(res);
      console.log(`[EmailMonitor] 客户端断开连接，当前连接数: ${this.clients.size}`);
    });

    // 发送初始状态
    this.sendToClient(res, {
      type: 'connected',
      timestamp: new Date().toISOString(),
      message: '邮件监控已连接'
    });
  }

  // 向单个客户端发送消息
  sendToClient(res, data) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error('[EmailMonitor] 发送消息失败:', error);
      this.clients.delete(res);
    }
  }

  // 向所有客户端广播消息
  broadcast(data) {
    if (this.clients.size === 0) return;

    console.log(`[EmailMonitor] 广播消息给 ${this.clients.size} 个客户端:`, data.type);

    this.clients.forEach(client => {
      this.sendToClient(client, data);
    });
  }

  // 检查所有账户的新邮件
  async checkAllAccounts() {
    if (!this.isRunning) return;

    try {
      const data = load();
      const accounts = data.accounts.filter(a => a.status === 'authorized' && a.refresh_token_enc);

      console.log(`[EmailMonitor] 开始检查 ${accounts.length} 个账户的新邮件...`);

      const results = await Promise.allSettled(
        accounts.map(account => this.checkAccount(account, data))
      );

      // 统计结果
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const newCodes = results.filter(r =>
        r.status === 'fulfilled' && r.value.hasNewCode
      ).length;

      this.lastCheckTime = new Date();

      if (newCodes > 0) {
        this.broadcast({
          type: 'new_codes_detected',
          count: newCodes,
          timestamp: this.lastCheckTime.toISOString(),
          message: `发现 ${newCodes} 个新的验证码`
        });
      }

      console.log(`[EmailMonitor] 检查完成: 成功 ${successful}/${accounts.length}, 新验证码 ${newCodes} 个`);

    } catch (error) {
      console.error('[EmailMonitor] 检查邮件时出错:', error);
      this.broadcast({
        type: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 检查单个账户的新邮件
  async checkAccount(account, data) {
    try {
      let rt = decryptPlaceholder(account.refresh_token_enc);
      if (rt) rt = String(rt).replace(/\s+$/,'').replace(/\n?EOF\n?$/,'');
      if (!rt) throw new Error('无有效refresh_token');

      const tok = await refreshAccessTokenOutlook(rt, account.client_id);

      // 如果获得新的refresh_token，更新存储
      if (tok.refresh_token && tok.refresh_token !== rt) {
        account.refresh_token_enc = encryptPlaceholder(tok.refresh_token);
        account.updated_at = nowIso();
        save(data);
      }

      const msg = await fetchLatestMessageOutlook(tok.access_token);
      if (!msg) {
        return { accountId: account.id, hasNewCode: false, message: '无邮件' };
      }

      const received = msg.ReceivedDateTime;
      const subject = msg.Subject || '';
      const sender = (msg.From && msg.From.EmailAddress && msg.From.EmailAddress.Address) || '';
      const preview = msg.BodyPreview || '';
      const code = extractCodeFromText(subject + ' ' + preview);

      // 检查是否为新消息
      const existingMessage = data.messages.find(m =>
        m.account_id === account.id && m.message_id === msg.Id
      );

      if (!existingMessage) {
        // 保存消息记录
        data.messages.push({
          id: nextId(data.messages),
          account_id: account.id,
          message_id: msg.Id,
          received_at: received,
          subject,
          sender,
          has_code: code ? 1 : 0,
          created_at: nowIso()
        });
      }

      let hasNewCode = false;
      if (code) {
        // 检查是否已有相同的验证码
        const existingCode = data.codes.find(c =>
          c.account_id === account.id &&
          c.code === code &&
          c.raw_message_id === msg.Id
        );

        if (!existingCode) {
          // 保存新验证码
          data.codes.push({
            id: nextId(data.codes),
            account_id: account.id,
            code,
            source: 'auto_detect',
            subject,
            sender,
            received_at: received,
            raw_message_id: msg.Id,
            created_at: nowIso()
          });
          hasNewCode = true;

          console.log(`[EmailMonitor] 发现新验证码 [${account.email}]: ${code}`);
        }
      }

      // 更新账户活跃时间
      account.last_active_at = received;
      account.updated_at = nowIso();
      save(data);

      return {
        accountId: account.id,
        email: account.email,
        hasNewCode,
        code: code || null,
        subject,
        sender,
        received_at: received,
        isNewMessage: !existingMessage
      };

    } catch (error) {
      console.error(`[EmailMonitor] 检查账户 ${account.email} 失败:`, error.message);
      return {
        accountId: account.id,
        email: account.email,
        hasNewCode: false,
        error: error.message
      };
    }
  }

  // 获取监控状态
  getStatus() {
    return {
      isRunning: this.isRunning,
      clientCount: this.clients.size,
      checkInterval: this.checkInterval,
      lastCheckTime: this.lastCheckTime,
      nextCheckTime: new Date(this.lastCheckTime.getTime() + this.checkInterval)
    };
  }
}

// 创建邮件监控实例
const emailMonitor = new EmailMonitor();

// SSE路由 - 实时推送
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  emailMonitor.addClient(res);
});

// API路由 - 获取监控状态
app.get('/api/monitor/status', (req, res) => {
  res.json(emailMonitor.getStatus());
});

// API路由 - 手动触发检查
app.post('/api/monitor/check', asyncHandler(async (req, res) => {
  const newCodesCount = await emailMonitor.checkAllAccounts();
  res.json({
    ok: true,
    message: '手动检查已触发',
    newCodesCount
  });
}));

// API路由 - 更新检查间隔
app.post('/api/monitor/interval', asyncHandler(async (req, res) => {
  const { interval } = req.body;
  if (interval && interval >= 5000) {
    emailMonitor.updateCheckInterval(interval);
    res.json({ ok: true, message: '检查间隔已更新' });
  } else {
    res.status(400).json({ ok: false, message: '无效的检查间隔' });
  }
}));

// API路由 - 启动/停止监控
app.post('/api/monitor/start', (req, res) => {
  emailMonitor.start();
  res.json({ ok: true, message: '监控已启动' });
});

app.post('/api/monitor/stop', (req, res) => {
  emailMonitor.stop();
  res.json({ ok: true, message: '监控已停止' });
});

// 启动邮件监控（服务器启动时自动开始）
setTimeout(() => {
  emailMonitor.start();
}, 2000); // 延迟2秒启动，确保服务器完全就绪

app.listen(config.port, () => {
  console.log(`[mailmanager] listening on http://localhost:${config.port}`);
  console.log('[mailmanager] 邮件监控将在2秒后自动启动');
});


