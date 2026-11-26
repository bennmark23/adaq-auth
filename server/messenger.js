'use strict';
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DATA_DIR = require('./data_safety').resolveDataDir();
const CHAT_UPLOADS = path.join(DATA_DIR, 'chat_uploads');
if (!fs.existsSync(CHAT_UPLOADS)) fs.mkdirSync(CHAT_UPLOADS, { recursive: true });
const MAX_FILE_MB = Math.max(1, Math.min(25, parseInt(process.env.MAX_FILE_MB || '5', 10) || 5));
const MAX_VOICE_SECONDS = Math.max(10, Math.min(300, parseInt(process.env.MAX_VOICE_SECONDS || '120', 10) || 120));
const MAX_FILES_DAY = Math.max(1, parseInt(process.env.MAX_FILES_PER_DAY_PER_USER || '50', 10) || 50);
function fileKind(buf, mime) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  const hex = b.subarray(0, 8).toString('hex');
  const s = b.subarray(0, 16).toString('latin1');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp';
  if (s.startsWith('GIF87a') || s.startsWith('GIF89a')) return 'image/gif';
  if (s.startsWith('%PDF')) return 'application/pdf';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return mime.startsWith('video/') ? 'video/mp4' : 'audio/mp4';
  if (hex.startsWith('1a45dfa3')) return 'audio/webm';
  if (hex.startsWith('504b0304')) return b.includes(Buffer.from('word/document.xml')) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/zip';
  if (mime === 'text/plain' && !b.subarray(0, 512).includes(0)) return 'text/plain';
  return null;
}
const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CHAT_UPLOADS),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    }
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(png|jpeg|webp|gif)|(audio|video)\/(webm|mp4)|text\/plain|application\/(pdf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))/.test(file.mimetype || '');
    cb(ok ? null : new Error('Unsupported file type'), ok);
  }
});
// Phase 1: data model + permission helpers for the in-house Messenger.
// Tables are prefixed chat_* so they never collide with the existing admin
// `messages` table or the bots' `reports` table.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'direct',
  name TEXT,
  avatar TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER,
  last_message_preview TEXT
);
CREATE TABLE IF NOT EXISTS chat_members (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  deleted_for_me INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  reply_to INTEGER,
  edited_at INTEGER,
  deleted_for_everyone INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS chat_reads (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT,
  name TEXT,
  size INTEGER,
  thumbnail TEXT,
  duration REAL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_message_deletes (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS chat_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  target_user_id INTEGER,
  message_id INTEGER,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notice_recipients (
  notice_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  delivered_at INTEGER,
  read_at INTEGER,
  PRIMARY KEY (notice_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_activity ON chat_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, archived, deleted_for_me);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reads_msg ON chat_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments(message_id);
`;
function setup(db) {
  db.exec(SCHEMA);
  try { db.exec("ALTER TABLE chat_conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'direct'"); } catch (e) {}
}

// Bots and the fixed admin identity are never Messenger participants.
function isBotUsername(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return /^(mr_|mrs_)/.test(n) || /^(mr\.|mrs\.)\s/.test(String(name));
}
// Strict messaging rules, enforced server-side on every send/creation.
function canSend(db, actor, targetUser) {
  if (!actor || !targetUser) return { ok: false, error: 'Unknown account' };
  const actorRole = String(actor.role || '').toLowerCase();
  const targetRole = String(targetUser.role || '').toLowerCase();
  if (isBotUsername(targetUser.username) || isBotUsername(actor.username)) {
    return { ok: false, error: 'Bots cannot be messaged and cannot use Messenger' };
  }
  if (actorRole === 'admin' && (targetRole === 'admin' || targetRole === 'subadmin')) {
    return { ok: false, error: 'Admins cannot message each other here' };
  }
  if (actorRole === 'user' && (targetRole === 'admin' || targetRole === 'subadmin')) {
    return { ok: false, error: "You can't message this account" };
  }
  const blocked = db.prepare('SELECT 1 FROM chat_blocks WHERE blocker_id=? AND blocked_id=?').get(targetUser.id, actor.id);
  if (blocked) return { ok: false, error: 'This user has blocked you' };
  return { ok: true };
}
// A user may only read/write inside conversations they actually belong to.
function assertConversationAccess(db, userId, conversationId) {
  const m = db.prepare('SELECT 1 FROM chat_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
  if (!m) { const e = new Error('Not a member of this conversation'); e.status = 403; throw e; }
  return m;
}
function isBlocked(db, blockerId, targetId) {
  return !!db.prepare('SELECT 1 FROM chat_blocks WHERE blocker_id=? AND blocked_id=?').get(blockerId, targetId);
}

// ---- Routes (Phase 5: 1-on-1 chat, permissions, real-time delivery) ----
const rateHits = new Map(); // in-memory: resets on restart
function rateOk(userId) {
  const now = Date.now();
  const arr = (rateHits.get(userId) || []).filter(t => now - t < 10000);
  if (arr.length >= 20) { rateHits.set(userId, arr); return false; }
  arr.push(now); rateHits.set(userId, arr); return true;
}
function publicMember(db, conv, meId) {
  const rows = db.prepare('SELECT m.user_id,m.role,u.username,u.avatar FROM chat_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.conversation_id=?').all(conv.id);
  const other = rows.find(r => r.user_id !== meId);
  const mine = rows.find(r => r.user_id === meId);
  return {
    id: conv.id, type: conv.type, kind: conv.kind || 'direct', name: conv.type === 'group' ? conv.name : (other ? other.username : ''),
    avatar: conv.type === 'group' ? conv.avatar : (other ? other.avatar : ''),
    otherId: other ? other.user_id : null,
    pinned: !!(mine && mine.pinned), muted: !!(mine && mine.muted), archived: !!(mine && mine.archived),
    unread: mine ? mine.unread_count : 0,
    last_message_at: conv.last_message_at, last_message_preview: conv.last_message_preview,
    online: other ? (() => { const u = db.prepare('SELECT last_active FROM users WHERE id=?').get(other.user_id); return !!(u && Date.now() - (u.last_active || 0) < 90000); })() : false,
    canReply: conv.kind !== 'admin_notice' && (conv.type !== 'direct' || !other || (other.username !== 'admin' && !isBotUsername(other.username)))
  };
}
function participantIds(db, convId) {
  return db.prepare('SELECT user_id FROM chat_members WHERE conversation_id=?').all(convId).map(r => r.user_id);
}
function emitChat(broadcast, db, convId, type, data) {
  if (broadcast) broadcast(type, data, uid => participantIds(db, convId).includes(uid));
}
function registerRoutes(app, db, auth, requireRole, broadcast) {
  const A = [auth];
  const adminOnly = [auth, requireRole('admin', 'subadmin')];
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'adaq-jwt-change-me-in-prod';
  app.use('/chat_uploads', (req, res) => {
    const file = req.path.replace(/^\/+/, '');
    if (!/^[a-f0-9]{24}\.[a-zA-Z0-9]{1,10}(?:_thumb\.jpg)?$/.test(file)) return res.status(400).end();
    const token = (req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/, '') || '');
    let user = null;
    try { const p = jwt.verify(token, JWT_SECRET); user = db.prepare('SELECT id FROM users WHERE id=?').get(p.id); } catch (e) {}
    if (!user) return res.status(401).end();
    const a = db.prepare("SELECT a.*,m.conversation_id FROM chat_attachments a JOIN chat_messages m ON m.id=a.message_id WHERE a.path=?").get('/chat_uploads/' + file);
    if (!a) return res.status(404).end();
    try { assertConversationAccess(db, user.id, a.conversation_id); } catch (e) { return res.status(403).end(); }
    res.set('x-content-type-options', 'nosniff');
    res.type(a.mime || 'application/octet-stream');
    if (req.query.download) res.set('content-disposition', 'attachment; filename="attachment"');
    res.sendFile(path.join(CHAT_UPLOADS, file));
  });
  app.post('/api/chat/conversations/:id/media', ...A, chatUpload.single('file'), async (req, res) => {
    const id = Number(req.params.id);
    assertConversationAccess(db, req.user.id, id);
    if (!rateOk(req.user.id)) return res.status(429).json({ error: 'Too many uploads. Slow down.' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const f = req.file;
    const today = db.prepare('SELECT COUNT(*) c FROM chat_messages WHERE sender_id=? AND kind<>\'text\' AND created_at>?').get(req.user.id, Date.now() - 86400000).c;
    if (today >= MAX_FILES_DAY) { try { fs.unlinkSync(f.path); } catch (e) {} return res.status(429).json({ error: 'Daily attachment limit reached' }); }
    const fd = fs.openSync(f.path, 'r'); const head = Buffer.alloc(65536);
    const read = fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd);
    const detected = fileKind(head.subarray(0, read), f.mimetype || '');
    if (!detected || detected === 'application/zip') { try { fs.unlinkSync(f.path); } catch (e) {} return res.status(400).json({ error: 'File signature does not match an allowed type' }); }
    const mime = detected;
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'voice' : 'file';
    const url = '/chat_uploads/' + f.filename;
    let thumb = '';
    if (kind === 'image') {
      try {
        const sharp = require('sharp');
        const tname = f.filename.replace(/(\.[^.]+)?$/, '') + '_thumb.jpg';
        await sharp(f.path).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toFile(path.join(CHAT_UPLOADS, tname));
        thumb = '/chat_uploads/' + tname;
      } catch (e) { console.log('thumb failed:', e.message); }
    }
    const now = Date.now();
    const info = db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?)').run(id, req.user.id, kind, url, now);
    db.prepare('INSERT INTO chat_attachments (message_id,kind,path,mime,name,size,thumbnail,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(Number(info.lastInsertRowid), kind, url, mime, String(f.originalname || '').slice(0, 160), f.size, thumb || null, now);
    db.prepare('UPDATE chat_conversations SET last_message_at=?,last_message_preview=? WHERE id=?').run(now, kind === 'file' ? 'File' : kind, id);
    db.prepare('UPDATE chat_members SET unread_count=unread_count+1 WHERE conversation_id=? AND user_id<>?').run(id, req.user.id);
    const msg = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(info.lastInsertRowid));
    emitChat(broadcast, db, id, 'chat_message', msg);
    res.json({ message: msg, attachment: { path: url, thumbnail: thumb } });
  });
  app.get('/api/chat/unread', ...A, (req, res) => {
    const r = db.prepare('SELECT COALESCE(SUM(unread_count),0) AS c FROM chat_members WHERE user_id=? AND archived=0 AND deleted_for_me=0').get(req.user.id);
    res.json({ unread: r.c });
  });
  app.get('/api/chat/conversations', ...A, (req, res) => {
    const rows = db.prepare(`SELECT c.* FROM chat_conversations c JOIN chat_members m ON m.conversation_id=c.id
      WHERE m.user_id=? AND m.deleted_for_me=0 ORDER BY m.pinned DESC, COALESCE(c.last_message_at,c.created_at) DESC LIMIT 200`).all(req.user.id);
    res.json({ conversations: rows.filter(c => req.query.archived ? db.prepare('SELECT archived FROM chat_members WHERE conversation_id=? AND user_id=?').get(c.id, req.user.id).archived : !db.prepare('SELECT archived FROM chat_members WHERE conversation_id=? AND user_id=?').get(c.id, req.user.id).archived).map(c => publicMember(db, c, req.user.id)) });
  });
  // Free-standing Messenger API aliases (same implementation as /api/chat).
  app.get('/api/messenger/users', ...A, (req, res) => {
    const users = db.prepare("SELECT id,username,avatar,last_active FROM users WHERE role='user' AND id<>? ORDER BY username").all(req.user.id)
      .map(u => ({ id: u.id, name: u.username, avatar: u.avatar || '/default-avatar.svg', online: Date.now() - (u.last_active || 0) < 90000 }));
    res.json({ users });
  });
  app.get('/api/messenger/conversations', ...A, (req, res) => {
    const rows = db.prepare(`SELECT c.* FROM chat_conversations c JOIN chat_members m ON m.conversation_id=c.id
      WHERE m.user_id=? AND m.deleted_for_me=0 ORDER BY m.pinned DESC, COALESCE(c.last_message_at,c.created_at) DESC LIMIT 200`).all(req.user.id);
    res.json({ conversations: rows.map(c => publicMember(db, c, req.user.id)) });
  });
  app.get('/api/messenger/conversations/:id/messages', ...A, (req, res) => {
    const id = Number(req.params.id);
    assertConversationAccess(db, req.user.id, id);
    const rows = db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? AND id<? ORDER BY created_at DESC LIMIT 50')
      .all(id, Number(req.query.before || Number.MAX_SAFE_INTEGER));
    const out = rows.map(m => {
      if (db.prepare('SELECT 1 FROM chat_message_deletes WHERE message_id=? AND user_id=?').get(m.id, req.user.id)) return null;
      const reactions = db.prepare('SELECT emoji,COUNT(*) AS n FROM chat_reactions WHERE message_id=? GROUP BY emoji').all(m.id).map(r => ({ emoji: r.emoji, n: r.n }));
      const att = db.prepare('SELECT * FROM chat_attachments WHERE message_id=?').get(m.id);
      return { ...m, reactions, attachment: att ? { path: att.path, thumbnail: att.thumbnail, name: att.name, kind: att.kind } : null };
    }).filter(Boolean);
    const newlyRead = db.prepare('SELECT id,sender_id FROM chat_messages WHERE conversation_id=? AND id NOT IN (SELECT message_id FROM chat_reads WHERE user_id=?)').all(id, req.user.id);
    db.prepare('UPDATE chat_members SET unread_count=0 WHERE conversation_id=? AND user_id=?').run(id, req.user.id);
    for (const m of newlyRead) if (m.sender_id !== req.user.id) emitChat(broadcast, db, id, 'chat_read', { id: m.id, user_id: req.user.id });
    res.json({ messages: out.reverse() });
  });
  app.post('/api/messenger/read', ...A, (req, res) => {
    const id = Number(req.body && req.body.conversation_id || 0);
    assertConversationAccess(db, req.user.id, id);
    const newlyRead = db.prepare('SELECT id,sender_id FROM chat_messages WHERE conversation_id=? AND id NOT IN (SELECT message_id FROM chat_reads WHERE user_id=?)').all(id, req.user.id);
    db.prepare('UPDATE chat_members SET unread_count=0 WHERE conversation_id=? AND user_id=?').run(id, req.user.id);
    for (const m of newlyRead) if (m.sender_id !== req.user.id) emitChat(broadcast, db, id, 'chat_read', { id: m.id, user_id: req.user.id });
    const total = db.prepare('SELECT COALESCE(SUM(unread_count),0) c FROM chat_members WHERE user_id=?').get(req.user.id).c;
    emitChat(broadcast, db, id, 'unread', { unread: total, to_user: req.user.id });
    res.json({ unread: total });
  });
  app.post('/api/messenger/presence', ...A, (req, res) => {
    db.prepare('UPDATE users SET last_active=? WHERE id=?').run(Date.now(), req.user.id);
    if (broadcast) broadcast('presence', { user_id: req.user.id, online: true });
    res.json({ ok: true });
  });
  // Rate limiting is shared with /api/chat (20 messages / 10s, already enforced).
  app.post('/api/chat/conversations', ...A, (req, res) => {
    const targetId = Number((req.body && req.body.target_id) || 0);
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
    const check = canSend(db, req.user, target);
    if (!check.ok) return res.status(403).json({ error: check.error });
    const existing = db.prepare(`SELECT c.id FROM chat_conversations c JOIN chat_members a ON a.conversation_id=c.id AND a.user_id=?
      JOIN chat_members b ON b.conversation_id=c.id AND b.user_id=? WHERE c.type='direct'`).get(req.user.id, targetId);
    let id = existing ? existing.id : null;
    if (!id) {
      const now = Date.now();
      const info = db.prepare("INSERT INTO chat_conversations (type,created_by,created_at,last_message_at) VALUES ('direct',?,?,?)").run(req.user.id, now, now);
      id = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO chat_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)').run(id, req.user.id, 'member', now);
      db.prepare('INSERT INTO chat_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)').run(id, targetId, 'member', now);
    }
    const c = db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(id);
    res.json({ conversation: publicMember(db, c, req.user.id) });
  });
  app.get('/api/chat/conversations/:id/messages', ...A, (req, res) => {
    const id = Number(req.params.id);
    assertConversationAccess(db, req.user.id, id);
    const before = Number(req.query.before || 0);
    const rows = before
      ? db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? AND id<? ORDER BY created_at DESC LIMIT 50').all(id, before)
      : db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 50').all(id);
    const out = rows.map(m => {
      if (db.prepare('SELECT 1 FROM chat_message_deletes WHERE message_id=? AND user_id=?').get(m.id, req.user.id)) return null;
      const reactions = db.prepare('SELECT emoji,COUNT(*) AS n FROM chat_reactions WHERE message_id=? GROUP BY emoji').all(m.id).map(r => ({ emoji: r.emoji, n: r.n }));
      const att = db.prepare('SELECT * FROM chat_attachments WHERE message_id=?').get(m.id);
      const seen = db.prepare('SELECT 1 FROM chat_reads WHERE message_id=? AND user_id<>? LIMIT 1').get(m.id, req.user.id);
      return { ...m, reactions, seen: !!seen, attachment: att ? { path: att.path, thumbnail: att.thumbnail, name: att.name, kind: att.kind, mime: att.mime } : null };
    }).filter(Boolean);
    const newlyRead = db.prepare('SELECT id,sender_id FROM chat_messages WHERE conversation_id=? AND id NOT IN (SELECT message_id FROM chat_reads WHERE user_id=?)').all(id, req.user.id);
    db.prepare('UPDATE chat_members SET unread_count=0 WHERE conversation_id=? AND user_id=?').run(id, req.user.id);
    for (const m of newlyRead) if (m.sender_id !== req.user.id) emitChat(broadcast, db, id, 'chat_read', { id: m.id, user_id: req.user.id });
    db.prepare('INSERT OR REPLACE INTO chat_reads (message_id,user_id,read_at) SELECT id,?,? FROM chat_messages WHERE conversation_id=?').run(req.user.id, Date.now(), id);
    res.json({ messages: out.reverse() });
  });
  app.post('/api/chat/conversations/:id/messages', ...A, (req, res) => {
    const id = Number(req.params.id);
    assertConversationAccess(db, req.user.id, id);
    const conv = db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(id);
    if (conv.kind === 'admin_notice' && req.user.role !== 'admin') return res.status(403).json({ error: 'You are not allowed to reply the Admin' });
    if (!rateOk(req.user.id)) return res.status(429).json({ error: 'Too many messages. Slow down.' });
    const b = req.body || {};
    const body = String(b.body || '').trim().slice(0, 4000);
    const kind = String(b.kind || 'text').slice(0, 20);
    if (!body && kind === 'text') return res.status(400).json({ error: 'Empty message' });
    if (kind === 'text') {
      const c = db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(id);
      if (c.type === 'direct') {
        const other = db.prepare('SELECT u.* FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? AND m.user_id<>?').get(id, req.user.id);
        const check = canSend(db, req.user, other);
        if (!check.ok) return res.status(403).json({ error: check.error });
      }
    }
    const now = Date.now();
    const info = db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,reply_to,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, req.user.id, kind, body, b.reply_to ? Number(b.reply_to) : null, now);
    db.prepare('UPDATE chat_conversations SET last_message_at=?,last_message_preview=? WHERE id=?').run(now, body.slice(0, 120), id);
    db.prepare('UPDATE chat_members SET unread_count=unread_count+1 WHERE conversation_id=? AND user_id<>?').run(id, req.user.id);
    const msg = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(info.lastInsertRowid));
    emitChat(broadcast, db, id, 'chat_message', msg);
    if (global.adaqBackupUploads) global.adaqBackupUploads();
    for (const uid of participantIds(db, id)) {
      if (uid === req.user.id) continue;
      const total = db.prepare('SELECT COALESCE(SUM(unread_count),0) c FROM chat_members WHERE user_id=?').get(uid).c;
      broadcast('unread', { unread: total, to_user: uid, from_user: req.user.id, conversation_id: id });
      if (global.adaqPushNotify && conv.kind !== 'admin_notice') global.adaqPushNotify(uid, 'New message', String(body || 'Attachment').slice(0, 80));
    }
    res.json({ message: msg });
  });
  app.patch('/api/chat/messages/:id/edit', ...A, (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'Not found' });
    assertConversationAccess(db, req.user.id, m.conversation_id);
    if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'Only the sender can edit' });
    if (m.deleted_for_everyone) return res.status(409).json({ error: 'Message removed' });
    const body = String((req.body && req.body.body) || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'Empty message' });
    db.prepare('UPDATE chat_messages SET body=?,edited_at=? WHERE id=?').run(body, Date.now(), m.id);
    const out = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(m.id);
    emitChat(broadcast, db, m.conversation_id, 'chat_updated', out);
    res.json({ message: out });
  });
  app.delete('/api/chat/messages/:id', ...A, (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'Not found' });
    assertConversationAccess(db, req.user.id, m.conversation_id);
    const mode = String(req.query.mode || 'me');
    if (mode === 'everyone') {
      if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'Only the sender can remove for everyone' });
      db.prepare('UPDATE chat_messages SET deleted_for_everyone=1,body=? WHERE id=?').run('', m.id);
      emitChat(broadcast, db, m.conversation_id, 'chat_updated', { id: m.id, deleted_for_everyone: 1 });
    } else {
      db.prepare('INSERT OR REPLACE INTO chat_message_deletes (message_id,user_id,created_at) VALUES (?,?,?)').run(m.id, req.user.id, Date.now());
    }
    res.json({ ok: true });
  });
  app.post('/api/chat/messages/:id/reactions', ...A, (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'Not found' });
    assertConversationAccess(db, req.user.id, m.conversation_id);
    const emoji = String((req.body && req.body.emoji) || '👍').slice(0, 16);
    const exists = db.prepare('SELECT id FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?').get(m.id, req.user.id, emoji);
    if (exists) db.prepare('DELETE FROM chat_reactions WHERE id=?').run(exists.id);
    else db.prepare('INSERT INTO chat_reactions (message_id,user_id,emoji,created_at) VALUES (?,?,?,?)').run(m.id, req.user.id, emoji, Date.now());
    const counts = db.prepare('SELECT emoji,COUNT(*) AS n FROM chat_reactions WHERE message_id=? GROUP BY emoji').all(m.id).map(r => ({ emoji: r.emoji, n: r.n }));
    emitChat(broadcast, db, m.conversation_id, 'chat_updated', { id: m.id, reactions: counts });
    res.json({ reactions: counts });
  });
  app.post('/api/chat/groups', ...A, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80);
    if (name.length < 2) return res.status(400).json({ error: 'Group name required' });
    const ids = Array.isArray(b.member_ids) ? [...new Set(b.member_ids.map(Number).filter(x => x > 0 && x !== req.user.id))] : [];
    const members = [req.user.id, ...ids].filter(id => {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      return u && u.role === 'user' && !isBotUsername(u.username);
    });
    if (members.length < 2) return res.status(400).json({ error: 'Add at least one real user (bots and admins cannot be added)' });
    const now = Date.now();
    const info = db.prepare("INSERT INTO chat_conversations (type,name,avatar,created_by,created_at,last_message_at) VALUES ('group',?,?,?,?,?)")
      .run(name, '/default-avatar.svg', req.user.id, now, now);
    const id = Number(info.lastInsertRowid);
    for (const uid of members) db.prepare('INSERT INTO chat_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)').run(id, uid, uid === req.user.id ? 'admin' : 'member', now);
    db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?)').run(id, req.user.id, 'system', name + ' group created', now);
    res.json({ conversation: publicMember(db, db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(id), req.user.id) });
  });
  app.patch('/api/chat/groups/:id', ...A, (req, res) => {
    const id = Number(req.params.id);
    const mine = assertConversationAccess(db, req.user.id, id);
    if (mine.role !== 'admin') return res.status(403).json({ error: 'Only group admins can manage members' });
    const b = req.body || {};
    if (b.add_id) {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(b.add_id));
      if (!u || u.role !== 'user' || isBotUsername(u.username)) return res.status(400).json({ error: 'Only real users can be added' });
      db.prepare('INSERT OR REPLACE INTO chat_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)').run(id, u.id, 'member', Date.now());
      db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?)').run(id, req.user.id, 'system', u.username + ' was added', Date.now());
    }
    if (b.remove_id) {
      const uid = Number(b.remove_id);
      if (uid === req.user.id) return res.status(400).json({ error: 'Use leave instead' });
      db.prepare('DELETE FROM chat_members WHERE conversation_id=? AND user_id=?').run(id, uid);
      const u = db.prepare('SELECT username FROM users WHERE id=?').get(uid);
      db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?)').run(id, req.user.id, 'system', (u ? u.username : 'A member') + ' was removed', Date.now());
    }
    if (b.promote_id) {
      db.prepare("UPDATE chat_members SET role='admin' WHERE conversation_id=? AND user_id=?").run(id, Number(b.promote_id));
      const u = db.prepare('SELECT username FROM users WHERE id=?').get(Number(b.promote_id));
      db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?)').run(id, req.user.id, 'system', (u ? u.username : 'A member') + ' is now a group admin', Date.now());
    }
    if (b.leave) {
      db.prepare('DELETE FROM chat_members WHERE conversation_id=? AND user_id=?').run(id, req.user.id);
      db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?)').run(id, req.user.id, 'system', 'A member left the group', Date.now());
    }
    res.json({ ok: true });
  });
  app.post('/api/chat/messages/:id/report', ...A, (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'Not found' });
    assertConversationAccess(db, req.user.id, m.conversation_id);
    db.prepare('INSERT INTO chat_reports (reporter_id,message_id,reason,created_at) VALUES (?,?,?,?)').run(req.user.id, m.id, String((req.body && req.body.reason) || '').slice(0, 500), Date.now());
    res.json({ ok: true });
  });
  // Admin notice: one-way messages to one, several or all users.
  app.post('/api/chat/notices', ...adminOnly, (req, res) => {
    const b = req.body || {};
    const body = String(b.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'Empty message' });
    let ids = Array.isArray(b.recipient_ids) ? [...new Set(b.recipient_ids.map(Number))] : [];
    if (b.all) ids = db.prepare("SELECT id FROM users WHERE role='user'").all().map(u => u.id);
    ids = ids.filter(id => {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      return u && u.role === 'user';
    });
    if (!ids.length) return res.status(400).json({ error: 'Select at least one real user' });
    const now = Date.now();
    const info = db.prepare("INSERT INTO chat_conversations (type,kind,name,avatar,created_by,created_at,last_message_at,last_message_preview) VALUES ('direct','admin_notice','Admin','/icon-192.png',?,?,?,?)")
      .run(req.user.id, now, now, body.slice(0, 120));
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO chat_members (conversation_id,user_id,role,pinned,joined_at) VALUES (?,?,?,?,?)').run(id, req.user.id, 'admin', 1, now);
    for (const uid of ids) {
      db.prepare('INSERT INTO chat_members (conversation_id,user_id,role,pinned,joined_at) VALUES (?,?,?,?,?)').run(id, uid, 'member', 1, now);
      db.prepare('INSERT INTO notice_recipients (notice_id,user_id,delivered_at) VALUES (?,?,?)').run(id, uid, now);
    }
    const m = db.prepare('INSERT INTO chat_messages (conversation_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?)').run(id, req.user.id, 'text', body, now);
    for (const uid of ids) emitChat(broadcast, db, id, 'chat_message', { ...db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(m.lastInsertRowid)), to_user: uid });
    res.json({ notice: { id, recipients: ids.length } });
  });
  app.get('/api/chat/notices', ...adminOnly, (req, res) => {
    const rows = db.prepare("SELECT * FROM chat_conversations WHERE kind='admin_notice' ORDER BY created_at DESC LIMIT 100").all();
    res.json({ notices: rows.map(c => ({
      id: c.id, body: c.last_message_preview, created_at: c.created_at,
      recipients: db.prepare('SELECT r.user_id,u.username,r.delivered_at,r.read_at FROM notice_recipients r LEFT JOIN users u ON u.id=r.user_id WHERE r.notice_id=?').all(c.id)
    })) });
  });
  app.delete('/api/chat/notices/:id', ...adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare("SELECT * FROM chat_conversations WHERE id=? AND kind='admin_notice'").get(id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const ids = db.prepare('SELECT user_id FROM chat_members WHERE conversation_id=?').all(id).map(r => r.user_id);
    for (const uid of ids) emitChat(broadcast, db, id, 'chat_deleted', { conversation_id: id, to_user: uid });
    db.prepare('DELETE FROM chat_messages WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM chat_members WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM notice_recipients WHERE notice_id=?').run(id);
    db.prepare('DELETE FROM chat_conversations WHERE id=?').run(id);
    res.json({ ok: true });
  });
  app.post('/api/chat/conversations/:id/typing', ...A, (req, res) => {
    const id = Number(req.params.id);
    assertConversationAccess(db, req.user.id, id);
    emitChat(broadcast, db, id, 'chat_typing', { conversation_id: id, user_id: req.user.id });
    res.json({ ok: true });
  });
  app.patch('/api/chat/conversations/:id', ...A, (req, res) => {
    const id = Number(req.params.id);
    assertConversationAccess(db, req.user.id, id);
    const b = req.body || {};
    for (const k of ['pinned', 'muted', 'archived', 'deleted_for_me']) {
      if (b[k] !== undefined) db.prepare(`UPDATE chat_members SET ${k}=? WHERE conversation_id=? AND user_id=?`).run(b[k] ? 1 : 0, id, req.user.id);
    }
    res.json({ ok: true });
  });
  app.post('/api/chat/messages/:id/read', ...A, (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'Not found' });
    assertConversationAccess(db, req.user.id, m.conversation_id);
    db.prepare('INSERT OR REPLACE INTO chat_reads (message_id,user_id,read_at) VALUES (?,?,?)').run(m.id, req.user.id, Date.now());
    emitChat(broadcast, db, m.conversation_id, 'chat_read', { id: m.id, user_id: req.user.id });
    res.json({ ok: true });
  });
  app.post('/api/chat/conversations/:id/block', ...A, (req, res) => {
    assertConversationAccess(db, req.user.id, Number(req.params.id));
    const c = db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(Number(req.params.id));
    if (c.kind === 'admin_notice') return res.status(403).json({ error: 'You cannot block the Administrator' });
    const other = db.prepare('SELECT user_id FROM chat_members WHERE conversation_id=? AND user_id<>?').get(c.id, req.user.id);
    if (!other) return res.status(400).json({ error: 'No other member' });
    db.prepare('INSERT OR REPLACE INTO chat_blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)').run(req.user.id, other.user_id, Date.now());
    res.json({ ok: true });
  });
  app.delete('/api/chat/conversations/:id/block', ...A, (req, res) => {
    const c = db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(Number(req.params.id));
    const other = db.prepare('SELECT user_id FROM chat_members WHERE conversation_id=? AND user_id<>?').get(c.id, req.user.id);
    if (other) db.prepare('DELETE FROM chat_blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id, other.user_id);
    res.json({ ok: true });
  });
}
module.exports = { SCHEMA, setup, isBotUsername, canSend, assertConversationAccess, isBlocked, registerRoutes, fileKind, MAX_FILE_MB, MAX_VOICE_SECONDS, MAX_FILES_DAY };
