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
module.exports = { SCHEMA, STATUSES, setup, addRevision };
