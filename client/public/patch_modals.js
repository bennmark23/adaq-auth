const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\index.html';
let t = fs.readFileSync(p, 'utf8');

// cpModal
t = t.replace(
  '<div id="cpModal" class="modal hidden"><div class="sheet">\n  <h3>Change Password</h3>',
  '<div id="cpModal" class="modal hidden"><div class="sheet">\n  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Change Password</h3><button onclick="document.getElementById(\'cpModal\').classList.add(\'hidden\')" style="background:none;border:0;font-size:20px;cursor:pointer;padding:0 6px">X</button></div>'
);

// enrollModal
t = t.replace(
  '<div id="enrollModal" class="modal hidden"><div class="sheet">\n  <h3>Set up Authenticator</h3>',
  '<div id="enrollModal" class="modal hidden"><div class="sheet">\n  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Set up Authenticator</h3><button onclick="document.getElementById(\'enrollModal\').classList.add(\'hidden\')" style="background:none;border:0;font-size:20px;cursor:pointer;padding:0 6px">X</button></div>'
);

// profileModal
t = t.replace(
  '<div id="profileModal" class="modal hidden"><div class="sheet">\n  <h3>Profile</h3>',
  '<div id="profileModal" class="modal hidden"><div class="sheet">\n  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Profile</h3><button onclick="document.getElementById(\'profileModal\').classList.add(\'hidden\')" style="background:none;border:0;font-size:20px;cursor:pointer;padding:0 6px">X</button></div>'
);

// Remove bottom Close button in profile modal
t = t.replace("  <button onclick=\"document.getElementById('profileModal').classList.add('hidden')\">Close</button>\n", "");

fs.writeFileSync(p, t, 'utf8');
console.log('done');
// verify
console.log('cpModal X:', t.includes("cpModal').classList.add('hidden')"));
console.log('enrollModal X:', t.includes("enrollModal').classList.add('hidden')"));
console.log('profileModal X:', t.includes("profileModal').classList.add('hidden')"));
console.log('bottom close removed:', !t.includes('<button onclick="document.getElementById(\'profileModal\').classList.add(\'hidden\')">Close</button>'));
