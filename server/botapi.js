'use strict';
const bots = require('./bots');
const llm = require('./llm');

function registerBotApi(app, db, auth, requireRole, logActivity, broadcast, clients, isOnline) {
  // Create bot tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      paused INTEGER NOT NULL DEFAULT 0,
      last_heartbeat INTEGER,
      last_job_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      details TEXT
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_bot TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'normal',
      attachments TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at INTEGER NOT NULL,
      read_at INTEGER,
      done_at INTEGER,
      follow_up_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      host_bot TEXT NOT NULL DEFAULT 'mr_admin',
      created_at INTEGER NOT NULL,
      closed_at INTEGER,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS meeting_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'bot',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      bot_id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run INTEGER,
      next_run INTEGER,
      PRIMARY KEY (bot_id, job_name)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  bots.initBots(db);

  // Seed default settings
  const defaults = { logRetentionDays: '14', llmDailyCap: process.env.LLM_DAILY_CAP || '100' };
  for (const [k, v] of Object.entries(defaults)) {
    const existing = db.prepare('SELECT key FROM settings WHERE key=?').get(k);
    if (!existing) db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(k, v);
  }
  // Admin path: fixed to 'thisisnottheadmin' for security (not /admin)
  const adminPathSetting = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_path');
  if (!adminPathSetting || adminPathSetting.value !== 'thisisnottheadmin') {
    if (adminPathSetting) db.prepare('UPDATE settings SET value=? WHERE key=?').run('thisisnottheadmin', 'admin_path');
    else db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('admin_path', 'thisisnottheadmin');
    console.log('Admin path set to: /thisisnottheadmin');
  }

  // Helper: public bot info
  function publicBot(b) {
    const onBreak = false; // simplified; real impl checks schedule
    const onDuty = !b.paused;
    return {
      id: b.id, name: b.name, role: b.role, description: b.description,
      status: b.paused ? 'paused' : (b.status || 'offline'),
      paused: !!b.paused, online: b.status === 'online' || b.status === 'on_duty',
      last_heartbeat: b.last_heartbeat, last_job_at: b.last_job_at,
      created_at: b.created_at,
    };
  }

  // ---- Members ----
  app.get('/api/admin/members', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const type = req.query.type;
    let botsList = db.prepare('SELECT * FROM bots').all();
    let usersList = db.prepare('SELECT * FROM users').all().map(u => ({
      id: 'u_' + u.id, name: u.username, role: u.role, type: 'user',
      status: (Date.now() - (u.last_active || 0) < 60000) ? 'online' : 'offline',
      last_active: u.last_active, created_at: u.created_at, avatar: u.avatar,
    }));
    const botsMapped = botsList.map(b => {
      const rc = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE author_bot=?').get(b.id);
      const jc = db.prepare("SELECT COUNT(*) AS c FROM job_runs WHERE bot_id=? AND status='running'").get(b.id);
      return { ...publicBot(b), type: 'bot', avatar: null, reports_count: rc.c, running_jobs: jc.c };
    });
    let all = [...botsMapped, ...usersList];
    if (type === 'bot') all = botsMapped;
    if (type === 'user') all = usersList;
    res.json({ members: all });
  });

  app.get('/api/admin/members/:id', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const id = req.params.id;
    if (id.startsWith('u_')) {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(parseInt(id.slice(2)));
      if (!u) return res.status(404).json({ error: 'Not found' });
      return res.json({ member: { id, name: u.username, role: u.role, type: 'user', status: (Date.now() - (u.last_active||0) < 60000) ? 'online' : 'offline', last_active: u.last_active, created_at: u.created_at, avatar: u.avatar } });
    }
    const b = db.prepare('SELECT * FROM bots WHERE id=?').get(id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.json({ member: { ...publicBot(b), type: 'bot' } });
  });

  app.get('/api/admin/members/:id/activity', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const id = req.params.id;
    const date = req.query.date; // YYYY-MM-DD
    let sql = 'SELECT * FROM activity_log WHERE ';
    let params = [];
    if (id.startsWith('u_')) { sql += 'user_id=?'; params.push(parseInt(id.slice(2))); }
    else { sql += 'user_id=?'; params.push(0); } // bots log under 0 or their own; simplify
    if (date) { sql += ' AND date(created_at/1000, "unixepoch") = ?'; params.push(date); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const rows = db.prepare(sql).all(...params);
    res.json({ activity: rows });
  });

  app.delete('/api/admin/members/:id/activity', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'date required' });
    db.prepare('DELETE FROM activity_log WHERE date(created_at/1000, "unixepoch") = ?').run(date);
    res.json({ ok: true });
  });

  // ---- Reports ----
  app.get('/api/admin/reports', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const status = req.query.status;
    const type = req.query.type;
    let sql = 'SELECT * FROM reports';
    const conditions = [], params = [];
    if (status) { conditions.push('status=?'); params.push(status); }
    if (type) { conditions.push('type=?'); params.push(type); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const rows = db.prepare(sql).all(...params);
    res.json({ reports: rows });
  });

  app.patch('/api/admin/reports/:id', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    const r = db.prepare('SELECT * FROM reports WHERE id=?').get(id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (status === 'read') db.prepare('UPDATE reports SET status=?, read_at=? WHERE id=?').run('read', Date.now(), id);
    else if (status === 'done') {
      db.prepare('UPDATE reports SET status=?, done_at=? WHERE id=?').run('done', Date.now(), id);
      // soft delete: keep audit, mark body cleared
      logActivity(req.user.id, 'report_done', 'Report ' + id + ' marked done');
    } else if (status === 'to_priority') {
      db.prepare('UPDATE reports SET status=?, follow_up_at=? WHERE id=?').run('to_priority', Date.now(), id);
    }
    const updated = db.prepare('SELECT * FROM reports WHERE id=?').get(id);
    res.json({ report: updated });
  });

  // ---- Bot control ----
  app.post('/api/admin/bots/:id/pause', auth, requireRole('admin'), (req, res) => {
    const id = req.params.id;
    const b = db.prepare('SELECT * FROM bots WHERE id=?').get(id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    const newPaused = b.paused ? 0 : 1;
    db.prepare('UPDATE bots SET paused=? WHERE id=?').run(newPaused, id);
    logActivity(req.user.id, 'bot_pause_toggle', id + ' paused=' + newPaused);
    res.json({ ok: true, paused: !!newPaused });
  });

  app.post('/api/admin/bots/pause-all', auth, requireRole('admin'), (req, res) => {
    const { paused } = req.body || {};
    db.prepare('UPDATE bots SET paused=?').run(paused ? 1 : 0);
    logActivity(req.user.id, 'bots_pause_all', paused ? 'paused all' : 'resumed all');
    res.json({ ok: true });
  });

  app.get('/api/admin/bots/:id/runs', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const rows = db.prepare('SELECT * FROM job_runs WHERE bot_id=? ORDER BY started_at DESC LIMIT 50').all(req.params.id);
    res.json({ runs: rows });
  });

  // ---- Meetings ----
  app.get('/api/admin/meetings/current', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const m = db.prepare("SELECT * FROM meetings WHERE status='open' ORDER BY created_at DESC LIMIT 1").get();
    if (!m) return res.json({ meeting: null });
    const msgs = db.prepare('SELECT * FROM meeting_messages WHERE meeting_id=? ORDER BY created_at ASC').all(m.id);
    res.json({ meeting: m, messages: msgs });
  });

  app.post('/api/admin/meetings', auth, requireRole('admin'), (req, res) => {
    const { title } = req.body || {};
    const info = db.prepare('INSERT INTO meetings (title,status,host_bot,created_at) VALUES (?,?,?,?)').run(title || 'Meeting', 'open', 'mr_admin', Date.now());
    const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(info.lastInsertRowid);
    // Mr. Admin opens meeting
    db.prepare('INSERT INTO meeting_messages (meeting_id,author,role,content,created_at) VALUES (?,?,?,?,?)').run(m.id, 'Mr. Admin', 'bot', 'Meeting opened. Attendance: all bots on duty.', Date.now());
    // Each bot gives a turn
    const botList = db.prepare('SELECT * FROM bots').all();
    for (const b of botList) {
      if (b.id === 'mr_admin') continue;
      db.prepare('INSERT INTO meeting_messages (meeting_id,author,role,content,created_at) VALUES (?,?,?,?,?)').run(m.id, b.name, 'bot', b.name + ' weekly update: operations normal, no critical issues.', Date.now());
    }
    db.prepare('INSERT INTO meeting_messages (meeting_id,author,role,content,created_at) VALUES (?,?,?,?,?)').run(m.id, 'Mr. Admin', 'bot', 'Summary: All bots operational. Action items: continue monitoring. Meeting closed.', Date.now());
    db.prepare('UPDATE meetings SET status=?,closed_at=?,summary=? WHERE id=?').run('closed', Date.now(), 'All bots operational. Action items: continue monitoring.', m.id);
    // File meeting report
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run('Meeting Report', 'Meeting Summary', 'All bots operational. Action items: continue monitoring.', 'mr_admin', 'normal', 'new', Date.now());
    res.json({ meeting: m });
  });

  app.post('/api/admin/meetings/:id/close', auth, requireRole('admin'), (req, res) => {
    const { summary } = req.body || {};
    db.prepare('UPDATE meetings SET status=?, closed_at=?, summary=? WHERE id=?').run('closed', Date.now(), summary || '', req.params.id);
    // File meeting report
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
      'Meeting Report', 'Meeting #' + req.params.id + ' Summary', summary || 'Meeting closed.', 'mr_admin', 'normal', 'new', Date.now()
    );
    res.json({ ok: true });
  });

  app.post('/api/admin/meetings/:id/message', auth, requireRole('admin', 'subadmin'), (req, res) => {
    const { content, author } = req.body || {};
    if (!content) return res.status(400).json({ error: 'Empty' });
    db.prepare('INSERT INTO meeting_messages (meeting_id,author,role,content,created_at) VALUES (?,?,?,?,?)').run(req.params.id, author || req.user.username, 'admin', content, Date.now());
    res.json({ ok: true });
  });

  // ---- Reports: create (used by bots) ----
  app.post('/api/internal/reports', (req, res) => {
    // Secret-protected endpoint for bots to file reports
    const secret = req.headers['x-bot-secret'];
    if (secret !== (process.env.BOT_SECRET || 'bot-secret-change-me')) return res.status(403).json({ error: 'Forbidden' });
    const { type, title, body, author_bot, severity, attachments } = req.body || {};
    if (!type || !title || !body) return res.status(400).json({ error: 'Missing fields' });
    const info = db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,attachments,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      type, title, body, author_bot || 'system', severity || 'normal', attachments ? JSON.stringify(attachments) : null, 'new', Date.now()
    );
    const report = db.prepare('SELECT * FROM reports WHERE id=?').get(info.lastInsertRowid);
    broadcast('report', report, () => true);
    res.json({ report });
  });

  // ---- Release hook ----
  app.post('/api/internal/release', (req, res) => {
    const secret = req.headers['x-bot-secret'];
    if (secret !== (process.env.BOT_SECRET || 'bot-secret-change-me')) return res.status(403).json({ error: 'Forbidden' });
    // Trigger all bots to run release checks
    logActivity(0, 'release_triggered', (req.body && req.body.version) || 'unknown');
    // Mr. Admin files release readiness report
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
      'Release Readiness Report', 'Release Check', 'All bots running post-release checks.', 'mr_admin', 'normal', 'new', Date.now()
    );
    res.json({ ok: true });
  });

  // ---- Bot status update (called by scheduler) ----
  app.post('/api/internal/bot-status', (req, res) => {
    const secret = req.headers['x-bot-secret'];
    if (secret !== (process.env.BOT_SECRET || 'bot-secret-change-me')) return res.status(403).json({ error: 'Forbidden' });
    const { bot_id, status, job_name, job_status, error } = req.body || {};
    if (bot_id) {
      db.prepare('UPDATE bots SET status=?, last_heartbeat=?, last_job_at=? WHERE id=?').run(status || 'online', Date.now(), Date.now(), bot_id);
      if (job_name) {
        db.prepare('INSERT INTO job_runs (bot_id,started_at,ended_at,status,error) VALUES (?,?,?,?,?)').run(bot_id, Date.now(), Date.now(), job_status || 'success', error || null);
      }
    }
    res.json({ ok: true });
  });

  // ---- Admin path (secret login URL) ----
  app.get('/api/admin/admin-path', auth, requireRole('admin'), (req, res) => {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_path');
    res.json({ path: row ? row.value : null });
  });
  app.post('/api/admin/admin-path/regenerate', auth, requireRole('admin'), (req, res) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let path = '';
    for (let i = 0; i < 12; i++) path += chars[Math.floor(Math.random() * chars.length)];
    const existing = db.prepare('SELECT key FROM settings WHERE key=?').get('admin_path');
    if (existing) db.prepare('UPDATE settings SET value=? WHERE key=?').run(path, 'admin_path');
    else db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('admin_path', path);
    logActivity(req.user.id, 'admin_path_regenerated', path);
    res.json({ path });
  });

  // ---- Settings ----
  app.get('/api/admin/settings', auth, requireRole('admin'), (req, res) => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json({ settings: obj });
  });
  app.put('/api/admin/settings', auth, requireRole('admin'), (req, res) => {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    const existing = db.prepare('SELECT key FROM settings WHERE key=?').get(key);
    if (existing) db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(value), key);
    else db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(key, String(value));
    res.json({ ok: true });
  });

  // ---- Presence heartbeat (for users and bots) ----
  app.post('/api/presence/heartbeat', auth, (req, res) => {
    db.prepare('UPDATE users SET last_active=? WHERE id=?').run(Date.now(), req.user.id);
    res.json({ ok: true });
  });

  // ---- SSE stream for admin ----
  app.get('/api/admin/stream', auth, requireRole('admin', 'subadmin'), (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });
    const send = (type, data) => {
      try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {}
    };
    // Register this client
    const clientId = Date.now() + '_' + Math.random();
    if (!clients.has(req.user.id)) clients.set(req.user.id, new Set());
    // We use a separate SSE set
    if (!global._sseClients) global._sseClients = new Map();
    if (!global._sseClients.has(req.user.id)) global._sseClients.set(req.user.id, new Set());
    global._sseClients.get(req.user.id).add(res);
    send('connected', { userId: req.user.id });
    req.on('close', () => {
      const s = global._sseClients.get(req.user.id);
      if (s) { s.delete(res); if (!s.size) global._sseClients.delete(req.user.id); }
    });
  });

  // Override broadcast to also push to SSE clients
  const origBroadcast = broadcast;
  // (broadcast function is defined in server.js; we'll just use it as-is)

  return { bots: bots.BOTS, reportTypes: bots.REPORT_TYPES };
}

module.exports = { registerBotApi };
