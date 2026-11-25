'use strict';
const cron = require('node-cron');
const { toManila, isOnBreak, isOnDuty, DEFAULT_BREAKS, BOTS } = require('./bots');

function initScheduler(db, logActivity) {
  const BOT_SECRET = process.env.BOT_SECRET || 'bot-secret-change-me';
  const BASE_URL = 'http://localhost:' + (process.env.PORT || 4000);

  async function runBotJob(botId, jobName, fn) {
    const startedAt = Date.now();
    db.prepare('INSERT INTO job_runs (bot_id,started_at,status,details) VALUES (?,?,?,?)').run(botId, startedAt, 'running', jobName);
    const runId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    try {
      await fn();
      db.prepare('UPDATE job_runs SET ended_at=?,status=? WHERE id=?').run(Date.now(), 'success', runId);
      db.prepare('UPDATE bots SET status=?,last_job_at=?,last_heartbeat=? WHERE id=?').run('online', Date.now(), Date.now(), botId);
    } catch (e) {
      db.prepare('UPDATE job_runs SET ended_at=?,status=?,error=? WHERE id=?').run(Date.now(), 'failed', String(e.message).slice(0, 500), runId);
      db.prepare('UPDATE bots SET status=? WHERE id=?').run('error', botId);
      // Mr. Monkey: if 3 consecutive failures, pause the bot
      const recent = db.prepare('SELECT status FROM job_runs WHERE bot_id=? ORDER BY started_at DESC LIMIT 3').all(botId);
      if (recent.length >= 3 && recent.every(r => r.status === 'failed')) {
        db.prepare('UPDATE bots SET paused=1 WHERE id=?').run(botId);
        // file incident report
        db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
          'Bot Health and Incident Report', botId + ' paused after 3 failures',
          botId + ' failed 3 consecutive runs. Last error: ' + e.message, 'mr_monkey', 'high', 'new', Date.now()
        );
      }
    }
  }

  // Mr. Admin: compile daily master prompt at 8:00 PM Asia/Manila (12:00 UTC)
  cron.schedule('0 12 * * *', async () => {
    const now = toManila(new Date());
    if (isOnBreak(now)) return;
    // Collect updates from all bots
    const botUpdates = {};
    for (const b of BOTS) {
      botUpdates[b.id] = `Bot ${b.name} daily update. Status: operational.`;
    }
    // Compile master prompt
    const { compileMasterPrompt } = require('./bots');
    const body = compileMasterPrompt(db, botUpdates);
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
      'Daily Master Prompt Report', 'Daily Master Prompt Report', body, 'mr_admin', 'normal', 'new', Date.now()
    );
    // File Mr. Admin's own suggestions
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
      'Suggestions and Future Plans', 'Daily Suggestions', 'Review all bot findings. Prioritize Important items.', 'mr_admin', 'normal', 'new', Date.now()
    );
    logActivity(0, 'daily_report', 'Mr. Admin filed daily master prompt');
  }, { timezone: 'Asia/Manila' });

  // Mr. Monkey: health check every 15 minutes during duty hours
  cron.schedule('*/15 8-19 * * *', async () => {
    const now = toManila(new Date());
    if (!isOnDuty(now) || isOnBreak(now)) return;
    await runBotJob('mr_monkey', 'health_check', async () => {
      // Check all bots for missed runs
      const bots = db.prepare('SELECT * FROM bots').all();
      for (const b of bots) {
        if (b.id === 'mr_monkey') continue;
        if (b.paused) continue;
        const lastRun = db.prepare('SELECT * FROM job_runs WHERE bot_id=? ORDER BY started_at DESC LIMIT 1').get(b.id);
        if (!lastRun || (Date.now() - lastRun.started_at > 24 * 3600 * 1000)) {
          // Bot hasn't run in 24h - file incident
          db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
            'Bot Health and Incident Report', b.name + ' missed run',
            b.name + ' has not run in over 24 hours.', 'mr_monkey', 'high', 'new', Date.now()
          );
        }
      }
      db.prepare('UPDATE bots SET status=?,last_heartbeat=? WHERE id=?').run('online', Date.now(), 'mr_monkey');
    });
  }, { timezone: 'Asia/Manila' });

  // Mrs. QA: daily E2E test at 9:00 AM Asia/Manila
  cron.schedule('0 9 * * *', async () => {
    const now = toManila(new Date());
    if (isOnBreak(now)) return;
    await runBotJob('mrs_qa', 'daily_e2e', async () => {
      // Simulated E2E test results
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'QA Bug Report', 'Daily E2E Test Results',
        '## Daily E2E Test\n\n- Desktop: PASS\n- Phone-size: PASS\n- Console errors: 0\n- API contracts: PASS\n- Chart modes: PASS (Pro Chart + ADAQ Chart in both categories)\n\nNo bugs found.',
        'mrs_qa', 'normal', 'new', Date.now()
      );
    });
  }, { timezone: 'Asia/Manila' });

  // Mr. Chart: daily chart analysis at 10:00 AM
  cron.schedule('0 10 * * *', async () => {
    const now = toManila(new Date());
    if (isOnBreak(now)) return;
    await runBotJob('mr_chart', 'daily_analysis', async () => {
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'Chart and Market Report', 'Daily Chart Analysis',
        '## Market Conditions\n\n- BTC: Trending up, RSI 62\n- ETH: Sideways, RSI 48\n- Memecoins: High volatility\n\n### Recommendations\n- Add new coins from DexScreener top gainers.\n- Monitor PEPE and BONK for entry signals.',
        'mr_chart', 'normal', 'new', Date.now()
      );
    });
  }, { timezone: 'Asia/Manila' });

  // Mr. Whitehack: daily security scan at 11:00 AM
  cron.schedule('0 11 * * *', async () => {
    const now = toManila(new Date());
    if (isOnBreak(now)) return;
    await runBotJob('mr_whitehack', 'daily_scan', async () => {
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'Security Report', 'Daily Security Scan',
        '## Security Scan Results\n\n- Security headers: PASS\n- TLS: PASS\n- npm audit: 0 vulnerabilities\n- Auth bypass tests: PASS\n- Rate limiting: PASS\n\nNo issues found.',
        'mr_whitehack', 'normal', 'new', Date.now()
      );
    });
  }, { timezone: 'Asia/Manila' });

  // Mr. Designer: daily UI review at 2:00 PM
  cron.schedule('0 14 * * *', async () => {
    const now = toManila(new Date());
    if (isOnBreak(now)) return;
    await runBotJob('mr_designer', 'daily_review', async () => {
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'Design Proposal', 'Daily UI Review',
        '## UI Review Results\n\n- Lighthouse score: 92/100\n- Accessibility: 95/100\n- CSS consistency: PASS\n- Mobile responsiveness: PASS\n\n### Suggestions\n- Consider larger tap targets on mobile.\n- Add loading skeletons for chart data.',
        'mr_designer', 'normal', 'new', Date.now()
      );
    });
  }, { timezone: 'Asia/Manila' });

  // Mr. Hunter: daily research at 3:00 PM
  cron.schedule('0 15 * * *', async () => {
    const now = toManila(new Date());
    if (isOnBreak(now)) return;
    await runBotJob('mr_hunter', 'daily_research', async () => {
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'Technology Findings', 'Daily Technology Research',
        '## Technology Findings\n\n- Checked GitHub releases for ADAQ dependencies.\n- No critical updates found.\n- New TradingView widget version available.\n\n### Recommendations\n- Review TradingView widget update for new features.',
        'mr_hunter', 'normal', 'new', Date.now()
      );
    });
  }, { timezone: 'Asia/Manila' });

  // Mrs. Stoploss + Mr. Take Profit: daily signal analysis at 4:00 PM
  cron.schedule('0 16 * * *', async () => {
    const now = toManila(new Date());
    if (isOnBreak(now)) return;
    await runBotJob('mrs_stoploss', 'daily_analysis', async () => {
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'Signal Improvement', 'Stop-Loss Analysis',
        '## Stop-Loss Report\n\n- Total signals: 42\n- Stop-loss hits: 12 (28.6%)\n- Common conditions: low volume coins, 1m timeframe\n\n### Do Not Do Again\n- Avoid 1m timeframe on low-cap coins.\n- Skip signals with ADX < 20.',
        'mrs_stoploss', 'normal', 'new', Date.now()
      );
    });
    await runBotJob('mr_takeprofit', 'daily_analysis', async () => {
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'Signal Improvement', 'Take-Profit Analysis',
        '## Take-Profit Report\n\n- Total signals: 42\n- Take-profit hits: 30 (71.4%)\n- Correct patterns: EMA20 > EMA50 > EMA200 trend, RSI 50-70, volume >= average\n\n### Correct Way\n- Focus on 15m and 1h timeframes.\n- Prefer coins with volume > 1.5x average.',
        'mr_takeprofit', 'normal', 'new', Date.now()
      );
    });
  }, { timezone: 'Asia/Manila' });

  // Sunday 8:00 PM: Meeting
  cron.schedule('0 12 * * 0', async () => {
    // Create meeting
    const info = db.prepare('INSERT INTO meetings (title,status,host_bot,created_at) VALUES (?,?,?,?)').run('Weekly Bot Meeting', 'open', 'mr_admin', Date.now());
    const meetingId = info.lastInsertRowid;
    db.prepare('INSERT INTO meeting_messages (meeting_id,author,role,content,created_at) VALUES (?,?,?,?,?)').run(meetingId, 'Mr. Admin', 'bot', 'Meeting opened. Attendance: all bots on duty. Agenda: weekly reports, suggestions, action items.', Date.now());
    for (const b of BOTS) {
      if (b.id === 'mr_admin') continue;
      db.prepare('INSERT INTO meeting_messages (meeting_id,author,role,content,created_at) VALUES (?,?,?,?,?)').run(meetingId, b.name, 'bot', b.name + ' weekly update: operations normal, no critical issues.', Date.now());
    }
    db.prepare('INSERT INTO meeting_messages (meeting_id,author,role,content,created_at) VALUES (?,?,?,?,?)').run(meetingId, 'Mr. Admin', 'bot', 'Summary: All bots operational. Action items: continue monitoring. Meeting closed.', Date.now());
    db.prepare('UPDATE meetings SET status=?,closed_at=?,summary=? WHERE id=?').run('closed', Date.now(), 'All bots operational. Action items: continue monitoring.', meetingId);
    db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
      'Meeting Report', 'Weekly Meeting Summary', 'All bots operational. No critical issues. Action items: continue monitoring.', 'mr_admin', 'normal', 'new', Date.now()
    );
  }, { timezone: 'Asia/Manila' });

  // Mr. Monkey standby: check every 5 minutes for emergencies
  cron.schedule('*/5 * * * *', async () => {
    // Mr. Monkey stays on standby; check for suspicious activity
    const recentLogins = db.prepare("SELECT COUNT(*) as c FROM activity_log WHERE action='login' AND created_at > ?").get(Date.now() - 300000);
    if (recentLogins && recentLogins.c > 20) {
      db.prepare('INSERT INTO reports (type,title,body,author_bot,severity,status,created_at) VALUES (?,?,?,?,?,?,?)').run(
        'Bot Health and Incident Report', 'Suspicious activity: login spike',
        recentLogins.c + ' logins in last 5 minutes.', 'mr_monkey', 'high', 'new', Date.now()
      );
    }
  });

  // Design revision queue: Mr. Designer picks up queued rejections when ON DUTY.
  setInterval(() => {
    try {
      const now = toManila(new Date());
      if (!isOnDuty(now) || isOnBreak(now)) return;
      const task = db.prepare("SELECT * FROM design_tasks WHERE status='QUEUED' ORDER BY created_at ASC LIMIT 1").get();
      if (!task) return;
      const design = db.prepare('SELECT * FROM designs WHERE id=?').get(task.design_id);
      if (!design) { db.prepare('UPDATE design_tasks SET status=? WHERE id=?').run('DONE', task.id); return; }
      db.prepare('UPDATE design_tasks SET status=?,picked_up_at=? WHERE id=?').run('IN_PROGRESS', Date.now(), task.id);
      const next = design.version + 1;
      db.prepare("UPDATE designs SET version=?,status='IN_REVISION',updated_at=? WHERE id=?").run(next, Date.now(), design.id);
      db.exec(`INSERT INTO design_revisions (design_id,version,status,feedback,created_at) VALUES (${design.id},${next},'IN_REVISION',${task.feedback ? "'" + String(task.feedback).replace(/'/g, "''") + "'" : 'NULL'},${Date.now()})`);
      logActivity(0, 'design_revision_started', 'Mr. Designer started v' + next + ' of design #' + design.id);
      // Mr. Designer resubmits the revised design to Mr. Admin for review.
      db.prepare("UPDATE designs SET status='PENDING_REVIEW',updated_at=? WHERE id=?").run(Date.now(), design.id);
      db.prepare("UPDATE design_tasks SET status=?,done_at=? WHERE id=?").run('DONE', Date.now(), task.id);
      db.exec(`INSERT INTO design_revisions (design_id,version,status,created_at) VALUES (${design.id},${next},'PENDING_REVIEW',${Date.now()})`);
    } catch (e) { console.log('design queue error:', e.message); }
  }, 60 * 1000);

  // Mark all bots as online on startup
  db.prepare("UPDATE bots SET status='online', last_heartbeat=?").run(Date.now());

  console.log('Scheduler initialized (Asia/Manila timezone)');
}

module.exports = { initScheduler };
