const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\auth.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
// line 250 (1-indexed) = index 249
lines[249] = "    if (el) el.innerHTML = (r.users || []).map(u => `<div class=\"msg-item\">${escapeHtml(u.username)} <span class=\"${u.online ? 'online' : 'offline'}\">●</span> <small>${u.role} · ${u.online ? 'online' : 'offline'}</small><br>${u.id !== USER.id && u.role !== 'admin' ? `<button onclick=\"deleteUser(${u.id})\" style=\"margin-right:4px\">Delete</button>` : ''}${u.id !== USER.id ? ` <button onclick=\"genRecovery(${u.id})\">Recovery Link</button>` : ''}<div id=\"rec_${u.id}\" style=\"word-break:break-all;font-size:11px;margin-top:4px\"></div></div>`).join('');";
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('patched admin users list');
console.log(lines[249]);
