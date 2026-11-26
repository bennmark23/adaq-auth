'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ds = require('../data_safety');
const { DatabaseSync } = require('node:sqlite');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'adaq-ds-')); }
function seed(db) {
  db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password_hash TEXT);');
  db.exec('CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, created_at INTEGER);');
  db.prepare('INSERT INTO users (username,password_hash) VALUES (?,?)').run('alice', 'hash');
  db.prepare('INSERT INTO activity_log (user_id,action,created_at) VALUES (?,?,?)').run(1, 'login', Date.now());
}

test('migrations are idempotent and preserve every record across a simulated redeploy', () => {
  const dir = tmpdir();
  const dbPath = path.join(dir, 'adaq.db');
  let db = new DatabaseSync(dbPath); seed(db);
  const backup = ds.backupBeforeMigration(dir, dbPath);
  assert.ok(backup && fs.existsSync(backup));
  assert.equal(ds.runMigrations(db), 2);
  assert.equal(ds.runMigrations(db), 2, 'second run is a no-op');
  const users = db.prepare('SELECT * FROM users').all();
  const acts = db.prepare('SELECT * FROM activity_log').all();
  db.close();
  // simulate code redeploy: reopen the same DATA_DIR DB
  db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM activity_log').get().c, 1);
  assert.deepEqual(db.prepare('SELECT COUNT(*) c FROM schema_version').get().c, 2);
  assert.equal(users[0].username, 'alice');
  assert.equal(acts[0].action, 'login');
  db.close();
});

test('failed migration restores the pre-migration backup', () => {
  const dir = tmpdir();
  const dbPath = path.join(dir, 'adaq.db');
  const db = new DatabaseSync(dbPath); seed(db);
  const backup = ds.backupBeforeMigration(dir, dbPath);
  assert.throws(() => ds.runMigrations(db, [{ v: 99, name: 'bad', sql: 'THIS IS NOT SQL;' }]));
  db.close();
  assert.ok(ds.restoreBackup(dbPath, backup));
  const check = new DatabaseSync(dbPath);
  assert.equal(check.prepare('SELECT username FROM users').get().username, 'alice');
  check.close();
});

test('missing database with existing backups or uploads stops startup', () => {
  const dir = tmpdir();
  assert.equal(ds.assertSafeStart(dir, path.join(dir, 'adaq.db')).brandNew, true);
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backups', 'db-old.sqlite'), 'x');
  assert.throws(() => ds.assertSafeStart(dir, path.join(dir, 'adaq.db')), /SAFETY STOP/);
  assert.equal(fs.existsSync(path.join(dir, 'adaq.db')), false, 'must not create a blank DB');
});

test('legacy data.json is imported and the source file is kept', () => {
  const dir = tmpdir();
  const dbPath = path.join(dir, 'adaq.db');
  const db = new DatabaseSync(dbPath); seed(db);
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
    users: [{ username: 'bob', password_hash: 'h' }],
    activities: [{ user_id: 1, action: 'imported', created_at: 1 }],
    settings: { theme: 'dark' }
  }));
  const r = ds.importLegacyJson(db, dir);
  assert.equal(r.imported, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE username='bob'").get().c, 1);
  assert.equal(ds.importLegacyJson(db, dir).already, true, 'importer is one-time');
  assert.ok(fs.existsSync(path.join(dir, 'data.json')), 'old file untouched');
  db.close();
});
