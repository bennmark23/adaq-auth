'use strict';
// Regression: legacy/local signal entries can have no created_at/opened_at.
// Upsert must never violate NOT NULL, and retries must keep the original time.
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const tl = require('../trading_logs');
const db = new DatabaseSync(':memory:');
tl.setup(db);
const routes = {};
const pass = (req, res, next) => next();
tl.registerRoutes({ post: (p, ...h) => { routes[p] = h; }, get: () => {} }, db, pass, () => pass);
const post = (p, entry) => {
  const handlers = routes[p];
  handlers[handlers.length - 1]({ user: { id: 7 }, body: { entry } }, { json: () => {} }, () => {});
};
(async () => {
  post('/api/logs/signal', { id: 'legacy-1', coin: 'BTC', created_at: null, closed_at: null });
  let row = db.prepare("SELECT * FROM signal_logs WHERE entry_id='legacy-1'").get();
  assert.ok(row && Number(row.created_at) > 0, 'missing created_at is replaced with a valid time');
  const original = row.created_at;
  await new Promise(r => setTimeout(r, 5));
  post('/api/logs/signal', { id: 'legacy-1', coin: 'BTC', created_at: undefined });
  row = db.prepare("SELECT * FROM signal_logs WHERE entry_id='legacy-1'").get();
  assert.equal(row.created_at, original, 'retry preserves the original created_at');
  post('/api/logs/training', { id: 'legacy-2', coin: 'ETH', opened_at: undefined, closed_at: null });
  const t = db.prepare("SELECT * FROM training_logs WHERE entry_id='legacy-2'").get();
  assert.ok(t && Number(t.opened_at) > 0, 'missing opened_at is replaced with a valid time');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM signal_logs').get().c, 1, 'retry did not duplicate the row');
  console.log('PASS: legacy trading logs with missing timestamps upsert safely');
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
