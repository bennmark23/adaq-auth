'use strict';
window.__authLoaded = 'start';
const SERVER_URL = (LS('cu', '') || localStorage.getItem('adaq_server_url') || location.origin).replace(/\/+$/, '');
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
  return fetch(API + path, opts).then(async r => {
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
async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const t = document.getElementById('loginTotp').value.trim();
  const msg = document.getElementById('loginMsg');
  msg.textContent = '';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: u, password: p, totp: t } });
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
    const r = await fetch(API + '/invite/' + token);
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
  // profile name
  const pn = document.getElementById('profileName'); if (pn) pn.textContent = USER.username;
  const tu = document.getElementById('topUsername'); if (tu) tu.textContent = USER.username;
  const ta = document.getElementById('topAvatar'); if (ta && USER.avatar) ta.src = USER.avatar;
  // connect websocket
  connectWS();
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
async function loadAnnouncements() {
  try {
    const r = await api('/announcements');
    const bar = document.getElementById('announceBar');
    const wrap = document.getElementById('announceWrap');
    if (!bar || !wrap) return;
    if (bar.parentElement !== wrap) wrap.appendChild(bar);
    const now = Date.now();
    const recent = (r.announcements || []).filter(a => now - a.created_at < 3600000);
    const latest = recent[0];
    if (latest) { bar.textContent = 'Announcement: ' + latest.content; bar.style.display = 'block'; }
    else bar.style.display = 'none';
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
  let base = SERVER_URL;
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
async function init() {
  // Always require login on app open (clear any stored token)
  sessionStorage.removeItem('adaq_token');
  TOKEN = '';
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
window.loadJournal = loadJournal; window.loadAdmin = loadAdmin; window.createInvite = createInvite;
window.sendAnnouncement = sendAnnouncement; window.sendMessage = sendMessage; window.loadMessages = loadMessages;
window.__authLoaded = 'done';
