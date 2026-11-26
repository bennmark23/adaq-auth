'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../messenger');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
m.setup(db);

test('magic-byte detection accepts real image/pdf/voice and rejects renamed executables', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  assert.equal(m.fileKind(png, 'image/png'), 'image/png');
  assert.equal(m.fileKind(Buffer.from('%PDF-1.4'), 'application/pdf'), 'application/pdf');
  assert.equal(m.fileKind(Buffer.from('GIF89a'), 'image/gif'), 'image/gif');
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 0)]);
  assert.equal(m.fileKind(exe, 'image/png'), null);
  assert.equal(m.fileKind(Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(20, 0)]), 'application/zip'), 'application/zip');
});

test('strict messenger permission rules on direct conversations', () => {
  const bot = { id: 0, username: 'mr_admin', role: 'bot' };
  const admin = { id: 1, username: 'admin', role: 'admin' };
  const user = { id: 5, username: 'alice', role: 'user' };
  const user2 = { id: 6, username: 'bob', role: 'user' };
  assert.equal(m.canSend(db, admin, user).ok, true);
  assert.equal(m.canSend(db, user, admin).ok, false);
  assert.equal(m.canSend(db, user, bot).ok, false);
  assert.equal(m.canSend(db, user, user2).ok, true);
});

test('chat tables and admin notice column exist after additive migration', () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of ['chat_conversations','chat_messages','chat_members','chat_attachments','notice_recipients']) {
    assert.ok(names.includes(t), t + ' exists');
  }
  const cols = db.prepare('PRAGMA table_info(chat_conversations)').all().map(c => c.name);
  assert.ok(cols.includes('kind'), 'admin_notice migration column exists');
});
