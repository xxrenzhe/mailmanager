'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const dayjs = require('dayjs');

const app = express();
const PORT = process.env.PORT || 3000;

// storage (JSON file-based)
const dataDir = path.join(__dirname, '..', 'data');
const fs = require('fs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const storePath = path.join(dataDir, 'store.json');
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

// helpers
function nowIso(){ return new Date().toISOString(); }
function encryptPlaceholder(t){ return t || null; } // keep plain for PoC
function decryptPlaceholder(t){ return t || null; }

function extractCodeFromText(text){
  if (!text) return null;
  const blacklist = new Set(['directly','click','please','link','code','verify','login']);
  const cleaned = String(text).replace(/\s+/g, ' ');
  // 1) Prefer digits after common keywords
  const reDigitZh = /(?:验证码|校验码|动态码)[^0-9]{0,8}(\b\d{4,8}\b)/i;
  const reDigitEn = /(?:verification\s*code|security\s*code)[^0-9A-Za-z]{0,8}(\b\d{4,8}\b)/i;
  let m = cleaned.match(reDigitZh) || cleaned.match(reDigitEn);
  if (m) return m[1];
  // 2) Allow alpha-numeric only if looks like code (uppercase/digits) and not blacklisted
  const reAlphaNum = /(?:验证码|校验码|动态码|verification\s*code|security\s*code)[^0-9A-Za-z]{0,8}(\b[A-Z0-9]{4,8}\b)/i;
  m = cleaned.match(reAlphaNum);
  if (m){
    const cand = m[1];
    const lower = cand.toLowerCase();
    const digitsRatio = (cand.replace(/\D/g,'').length) / cand.length;
    if (!blacklist.has(lower) && (/[A-Z]/.test(cand) || digitsRatio >= 0.5)) return cand;
  }
  // 3) Common 6-digit fallback
  m = cleaned.match(/\b\d{6}\b/);
  if (m) return m[0];
  // 4) Last resort: 4-8 digits
  m = cleaned.match(/\b\d{4,8}\b/);
  if (m) return m[0];
  return null;
}

async function refreshAccessTokenOutlook(refreshToken, clientId){
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshToken);
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
  const url = 'https://outlook.office.com/api/v2.0/me/messages?$top=1&$orderby=ReceivedDateTime desc&$select=Id,Subject,From,ReceivedDateTime,BodyPreview';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!res.ok) throw new Error('outlook http ' + res.status);
  const j = await res.json();
  const item = j && j.value && j.value[0];
  return item || null;
}

async function fetchRecentMessagesOutlook(accessToken, top){
  const url = `https://outlook.office.com/api/v2.0/me/messages?$top=${top}&$orderby=ReceivedDateTime desc&$select=Id,Subject,From,ReceivedDateTime,BodyPreview`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!res.ok) throw new Error('outlook http ' + res.status);
  const j = await res.json();
  return (j && j.value) || [];
}

async function fetchMessageFullOutlook(accessToken, id){
  const url = `https://outlook.office.com/api/v2.0/me/messages/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!res.ok) throw new Error('outlook http ' + res.status);
  return await res.json();
}

// routes
app.get('/', (req, res) => {
  const sort = req.query.sort || 'import_seq';
  const order = (req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const q = (req.query.q || '').trim();
  const data = load();
  let rows = data.accounts.slice();
  if (q) rows = rows.filter(r => r.email.includes(q));
  const key = (sort === 'last_active_at' ? 'last_active_at' : sort);
  rows.sort((a,b)=>{
    const av = a[key] || '';
    const bv = b[key] || '';
    if (av === bv) return 0;
    return (order === 'ASC' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1));
  });
  const accounts = rows.map(r => {
    const latest = data.codes.filter(c => c.account_id === r.id).sort((a,b)=> (a.received_at < b.received_at ? 1 : -1))[0];
    return { ...r, latestCode: latest || null };
  });
  res.render('accounts', { title: '账户', accounts, sort, order, q });
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
    // Robust parsing: email is before first '----'; token is after last '----'; clientId is UUID in the middle
    let email = '';
    let clientId = '';
    let codeLike = '';
    const firstSep = raw.indexOf('----');
    const lastSep = raw.lastIndexOf('----');
    if (firstSep > 0 && lastSep > firstSep){
      email = raw.slice(0, firstSep).trim();
      codeLike = raw.slice(lastSep + 4).trim();
      const middle = raw.slice(firstSep + 4, lastSep);
      const uuidMatch = middle.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      if (uuidMatch) clientId = uuidMatch[0];
    }
    let parseStatus = 'OK', verifyStatus = '', message = '';
    if (!email || !clientId) { parseStatus = '格式错误'; }
    const acceptable = parseStatus === 'OK';
    return { raw, email, clientId, codeLike, parseStatus, verifyStatus, message, acceptable, importSeq: seqBase + idx + 1 };
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

app.post('/accounts/:id/pickup', async (req, res) => {
  try {
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
  } catch (e){
    res.status(500).send(String(e.message || e));
  }
});

// recent messages (last 3)
app.get('/accounts/:id/recent', async (req, res) => {
  try {
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
  } catch (e){ res.status(500).send(String(e.message || e)); }
});

// message detail (full content)
app.get('/accounts/:id/messages/:mid', async (req, res) => {
  try {
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
  } catch (e){ res.status(500).send(String(e.message || e)); }
});

app.listen(PORT, () => {
  console.log(`[mailmanager] listening on http://localhost:${PORT}`);
});


