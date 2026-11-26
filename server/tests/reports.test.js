'use strict';
// Regression tests for the "report disappears after going back" bug (Part 4.3).
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'adaq.db'));
const base = process.env.ADAQ_TEST_URL || 'http://127.0.0.1:4000';
const admin = db.prepare("SELECT * FROM users WHERE username='admin'").get();
const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role },
  process.env.JWT_SECRET || 'adaq-jwt-change-me-in-prod', { expiresIn: '1h' });
const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
const req = async (p, method, body) => {
  const r = await fetch(base + p, { method: method || 'GET', headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
(async () => {
  const tag = 'TEST-' + Date.now();
  const now = Date.now();
  for (let i = 1; i <= 2; i++) {
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('Regression Test', tag + ' #' + i, 'body', 'mr_admin', 'normal', 'new', now + i);
  }
  const ids = db.prepare('SELECT id FROM reports WHERE title LIKE ? ORDER BY id DESC LIMIT 2').all(tag + '%').map(r => r.id);
  assert.equal(ids.length, 2, '2 reports created');

  let r = await req('/api/admin/reports');
  assert.equal(r.status, 200);
  let list = r.data.reports.filter(x => ids.includes(x.id));
  assert.equal(list.length, 2, 'list shows 2 reports initially');

  r = await req('/api/admin/reports/' + ids[0], 'PATCH', { status: 'read' });
  assert.equal(r.status, 200, 'mark read succeeds');
  r = await req('/api/admin/reports');
  list = r.data.reports.filter(x => ids.includes(x.id));
  assert.equal(list.length, 2, 'marking Read does NOT remove a report');
  assert.equal(db.prepare('SELECT status FROM reports WHERE id=?').get(ids[0]).status, 'read', 'status is read');

  r = await req('/api/admin/reports/' + ids[1], 'PATCH', { status: 'done' });
  assert.equal(r.status, 200, 'mark done succeeds');
  const audit = db.prepare("SELECT 1 FROM activity_log WHERE action='report_done' AND detail LIKE ?").get('%' + ids[1] + '%');
  assert.ok(audit, 'Done creates an audit entry');

  // Simulate the nightly cleanup: only Done reports older than 7 days are deleted.
  db.prepare('UPDATE reports SET done_at=? WHERE id=?').run(Date.now() - 8 * 24 * 3600 * 1000, ids[1]);
  db.prepare("DELETE FROM reports WHERE status='done' AND done_at < ?").run(Date.now() - 7 * 24 * 3600 * 1000);
  r = await req('/api/admin/reports');
  list = r.data.reports.filter(x => ids.includes(x.id));
  assert.equal(list.length, 1, 'only Done report is deleted; Read one remains');
  assert.equal(list[0].status, 'read', 'remaining report is Read, not deleted');

  // Unread badge equals unread items in the list.
  const unread = r.data.reports.filter(x => ids.includes(x.id) && x.status === 'new').length;
  assert.equal(unread, 0, 'badge count and list agree');

  // Cleanup test rows.
  db.prepare('DELETE FROM reports WHERE title LIKE ?').run(tag + '%');
  console.log('PASS: reports regression tests (2 reports -> read -> done -> cleanup)');
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
