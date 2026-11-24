const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\server\\server.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
// Replace lines 475-487 (1-indexed) = indices 474-486
const startIdx = 474;
const endIdx = 487; // exclusive
const newLines = [
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
];
lines.splice(startIdx, endIdx - startIdx, ...newLines);
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('fixed catch-all');