'use strict';
// Bot platform: definitions, scheduler integration, report building
// All bots are deterministic. LLM is optional for wording.

const { DatabaseSync } = require('node:sqlite');

const BOTS = [
  { id: 'mr_admin', name: 'Mr. Admin', role: 'admin', desc: 'Compiles reports, hosts meetings, follows up unread reports' },
  { id: 'mr_monkey', name: 'Mr. Monkey', role: 'supervisor', desc: 'Monitors bot health, server health, suspicious activity, runs monkey tests' },
  { id: 'mr_hunter', name: 'Mr. Hunter', role: 'researcher', desc: 'Gathers outside info from free public sources' },
  { id: 'mr_designer', name: 'Mr. Designer', role: 'ui_reviewer', desc: 'Automated UI review with Lighthouse, axe-core, CSS checks' },
  { id: 'mr_chart', name: 'Mr. Chart', role: 'analyst', desc: 'Analyzes charts, reports market conditions, recommends coins' },
  { id: 'mrs_stoploss', name: 'Mrs. Stoploss', role: 'analyst', desc: 'Analyzes stop-loss outcomes, finds common conditions' },
  { id: 'mr_takeprofit', name: 'Mr. Take Profit', role: 'analyst', desc: 'Analyzes take-profit outcomes, finds correct patterns' },
  { id: 'mrs_qa', name: 'Mrs. QA', role: 'tester', desc: 'End-to-end tests on desktop and phone, regression checks' },
  { id: 'mr_whitehack', name: 'Mr. Whitehack', role: 'security', desc: 'Non-destructive security checks of ADAQ only' },
];

const REPORT_TYPES = [
  'Daily Master Prompt Report', 'Priority', 'Meeting Report', 'Suggestions and Future Plans',
  'Design Proposal', 'Chart and Market Report', 'Signal Improvement', 'QA Bug Report',
  'Security Report', 'Technology Findings', 'Bot Health and Incident Report',
  'Release Readiness Report', 'Weekly Summary',
];

// Break windows (Asia/Manila) - default
const DEFAULT_BREAKS = [
  { start: '10:00', end: '10:30', label: 'Morning break' },
  { start: '12:00', end: '13:00', label: 'Noon break' },
  { start: '17:00', end: '17:30', label: 'Evening break' },
];

const DUTY_START = '08:00';
const DUTY_END = '20:00';

function isOnBreak(nowManila) {
  const hm = nowManila.getHours() * 60 + nowManila.getMinutes();
  for (const b of DEFAULT_BREAKS) {
    const [sh, sm] = b.start.split(':').map(Number);
    const [eh, em] = b.end.split(':').map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em;
    if (hm >= s && hm < e) return b;
  }
  return null;
}

function isOnDuty(nowManila) {
  const hm = nowManila.getHours() * 60 + nowManila.getMinutes();
  const [sh, sm] = DUTY_START.split(':').map(Number);
  const [eh, em] = DUTY_END.split(':').map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return hm >= s && hm < e;
}

function toManila(date) {
  // Asia/Manila is UTC+8, no DST
  return new Date(date.getTime() + 8 * 3600 * 1000);
}

function initBots(db) {
  for (const b of BOTS) {
    const existing = db.prepare('SELECT id FROM bots WHERE id=?').get(b.id);
    if (!existing) {
      db.prepare('INSERT INTO bots (id,name,role,description,status,paused,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(b.id, b.name, b.role, b.desc, 'offline', 0, Date.now());
    }
  }
}

// Generate a structured weekly update for a bot (template-based, no LLM)
function buildBotUpdate(botId, db) {
  const now = new Date();
  const lines = [];
  lines.push(`## ${BOTS.find(b=>b.id===botId)?.name || botId} — Daily Update`);
  lines.push(`Date: ${now.toISOString().slice(0,10)}`);
  lines.push('');
  lines.push('### Activity Summary');
  const runs = db.prepare('SELECT * FROM job_runs WHERE bot_id=? ORDER BY started_at DESC LIMIT 5').all(botId);
  if (runs.length) {
    for (const r of runs) lines.push(`- ${new Date(r.started_at).toISOString()} — ${r.status} (${r.ended_at ? Math.round((r.ended_at-r.started_at)/1000)+'s' : 'running'})`);
  } else {
    lines.push('- No jobs run yet.');
  }
  lines.push('');
  lines.push('### Observations');
  lines.push('- System operating normally.');
  lines.push('');
  lines.push('### Recommendations');
  lines.push('- None at this time.');
  return lines.join('\n');
}

// Mr. Admin compiles the daily master prompt report from all bot updates
function compileMasterPrompt(db, botUpdates) {
  const lines = [];
  lines.push('# Daily Master Prompt Report');
  lines.push(`Date: ${new Date().toISOString().slice(0,10)}`);
  lines.push('');
  lines.push('## Compiled from all bot reports');
  lines.push('');
  for (const [botId, update] of Object.entries(botUpdates)) {
    lines.push(`### ${BOTS.find(b=>b.id===botId)?.name || botId}`);
    lines.push(update);
    lines.push('');
  }
  lines.push('## Mr. Admin Suggestions');
  lines.push('- Review all bot findings above.');
  lines.push('- Prioritize any items marked as Important.');
  lines.push('');
  lines.push('## Future Plans');
  lines.push('- Continue monitoring and data collection.');
  return lines.join('\n');
}

module.exports = {
  BOTS, REPORT_TYPES, DEFAULT_BREAKS, DUTY_START, DUTY_END,
  isOnBreak, isOnDuty, toManila, initBots, buildBotUpdate, compileMasterPrompt,
};
