'use strict';
// Phase 1 data safety: DATA_DIR separation, versioned additive migrations,
// pre-migration backups with restore-on-failure, and startup safety checks.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function resolveDataDir() {
  return process.env.ADAQ_DATA_DIR
    ? path.resolve(process.env.ADAQ_DATA_DIR)
    : path.join(__dirname, 'data');
}
function backupDir(dataDir) { return path.join(dataDir, 'backups'); }
function safeName(name) { return String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80); }
function stamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}
function assertSafeStart(dataDir, dbPath) {
  if (fs.existsSync(dbPath)) return { brandNew: false };
  const backups = backupDir(dataDir);
  const hasBackups = fs.existsSync(backups) && fs.readdirSync(backups).some(f => f.endsWith('.sqlite'));
  const up = path.join(dataDir, 'uploads');
  const hasUploads = fs.existsSync(up) && fs.readdirSync(up).some(f => !f.startsWith('.'));
  if (hasBackups || hasUploads) {
    throw new Error('ADAQ SAFETY STOP: database is missing but ' +
      (hasBackups ? 'backups' : '') + (hasBackups && hasUploads ? ' and ' : '') + (hasUploads ? 'uploads' : '') +
      ' exist in ' + dataDir + '. Restore a backup into ' + dbPath + ' before starting. Do NOT delete DATA_DIR.');
  }
  return { brandNew: true };
}
function backupBeforeMigration(dataDir, dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'db-' + stamp() + '.sqlite');
  fs.copyFileSync(dbPath, dest);
  const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10) || 14);
  const files = fs.readdirSync(dir).filter(f => /^db-.*\.sqlite$/.test(f)).sort().reverse();
  for (const f of files.slice(keep)) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} }
  return dest;
}
function restoreBackup(dbPath, backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) return false;
  fs.copyFileSync(backupPath, dbPath);
  return true;
}
// Additive, idempotent migrations. Never drop/truncate here.
const MIGRATIONS = [
  { v: 1, name: 'baseline-schema-version', sql: '' },
  { v: 2, name: 'import-state', sql: 'CREATE TABLE IF NOT EXISTS import_state (name TEXT PRIMARY KEY, done_at INTEGER NOT NULL);' }
];
function runMigrations(db, migrations) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, name TEXT NOT NULL);');
  const list = migrations || MIGRATIONS;
  let current = 0;
  try { const r = db.prepare('SELECT MAX(version) AS v FROM schema_version').get(); current = r && r.v ? r.v : 0; } catch (e) {}
  for (const m of list.slice().sort((a, b) => a.v - b.v)) {
    if (m.v <= current) continue;
    if (m.sql) db.exec(m.sql);
    db.prepare('INSERT OR REPLACE INTO schema_version (version,applied_at,name) VALUES (?,?,?)').run(m.v, Date.now(), m.name);
    current = m.v;
  }
  return current;
}
function importLegacyJson(db, dataDir) {
  const file = path.join(dataDir, 'data.json');
  if (!fs.existsSync(file)) return { imported: false };
  try { db.exec('CREATE TABLE IF NOT EXISTS import_state (name TEXT PRIMARY KEY, done_at INTEGER NOT NULL);'); } catch (e) {}
  if (db.prepare('SELECT 1 FROM import_state WHERE name=?').get('data.json')) return { imported: false, already: true };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error('Could not parse data.json: ' + e.message); }
  const counts = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  const insert = (table, rows) => {
    if (!Array.isArray(rows) || !tables.includes(table)) return;
    const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map(r => r.name);
    let n = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const keys = Object.keys(row).filter(k => cols.includes(k));
      if (!keys.length) continue;
      try {
        db.prepare('INSERT INTO ' + table + ' (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')')
          .run(...keys.map(k => row[k] === undefined ? null : row[k]));
        n++;
      } catch (e) { /* skip conflicting legacy row */ }
    }
    counts[table] = n;
  };
  insert('users', raw.users);
  insert('activity_log', raw.activities || raw.activity || raw.activity_log);
  insert('journal', raw.history || raw.journal);
  insert('reports', raw.reports);
  if (raw.settings && typeof raw.settings === 'object') {
    const keys = Object.keys(raw.settings);
    try {
      db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
      for (const k of keys) db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(safeName(k), String(raw.settings[k]));
      counts.settings = keys.length;
    } catch (e) {}
  }
  db.prepare('INSERT OR REPLACE INTO import_state (name,done_at) VALUES (?,?)').run('data.json', Date.now());
  console.log('Legacy data.json import counts:', JSON.stringify(counts));
  return { imported: true, counts };
}
function createArchive(dataDir, dbPath) {
  const tmp = path.join(dataDir, 'backup-' + stamp() + '.tar.gz');
  const args = ['-czf', tmp, '-C', dataDir, path.basename(dbPath)];
  const up = path.join(dataDir, 'uploads');
  if (fs.existsSync(up)) args.push('uploads');
  execFileSync('tar', args, { stdio: 'ignore', timeout: 120000 });
  return tmp;
}
function extractArchive(dataDir, archive) {
  const up = path.join(dataDir, 'uploads');
  fs.mkdirSync(up, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', dataDir], { stdio: 'ignore', timeout: 120000 });
  return true;
}
module.exports = {
  resolveDataDir, backupDir, assertSafeStart, backupBeforeMigration, restoreBackup,
  runMigrations, MIGRATIONS, importLegacyJson, createArchive, extractArchive, stamp
};
