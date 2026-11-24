const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\auth.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
// Replace lines 378-380
lines[377] = '  // Keep session on refresh; clear on app close (handled by Electron main.js / OS)';
lines[378] = '  TOKEN = sessionStorage.getItem(\'adaq_token\') || \'\';';
lines[379] = '';
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('patched refresh');
// verify
console.log(lines[377]);
console.log(lines[378]);
