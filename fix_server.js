const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\server\\server.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

// Lines 463-497 (1-indexed) = indices 462-496 (0-indexed, exclusive end 497)
// Replace lines 463-497 (1-indexed) which is indices 462 to 496 (exclusive end)
const startIdx = 462; // line 463 (1-indexed)
const endIdx = 497;   // line 498 (1-indexed), exclusive

const newBlock = [
  "// ---- Serve client (static) - AFTER all API routes ----",
  "// CLIENT_DIR is always client/public (the source of truth), NOT server/public which can be stale",
  "const CLIENT_DIR = path.join(__dirname, '..', 'client', 'public');",
  "console.log('CLIENT_DIR:', CLIENT_DIR);",
  "if (!fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {",
  "  console.error('CLIENT_DIR not found:', CLIENT_DIR);",
  "} else {",
  "  app.use(express.static(CLIENT_DIR, { maxAge: 0 })); // no caching",
  "  app.get('*', (req, res) => {",
  "    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return res.status(404).end();",
  "    const adminPath = (db.prepare('SELECT value FROM settings WHERE key=?').get('admin_path') || {}).value || 'thisisnottheadmin';",
  "    // Only serve the app for / and the admin path",
  "    if (req.path === '/') {",
  "      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');",
  "      return res.sendFile(path.join(CLIENT_DIR, 'index.html'));",
  "    }",
  "    if (req.path === '/' + adminPath) {",
  "      let html = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8');",
  "      html = html.replace('</head>', '<script>window.__ADMIN_MODE=true;</script></head>');",
  "      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');",
  "      res.set('Pragma', 'no-cache');",
  "      return res.type('html').send(html);",
  "    }",
  "    // Allow invite.html and recover.html",
  "    if (req.path === '/invite.html' || req.path === '/recover.html') {",
  "      const file = path.join(CLIENT_DIR, req.path.slice(1));",
  "      if (fs.existsSync(file)) return res.sendFile(file);",
  "    }",
  "    // Everything else = 404",
  "    return res.status(404).send('Not Found');",
  "  });",
  "}",
];

lines.splice(startIdx, endIdx - startIdx, ...newBlock);

fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log("Fixed server.js");
