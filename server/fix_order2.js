const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\server\\server.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
// Replace lines 449-482 (1-indexed) = indices 448-481
const startIdx = 448; // 0-indexed for line 449
const endIdx = 482; // exclusive, up to line 482
const newLines = [
  "// Test route before bot API",
  "app.get('/api/test/before', (req, res) => res.json({ ok: true, msg: 'before botapi' }));",
  "// Debug: test route before bot API",
  "app.get('/api/test/before2', (req, res) => res.json({ ok: true, msg: 'before botapi 2' }));",
  "// Register bot API (must be before the catch-all)",
  "const botInfo = registerBotApi(app, db, auth, requireRole, logActivity, broadcast, clients, isOnline);",
  "console.log('Bot API registered. Routes:', app._router.stack.filter(s=>s.route).map(s=>s.route.path).filter(p=>p.includes('admin')).length);",
  "",
  "// ---- Serve client (static) - AFTER all API routes ----",
  "const candidates = [",
  "  path.join(__dirname, 'public'),",
  "  path.join(process.cwd(), 'public'),",
  "  path.join(__dirname, '..', 'client', 'public'),",
  "  path.join(__dirname, 'client', 'public'),",
  "  path.join(process.cwd(), 'client', 'public'),",
  "];",
  "const CLIENT_DIR = candidates.find(p => fs.existsSync(path.join(p, 'index.html')));",
  "console.log('CLIENT_DIR resolved:', CLIENT_DIR);",
  "if (CLIENT_DIR) {",
  "  app.use(express.static(CLIENT_DIR));",
  "  app.get('*', (req, res) => {",
  "    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return res.status(404).end();",
  "    res.sendFile(path.join(CLIENT_DIR, 'index.html'));",
  "  });",
  "} else {",
  "  app.get('/', (req, res) => res.status(200).send('<h1>ADAQ server running</h1><p>Client files not found.</p>'));",
  "  console.error('NO CLIENT DIR FOUND');",
  "}",
  "",
  "// Debug: test route after bot API",
  "app.get('/api/test/after2', (req, res) => res.json({ ok: true, msg: 'after botapi 2' }));",
  "// Test route after bot API",
  "app.get('/api/test/after', (req, res) => res.json({ ok: true, msg: 'after botapi' }));",
];
lines.splice(startIdx, endIdx - startIdx, ...newLines);
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('fixed route order');
console.log('new line count:', lines.length);
