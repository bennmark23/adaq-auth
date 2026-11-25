'use strict';
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
CREATE INDEX IF NOT EXISTS idx_chat_conv_activity ON chat_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, archived, deleted_for_me);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reads_msg ON chat_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments(message_id);
`;
function setup(db) { db.exec(SCHEMA); }

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
    id: conv.id, type: conv.type, name: conv.type === 'group' ? conv.name : (other ? other.username : ''),
    avatar: conv.type === 'group' ? conv.avatar : (other ? other.avatar : ''),
    otherId: other ? other.user_id : null,
    pinned: !!(mine && mine.pinned), muted: !!(mine && mine.muted), archived: !!(mine && mine.archived),
    unread: mine ? mine.unread_count : 0,
    last_message_at: conv.last_message_at, last_message_preview: conv.last_message_preview,
    online: other ? (() => { const u = db.prepare('SELECT last_active FROM users WHERE id=?').get(other.user_id); return !!(u && Date.now() - (u.last_active || 0) < 90000); })() : false,
    canReply: conv.type !== 'direct' || !other || (other.username !== 'admin' && !isBotUsername(other.username))
  };
}
function participantIds(db, convId) {
  return db.prepare('SELECT user_id FROM chat_members WHERE conversation_id=?').all(convId).map(r => r.user_id);
}
function emitChat(broadcast, db, convId, type, data) {
  if (broadcast) broadcast(type, data, uid => participantIds(db, convId).includes(uid));
}
function registerRoutes(app, db, auth, broadcast) {
  const A = [auth];
  app.get('/api/chat/unread', ...A, (req, res) => {
    const r = db.prepare('SELECT COALESCE(SUM(unread_count),0) AS c FROM chat_members WHERE user_id=? AND archived=0 AND deleted_for_me=0').get(req.user.id);
    res.json({ unread: r.c });
  });
  app.get('/api/chat/conversations', ...A, (req, res) => {
    const rows = db.prepare(`SELECT c.* FROM chat_conversations c JOIN chat_members m ON m.conversation_id=c.id
      WHERE m.user_id=? AND m.deleted_for_me=0 ORDER BY COALESCE(c.last_message_at,c.created_at) DESC LIMIT 200`).all(req.user.id);
    res.json({ conversations: rows.filter(c => req.query.archived ? db.prepare('SELECT archived FROM chat_members WHERE conversation_id=? AND user_id=?').get(c.id, req.user.id).archived : !db.prepare('SELECT archived FROM chat_members WHERE conversation_id=? AND user_id=?').get(c.id, req.user.id).archived).map(c => publicMember(db, c, req.user.id)) });
  });
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
      return { ...m, reactions };
    }).filter(Boolean);
    db.prepare('UPDATE chat_members SET unread_count=0 WHERE conversation_id=? AND user_id=?').run(id, req.user.id);
    db.prepare('INSERT OR REPLACE INTO chat_reads (message_id,user_id,read_at) SELECT id,?,? FROM chat_messages WHERE conversation_id=?').run(req.user.id, Date.now(), id);
    res.json({ messages: out.reverse() });
  });
  app.post('/api/chat/conversations/:id/messages', ...A, (req, res) => {
    const id = Number(req.params.id);
    assertConversationAccess(db, req.user.id, id);
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
module.exports = { SCHEMA, setup, isBotUsername, canSend, assertConversationAccess, isBlocked, registerRoutes };
