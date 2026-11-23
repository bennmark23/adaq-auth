const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\index.html';
let t = fs.readFileSync(p, 'utf8');
const marker = 'position:fixed;bottom:70px';
const i = t.indexOf(marker);
if (i === -1) { console.log('marker not found'); process.exit(1); }
// find the start of the div containing it
const start = t.lastIndexOf('<div', i);
// find matching closing: search for </div> after the block; the block ends before </body>
const endMarker = '</body>';
const end = t.indexOf(endMarker, i);
const newBlock = `<div style="position:fixed;top:8px;right:12px;display:flex;align-items:center;gap:8px;z-index:70">
  <button id="profileTopBtn" onclick="document.getElementById('profileModal').classList.remove('hidden')" style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:20px;background:var(--card);border:1px solid var(--bd);cursor:pointer">
    <img id="topAvatar" src="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;background:#232c3b">
    <span id="topUsername" style="font-size:13px">Profile</span>
  </button>
  <button id="adminBtn" onclick="document.getElementById('adminModal').classList.remove('hidden');loadAdmin()" style="padding:6px 10px;border-radius:20px;display:none">Admin</button>
  <button onclick="logout()" style="padding:6px 10px;border-radius:20px">Logout</button>
</div>`;
t = t.slice(0, start) + newBlock + '\n' + t.slice(end);
fs.writeFileSync(p, t, 'utf8');
console.log('done, replaced block');
