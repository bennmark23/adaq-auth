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
module.exports = { SCHEMA, setup, isBotUsername, canSend, assertConversationAccess, isBlocked };
