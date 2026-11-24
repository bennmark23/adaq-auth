'use strict';
window.__authLoaded = 'start';
function getServerUrl() {
  const cu = LS('cu', '');
  const val = cu || localStorage.getItem('adaq_server_url') || location.origin;
  return String(val).replace(/\/+$/, '').replace(/^"|"$/g, '');
}
const SERVER_URL = getServerUrl();
const API = SERVER_URL + '/api';
let TOKEN = sessionStorage.getItem('adaq_token') || '';
// clear legacy localStorage token from old builds
localStorage.removeItem('adaq_token');
// remember last user for login screen display
let LAST_USER = null;
try { LAST_USER = JSON.parse(localStorage.getItem('adaq_last_user') || 'null'); } catch (e) {}
let USER = null;
const $$ = s => document.querySelector(s);

function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
  if (TOKEN) opts.headers.authorization = 'Bearer ' + TOKEN;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
  if (opts.body instanceof FormData) delete opts.headers['content-type'];
  const url = getServerUrl() + '/api' + path;
  return fetch(url, opts).then(async r => {
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
    if (!r.ok) throw new Error((j && j.error) || r.statusText);
    return j;
  });
}

function showLogin() {
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function hideLogin() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('app').style.display = '';
}

// ---- Login ----
function loginAsRemembered() {
  const lu = document.getElementById('loginUser');
  if (LAST_USER && lu) lu.value = LAST_USER.username;
  // show password + totp, hide remember buttons
  const rb = document.getElementById('rememberBtns'); if (rb) rb.style.display = 'none';
  document.getElementById('loginPass').focus();
}
function useAnotherAccount() {
  LAST_USER = null;
  localStorage.removeItem('adaq_last_user');
  const rb = document.getElementById('rememberBtns'); if (rb) rb.remove();
  const av = document.getElementById('loginAvatar'); if (av) av.src = '';
  const nm = document.getElementById('loginName'); if (nm) nm.textContent = '';
  document.getElementById('loginUser').style.display = '';
}
async function doLogin() {
  const u = ADMIN_MODE ? 'admin' : document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const t = document.getElementById('loginTotp').value.trim();
  const msg = document.getElementById('loginMsg');
  msg.textContent = '';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: u, password: p, totp: t, adminMode: ADMIN_MODE } });
    if (r.mustChangePassword) { TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user; hideLogin(); showChangePassword(); return; }
    if (r.needsTotpEnroll) { TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user; hideLogin(); showEnroll(r); return; }
    if (r.totpRequired) { msg.textContent = 'TOTP code required'; return; }
    TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user;
    localStorage.setItem('adaq_last_user', JSON.stringify({ username: r.user.username, avatar: r.user.avatar }));
    hideLogin(); await afterLogin();
  } catch (e) { msg.textContent = e.message; }
}

function showChangePassword() {
  document.getElementById('cpModal').classList.remove('hidden');
}
async function submitChangePassword() {
  const oldP = document.getElementById('cpOld').value;
  const newP = document.getElementById('cpNew').value;
  const msg = document.getElementById('cpMsg');
  try {
    const r = await api('/auth/change-password', { method: 'POST', body: { oldPassword: oldP, newPassword: newP } });
    document.getElementById('cpModal').classList.add('hidden');
    // show enrollment
    document.getElementById('enrollQr').src = r.qr;
    document.getElementById('enrollSecret').textContent = r.totpSecret;
    document.getElementById('enrollModal').classList.remove('hidden');
  } catch (e) { msg.textContent = e.message; }
}
async function submitEnroll() {
  const code = document.getElementById('enrollCode').value.trim();
  const msg = document.getElementById('enrollMsg');
  try {
    await api('/auth/enroll-totp', { method: 'POST', body: { code } });
    document.getElementById('enrollModal').classList.add('hidden');
    await afterLogin();
  } catch (e) { msg.textContent = e.message; }
}

// ---- Registration via invite ----
function getInviteToken() {
  const m = location.search.match(/[?&]token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function showRegister(token) {
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('loginBox').style.display = 'none';
  document.getElementById('registerBox').style.display = 'block';
  document.getElementById('regToken').value = token;
  try {
    const r = await fetch(getServerUrl() + '/api/invite/' + token);
    const j = await r.json();
    document.getElementById('regRole').textContent = 'Role: ' + (j.role || '');
  } catch (e) {}
}
async function doRegister() {
  const token = document.getElementById('regToken').value;
  const u = document.getElementById('regUser').value.trim();
  const p = document.getElementById('regPass').value;
  const msg = document.getElementById('regMsg');
  try {
    const r = await api('/invite/' + token + '/register', { method: 'POST', body: { username: u, password: p } });
    TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user;
    // needs TOTP enroll
    document.getElementById('registerBox').style.display = 'none';
    document.getElementById('authOverlay').style.display = 'none';
    document.getElementById('app').style.display = '';
    // trigger enrollment by changing password? Instead enroll directly: server didn't return secret; fetch via change-password? 
    // For invite users, password_must_change is 0, totp not enabled. Login returns needsTotpEnroll only if totp not enabled AND not mustChange.
    // Re-login flow: force enrollment via a synthetic change? Simpler: call a helper to start enrollment.
    await startTotpEnrollment();
  } catch (e) { msg.textContent = e.message; }
}
async function startTotpEnrollment() {
  // enroll by requesting a secret via change-password? We need a password change. Instead, add endpoint? 
  // Use existing: must change password first. For invite users, prompt to set a "new" password same as current? Not ideal.
  // Simpler: show enroll modal with a generated client-side? No, secret must be server-stored.
  // We'll call change-password with old=new? Not allowed (wrong old). 
  // Fallback: ask user to change password first.
  document.getElementById('cpModal').classList.remove('hidden');
  document.getElementById('cpMsg').textContent = 'Set your password (then scan the QR).';
}

// ---- After login ----
async function afterLogin() {
  try { USER = (await api('/auth/me')).user; } catch (e) { logout(); return; }
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('app').style.display = '';
  applyTheme(USER.theme);
  // load announcements
  loadAnnouncements();
  // load messages
  loadMessages();
  // admin panel visibility
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.style.display = (USER.role === 'admin' || USER.role === 'subadmin') ? '' : 'none';
  // Admin's Features nav item (admin only)
  const adminNav = document.getElementById('adminNavBtn');
  if (adminNav) adminNav.style.display = USER.role === 'admin' ? '' : 'none';
  // Debug: log role
  console.log('Logged in as:', USER.username, 'role:', USER.role, 'adminMode:', ADMIN_MODE);
  // profile name
  const pn = document.getElementById('profileName'); if (pn) pn.textContent = USER.username;
  const tu = document.getElementById('topUsername'); if (tu) tu.textContent = USER.username;
  const ta = document.getElementById('topAvatar'); if (ta && USER.avatar) ta.src = USER.avatar;
  // connect websocket
  connectWS();
  // report filter handlers
  const rf = document.getElementById('reportFilter');
  const rtf = document.getElementById('reportTypeFilter');
  if (rf) rf.onchange = loadReports;
  if (rtf) rtf.onchange = loadReports;
  // presence heartbeat
  setInterval(() => { api('/activity', { method: 'POST', body: { action: 'heartbeat' } }).catch(() => {}); }, 30000);
}

function logout() {
  TOKEN = ''; sessionStorage.removeItem('adaq_token'); USER = null;
  showLogin();
  document.getElementById('loginBox').style.display = 'block';
  document.getElementById('registerBox').style.display = 'none';
}

// ---- Theme ----
function applyTheme(t) {
  document.body.className = 'th-' + (t || 'dark');
  if (USER) USER.theme = t;
}

// ---- Announcements ----
// ---- Announcement carousel ----
let _announceList = [];
let _announceIdx = 0;
let _announceTimer = null;

function renderAnnounceCarousel() {
  const wrap = document.getElementById('announceWrap');
  if (!wrap) return;
  if (!_announceList.length) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const a = _announceList[_announceIdx % _announceList.length];
  wrap.innerHTML = `<div id="announceCarousel" style="background:#f5a524;color:#04140d;padding:8px 12px;border-radius:10px;font-weight:600;position:relative;overflow:hidden;cursor:grab;user-select:none">
    <span id="announceText">Announcement: ${escapeHtml(a.content)}</span>
    <div style="position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;gap:4px">
      <button onclick="announcePrev()" style="background:none;border:0;cursor:pointer;font-size:14px;padding:0 4px">◀</button>
      <button onclick="announceNext()" style="background:none;border:0;cursor:pointer;font-size:14px;padding:0 4px">▶</button>
    </div>
  </div>
  <div style="text-align:center;font-size:10px;color:#8791a3;margin-top:2px">${_announceIdx+1} / ${_announceList.length}</div>`;
  // touch swipe
  const car = document.getElementById('announceCarousel');
  if (car) {
    let startX = 0;
    car.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, {passive:true});
    car.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - startX; if (Math.abs(dx) > 40) { dx < 0 ? announceNext() : announcePrev(); } }, {passive:true});
  }
}

function announceNext() { _announceIdx = (_announceIdx + 1) % _announceList.length; renderAnnounceCarousel(); resetAnnounceTimer(); }
function announcePrev() { _announceIdx = (_announceIdx - 1 + _announceList.length) % _announceList.length; renderAnnounceCarousel(); resetAnnounceTimer(); }
function resetAnnounceTimer() {
  if (_announceTimer) clearInterval(_announceTimer);
  _announceTimer = setInterval(() => { announceNext(); }, 60000);
}

async function loadAnnouncements() {
  try {
    const r = await api('/announcements');
    const now = Date.now();
    const recent = (r.announcements || []).filter(a => now - a.created_at < 3600000);
    _announceList = recent;
    _announceIdx = 0;
    renderAnnounceCarousel();
    resetAnnounceTimer();
    loadPastAnnouncements();
  } catch (e) {}
}
async function loadPastAnnouncements() {
  try {
    const r = await api('/announcements');
    const el = document.getElementById('pastAnnounceList');
    if (!el) return;
    el.innerHTML = (r.announcements || []).map(a => `<div class="msg-item"><small>${new Date(a.created_at).toLocaleString()}</small> ${escapeHtml(a.content)} <button onclick="deleteAnnouncement(${a.id})" style="float:right">Remove</button></div>`).join('') || '<small>No past announcements.</small>';
  } catch (e) {}
}
async function deleteAnnouncement(id) {
  try { await api('/announcements/' + id, { method: 'DELETE' }); loadPastAnnouncements(); loadAnnouncements(); } catch (e) { alert(e.message); }
}

// ---- Messages ----
async function loadMessages() {
  try {
    const r = await api('/messages');
    const list = document.getElementById('msgList');
    if (!list) return;
    list.innerHTML = (r.messages || []).map(m => `<div class="msg-item"><b>${escapeHtml(m.from_name || '')}</b> <small>${new Date(m.created_at).toLocaleString()}</small><br>${escapeHtml(m.content || '')}${m.image_path ? '<br><img src="' + m.image_path + '" style="max-width:200px">' : ''}${m.pinned ? ' =?' : ''}</div>`).join('');
  } catch (e) {}
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function sendMessage() {
  const content = document.getElementById('msgInput').value.trim();
  const to = document.getElementById('msgTo').value;
  if (!content) return;
  const fd = new FormData();
  fd.append('content', content);
  if (to) fd.append('to_user', to);
  const enc = document.getElementById('msgEnc').value;
  if (enc) fd.append('encrypted_mode', enc);
  const img = document.getElementById('msgImg').files[0];
  if (img) fd.append('image', img);
  try {
    await api('/messages', { method: 'POST', body: fd });
    document.getElementById('msgInput').value = '';
    loadMessages();
  } catch (e) { alert(e.message); }
}

// ---- Profile ----
async function saveProfile() {
  const theme = document.getElementById('profTheme').value;
  const alerts = document.getElementById('profAlerts').checked;
  await api('/profile', { method: 'PUT', body: { theme, alerts_on: alerts } });
  if (USER) { USER.theme = theme; USER.alerts_on = alerts; }
  applyTheme(theme);
  alert('Saved');
}
async function changeUsername() {
  const u = document.getElementById('profNewUser').value.trim();
  try {
    const r = await api('/profile/username', { method: 'POST', body: { username: u } });
    TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user;
    document.getElementById('profileName').textContent = USER.username;
    alert('Username changed');
  } catch (e) { alert(e.message); }
}
async function uploadAvatar() {
  const f = document.getElementById('profAvatarFile').files[0];
  if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  try {
    const r = await api('/profile/avatar', { method: 'POST', body: fd });
    if (USER) USER.avatar = r.avatar;
    const img = document.getElementById('profAvatarImg'); if (img) img.src = r.avatar;
    const ta = document.getElementById('topAvatar'); if (ta) ta.src = r.avatar;
  } catch (e) { alert(e.message); }
}
async function addJournal() {
  const e = document.getElementById('journalInput').value.trim();
  if (!e) return;
  await api('/journal', { method: 'POST', body: { entry: e } });
  document.getElementById('journalInput').value = '';
  loadJournal();
}
async function loadJournal() {
  try {
    const r = await api('/journal');
    const el = document.getElementById('journalList');
    if (!el) return;
    el.innerHTML = (r.entries || []).map(x => `<div class="msg-item"><small>${new Date(x.created_at).toLocaleString()}</small><br>${escapeHtml(x.entry)}</div>`).join('');
  } catch (e) {}
}

// ---- Admin ----
async function loadAdmin() {
  try {
    const r = await api('/admin/users');
    const el = document.getElementById('adminUsers');
    if (el) el.innerHTML = (r.users || []).map(u => `<div class="msg-item">${escapeHtml(u.username)} <span class="${u.online ? 'online' : 'offline'}">?</span> <small>${u.role} ? ${u.online ? 'online' : 'offline'}</small><br>${u.id !== USER.id && u.role !== 'admin' ? `<button onclick="deleteUser(${u.id})" style="margin-right:4px">Delete</button>` : ''}${u.id !== USER.id ? ` <button onclick="genRecovery(${u.id})">Recovery Link</button>` : ''}<div id="rec_${u.id}" style="word-break:break-all;font-size:11px;margin-top:4px"></div></div>`).join('');
  } catch (e) {}
  try {
    const r = await api('/admin/activity');
    const el = document.getElementById('adminActivity');
    if (el) el.innerHTML = (r.activity || []).slice(0, 50).map(a => `<div class="msg-item"><small>${new Date(a.created_at).toLocaleString()}</small> <b>${escapeHtml(a.username || '')}</b> ${escapeHtml(a.action)} ${escapeHtml(a.detail || '')}</div>`).join('');
  } catch (e) {}
}
async function createInvite() {
  const role = document.getElementById('inviteRole').value;
  try {
    const r = await api('/invitations', { method: 'POST', body: { role } });
    const out = document.getElementById('inviteOut');
    if (out) out.innerHTML = 'Link: <a href="' + r.link + '" target="_blank">' + r.link + '</a>';
  } catch (e) { alert(e.message); }
}
async function sendAnnouncement() {
  const c = document.getElementById('announceInput').value.trim();
  if (!c) return;
  try {
    await api('/announcements', { method: 'POST', body: { content: c } });
    document.getElementById('announceInput').value = '';
    loadAnnouncements();
    loadPastAnnouncements();
  } catch (e) { alert(e.message); }
}

// ---- WebSocket ----
let ws = null;
function connectWS() {
  if (ws) try { ws.close(); } catch (e) {}
  const base = getServerUrl();
  const proto = base.startsWith('https') ? 'wss:' : 'ws:';
  const host = base.replace(/^https?:\/\//, '');
  ws = new WebSocket(proto + '//' + host + '/?token=' + encodeURIComponent(TOKEN));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === 'announcement') { loadAnnouncements(); }
    if (m.type === 'message') { loadMessages(); }
  };
  ws.onclose = () => { setTimeout(connectWS, 3000); };
}

// ---- init ----
const ADMIN_MODE = !!window.__ADMIN_MODE;

async function init() {
  // Always require login on app open (clear any stored token)
  sessionStorage.removeItem('adaq_token');
  TOKEN = '';
  // Admin mode: fixed username, permanent avatar, only password + authenticator
  if (ADMIN_MODE) {
    const lu = document.getElementById('loginUser');
    if (lu) { lu.value = 'admin'; lu.readOnly = true; lu.style.display = 'block'; }
    const lt = document.getElementById('loginTotp');
    if (lt) lt.placeholder = "Whats your favorite snack";
    // permanently fixed admin avatar
    const loginAvatar = document.getElementById('loginAvatar');
    if (loginAvatar) { loginAvatar.src = 'icon-192.png'; loginAvatar.style.display = 'block'; }
    const loginName = document.getElementById('loginName');
    if (loginName) loginName.textContent = 'Admin';
  }
  // User mode: remember me
  if (!ADMIN_MODE) {
    const lu = document.getElementById('loginUser');
    if (lu) { lu.value = ''; lu.style.display = 'block'; lu.readOnly = false; }
    const lt = document.getElementById('loginTotp');
    if (lt) lt.placeholder = "Whats your favorite snack";
    const loginAvatar = document.getElementById('loginAvatar');
    const loginName = document.getElementById('loginName');
    if (LAST_USER) {
      if (loginAvatar && LAST_USER.avatar) loginAvatar.src = LAST_USER.avatar;
      if (loginName) loginName.textContent = LAST_USER.username || '';
      // Add "Login as" / "Use another account" buttons
      const box = document.getElementById('loginBox');
      if (box && !document.getElementById('rememberBtns')) {
        const div = document.createElement('div');
        div.id = 'rememberBtns';
        div.style.marginTop = '8px';
        div.innerHTML = `<button onclick="loginAsRemembered()" style="width:100%;margin-bottom:4px">Login as ${escapeHtml(LAST_USER.username)}</button>
          <button onclick="useAnotherAccount()" style="width:100%;background:none;border:1px solid var(--bd)">Use another account</button>`;
        const btn = box.querySelector('button[onclick="doLogin()"]');
        if (btn) box.insertBefore(div, btn);
      }
    } else {
      // No prior login: show "Welcome Champ" only
      if (loginAvatar) loginAvatar.style.display = 'none';
      if (loginName) loginName.textContent = '';
    }
  }
  // If no server URL is set and we're not on web, prompt the user
  if (!LS('cu', '') && !/^https?:/.test(location.protocol)) {
    const u = prompt('Enter your ADAQ server URL (e.g. https://adaq-auth.onrender.com):');
    if (u) { SV('cu', u.trim()); location.reload(); return; }
  }
  const params = new URLSearchParams(location.search);
  if (params.get('recover') === '1') {
    const t = sessionStorage.getItem('adaq_token');
    if (t) { TOKEN = t; }
    const sec = sessionStorage.getItem('adaq_pending_secret');
    const qr = sessionStorage.getItem('adaq_pending_qr');
    if (sec && qr) {
      try { USER = (await api('/auth/me')).user; } catch (e) {}
      hideLogin();
      document.getElementById('enrollQr').src = qr;
      document.getElementById('enrollSecret').textContent = sec;
      document.getElementById('enrollModal').classList.remove('hidden');
      // clear pending
      sessionStorage.removeItem('adaq_pending_secret');
      sessionStorage.removeItem('adaq_pending_qr');
      return;
    }
  }
  const token = getInviteToken();
  if (token) { showRegister(token); return; }
  // show last user's avatar on login screen
  if (LAST_USER) {
    const av = document.getElementById('loginAvatar'); if (av && LAST_USER.avatar) av.src = LAST_USER.avatar;
    const un = document.getElementById('loginUser'); if (un && LAST_USER.username) un.value = LAST_USER.username;
    const nm = document.getElementById('loginName'); if (nm) nm.textContent = LAST_USER.username || '';
  }
  if (TOKEN) {
    try { USER = (await api('/auth/me')).user; hideLogin(); await afterLogin(); return; }
    catch (e) { logout(); return; }
  }
  showLogin();
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(init, 0);
} else {
  window.addEventListener('load', init);
}
// session reset on visibility hidden / pagehide
document.addEventListener('visibilitychange', () => { if (document.hidden) { /* keep token; server tracks last_active */ } });
window.addEventListener('pagehide', () => { /* optional: logout(); */ });

// ---- Admin's Features ----
function switchAdminTab2(t) {
  ['bots','users','reports','meeting'].forEach(x => {
    const el = document.getElementById('adminTab2_' + x);
    if (el) el.style.display = x === t ? 'block' : 'none';
  });
  document.querySelectorAll('#v-admin .tabbar button').forEach((b, i) => {
    b.classList.toggle('on', ['bots','users','reports','meeting'][i] === t);
  });
  if (t === 'bots') loadBots();
  if (t === 'users') loadUsers();
  if (t === 'reports') loadReports();
  if (t === 'meeting') loadMeeting();
}
async function loadBots() {
  const el = document.getElementById('botsList');
  if (!el) return;
  try {
    const r = await api('/admin/members?type=bot');
    el.innerHTML = (r.members || []).map(b => `<div class="msg-item">
      <span class="${b.status === 'online' || b.status === 'on_duty' ? 'online' : 'offline'}">●</span>
      <b>${escapeHtml(b.name)}</b> <small>${b.role}</small>
      <br><small>${escapeHtml(b.description || '')}</small>
      <br><small>Status: ${b.status}${b.paused ? ' (paused)' : ''}</small>
      ${USER.role === 'admin' ? `<br><button onclick="toggleBotPause('${b.id}')" style="margin-top:4px">${b.paused ? 'Resume' : 'Pause'}</button>` : ''}
    </div>`).join('') || '<small>No bots.</small>';
  } catch (e) { el.innerHTML = '<small style="color:#ea3943">' + escapeHtml(e.message) + '</small>'; }
}
async function loadUsers() {
  const el = document.getElementById('usersList');
  if (!el) return;
  try {
    const r = await api('/admin/members?type=user');
    el.innerHTML = (r.members || []).map(u => `<div class="msg-item">
      <span class="${u.status === 'online' ? 'online' : 'offline'}">●</span>
      <b>${escapeHtml(u.name)}</b> <small>${u.role}</small>
      <br><small>${u.status} · last active: ${u.last_active ? new Date(u.last_active).toLocaleString() : 'never'}</small>
      ${USER.role === 'admin' && u.id !== 'u_' + USER.id ? `<br><button onclick="deleteUserAccount(${u.id.replace('u_','')})" style="margin-top:4px;color:#ea3943">Delete</button> <button onclick="genRecoveryLink(${u.id.replace('u_','')})">Recovery Link</button>` : ''}
      <div id="rec_${u.id}" style="font-size:11px;margin-top:4px"></div>
    </div>`).join('') || '<small>No users.</small>';
  } catch (e) { el.innerHTML = '<small style="color:#ea3943">' + escapeHtml(e.message) + '</small>'; }
}
async function loadReports() {
  const el = document.getElementById('reportsList');
  if (!el) return;
  const status = document.getElementById('reportFilter').value;
  const type = document.getElementById('reportTypeFilter').value;
  try {
    let url = '/admin/reports';
    const params = [];
    if (status) params.push('status=' + status);
    if (type) params.push('type=' + encodeURIComponent(type));
    if (params.length) url += '?' + params.join('&');
    const r = await api(url);
    el.innerHTML = (r.reports || []).map(rep => `<div class="msg-item">
      <b>${escapeHtml(rep.title)}</b> <small>${rep.type} · ${rep.severity} · ${rep.author_bot}</small>
      <br><small>${new Date(rep.created_at).toLocaleString()} · status: ${rep.status}</small>
      <div style="margin-top:4px;font-size:13px">${escapeHtml(rep.body).slice(0, 200)}${rep.body.length > 200 ? '...' : ''}</div>
      <div style="margin-top:4px">
        <button onclick="markReport(${rep.id},'read')" style="margin-right:4px">Mark Read</button>
        <button onclick="markReport(${rep.id},'done')" style="margin-right:4px">Done</button>
        <button onclick="markReport(${rep.id},'to_priority')">Priority</button>
      </div>
    </div>`).join('') || '<small>No reports.</small>';
  } catch (e) { el.innerHTML = '<small style="color:#ea3943">' + escapeHtml(e.message) + '</small>'; }
}
async function markReport(id, status) {
  try { await api('/admin/reports/' + id, { method: 'PATCH', body: { status } }); loadReports(); } catch (e) { alert(e.message); }
}
async function toggleBotPause(id) {
  try { await api('/admin/bots/' + id + '/pause', { method: 'POST' }); loadBots(); } catch (e) { alert(e.message); }
}
async function deleteUserAccount(id) {
  if (!confirm('Delete this user?')) return;
  try { await api('/admin/users/' + id, { method: 'DELETE' }); loadUsers(); } catch (e) { alert(e.message); }
}
async function genRecoveryLink(id) {
  try {
    const r = await api('/admin/users/' + id + '/recovery', { method: 'POST' });
    const el = document.getElementById('rec_u_' + id);
    if (!el) {
      // find the user's div
      const divs = document.querySelectorAll('#usersList .msg-item');
      // just alert
    }
    alert('Recovery link: ' + r.link);
  } catch (e) { alert(e.message); }
}
async function loadAdminPath() {
  try {
    const r = await api('/admin/admin-path');
    const el = document.getElementById('adminPathDisplay');
    if (el) el.textContent = (location.origin) + '/' + r.path;
  } catch (e) { alert(e.message); }
}
async function regenerateAdminPath() {
  if (!confirm('Regenerate admin link? The old link will stop working.')) return;
  try {
    const r = await api('/admin/admin-path/regenerate', { method: 'POST' });
    const el = document.getElementById('adminPathDisplay');
    if (el) el.textContent = (location.origin) + '/' + r.path;
    alert('New admin link: ' + location.origin + '/' + r.path);
  } catch (e) { alert(e.message); }
}
async function loadMeeting() {
  const el = document.getElementById('meetingArea');
  if (!el) return;
  try {
    const r = await api('/admin/meetings/current');
    if (!r.meeting) { el.innerHTML = '<small>No active meeting.</small>'; return; }
    const msgs = r.messages || [];
    el.innerHTML = `<div style="max-height:300px;overflow:auto;border:1px solid var(--bd);padding:8px;border-radius:8px;margin-bottom:8px">
      ${msgs.map(m => `<div style="margin-bottom:6px"><b>${escapeHtml(m.author)}</b> <small>${new Date(m.created_at).toLocaleTimeString()}</small><br>${escapeHtml(m.content)}</div>`).join('')}
    </div>`;
  } catch (e) { el.innerHTML = '<small style="color:#ea3943">' + escapeHtml(e.message) + '</small>'; }
}
async function openMeeting() {
  try {
    await api('/admin/meetings', { method: 'POST', body: { title: 'Weekly Bot Meeting' } });
    loadMeeting();
  } catch (e) { alert(e.message); }
}

// expose
window.switchAdminTab2 = switchAdminTab2;
window.loadBots = loadBots;
window.loadUsers = loadUsers;
window.loadReports = loadReports;
window.markReport = markReport;
window.toggleBotPause = toggleBotPause;
window.deleteUserAccount = deleteUserAccount;
window.genRecoveryLink = genRecoveryLink;
window.loadMeeting = loadMeeting;
window.openMeeting = openMeeting;
window.loadAdminPath = loadAdminPath;
window.regenerateAdminPath = regenerateAdminPath;

// expose
window.doLogin = doLogin; window.logout = logout; window.submitChangePassword = submitChangePassword;
window.submitEnroll = submitEnroll; window.doRegister = doRegister; window.saveProfile = saveProfile;
window.changeUsername = changeUsername; window.uploadAvatar = uploadAvatar; window.addJournal = addJournal;
async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  try { await api('/admin/users/' + id, { method: 'DELETE' }); loadAdmin(); } catch (e) { alert(e.message); }
}
async function genRecovery(id) {
  try {
    const r = await api('/admin/users/' + id + '/recovery', { method: 'POST' });
    const el = document.getElementById('rec_' + id);
    if (el) el.innerHTML = 'Recovery link: <a href="' + r.link + '" target="_blank">' + r.link + '</a>';
  } catch (e) { alert(e.message); }
}
window.deleteUser = deleteUser;
window.genRecovery = genRecovery;
window.announceNext = announceNext;
window.announcePrev = announcePrev;
window.loadJournal = loadJournal; window.loadAdmin = loadAdmin; window.createInvite = createInvite;
window.sendAnnouncement = sendAnnouncement; window.sendMessage = sendMessage; window.loadMessages = loadMessages;
window.__authLoaded = 'done';
