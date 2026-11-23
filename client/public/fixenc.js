const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\index.html';
const t = fs.readFileSync(p, 'utf8');
// Fix mojibake: encode as latin1, decode as utf8
const fixed = Buffer.from(t, 'latin1').toString('utf8');
fs.writeFileSync(p, fixed, 'utf8');
// count remaining Â
const c = (fixed.match(/Â/g) || []).length;
console.log('remaining Â:', c);
// also fix auth.js
const p2 = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\auth.js';
const t2 = fs.readFileSync(p2, 'utf8');
const fixed2 = Buffer.from(t2, 'latin1').toString('utf8');
fs.writeFileSync(p2, fixed2, 'utf8');
console.log('auth.js remaining Â:', (fixed2.match(/Â/g)||[]).length);
