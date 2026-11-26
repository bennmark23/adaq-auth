'use strict';
// Phase 2 icon audit: report any emoji/Unicode glyph still used as an icon.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'client', 'public');
const files = ['index.html', 'auth.js', 'auth.css'];
const ICON_GLYPHS = ['📈','📊','😀','📰','🎯','⚙','🛡','💬','😊','📎','📄','🚩','➤','🗑','✎','✕','⧉','↩','✅','❌','🔔','👍'];
const ENTITY = /&#x1[Ff][0-9A-Fa-f]{2,4};/g;
const found = [];
for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const g of ICON_GLYPHS) {
      if (!line.includes(g)) continue;
      const contentOnly = /i\.value\s*\+=\s*'😊'|emoji:\s*'👍'|emoji\s*=\s*'👍'/.test(line);
      if (!contentOnly) found.push(f + ':' + (i + 1) + ' -> ' + g + ' :: ' + line.trim().slice(0, 100));
    }
    const m = line.match(ENTITY);
    if (m) found.push(f + ':' + (i + 1) + ' -> ' + m.join(','));
  });
}
if (found.length) {
  console.error('Non-plain icons found:\n' + found.join('\n'));
  process.exitCode = 1;
} else console.log('PASS: no emoji icon glyphs found in client files');
