'use strict';
// Phase 1: data model for the Mr. Designer -> Mr. Admin design approval flow.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  preview_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  author_bot TEXT NOT NULL DEFAULT 'mr_designer',
  owner_user_id INTEGER,
  current_feedback TEXT,
  implementation_prompt TEXT,
  pipeline_sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS design_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  feedback TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS design_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'revision',
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  created_at INTEGER NOT NULL,
  picked_up_at INTEGER,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_designs_status ON designs(status);
CREATE INDEX IF NOT EXISTS idx_designs_created ON designs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_revisions_design ON design_revisions(design_id, version);
CREATE INDEX IF NOT EXISTS idx_design_tasks_queue ON design_tasks(status, created_at);
`;
const STATUSES = ['PENDING_REVIEW','APPROVED','REJECTED','REVISION_QUEUED','IN_REVISION'];
function setup(db) { db.exec(SCHEMA); }
function addRevision(db, designId, version, status, feedback) {
  db.prepare('INSERT INTO design_revisions (design_id,version,status,feedback,created_at) VALUES (?,?,?,?,?)')
    .run(designId, version, status, feedback || null, Date.now());
}
function buildMasterPrompt(design) {
  const title = String(design.title || 'Untitled design');
  const summary = String(design.summary || '');
  return `# MASTER PROMPT — ${title} (v${design.version})\n\n` +
`Mr. Admin translation of the approved Mr. Designer report. Implementation-ready specification.\n\n` +
`## 1. Component structure and hierarchy\n` +
`- Screen: ${title}\n- Layout > Header > Content > Actions > Footer\n` +
`- Reusable atoms: Button, Card, Avatar, Badge, Input, Modal\n` +
`- State container owns loading, error, empty and success data\n\n` +
`## 2. Layout, spacing, colors, typography\n` +
`- Mobile-first flex/grid, 8px spacing scale (8/12/16/24/32)\n` +
`- Palette: background var(--bg), surface var(--card), border var(--bd), primary #16c784, danger #ea3943\n` +
`- Type: system UI stack, 14px body / 12px meta / 16px headings via var(--tx)\n\n` +
`## 3. States (hover, active, disabled, error, loading)\n` +
`- hover: opacity .88, subtle elevation · active: pressed scale .98\n` +
`- disabled: opacity .5, pointer-events none, aria-disabled\n` +
`- error: inline message with #ea3943 and retry action\n` +
`- loading: skeleton blocks, aria-busy, never layout-shift\n\n` +
`## 4. Responsive behavior\n` +
`- <600px: single column, 12px gutters, full-width buttons, 44px touch targets\n` +
`- >=600px: two-column grid, max-width 960px centered\n` +
`- Never hide primary actions; stack them vertically on narrow screens\n\n` +
`## 5. Props, interactions and expected behavior\n` +
`- props: variant, disabled, loading, onClick, ariaLabel\n` +
`- keyboard: Enter/Space activate, Escape closes modals, focus trap in dialogs\n` +
`- optimistic UI for mutations; rollback on failure; announce with aria-live\n\n` +
`## 6. Actual UI code (React + CSS)\n` +
`\`\`\`jsx\n` +
`export function ${title.replace(/[^A-Za-z0-9]/g, '') || 'Design'}View({ loading, error, data, onSubmit }) {\n` +
`  if (loading) return <div className="skeleton" aria-busy="true" />;\n` +
`  if (error) return <div className="error">{error.message}<button onClick={onSubmit}>Retry</button></div>;\n` +
`  return (\n` +
`    <section className="card">\n` +
`      <header><h2>${title}</h2></header>\n` +
`      <p className="muted">${summary.replace(/[`$\\]/g, '')}</p>\n` +
`      <div className="actions"><button className="btn btn-primary" onClick={onSubmit}>Continue</button></div>\n` +
`    </section>\n` +
`  );\n` +
`}\n` +
`\`\`\`\n` +
`\`\`\`css\n` +
`.card{padding:16px;border:1px solid var(--bd);border-radius:12px;background:var(--card)}\n` +
`.muted{color:var(--mu);font-size:12px}\n` +
`.actions{display:flex;gap:8px;margin-top:16px}\n` +
`.btn{padding:10px 14px;border-radius:8px;min-height:44px;cursor:pointer}\n` +
`.btn-primary{background:#16c784;color:#04140d;border:0}\n` +
`.btn:disabled{opacity:.5;pointer-events:none}\n` +
`.skeleton{height:96px;border-radius:12px;background:var(--card);animation:pulse 1.2s infinite}\n` +
`@media(max-width:599px){.actions{flex-direction:column}.btn{width:100%}}\n` +
`\`\`\`\n\n` +
`Source report summary: ${summary}\n`;
}
function publicDesign(db, d) {
  const revs = db.prepare('SELECT version,status,feedback,created_at FROM design_revisions WHERE design_id=? ORDER BY version DESC').all(d.id);
  return { ...d, revisions: revs };
}
function registerRoutes(app, db, auth, requireRole, logActivity, broadcast) {
  const adminOnly = [auth, requireRole('admin', 'subadmin')];
  app.get('/api/designs', ...adminOnly, (req, res) => {
    const rows = db.prepare('SELECT * FROM designs ORDER BY created_at DESC LIMIT 100').all();
    res.json({ designs: rows.map(d => publicDesign(db, d)) });
  });
  // Mr. Admin relays a finished design report into the review section.
  app.post('/api/designs', ...adminOnly, (req, res) => {
    const { title, summary, preview_url } = req.body || {};
    if (!title || String(title).length < 2) return res.status(400).json({ error: 'Title required' });
    const now = Date.now();
    const info = db.prepare('INSERT INTO designs (title,summary,preview_url,status,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(String(title).slice(0, 160), String(summary || '').slice(0, 2000), preview_url ? String(preview_url).slice(0, 500) : '/icon-192.png', 'PENDING_REVIEW', req.user.id, now, now);
    const id = Number(info.lastInsertRowid);
    addRevision(db, id, 1, 'PENDING_REVIEW', null);
    logActivity(req.user.id, 'design_submitted', String(title).slice(0, 80));
    if (broadcast) broadcast('design_report', { id, title, status: 'PENDING_REVIEW' });
    res.json({ design: publicDesign(db, db.prepare('SELECT * FROM designs WHERE id=?').get(id)) });
  });
  app.post('/api/designs/:id/accept', ...adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const d = db.prepare('SELECT * FROM designs WHERE id=?').get(id);
    if (!d) return res.status(404).json({ error: 'Not found' });
    if (d.status !== 'PENDING_REVIEW' && d.status !== 'IN_REVISION') return res.status(409).json({ error: 'This design is no longer pending review' });
    const prompt = buildMasterPrompt(d);
    db.prepare("UPDATE designs SET status='APPROVED',implementation_prompt=?,pipeline_sent=1,updated_at=? WHERE id=?").run(prompt, Date.now(), id);
    addRevision(db, id, d.version, 'APPROVED', null);
    logActivity(0, 'design_approved', 'design #' + id + ' v' + d.version + ' sent to implementation pipeline');
    if (broadcast) broadcast('design_report', { id, status: 'APPROVED' });
    res.json({ design: publicDesign(db, db.prepare('SELECT * FROM designs WHERE id=?').get(id)), prompt });
  });
  app.post('/api/designs/:id/reject', ...adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const d = db.prepare('SELECT * FROM designs WHERE id=?').get(id);
    if (!d) return res.status(404).json({ error: 'Not found' });
    if (d.status !== 'PENDING_REVIEW' && d.status !== 'IN_REVISION') return res.status(409).json({ error: 'This design is no longer pending review' });
    const feedback = String((req.body && req.body.feedback) || '').slice(0, 2000);
    db.prepare("UPDATE designs SET status='REJECTED',current_feedback=?,updated_at=? WHERE id=?").run(feedback, Date.now(), id);
    addRevision(db, id, d.version, 'REJECTED', feedback);
    const next = d.version + 1;
    db.prepare("INSERT INTO design_tasks (design_id,kind,feedback,status,created_at) VALUES (?,'revision',?,'QUEUED',?)").run(id, feedback, Date.now());
    db.prepare("UPDATE designs SET status='REVISION_QUEUED' WHERE id=?").run(id);
    addRevision(db, id, next, 'REVISION_QUEUED', feedback);
    logActivity(0, 'design_rejected', 'design #' + id + ' v' + d.version + ' queued for Mr. Designer');
    if (broadcast) broadcast('design_report', { id, status: 'REVISION_QUEUED' });
    res.json({ design: publicDesign(db, db.prepare('SELECT * FROM designs WHERE id=?').get(id)) });
  });
  app.get('/api/designs/:id/history', ...adminOnly, (req, res) => {
    const rows = db.prepare('SELECT * FROM design_revisions WHERE design_id=? ORDER BY version ASC, created_at ASC').all(Number(req.params.id));
    res.json({ history: rows });
  });
}
module.exports = { SCHEMA, STATUSES, setup, addRevision, buildMasterPrompt, registerRoutes };
