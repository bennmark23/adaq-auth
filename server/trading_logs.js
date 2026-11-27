'use strict';
// Additive per-user trading logs. Keyed by (user_id, entry_id) so retries never duplicate.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS signal_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  coin TEXT, timeframe TEXT, side TEXT,
  entry REAL, stop_loss REAL, take_profit REAL, size_usd REAL,
  result TEXT NOT NULL DEFAULT 'open', exit_price REAL,
  pnl_pct REAL, pnl_usd REAL, quality REAL, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, entry_id)
);
CREATE TABLE IF NOT EXISTS training_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL, closed_at INTEGER,
  coin TEXT, timeframe TEXT, side TEXT, size_usd REAL,
  entry REAL, stop REAL, take_profit REAL, exit REAL,
  result TEXT, pnl_pct REAL, pnl_usd REAL,
  close_reason TEXT, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_signal_user ON signal_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_user ON training_logs(user_id, opened_at DESC);
`;
function setup(db) { db.exec(SCHEMA); }
function registerRoutes(app, db, auth, requireRole) {
  const A = [auth];
  const upsert = (table, uid, e) => {
    const isSignal = table === 'signal_logs';
    const cols = isSignal
      ? ['coin','timeframe','side','entry','stop_loss','take_profit','size_usd','result','exit_price','pnl_pct','pnl_usd','quality','created_at','closed_at']
      : ['coin','timeframe','side','size_usd','entry','stop','take_profit','exit','result','pnl_pct','pnl_usd','close_reason','opened_at','closed_at'];
    const timeCol = isSignal ? 'created_at' : 'opened_at';
    const entryId = String(e.id || e.entry_id || '');
    // Keep the original timestamp on retries; old/local entries may have no time at all.
    const existing = db.prepare(`SELECT ${timeCol} FROM ${table} WHERE user_id=? AND entry_id=?`).get(uid, entryId);
    const numeric = cols.filter(c => !['coin','timeframe','side','result','close_reason',timeCol,'closed_at'].includes(c));
    const vals = cols.map(c => {
      const v = e[c];
      if (c === timeCol) {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : ((existing && existing[timeCol]) || Date.now());
      }
      if (c === 'closed_at') { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
      if (c === 'result') return typeof v === 'string' && v ? v : 'open';
      if (numeric.includes(c)) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v); return Number.isFinite(n) ? n : null;
      }
      return typeof v === 'string' && v ? v : null;
    });
    const sets = cols.map(c => c + '=excluded.' + c).join(',');
    db.prepare(`INSERT INTO ${table} (user_id,entry_id,${cols.join(',')},updated_at) VALUES (?,?,${cols.map(() => '?').join(',')},?)
      ON CONFLICT(user_id,entry_id) DO UPDATE SET ${sets},updated_at=excluded.updated_at`)
      .run(uid, entryId, ...vals, Date.now());
  };
  app.post('/api/logs/signal', ...A, (req, res) => {
    const e = (req.body && req.body.entry) || {};
    if (!e.id) return res.status(400).json({ error: 'Entry id required' });
    upsert('signal_logs', req.user.id, e);
    res.json({ ok: true });
  });
  app.post('/api/logs/training', ...A, (req, res) => {
    const e = (req.body && req.body.entry) || {};
    if (!e.id) return res.status(400).json({ error: 'Entry id required' });
    upsert('training_logs', req.user.id, e);
    res.json({ ok: true });
  });
  const admin = [auth, requireRole('admin', 'subadmin')];
  function query(table, timeCol, req, res) {
    const uid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(uid)) return res.status(404).json({ error: 'User not found' });
    const w = ['user_id=?'], p = [uid];
    if (req.query.date) { w.push(`date(${timeCol}/1000,'unixepoch')=?`); p.push(String(req.query.date)); }
    for (const [q, col] of [['coin','coin'],['tf','timeframe'],['side','side'],['result','result']]) {
      if (req.query[q]) { w.push(col + '=?'); p.push(String(req.query[q])); }
    }
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${w.join(' AND ')} ORDER BY ${timeCol} DESC LIMIT 500`).all(...p);
    res.json({ logs: rows });
  }
  app.get('/api/admin/users/:id/signal-logs', ...admin, (req, res) => query('signal_logs', 'created_at', req, res));
  app.get('/api/admin/users/:id/training-logs', ...admin, (req, res) => query('training_logs', 'opened_at', req, res));
  app.get('/api/admin/users/:id/trading-summary', ...admin, (req, res) => {
    const uid = Number(req.params.id);
    const s = db.prepare("SELECT COUNT(*) total, SUM(result='tp') wins, SUM(result='open') open, COALESCE(SUM(pnl_usd),0) pnl FROM signal_logs WHERE user_id=?").get(uid);
    const t = db.prepare('SELECT COUNT(*) total, COALESCE(SUM(pnl_usd),0) pnl FROM training_logs WHERE user_id=?').get(uid);
    res.json({ signal: s, training: t });
  });
}
module.exports = { SCHEMA, setup, registerRoutes };
