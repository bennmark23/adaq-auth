'use strict';
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
// Tolerate small clock drift / codes entered near the 30s boundary:
// accept the previous, current and next step (otplib default is window 0).
authenticator.options = { window: 1 };
const QRCode = require('qrcode');
const multer = require('multer');
const cors = require('cors');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { registerBotApi } = require('./botapi');
const { initScheduler } = require('./scheduler');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'adaq-jwt-change-me-in-prod';
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOADS = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'adaq.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  password_must_change INTEGER NOT NULL DEFAULT 0,
  avatar TEXT,
  theme TEXT NOT NULL DEFAULT 'dark',
  alerts_on INTEGER NOT NULL DEFAULT 1,
  username_changed_at INTEGER,
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  last_active INTEGER
);
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  used_by INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user INTEGER NOT NULL,
  to_user INTEGER,
  content TEXT NOT NULL,
  image_path TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  encrypted_mode TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entry TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

// seed admin
const adminRow = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
if (!adminRow) {
  const hash = bcrypt.hashSync('123456', 10);
  db.prepare('INSERT INTO users (username,password_hash,role,password_must_change,created_at,theme) VALUES (?,?,?,?,?,?)')
    .run('admin', hash, 'admin', 1, Date.now(), 'dark');
  console.log('Seeded admin (password: 123456, must change on first login)');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UPLOADS));

const upload = multer({ dest: UPLOADS, limits: { fileSize: 5 * 1024 * 1024 } });

function logActivity(userId, action, detail) {
  try { db.prepare('INSERT INTO activity_log (user_id,action,detail,created_at) VALUES (?,?,?,?)').run(userId, action, detail || null, Date.now()); } catch (e) {}
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(t, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    db.prepare('UPDATE users SET last_active=? WHERE id=?').run(Date.now(), user.id);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// WebSocket clients
const clients = new Map(); // userId -> Set of ws
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  // auth via query token
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');
  let user = null;
  try { const p = jwt.verify(token, JWT_SECRET); user = db.prepare('SELECT * FROM users WHERE id=?').get(p.id); } catch (e) {}
  if (!user) { ws.close(); return; }
  if (!clients.has(user.id)) clients.set(user.id, new Set());
  clients.get(user.id).add(ws);
  ws.on('close', () => { const s = clients.get(user.id); if (s) { s.delete(ws); if (!s.size) clients.delete(user.id); } });
  ws.send(JSON.stringify({ type: 'hello', userId: user.id }));
});

function broadcast(type, data, filterFn) {
  for (const [uid, set] of clients.entries()) {
    for (const ws of set) {
      try { if (!filterFn || filterFn(uid)) ws.send(JSON.stringify({ type, data })); } catch (e) {}
    }
  }
}

function isOnline(uid) { return clients.has(uid) && clients.get(uid).size > 0; }

// ---- Auth ----
app.post('/api/auth/login', (req, res) => {
  const { username, password, totp, adminMode } = req.body || {};
  // Admin link: only admin/subadmin can login
  // User link: only user can login (admin/subadmin rejected)
  let resolvedUsername = username;
  if (adminMode) resolvedUsername = 'admin'; // fixed username for admin
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(resolvedUsername);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Role separation
  if (adminMode && user.role === 'user') {
    return res.status(403).json({ error: 'This login is for administrators only.' });
  }
  if (!adminMode && (user.role === 'admin' || user.role === 'subadmin')) {
    return res.status(403).json({ error: 'Please use the administrator login link.' });
  }
  if (user.password_must_change) {
    return res.json({ mustChangePassword: true, token: signToken(user), user: publicUser(user) });
  }
  if (user.totp_enabled) {
    if (!totp) return res.status(401).json({ error: 'TOTP required', totpRequired: true });
    const ok = authenticator.verify({ token: String(totp || '').replace(/[\s-]/g, ''), secret: user.totp_secret });
    if (!ok) return res.status(401).json({ error: 'Invalid TOTP' });
  } else {
    // needs enrollment
    return res.json({ needsTotpEnroll: true, token: signToken(user), user: publicUser(user) });
  }
  db.prepare('UPDATE users SET last_login=?,last_active=? WHERE id=?').run(Date.now(), Date.now(), user.id);
  logActivity(user.id, 'login', null);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!bcrypt.compareSync(oldPassword || '', req.user.password_hash)) return res.status(401).json({ error: 'Wrong old password' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });
  const hash = bcrypt.hashSync(newPassword, 10);
  // Reuse a pending (not yet enabled) secret so going Back and re-submitting
  // does not invalidate a QR the user already scanned. Only generate a new
  // secret when none exists or TOTP is already enabled.
  const secret = (!req.user.totp_enabled && req.user.totp_secret)
    ? req.user.totp_secret
    : authenticator.generateSecret();
  db.prepare('UPDATE users SET password_hash=?,password_must_change=0,totp_secret=?,totp_enabled=0 WHERE id=?').run(hash, secret, req.user.id);
  const otpauth = authenticator.keyuri(req.user.username, 'ADAQ', secret);
  QRCode.toDataURL(otpauth, (err, url) => {
    if (err) return res.status(500).json({ error: 'QR failed' });
    res.json({ ok: true, totpSecret: secret, qr: url, needsTotpEnroll: true });
  });
});

app.post('/api/auth/enroll-totp', auth, (req, res) => {
  const { code } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user.totp_secret) return res.status(400).json({ error: 'No pending secret' });
  const ok = authenticator.verify({ token: String(code || '').replace(/[\s-]/g, ''), secret: user.totp_secret });
  if (!ok) return res.status(401).json({ error: 'Invalid code' });
  db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(user.id);
  logActivity(user.id, 'totp_enrolled', null);
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

function publicUser(u) {
  return {
    id: u.id, username: u.username, role: u.role,
    avatar: u.avatar, theme: u.theme, alerts_on: !!u.alerts_on,
    totp_enabled: !!u.totp_enabled, password_must_change: !!u.password_must_change,
    username_changed_at: u.username_changed_at, created_at: u.created_at,
    last_active: u.last_active, online: isOnline(u.id)
  };
}

// ---- Invitations ----
app.post('/api/invitations', auth, requireRole('admin', 'subadmin'), (req, res) => {
  const { role } = req.body || {};
  const r = (role === 'subadmin' && req.user.role === 'admin') ? 'subadmin' : 'user';
  // subadmin can only invite users
  const finalRole = req.user.role === 'subadmin' ? 'user' : (r === 'subadmin' ? 'subadmin' : 'user');
  const token = crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + 7 * 24 * 3600 * 1000;
  db.prepare('INSERT INTO invitations (token,role,created_by,expires_at,created_at) VALUES (?,?,?,?,?)').run(token, finalRole, req.user.id, expires, Date.now());
  logActivity(req.user.id, 'invite_created', finalRole);
  const base = req.headers.origin || `http://localhost:${PORT}`;
  res.json({ token, role: finalRole, link: `${base}/invite.html?token=${token}` });
});

app.get('/api/invitations', auth, requireRole('admin', 'subadmin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM invitations ORDER BY created_at DESC').all();
  res.json({ invitations: rows });
});

app.get('/api/invite/:token', (req, res) => {
  const inv = db.prepare('SELECT * FROM invitations WHERE token=?').get(req.params.token);
  if (!inv || inv.used || inv.expires_at < Date.now()) return res.status(404).json({ error: 'Invalid or expired invitation' });
  res.json({ role: inv.role });
});

app.post('/api/invite/:token/register', (req, res) => {
  const inv = db.prepare('SELECT * FROM invitations WHERE token=?').get(req.params.token);
  if (!inv || inv.used || inv.expires_at < Date.now()) return res.status(404).json({ error: 'Invalid or expired invitation' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 4) return res.status(400).json({ error: 'Invalid input' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Username taken' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username,password_hash,role,password_must_change,created_at,theme) VALUES (?,?,?,?,?,?)').run(username, hash, inv.role, 0, Date.now(), 'dark');
  // new users via invite: require password change? No, but require TOTP enrollment on first login? We'll set totp not enabled, so login returns needsTotpEnroll.
  db.prepare('UPDATE invitations SET used=1,used_by=? WHERE id=?').run(info.lastInsertRowid, inv.id);
  logActivity(info.lastInsertRowid, 'registered', inv.role);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.json({ ok: true, token: signToken(user), user: publicUser(user) });
});

// ---- Profile ----
app.get('/api/profile', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.put('/api/profile', auth, (req, res) => {
  const { theme, alerts_on } = req.body || {};
  if (theme) db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme, req.user.id);
  if (alerts_on !== undefined) db.prepare('UPDATE users SET alerts_on=? WHERE id=?').run(alerts_on ? 1 : 0, req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u) });
});
app.post('/api/profile/username', auth, (req, res) => {
  const { username } = req.body || {};
  if (!username || username.length < 3) return res.status(400).json({ error: 'Too short' });
  const last = req.user.username_changed_at;
  if (last && Date.now() - last < 7 * 24 * 3600 * 1000) return res.status(429).json({ error: 'Username can be changed once per week' });
  if (db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username, req.user.id)) return res.status(409).json({ error: 'Taken' });
  db.prepare('UPDATE users SET username=?,username_changed_at=? WHERE id=?').run(username, Date.now(), req.user.id);
  logActivity(req.user.id, 'username_changed', username);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u), token: signToken(u) });
});
app.post('/api/profile/avatar', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, req.user.id);
  res.json({ avatar: url });
});

// ---- Journal ----
app.get('/api/journal', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM journal WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ entries: rows });
});
app.post('/api/journal', auth, (req, res) => {
  const { entry } = req.body || {};
  if (!entry) return res.status(400).json({ error: 'Empty' });
  db.prepare('INSERT INTO journal (user_id,entry,created_at) VALUES (?,?,?)').run(req.user.id, entry, Date.now());
  res.json({ ok: true });
});

// ---- Announcements ----
app.get('/api/announcements', auth, (req, res) => {
  const rows = db.prepare('SELECT a.*,u.username as author_name FROM announcements a LEFT JOIN users u ON u.id=a.author ORDER BY created_at DESC LIMIT 50').all();
  res.json({ announcements: rows });
});
app.post('/api/announcements', auth, requireRole('admin', 'subadmin'), (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Empty' });
  db.prepare('INSERT INTO announcements (author,content,created_at) VALUES (?,?,?)').run(req.user.id, content, Date.now());
  logActivity(req.user.id, 'announcement', content.slice(0, 80));
  broadcast('announcement', { author: req.user.username, content, created_at: Date.now() });
  res.json({ ok: true });
});

app.delete('/api/announcements/:id', auth, requireRole('admin', 'subadmin'), (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Messages ----
app.get('/api/messages', auth, (req, res) => {
  // users see messages to them or broadcast (to_user null) from admin/subadmin; admin/subadmin see all
  let rows;
  if (req.user.role === 'admin' || req.user.role === 'subadmin') {
    rows = db.prepare('SELECT m.*,u.username as from_name FROM messages m LEFT JOIN users u ON u.id=m.from_user ORDER BY created_at DESC LIMIT 200').all();
  } else {
    rows = db.prepare('SELECT m.*,u.username as from_name FROM messages m LEFT JOIN users u ON u.id=m.from_user WHERE m.to_user=? OR m.to_user IS NULL ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  }
  // filter expired
  const now = Date.now();
  rows = rows.filter(r => !r.expires_at || r.expires_at > now);
  res.json({ messages: rows });
});

app.post('/api/messages', auth, requireRole('admin', 'subadmin'), upload.single('image'), (req, res) => {
  const { content, to_user, encrypted_mode } = req.body || {};
  if (!content && !req.file) return res.status(400).json({ error: 'Empty' });
  const imagePath = req.file ? '/uploads/' + req.file.filename : null;
  let expiresAt = null;
  if (encrypted_mode === 'daily') expiresAt = Date.now() + 24 * 3600 * 1000;
  else if (encrypted_mode === 'weekly') expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
  else if (encrypted_mode === 'monthly') expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
  const toUser = to_user ? parseInt(to_user, 10) : null;
  const info = db.prepare('INSERT INTO messages (from_user,to_user,content,image_path,encrypted_mode,expires_at,created_at) VALUES (?,?,?,?,?,?,?)').run(req.user.id, toUser, content || '', imagePath, encrypted_mode || null, expiresAt, Date.now());
  const msg = db.prepare('SELECT m.*,u.username as from_name FROM messages m LEFT JOIN users u ON u.id=m.from_user WHERE m.id=?').get(info.lastInsertRowid);
  broadcast('message', msg, (uid) => {
    const recipient = toUser ? toUser : null;
    if (req.user.role === 'admin') {
      // Admin: targeted message -> only that user; admin broadcast -> everyone
      if (recipient) return uid === recipient;
      return true;
    }
    // Regular user: only their chosen recipient (or themselves if none)
    if (recipient) return uid === recipient;
    return uid === req.user.id;
  });
  res.json({ message: msg });
});

app.post('/api/messages/:id/pin', auth, requireRole('admin', 'subadmin'), (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE messages SET pinned=? WHERE id=?').run(m.pinned ? 0 : 1, m.id);
  res.json({ ok: true, pinned: !m.pinned });
});

app.delete('/api/messages/:id', auth, requireRole('admin', 'subadmin'), (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Admin ----
app.get('/api/admin/users', auth, requireRole('admin', 'subadmin'), (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(publicUser);
  res.json({ users });
});
app.delete('/api/admin/users/:id', auth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.role === 'admin') return res.status(403).json({ error: 'Cannot delete another admin' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  db.prepare('DELETE FROM messages WHERE from_user=? OR to_user=?').run(id, id);
  db.prepare('DELETE FROM journal WHERE user_id=?').run(id);
  logActivity(req.user.id, 'user_deleted', u.username);
  res.json({ ok: true });
});

// Admin generates a recovery link for a user with authenticator problems
app.post('/api/admin/users/:id/recovery', auth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const token = crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + 24 * 3600 * 1000;
  db.prepare('INSERT INTO recovery_tokens (token,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(token, id, expires, Date.now());
  const base = req.headers.origin || `http://localhost:${PORT}`;
  res.json({ token, link: `${base}/recover.html?token=${token}` });
});

// Public: validate recovery token
app.get('/api/recover/:token', (req, res) => {
  const rt = db.prepare('SELECT * FROM recovery_tokens WHERE token=?').get(req.params.token);
  if (!rt || rt.used || rt.expires_at < Date.now()) return res.status(404).json({ error: 'Invalid or expired recovery link' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(rt.user_id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ username: u.username, userId: u.id });
});

// Public: login via recovery token (bypasses TOTP, forces re-enrollment)
app.post('/api/recover/:token/login', (req, res) => {
  const rt = db.prepare('SELECT * FROM recovery_tokens WHERE token=?').get(req.params.token);
  if (!rt || rt.used || rt.expires_at < Date.now()) return res.status(404).json({ error: 'Invalid or expired recovery link' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(rt.user_id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  // generate new totp secret for re-enrollment
  const secret = authenticator.generateSecret();
  db.prepare('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?').run(secret, u.id);
  db.prepare('UPDATE recovery_tokens SET used=1 WHERE id=?').run(rt.id);
  logActivity(u.id, 'recovery_login', null);
  const otpauth = authenticator.keyuri(u.username, 'ADAQ', secret);
  QRCode.toDataURL(otpauth, (err, url) => {
    if (err) return res.status(500).json({ error: 'QR failed' });
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    res.json({ token: signToken(fresh), user: publicUser(fresh), needsTotpEnroll: true, totpSecret: secret, qr: url });
  });
});

app.get('/api/admin/activity', auth, requireRole('admin', 'subadmin'), (req, res) => {
  const rows = db.prepare('SELECT a.*,u.username FROM activity_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY created_at DESC LIMIT 300').all();
  res.json({ activity: rows });
});

// ---- Presence/activity logging endpoint ----
app.post('/api/activity', auth, (req, res) => {
  const { action, detail } = req.body || {};
  logActivity(req.user.id, action || 'activity', detail);
  res.json({ ok: true });
});

// ---- Health check ----
app.get('/api/health', (req, res) => res.json({ ok: true, adaq: true, version: '2026-11-25-v11' }));

// ---- Market / news / external API proxy (browser-side CORS-safe) ----
const MARKET_PROXIES = [
  { prefix: 'binance', base: 'https://data-api.binance.vision' },
  { prefix: 'coingecko', base: 'https://api.coingecko.com' },
  { prefix: 'cryptocompare', base: 'https://min-api.cryptocompare.com' },
  { prefix: 'finnhub', base: 'https://finnhub.io' },
  { prefix: 'dexscreener', base: 'https://api.dexscreener.com' },
  { prefix: 'rugcheck', base: 'https://api.rugcheck.xyz' },
  { prefix: 'solana', base: 'https://api.mainnet-beta.solana.com' },
  { prefix: 'geckoterminal', base: 'https://api.geckoterminal.com' },
  { prefix: 'gopluslabs', base: 'https://api.gopluslabs.io' },
  { prefix: 'rss2json', base: 'https://api.rss2json.com' },
];
app.use('/api/market', async (req, res) => {
  try {
    const rel = req.path.replace(/^\/+/, '');
    const prox = MARKET_PROXIES.filter(p => rel === p.prefix || rel.startsWith(p.prefix + '/')).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!prox) return res.status(404).json({ error: 'Not found' });
    const upstream = prox.base + rel.slice(prox.prefix.length) + (req.query ? '?' + new URLSearchParams(req.query).toString() : '');
    const init = { method: req.method, headers: { 'content-type': 'application/json', accept: '*/*' } };
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = JSON.stringify(req.body || {});
    const r = await fetch(upstream, init);
    const text = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.send(text);
  } catch (e) { res.status(502).json({ error: 'Proxy error' }); }
});

// Register bot API (must be before the catch-all)
const botInfo = registerBotApi(app, db, auth, requireRole, logActivity, broadcast, clients, isOnline);

// ---- Serve client (static) - AFTER all API routes ----
// CLIENT_DIR is always client/public (the source of truth), NOT server/public which can be stale
const CLIENT_DIR = path.join(__dirname, '..', 'client', 'public');
console.log('CLIENT_DIR:', CLIENT_DIR);
if (!fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
  console.error('CLIENT_DIR not found:', CLIENT_DIR);
} else {
  app.use(express.static(CLIENT_DIR, { maxAge: 0 })); // no caching
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return res.status(404).end();
    const adminPath = (db.prepare('SELECT value FROM settings WHERE key=?').get('admin_path') || {}).value || 'thisisnottheadmin';
    // Only serve the app for / and the admin path
    if (req.path === '/') {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.sendFile(path.join(CLIENT_DIR, 'index.html'));
    }
    if (req.path === '/' + adminPath) {
      let html = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8');
      html = html.replace('</head>', '<script>window.__ADMIN_MODE=true;</script></head>');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
      return res.type('html').send(html);
    }
    // Allow invite.html and recover.html
    if (req.path === '/invite.html' || req.path === '/recover.html' || req.path === '/admins') {
      const file = path.join(CLIENT_DIR, req.path.slice(1));
      if (fs.existsSync(file)) { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); return res.sendFile(file); }
    }
    // Everything else = 404
    return res.status(404).send('Not Found');
  });
}

// Debug: list all routes
app.get('/api/debug/routes', (req, res) => {
  const routes = app._router.stack.filter(s => s.route).map(s => ({ path: s.route.path, methods: Object.keys(s.route.methods) }));
  res.json({ routes });
});

// Nightly cleanup of old activity logs and reports
setInterval(() => {
  const retentionDays = parseInt((db.prepare('SELECT value FROM settings WHERE key=?').get('logRetentionDays') || { value: '14' }).value, 10);
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
  db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(cutoff);
  // Delete done reports older than 7 days
  db.prepare("DELETE FROM reports WHERE status='done' AND done_at < ?").run(Date.now() - 7 * 24 * 3600 * 1000);
}, 3600000); // every hour

// Seed a daily report from Mr. Admin on startup (demo)
try {
  const existing = db.prepare('SELECT id FROM reports WHERE type=?').get('Daily Master Prompt Report');
  if (!existing) {
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
      'Daily Master Prompt Report', 'Daily Master Prompt Report',
      '## Daily Summary\n\nAll bots are operational. No issues detected.\n\n### Bot Status\n- Mr. Admin: Online\n- Mr. Monkey: Online\n- Mr. Hunter: Online\n- Mr. Designer: Online\n- Mr. Chart: Online\n- Mrs. Stoploss: Online\n- Mr. Take Profit: Online\n- Mrs. QA: Online\n- Mr. Whitehack: Online\n\n### Recommendations\n- Continue monitoring.',
      'mr_admin', 'normal', 'new', Date.now()
    );
  }
} catch (e) { console.log('Seed report error:', e.message); }

// Initialize scheduler
initScheduler(db, logActivity);

server.listen(PORT, () => console.log(`ADAQ auth server on http://localhost:${PORT}`));
