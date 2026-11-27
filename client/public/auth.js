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
// The admin account must never appear on the normal user login page.
if (LAST_USER && LAST_USER.username === 'admin') {
  LAST_USER = null;
  try { localStorage.removeItem('adaq_last_user'); } catch (e) {}
}
let USER = null;
const $$ = s => document.querySelector(s);

// Remove the pre-paint auth guard (index.html) once the auth state is known.
function authReady() { document.documentElement.classList.remove('adaq-auth-pending'); }
// Keep the login screen's remembered user (name + avatar) in sync with the account.
async function validateLastUser() {
  if (!LAST_USER || !LAST_USER.username || ADMIN_MODE) return;
  try {
    const r = await fetch(getServerUrl() + '/api/public/user-exists?username=' + encodeURIComponent(LAST_USER.username));
    const j = await r.json();
    if (!j.exists) {
      LAST_USER = null;
      try { localStorage.removeItem('adaq_last_user'); localStorage.removeItem('adaq_last_name'); } catch (e) {}
    }
  } catch (e) {}
}
function setLoginGreeting() {
  const el = document.getElementById('loginGreeting');
  if (!el) return;
  // The admin URL never uses the remembered user record (it belongs to the user account).
  if (ADMIN_MODE) { el.textContent = 'Welcome Champ'; return; }
  const name = LAST_USER && typeof LAST_USER === 'object' ? String(LAST_USER.username || '').trim() : '';
  el.textContent = name && name !== 'admin' ? 'Welcome back, ' + name : 'Welcome Champ';
}
function rememberUser(u) {
  if (!u || !u.username) return;
  if (u.username === 'admin') return; // admin is only shown on the admin URL
  LAST_USER = { username: u.username, avatar: u.avatar || '' };
  try { localStorage.setItem('adaq_last_user', JSON.stringify(LAST_USER)); } catch (e) {}
  try { localStorage.setItem('adaq_last_name', u.username); } catch (e) {}
  setLoginGreeting();
}
function setLoginAvatar(url) {
  const av = document.getElementById('loginAvatar');
  if (!av) return;
  av.style.display = 'block';
  av.onerror = function () { av.onerror = null; av.src = 'icon-192.png'; };
  av.src = url
    ? (/^(https?:|data:|blob:)/.test(url) ? url : getServerUrl() + url)
    : 'icon-192.png';
}

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
    if (!r.ok) { const err = new Error((j && j.error) || r.statusText); err.status = r.status; throw err; }
    return j;
  });
}

function showLogin() {
  authReady();
  setLoginGreeting();
  renderLoginMode();
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function hideLogin() {
  authReady();
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('app').style.display = '';
}

// ---- Login ----
// Remembered account: username is fixed; only password + authenticator are needed.
// No remembered account: normal username + password + authenticator form.
function renderLoginMode() {
  if (ADMIN_MODE) return;
  const lu = document.getElementById('loginUser');
  const loginName = document.getElementById('loginName');
  const box = document.getElementById('loginBox');
  const mainBtn = document.getElementById('loginBtn');
  const old = document.getElementById('rememberBtns');
  if (old) old.remove();
  if (LAST_USER) {
    setLoginAvatar(LAST_USER.avatar);
    if (loginName) loginName.textContent = LAST_USER.username || '';
    if (lu) { lu.value = LAST_USER.username; lu.readOnly = true; lu.style.opacity = '0.7'; }
    if (box && mainBtn) {
      const div = document.createElement('div');
      div.id = 'rememberBtns';
      div.style.marginTop = '8px';
      div.innerHTML = `<button onclick="doLogin()" style="width:100%">Login as ${escapeHtml(LAST_USER.username)}</button>`;
      box.insertBefore(div, mainBtn);
    }
    if (mainBtn) { mainBtn.textContent = 'Login in another account'; mainBtn.onclick = switchAccount; }
  } else {
    const av = document.getElementById('loginAvatar');
    if (av) { av.style.display = 'none'; av.removeAttribute('src'); }
    if (loginName) loginName.textContent = '';
    if (lu) { lu.value = ''; lu.readOnly = false; lu.style.opacity = ''; }
    if (mainBtn) { mainBtn.textContent = 'Login'; mainBtn.onclick = doLogin; }
  }
}
function switchAccount() {
  LAST_USER = null; // keep localStorage so the last account is still remembered next visit
  const lu = document.getElementById('loginUser');
  if (lu) { lu.value = ''; lu.readOnly = false; lu.style.opacity = ''; }
  const rb = document.getElementById('rememberBtns'); if (rb) rb.remove();
  const av = document.getElementById('loginAvatar'); if (av) { av.style.display = 'none'; av.removeAttribute('src'); }
  const nm = document.getElementById('loginName'); if (nm) nm.textContent = '';
  const lp = document.getElementById('loginPass'); if (lp) lp.value = '';
  const lt = document.getElementById('loginTotp'); if (lt) lt.value = '';
  const lm = document.getElementById('loginMsg'); if (lm) lm.textContent = '';
  const btn = document.getElementById('loginBtn');
  if (btn) { btn.textContent = 'Login'; btn.onclick = doLogin; }
  if (lu) lu.focus();
}
async function doLogin() {
  const u = ADMIN_MODE ? 'admin' : document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const t = document.getElementById('loginTotp').value.trim();
  const msg = document.getElementById('loginMsg');
  msg.textContent = '';
  // Always start from a clean slate so a failed attempt can never leave a stale session
  TOKEN = ''; sessionStorage.removeItem('adaq_token');
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: u, password: p, totp: t, adminMode: ADMIN_MODE } });
    if (r.mustChangePassword) { TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user; hideLogin(); showChangePassword(); return; }
    if (r.needsTotpEnroll) { TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user; hideLogin(); showEnroll(r); return; }
    if (r.totpRequired) { msg.textContent = 'TOTP code required'; return; }
    TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user;
    if (!ADMIN_MODE) rememberUser(r.user);
    hideLogin(); await afterLogin();
  } catch (e) { TOKEN = ''; sessionStorage.removeItem('adaq_token'); USER = null; msg.textContent = e.message; }
}

function openChangePassword() {
  const cp = document.getElementById('cpModal');
  if (cp) cp.classList.remove('hidden');
}
function closeChangePassword() {
  const cp = document.getElementById('cpModal');
  if (cp) cp.classList.add('hidden');
  const msg = document.getElementById('cpMsg'); if (msg) { msg.textContent = ''; msg.className = 'ui-msg'; }
  document.getElementById('profileModal').classList.remove('hidden');
}
function showChangePassword() {
  const profile = document.getElementById('profileModal');
  if (profile) profile.classList.add('hidden');
  openChangePassword();
}
async function submitChangePassword() {
  const oldP = document.getElementById('cpOld').value;
  const newP = document.getElementById('cpNew').value;
  const msg = document.getElementById('cpMsg');
  try {
    const r = await api('/auth/change-password', { method: 'POST', body: { oldPassword: oldP, newPassword: newP } });
    document.getElementById('cpModal').classList.add('hidden');
    const msg = document.getElementById('cpMsg'); if (msg) { msg.textContent = ''; msg.className = 'ui-msg'; }
    document.getElementById('profileModal').classList.remove('hidden');
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
  authReady();
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
  authReady();
  try { USER = (await api('/auth/me')).user; } catch (e) { logout(); return; }
  if (!ADMIN_MODE) rememberUser(USER);
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('app').style.display = '';
  applyTheme(USER.theme);
  // load announcements
  loadAnnouncements();
  // load messages
  loadMessages();
  // Admin panel visibility
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.style.display = (USER.role === 'admin' || USER.role === 'subadmin') ? '' : 'none';
  // Admin's Features nav item (admin only)
  const adminNav = document.getElementById('adminNavBtn');
  if (adminNav) adminNav.style.display = USER.role === 'admin' ? '' : 'none';
  const msgIcon = document.getElementById('msgIconBtn');
  if (msgIcon) msgIcon.style.display = 'none';
  try { sessionStorage.setItem('adaq_uid', String(USER.id)); } catch (e) {}
  if (typeof window.initBubble === 'function') { window.initBubble(); window.updateBubble(); }
  if (USER.role === 'user') {
    refreshUnread();
    if (!window.__msgPoll) { window.__msgPoll = setInterval(() => { if (TOKEN) refreshUnread(); }, 15000); }
  }
  console.log('ADMIN afterLogin: role=', USER.role, 'adminBtn=', adminBtn ? adminBtn.style.display : 'none', 'adminNav=', adminNav ? adminNav.style.display : 'none');
  // profile name
  const pn = document.getElementById('profileName'); if (pn) pn.textContent = USER.username;
  const tu = document.getElementById('topUsername'); if (tu) tu.textContent = USER.username;
  const ta = document.getElementById('topAvatar'); if (ta) { ta.onerror = () => { ta.onerror = null; ta.src = '/default-avatar.svg'; }; ta.src = USER.avatar || '/default-avatar.svg'; }
  // connect websocket
  connectWS();
  // report filter handlers
  const rf = document.getElementById('reportFilter');
  const rtf = document.getElementById('reportTypeFilter');
  if (rf) rf.onchange = loadReports;
  if (rtf) rtf.onchange = loadReports;
  // presence heartbeat
  setInterval(() => { api('/activity', { method: 'POST', body: { action: 'heartbeat' } }).catch(() => {}); }, 30000);
  if (typeof window.syncTradeLogs === 'function') window.syncTradeLogs();
  try { SV('privacy_notice_seen', true); } catch (e) {}
}

function logout() {
  try { fetch('/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + (sessionStorage.getItem('adaq_token') || '') } }); } catch (e) {}
  TOKEN = ''; sessionStorage.removeItem('adaq_token'); USER = null;
  if (typeof S !== 'undefined' && S) { S.bannerLocked = true; S.stickySig = null; S.sig = null; }
  ['profileModal','cpModal','adminModal','enrollModal'].forEach(id => { const m = document.getElementById(id); if (m) m.classList.add('hidden'); });
  showLogin();
  document.getElementById('loginBox').style.display = 'block';
  document.getElementById('registerBox').style.display = 'none';
}

// ---- Theme ----
function resolvedTheme(t){if(t==='auto')return (window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';return t||'dark'}
function applyTheme(t){
  document.body.className='th-'+String(resolvedTheme(t)).replace(/[^a-z]/g,'');
  if(USER)USER.theme=t;
}
if(window.matchMedia&&matchMedia('(prefers-color-scheme: light)').addEventListener)
  matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{if(USER&&USER.theme==='auto')applyTheme('auto')});

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
function profileMsg(text, ok) {
  const el = document.getElementById('profMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'ui-msg' + (text ? (ok ? ' ok' : ' err') : '');
}
function openProfile() {
  const u = USER || {};
  const img = document.getElementById('profAvatarImg');
  if (img) { img.onerror = () => { img.onerror = null; img.src = '/default-avatar.svg'; }; img.src = u.avatar || '/default-avatar.svg'; }
  const nu = document.getElementById('profNewUser'); if (nu) nu.value = '';
  const th = document.getElementById('profTheme'); if (th) th.value = u.theme || 'dark';
  const al = document.getElementById('profAlerts'); if (al) al.checked = u.alerts_on !== 0;
  const file = document.getElementById('profAvatarFile'); if (file) file.value = '';
  const side = document.getElementById('profPhotoSide');
  const isAdmin = u.role === 'admin';
  if (side) side.style.display = isAdmin ? 'none' : '';
  const hint = document.getElementById('profAvatarHint');
  if (hint) hint.textContent = isAdmin ? 'Administrator profile picture is fixed.' : 'JPG or PNG, up to 5 MB. Saved when you tap Save changes.';
  profileMsg('');
  document.getElementById('profileModal').classList.remove('hidden');
}
function profilePhotoChosen() {
  const f = document.getElementById('profAvatarFile').files[0];
  if (!f) return;
  const img = document.getElementById('profAvatarImg');
  if (img) img.src = URL.createObjectURL(f);
  profileMsg('Photo selected — tap Save changes to apply.', true);
}
async function saveProfile() {
  const theme = document.getElementById('profTheme').value;
  const alerts = document.getElementById('profAlerts').checked;
  const newUser = document.getElementById('profNewUser').value.trim();
  const fileInput = document.getElementById('profAvatarFile');
  const f = fileInput && fileInput.files ? fileInput.files[0] : null;
  const btn = document.querySelector('#profileModal .btn-primary');
  if (btn) btn.disabled = true;
  try {
    profileMsg('Saving...', true);
    // Photo (ignored for the fixed admin profile)
    if (f && (!USER || USER.role !== 'admin')) await uploadAvatar();
    // Username only when the field was filled in
    if (newUser && newUser !== (USER ? USER.username : '')) await changeUsername(newUser);
    // Theme and alerts
    const r = await api('/profile', { method: 'PUT', body: { theme, alerts_on: alerts } });
    if (r && r.user) USER = r.user;
    if (USER) { USER.theme = theme; USER.alerts_on = alerts; }
    applyTheme(theme);
    const nu = document.getElementById('profNewUser'); if (nu) nu.value = '';
    if (fileInput) fileInput.value = '';
    profileMsg('All changes saved.', true);
  } catch (e) { profileMsg(e.message || 'Could not save', false); }
  if (btn) btn.disabled = false;
}
async function changeUsername(u) {
  const name = u || document.getElementById('profNewUser').value.trim();
  if (!name) return;
  const r = await api('/profile/username', { method: 'POST', body: { username: name } });
  TOKEN = r.token; sessionStorage.setItem('adaq_token', TOKEN); USER = r.user;
  if (!ADMIN_MODE) rememberUser(USER);
  const pn = document.getElementById('profileName'); if (pn) pn.textContent = USER.username;
  const tu = document.getElementById('topUsername'); if (tu) tu.textContent = USER.username;
  return r;
}
async function uploadAvatar() {
  const f = document.getElementById('profAvatarFile').files[0];
  if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  const r = await api('/profile/avatar', { method: 'POST', body: fd });
  if (USER) { USER.avatar = r.avatar; if (!ADMIN_MODE) rememberUser(USER); }
  const img = document.getElementById('profAvatarImg'); if (img) img.src = r.avatar;
  const ta = document.getElementById('topAvatar'); if (ta) ta.src = r.avatar;
  return r;
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

async function loadDesigns() {
  const el = document.getElementById('designReviewList');
  if (!el) return;
  try {
    const r = await api('/designs');
    const ds = r.designs || [];
    const badge = document.getElementById('designBadge');
    const pending = ds.filter(d => d.status === 'PENDING_REVIEW').length;
    if (badge) { badge.style.display = pending ? '' : 'none'; badge.textContent = pending; }
    el.innerHTML = ds.length ? ds.map(d => {
      const final = d.status === 'APPROVED' || d.status === 'REVISION_QUEUED' || d.status === 'IN_REVISION' || d.status === 'REJECTED';
      const color = d.status === 'APPROVED' ? '#16c784' : (d.status === 'PENDING_REVIEW' ? '#f5a524' : '#8791a3');
      return `<div class="card" style="margin-top:6px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <img src="${escapeHtml(d.preview_url || '/icon-192.png')}" onerror="this.onerror=null;this.src='/icon-192.png'" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex:none" alt="">
          <div style="flex:1;min-width:0">
            <b>${escapeHtml(d.title)}</b> <small>v${d.version}</small>
            <div style="font-size:11px;color:${color};font-weight:700;margin-top:2px">${escapeHtml(d.status)}</div>
            <small style="display:block;color:var(--mu)">${escapeHtml(d.summary || '')}</small>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:11px" onclick="showDesignHistory(${d.id})">History (${(d.revisions||[]).length})</button>
          ${final ? `<button class="btn btn-ghost" style="padding:6px 10px;font-size:11px" disabled>${escapeHtml(d.status)}</button>` : `
          <button class="btn btn-primary" style="padding:6px 10px;font-size:11px" onclick="decideDesign(${d.id},'accept')">I Accept this design to implement</button>
          <button class="btn btn-danger" style="padding:6px 10px;font-size:11px" onclick="decideDesign(${d.id},'reject')">I Reject it</button>`}
        </div>
      </div>`;
    }).join('') : '<small>No design reports yet.</small>';
  } catch (e) { el.innerHTML = '<small style="color:#ea3943">' + escapeHtml(e.message) + '</small>'; }
}
async function decideDesign(id, decision) {
  let feedback = '';
  if (decision === 'reject') { feedback = prompt('Feedback for Mr. Designer (optional):') || ''; }
  try {
    if (decision === 'accept') {
      const r = await api('/designs/' + id + '/accept', { method: 'POST', body: {} });
      alert('Design approved. Implementation-ready master prompt generated and sent to the pipeline.\n\n' + String(r.prompt || '').slice(0, 500) + '...');
    } else {
      await api('/designs/' + id + '/reject', { method: 'POST', body: { feedback } });
      alert('Design rejected and sent back to Mr. Designer.');
    }
    loadDesigns();
  } catch (e) { alert(e.message); }
}
async function showDesignHistory(id) {
  const box = document.getElementById('designHistory');
  if (!box) return;
  try {
    const r = await api('/designs/' + id + '/history');
    box.style.display = 'block';
    box.innerHTML = '<h4 style="margin:6px 0">Revision history</h4>' + (r.history || []).map(h =>
      `<div class="msg-item"><small>${new Date(h.created_at).toLocaleString()}</small> <b>v${h.version}</b> ${escapeHtml(h.status)}${h.feedback ? '<br><small>' + escapeHtml(h.feedback) + '</small>' : ''}</div>`).join('');
  } catch (e) { box.textContent = e.message; }
}
async function addDesignReport() {
  const title = prompt('Design title:');
  if (!title) return;
  const summary = prompt('Short summary:') || '';
  try {
    await api('/designs', { method: 'POST', body: { title, summary, preview_url: '/icon-192.png' } });
    loadDesigns();
  } catch (e) { alert(e.message); }
}

// ---- Admin ----
function fileUrl(p){return p+(p.indexOf('?')>=0?'&':'?')+'token='+encodeURIComponent(sessionStorage.getItem('adaq_token')||'')}
const GREETINGS=['Hello there!','Good to see you','Start something good','A fresh chat!','Say hi 👋','Let’s talk','Welcome in','New conversation','Make it count','Your space, your rules','Ready when you are','A little hello','Every chat starts somewhere','Tell me more','Let’s catch up','Good vibes only','Open the floor','First words matter','Make yourself at home','This is the beginning','Hi, friend','Let’s begin','A new chapter','Drop a line','Come on in'];
function greetingFor(id){let g=sessionStorage.getItem('greet_'+id);if(!g){g=GREETINGS[Math.floor(Math.random()*GREETINGS.length)];sessionStorage.setItem('greet_'+id,g)}return g}
async function loadFriendStrip(){
  const s=document.getElementById('friendStrip');if(!s)return;
  try{
    const j=await (await fetch('/api/presence',{headers:{authorization:'Bearer '+(sessionStorage.getItem('adaq_token')||'')}})).json();
    const me = 'u_' + String((typeof USER !== 'undefined' && USER && USER.id) || 0);
    const members=(j.members||[]).filter(m=>m.id!==me); // admin first, then every user (online or offline); no bots
    const item=m=>{
      const attr=m.type==='admin'?'data-admin="1"':(m.type==='bot'?'data-bot="1"':'data-uid="'+String(m.id||'').replace('u_','')+'"');
      return `<button class="friend-item" ${attr} title="${escapeHtml(m.name)}"><img src="${escapeHtml(m.avatar||'/default-avatar.svg')}" onerror="this.onerror=null;this.src='/default-avatar.svg'" alt=""><span>${escapeHtml(String(m.name).replace(/^(Mr\.|Mrs\.)\s*/,''))}</span>${m.type==='bot'?'<b class="bot-tag">Bot</b>':''}<small class="presence ${m.online?'on':'off'}">${m.online?'Online':'Offline'}</small><i class="dot ${m.online?'on':''}"></i></button>`;
    };
    s.innerHTML='<div class="track">'+(members.length ? members.map(item).join('') : '<small class="muted">No one here yet.</small>')+'</div>';
    // Manual horizontal scroll: drag with mouse on desktop, native finger scroll on APK.
    // No pointer capture: it can retarget the click to the strip and break profile taps.
    let dragging=false,moved=false,x0=0,scroll0=0,downItem=null;
    s.onpointerdown=e=>{moved=false;if(e.pointerType==='touch')return;dragging=true;downItem=e.target.closest&&e.target.closest('.friend-item');x0=e.clientX;scroll0=s.scrollLeft};
    s.onpointermove=e=>{if(!dragging)return;if(Math.abs(e.clientX-x0)>4)moved=true;s.scrollLeft=scroll0-(e.clientX-x0)};
    s.onpointerup=()=>{dragging=false};
    s.onpointercancel=()=>{dragging=false};
    s.onclick=async e=>{
      if(moved)return;
      const under=document.elementFromPoint(e.clientX,e.clientY);
      const b=(e.target.closest&&e.target.closest('.friend-item'))||(under&&under.closest&&under.closest('.friend-item'))||(downItem&&!moved?downItem:null);
      if(!b)return;
      if(b.dataset.bot){alert('You cannot message a bot');return}
      if(b.dataset.admin){
        await openMessenger();
        try {
          const r = await api('/chat/conversations');
          const adminConv = (r.conversations || []).find(c => c.kind === 'admin_notice');
          if (adminConv) openChat(adminConv.id);
        } catch (err) {}
        if (!USER || USER.role !== 'admin') showMsgNotice('You are not allowed to reply the Admin');
        return;
      }
      const uid=b.dataset.uid;if(!uid)return;
      try {
        const r=await api('/chat/conversations',{method:'POST',body:{target_id:Number(uid)}});
        if(r.conversation)openChat(r.conversation.id);
      } catch (err) { alert(err.message || 'Could not open chat'); }
    };
  }catch(e){}
}
let LOG_USER = 0, LOG_KIND = 'signal';
async function openUserProfile(id) {
  LOG_USER = Number(id);
  const p = document.getElementById('profileModal');
  let act = document.getElementById('adminLogActions');
  if (!act) {
    act = document.createElement('div'); act.id = 'adminLogActions'; act.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    p.querySelector('.ui-body').appendChild(act);
  }
  act.innerHTML = `<button class="btn btn-ghost" onclick="openUserLogs('signal')">Signal entry log</button><button class="btn btn-ghost" onclick="openUserLogs('training')">Training log</button>`;
  const name = document.getElementById('profNewUser');
  if (name) name.value = '';
  document.getElementById('profileModal').classList.remove('hidden');
}
async function openUserLogs(kind) {
  LOG_KIND = kind;
  document.getElementById('userLogsTitle').textContent = (kind === 'signal' ? 'Signal entry log' : 'Training log');
  const tf = document.getElementById('logTf');
  if (tf && !tf.options.length) tf.innerHTML = '<option value="">All timeframes</option>' + (typeof TFS !== 'undefined' ? TFS : ['1m','5m','15m','1h','4h','1d']).map(t => `<option value="${t}">${t}</option>`).join('');
  document.getElementById('profileModal').classList.add('hidden');
  document.getElementById('userLogsModal').classList.remove('hidden');
  await loadUserLogs();
}
async function loadUserLogs() {
  const base = '/admin/users/' + LOG_USER + '/' + (LOG_KIND === 'signal' ? 'signal-logs' : 'training-logs');
  const p = [];
  const d = document.getElementById('logDate').value, c = document.getElementById('logCoin').value.trim(), tf = document.getElementById('logTf').value, s = document.getElementById('logSide').value, r = document.getElementById('logResult').value;
  if (d) p.push('date=' + d); if (c) p.push('coin=' + encodeURIComponent(c)); if (tf) p.push('tf=' + tf); if (s) p.push('side=' + s); if (r) p.push('result=' + r);
  try {
    const [logs, sum] = await Promise.all([api(base + (p.length ? '?' + p.join('&') : '')), api('/admin/users/' + LOG_USER + '/trading-summary')]);
    const x = LOG_KIND === 'signal' ? sum.signal : sum.training;
    document.getElementById('logSummary').innerHTML = `<b>Summary</b><br><small>Total: ${x.total||0} · Win rate: ${x.total ? Math.round((x.wins||0)/x.total*100) : 0}% · P/L: $${(x.pnl||0).toFixed(2)} · Open: ${x.open||0}</small>`;
    document.getElementById('logRows').innerHTML = (logs.logs || []).map(l => `<div class="msg-item"><small>${new Date(LOG_KIND === 'signal' ? l.created_at : l.opened_at).toLocaleString()}${l.closed_at ? ' → ' + new Date(l.closed_at).toLocaleString() : ''}</small><br><b>${escapeHtml(l.coin||'')}</b> <small>${escapeHtml(l.timeframe||'')} · ${escapeHtml(l.side||'')} · ${escapeHtml(l.result||'')}</small><br><small>Entry ${l.entry||''} · SL ${l.stop_loss||l.stop||''} · TP ${l.take_profit||''} · Size $${l.size_usd||''} · Exit ${l.exit_price||l.exit||''} · P/L ${l.pnl_usd||0} (${l.pnl_pct||0}%) · Quality ${l.quality||''}${l.close_reason?' · '+escapeHtml(l.close_reason):''}</small></div>`).join('') || '<small>No entries.</small>';
  } catch (e) { document.getElementById('logRows').textContent = e.message; }
}
async function loadAdmin() {
  try {
    const r = await api('/admin/users');
    const el = document.getElementById('adminUsers');
    if (el) el.innerHTML = (r.users || []).map(u => `<div class="msg-item">${escapeHtml(u.username)} <span class="${u.online ? 'online' : 'offline'}">?</span> <small>${u.role} ? ${u.online ? 'online' : 'offline'}</small><br>${u.id !== USER.id && u.role !== 'admin' ? `<button onclick="deleteUser(${u.id})" style="margin-right:4px">Delete</button>` : ''}${u.id !== USER.id && u.role === 'user' ? ` <button onclick="adminMessageUser(${u.id})">Message</button>` : ''}${u.id !== USER.id ? ` <button onclick="genRecovery(${u.id})">Recovery Link</button>` : ''}<div id="rec_${u.id}" style="word-break:break-all;font-size:11px;margin-top:4px"></div></div>`).join('');
  } catch (e) {}
  try {
    const r = await api('/admin/activity');
    const el = document.getElementById('adminActivity');
    if (el) el.innerHTML = (r.activity || []).slice(0, 50).map(a => `<div class="msg-item"><small>${new Date(a.created_at).toLocaleString()}</small> <b>${escapeHtml(a.username || '')}</b> ${a.kind === 'bot' ? '<span class="tag">BOT</span> ' : ''}${escapeHtml(a.action)} ${escapeHtml(a.detail || '')}</div>`).join('');
  } catch (e) {}
}
async function adminMessageUser(id) {
  try {
    const r = await api('/chat/conversations', { method: 'POST', body: { target_id: id } });
    openMessenger();
    if (r.conversation) openChat(r.conversation.id);
  } catch (e) { alert(e.message); }
}
async function sendAdminNotice() {
  const to = document.getElementById('noticeTo').value.trim();
  const body = document.getElementById('noticeBody').value.trim();
  if (!body) { alert('Write a message first'); return; }
  const all = !to;
  if (all && !confirm('Send this notice to ALL users?')) return;
  const recipient_ids = to ? to.split(',').map(s => Number(s.trim())).filter(Boolean) : [];
  try {
    await api('/chat/notices', { method: 'POST', body: { body, recipient_ids, all } });
    document.getElementById('noticeBody').value = '';
    loadAdminNotices();
  } catch (e) { alert(e.message); }
}
async function loadAdminNotices() {
  const el = document.getElementById('noticeSent');
  if (!el) return;
  try {
    const r = await api('/chat/notices');
    el.innerHTML = (r.notices || []).map(n => `<div class="msg-item"><small>${new Date(n.created_at).toLocaleString()}</small><br>${escapeHtml(n.body || '')}<br><small>Recipients: ${n.recipients.length} · Read: ${n.recipients.filter(x => x.read_at).length} · Delivered: ${n.recipients.filter(x => x.delivered_at).length}</small><br><button onclick="deleteAdminNotice(${n.id})" style="color:#ea3943">Delete for everyone</button></div>`).join('') || '<small>No notices sent.</small>';
  } catch (e) { el.textContent = e.message; }
}
async function deleteAdminNotice(id) {
  if (!confirm('Delete this notice for everyone?')) return;
  try { await api('/chat/notices/' + id, { method: 'DELETE' }); loadAdminNotices(); } catch (e) { alert(e.message); }
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
    if (m.type === 'chat_message' || m.type === 'chat_typing' || m.type === 'chat_read' || m.type === 'unread' || m.type === 'chat_updated' || m.type === 'chat_deleted') { window.dispatchEvent(new CustomEvent('adaq:chat', { detail: m })); }
  };
  ws.onclose = () => { setTimeout(connectWS, 3000); };
}

// ---- init ----
const ADMIN_MODE = !!window.__ADMIN_MODE || location.pathname.indexOf('thisisnottheadmin') !== -1;

async function init() {
  // Keep session on refresh; clear on app close (handled by Electron main.js / OS)
  TOKEN = sessionStorage.getItem('adaq_token') || '';

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
  // User mode: normal form; remembered account is rendered by showLogin()
  if (!ADMIN_MODE) {
    const lu = document.getElementById('loginUser');
    if (lu) { lu.value = ''; lu.style.display = 'block'; lu.readOnly = false; }
    const lt = document.getElementById('loginTotp');
    if (lt) lt.placeholder = "Whats your favorite snack";
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
  if (TOKEN) {
    // A refresh can hit a cold server / slow network: retry before deciding the session is gone.
    // Only a real 401 means the session is invalid.
    let me = null;
    for (let i = 0; i < 3; i++) {
      try { me = (await api('/auth/me')).user; break; }
      catch (e) { if (e.status === 401) break; await new Promise(r => setTimeout(r, 600 * (i + 1))); }
    }
    if (me) { USER = me; hideLogin(); await afterLogin(); return; }
    logout(); return;
  }
  await validateLastUser();
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
  const va = document.getElementById('v-admin');
  if (va) va.hidden = false; // the section is hidden by default in markup; reveal it when opening admin features
  ['bots','users','reports','meeting'].forEach(x => {
    const el = document.getElementById('adminTab2_' + x);
    if (el) el.style.display = x === t ? 'block' : 'none';
  });
  document.querySelectorAll('#v-admin .tabbar button').forEach((b, i) => {
    b.classList.toggle('on', ['bots','users','reports','meeting'][i] === t);
  });
  if (t === 'bots') loadBots();
  if (t === 'users') loadUsers();
  if (t === 'reports') { const f = document.getElementById('reportFilter'); if (f) f.value = ''; const tf = document.getElementById('reportTypeFilter'); if (tf) tf.value = ''; loadReports(); loadDesigns(); }
  if (t === 'meeting') loadMeeting();
  if (typeof resetScroll === 'function') resetScroll();
}
// Lightweight pixel-style bot characters in one shared office room (CSS/SVG only)
const BOT_COLORS={mr_admin:'#3b82f6',mr_monkey:'#f59e0b',mr_hunter:'#10b981',mr_designer:'#ec4899',mr_chart:'#06b6d4',mrs_stoploss:'#ef4444',mr_take_profit:'#16c784',mrs_qa:'#8b5cf6',mr_whitehack:'#6366f1'};
function botWorking(b){return !b.paused&&(b.status==='on_duty'||b.status==='online')}
function botPixel(b){
  const c=BOT_COLORS[b.id]||'#3b82f6';
  const female=String(b.id).indexOf('mrs_')===0;
  const hair=female
    ? '<rect x="5" y="2" width="14" height="4" fill="#2b1a10"/><rect x="4" y="6" width="2" height="9" fill="#2b1a10"/><rect x="18" y="6" width="2" height="9" fill="#2b1a10"/>'
    : '<rect x="6" y="2" width="12" height="4" fill="#2b1a10"/><rect x="5" y="5" width="2" height="3" fill="#2b1a10"/><rect x="17" y="5" width="2" height="3" fill="#2b1a10"/>';
  const acc={
    mr_admin:'<rect x="11" y="17" width="2" height="6" fill="#f5a524"/>',
    mr_monkey:'<rect x="6" y="4" width="12" height="2" fill="#f5a524"/>',
    mr_hunter:'<rect x="5" y="1" width="14" height="3" fill="#151d2a"/><rect x="4" y="3" width="8" height="2" fill="#151d2a"/>',
    mr_designer:'<rect x="7" y="8" width="4" height="3" fill="none" stroke="#111"/><rect x="13" y="8" width="4" height="3" fill="none" stroke="#111"/><rect x="11" y="9" width="2" height="1" fill="#111"/>',
    mr_chart:'<rect x="17" y="18" width="4" height="3" fill="#e6e9ef"/>',
    mrs_stoploss:'<rect x="10" y="15" width="4" height="2" fill="#ff8d93"/><rect x="4" y="4" width="3" height="3" fill="#ff8d93"/>',
    mr_take_profit:'<rect x="17" y="18" width="4" height="3" fill="#16c784"/>',
    mrs_qa:'<rect x="4" y="7" width="2" height="6" fill="#151d2a"/><rect x="18" y="7" width="2" height="6" fill="#151d2a"/>',
    mr_whitehack:'<rect x="5" y="2" width="14" height="4" fill="#151d2a"/>'
  }[b.id]||'';
  const legs=female
    ? '<rect x="7" y="25" width="10" height="4" fill="#2b1a10"/><rect x="9" y="29" width="2" height="3" fill="#2b1a10"/><rect x="13" y="29" width="2" height="3" fill="#2b1a10"/>'
    : '<rect x="8" y="25" width="3" height="5" fill="#1c2534"/><rect x="13" y="25" width="3" height="5" fill="#1c2534"/>';
  return `<svg class="bot-pixel" viewBox="0 0 24 32" shape-rendering="crispEdges" aria-hidden="true">
    ${hair}<rect x="6" y="5" width="12" height="10" fill="${c}"/>
    <rect x="8" y="9" width="2" height="2" fill="#fff" class="px-eye"/><rect x="14" y="9" width="2" height="2" fill="#fff" class="px-eye"/>
    <rect x="9" y="9" width="1" height="1" fill="#111"/><rect x="15" y="9" width="1" height="1" fill="#111"/>
    <rect x="6" y="16" width="12" height="9" fill="${c}"/>
    <rect x="3" y="17" width="3" height="7" fill="${c}" class="px-arm"/><rect x="18" y="17" width="3" height="7" fill="${c}" class="px-arm2"/>
    ${legs}${acc}
  </svg>`;
}
function botStatus(b){
  if(!botWorking(b))return '<span class="bot-off">● Off Duty now</span>';
  if(b.running_jobs>0)return '<span class="bot-on">● Working now · job in progress</span>';
  if(!b.reports_count)return '<span class="bot-on">● On Duty working now · no reports yet</span>';
  return `<span class="bot-on">● On Duty working now · ${b.reports_count} report${b.reports_count===1?'':'s'} filed</span>`;
}
async function loadBots() {
  const el = document.getElementById('botsList');
  if (!el) return;
  try {
    const r = await api('/admin/members?type=bot');
    const bots = r.members || [];
    if (!bots.length) { el.innerHTML = '<small>No bots.</small>'; return; }
    el.innerHTML = `<div class="bot-room">
      <div class="room-window"></div><div class="room-clock"></div><div class="room-plant"></div><div class="room-desk"></div>
      ${bots.map(b => `<div class="bot-unit ${botWorking(b) ? 'awake' : 'sleeping'}" title="${escapeHtml(b.description||'')}">
        ${botPixel(b)}<span class="bot-unit-name">${escapeHtml(b.name.replace(/^(Mr\.|Mrs\.)\s*/,''))}</span>
        ${botWorking(b) ? '' : '<span class="zzz">ZZZ</span>'}
      </div>`).join('')}
    </div>
    <div class="bot-roster-title">Bot list</div>
    <div class="bot-roster">${bots.map(b => `<div class="msg-item">
      <b>${escapeHtml(b.name)}</b> <small>${escapeHtml(b.role||'')}</small> ${botStatus(b)}
      ${USER.role === 'admin' ? `<button onclick="toggleBotPause('${b.id}')" style="margin-left:auto;padding:3px 10px;font-size:11px">${b.paused ? 'Resume' : 'Pause'}</button>` : ''}
    </div>`).join('')}</div>`;
  } catch (e) { el.innerHTML = '<small style="color:#ea3943">' + escapeHtml(e.message) + '</small>'; }
}
// Keep bot duty status live while the Bots tab is open
setInterval(() => {
  if (typeof S !== 'undefined' && S && S.tab === 'admin') {
    const p = document.getElementById('adminTab2_bots');
    if (p && p.style.display !== 'none') loadBots();
  }
}, 10000);
// Keep bot job activity live while Admin Power -> Activity is open
setInterval(() => {
  const m = document.getElementById('adminModal');
  if (!m || m.classList.contains('hidden')) return;
  const act = document.getElementById('adminTab_activity');
  if (act && act.style.display !== 'none') loadAdmin();
}, 10000);
async function loadUsers() {
  const el = document.getElementById('usersList');
  if (!el) return;
  try {
    const r = await api('/admin/members?type=user');
    el.innerHTML = (r.members || []).map(u => `<div class="msg-item">
<img src="${escapeHtml(u.avatar || '/default-avatar.svg')}" onerror="this.onerror=null;this.src='/default-avatar.svg'" style="width:30px;height:30px;border-radius:50%;object-fit:cover;cursor:pointer;flex:none" onclick="openUserProfile(${u.id.replace('u_','')})" alt=""> <span class="${u.status === 'online' ? 'online' : 'offline'}">●</span>
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
    const all = r.reports || [];
    const badge = document.getElementById('reportTabBadge');
    if (badge) { const n = all.filter(x => x.status === 'new').length; badge.style.display = n ? '' : 'none'; badge.textContent = n; }
    el.innerHTML = (all).map(rep => `<div class="msg-item">
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
// ---- In-house Messenger (Phase 5) ----
let CHAT_ID = null;
async function refreshUnread() {
  const badge = document.getElementById('msgUnread');
  if (!badge) return;
  try {
    const r = await api('/chat/unread');
    badge.textContent = r.unread;
    badge.style.display = r.unread ? '' : 'none';
  } catch (e) {}
}
async function openMessenger() {
  const modal = document.getElementById('messengerModal');
  if (modal) {
    modal.classList.remove('chat-open'); // always start at the list, never a stale chat
    const full = document.getElementById('chatFull'); if (full) full.innerHTML = '';
  }
  clearPendingAttachment();
  CHAT_ID = null;
  document.getElementById('messengerModal').classList.remove('hidden');
  await loadConversations(); loadFriendStrip();
  refreshUnread();
}
async function loadConversations() {
  const el = document.getElementById('convList');
  if (!el) return;
  try {
    const r = await api('/chat/conversations');
    const cs = r.conversations || [];
    el.innerHTML = cs.length ? cs.map(c => `<button class="conv-item ${c.id === CHAT_ID ? 'on' : ''}" onclick="openChat(${c.id})">
      <img src="${escapeHtml(c.avatar || '/default-avatar.svg')}" onerror="this.onerror=null;this.src='/default-avatar.svg'" alt="">
      <span class="meta"><b>${escapeHtml(c.name || 'Conversation')}${c.kind === 'admin_notice' ? ' <span class="bot-tag">Admin</span>' : ''}</b><small>${escapeHtml(c.last_message_preview || 'No messages yet')}</small></span>
      ${c.online ? '<i class="dot"></i>' : ''}<span class="presence ${c.online ? 'on' : 'off'}">${c.online ? 'Online' : 'Offline'}</span>${c.unread ? `<span class="unread">${c.unread}</span>` : ''}
    </button>`).join('') : '<div class="msg-empty">Look now for a conversation</div>';
  } catch (e) { el.innerHTML = '<small style="color:#ea3943">' + escapeHtml(e.message) + '</small>'; }
}
async function openChat(id) {
  CHAT_ID = Number(id);
  const modal = document.getElementById('messengerModal');
  if (modal) modal.classList.add('chat-open');
  const pane = document.getElementById('chatFull');
  if (pane) pane.innerHTML = '<div class="msg-note">Loading...</div>'; // never flash the previous chat
  clearPendingAttachment();
  await loadChatMessages(CHAT_ID);
  loadConversations();
  if (typeof window.updateBubble === 'function') window.updateBubble();
}
function closeChatView() {
  CHAT_ID = null;
  const modal = document.getElementById('messengerModal');
  if (modal) modal.classList.remove('chat-open');
  loadConversations();
  if (typeof window.updateBubble === 'function') window.updateBubble();
}
async function loadChatMessages(id) {
  const pane = document.getElementById('chatFull');
  if (!pane) return;
  const stale = () => Number(id) !== Number(CHAT_ID); // another chat was opened meanwhile
  try {
    const r = await api('/chat/conversations/' + id + '/messages');
    if (stale()) return;
    const msgs = r.messages || [];
    const conv = ((await api('/chat/conversations')).conversations || []).find(c => c.id === Number(id)) || {};
    if (stale()) return;
    const canReply = conv.canReply !== false;
    let lastDay = '';
    const list = msgs.map(m => {
      const d = new Date(m.created_at);
      const dayKey = d.toDateString();
      let sep = '';
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        sep = `<div class="msg-day">${dayKey === new Date().toDateString() ? 'Today' : d.toLocaleDateString()}</div>`;
      }
      const mine = m.sender_id === (USER ? USER.id : 0);
      const deleted = !!m.deleted_for_everyone;
      // Attachments never render the stored body (legacy rows contain the raw upload path).
      const body = deleted ? `<span class="deleted-msg">${adaqIcon('circle')} Deleted message</span>` : (m.attachment ? '' : escapeHtml(m.body || ''));
      const reacts = (m.reactions || []).map(x => `<span class="react">${escapeHtml(x.emoji)} ${x.n}</span>`).join('');
      // Keep attachments available even when the message text is deleted.
      const media = m.attachment ? (m.attachment.kind === 'image' ? `<img class="bubble-media" src="${esc(fileUrl(m.attachment.thumbnail || m.attachment.path))}" onerror="chatImgError(this,'${escapeHtml(m.attachment.path)}')" onclick="viewMedia('${escapeHtml(m.attachment.path)}')" alt="Image attachment">` : m.attachment.kind === 'video' ? `<video class="bubble-media" controls src="${esc(fileUrl(m.attachment.path))}"></video>` : m.attachment.kind === 'voice' ? `<audio controls src="${esc(fileUrl(m.attachment.path))}"></audio>` : `<a class="file-link" href="${esc(fileUrl(m.attachment.path))}&download=1" target="_blank" rel="noopener">${adaqIcon('attach')} ${escapeHtml(m.attachment.name || 'File')}</a>`) : '';
      const menu = (mine && !deleted) ? `<span class="menu-holder"><button type="button" class="msg-menu" aria-label="Message options" onclick="toggleMsgMenu(event,${m.id})">${adaqIcon('dots')}</button></span>` : '';
      return sep + `<div class="msg-wrap ${mine ? 'mine' : ''}">
        <div class="msg-line">${menu}<div class="bubble ${mine ? 'mine' : ''}${media ? ' has-media' : ''}" data-id="${m.id}">${m.reply_to ? '<div class="quote">Replying to a message</div>' : ''}${media}${body}${m.edited_at && !deleted ? '<small>Edited</small>' : ''}${reacts ? `<div class="reacts">${reacts}</div>` : ''}</div></div>
        <small class="bubble-time">${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${m.seen ? ' · Seen' : ''}</small>
      </div>`;
    }).join('');
    pane.innerHTML = `<div class="msg-head">
      <button class="icon-btn" onclick="closeChatView()" aria-label="Back to Messenger" title="Back">${adaqIcon('back')}</button>
      <span class="chat-peer"><img src="${escapeHtml(conv.avatar || '/default-avatar.svg')}" onerror="this.onerror=null;this.src='/default-avatar.svg'" alt=""><i class="${conv.online ? 'on' : 'off'}"></i></span>
      <b>${escapeHtml(conv.name || 'Conversation')}</b><small>${conv.online ? 'Online' : 'Offline'}</small></div>
      <div id="typingNote" class="msg-note" style="display:none">typing...</div>
      <div class="msg-scroll" id="msgScroll">${list || `<div class="msg-day">${greetingFor(CHAT_ID)}</div>`}</div>
      <button class="btn btn-ghost" style="width:100%;font-size:11px" onclick="(()=>{const s=document.getElementById('msgScroll');if(s)s.scrollTop=s.scrollHeight})()">Scroll to latest</button>
      ${canReply ? `<div class="msg-compose"><label class="file-btn btn btn-ghost" title="Attach file" style="min-width:44px;justify-content:center">${adaqIcon('attach')}<input type="file" id="chatFile" onchange="prepareChatFile()" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mp4,audio/webm,.pdf,.txt,.docx"></label><button class="btn btn-ghost" style="min-width:44px" id="micBtn" onclick="toggleVoice()" aria-label="Record voice" title="Record voice">${adaqIcon('mic')}</button><input id="chatInput" placeholder="Type a message" onkeydown="typingNow();if(event.key==='Enter')sendChatMessage()" onpaste="pasteImage(event)"><button class="btn btn-primary" onclick="sendChatMessage()">Send</button></div><div id="uploadStatus" class="msg-note" style="display:none"></div><small class="muted" id="uploadLimits">Max ${window.ADAQ_LIMITS ? window.ADAQ_LIMITS.max_file_mb : 5} MB · voice up to 120s · images, PDF, TXT, DOCX</small>` : `<div class="msg-note">${conv.kind === 'admin_notice' ? 'You are not allowed to reply the Admin' : 'You can\'t reply to this account'}</div>`}`;
    const sc = document.getElementById('msgScroll'); if (sc) sc.scrollTop = sc.scrollHeight;
  } catch (e) { pane.innerHTML = '<div class="msg-note">' + escapeHtml(e.message) + '</div>'; }
}
async function chatMute(){
  const m=LS('chat_muted',{});m[CHAT_ID]=!m[CHAT_ID];SV('chat_muted',m);
  alert(m[CHAT_ID]?'Conversation muted':'Conversation unmuted');
}
async function createGroup() {
  const name = prompt('Group name:');
  if (!name) return;
  const ids = prompt('Member user IDs (comma-separated):') || '';
  const member_ids = ids.split(',').map(s => Number(s.trim())).filter(Boolean);
  try {
    const r = await api('/chat/groups', { method: 'POST', body: { name, member_ids } });
    loadConversations(); openChat(r.conversation.id);
  } catch (e) { alert(e.message); }
}
function chatSettings() {
  const s = LS('chat_settings', { sounds: true, online: true, receipts: true });
  const sounds = confirm('Message sounds? OK = on, Cancel = off');
  const online = confirm('Show my online status? OK = on, Cancel = off');
  const receipts = confirm('Read receipts? OK = on, Cancel = off');
  SV('chat_settings', { sounds, online, receipts });
}
async function chatBlockToggle(otherId) {
  if (!otherId) return;
  try {
    const r = await fetch('/api/chat/conversations/' + CHAT_ID + '/block', { method: confirm('Block this user?') ? 'POST' : 'DELETE', headers: { authorization: 'Bearer ' + (sessionStorage.getItem('adaq_token') || '') } });
    if (!r.ok) throw new Error('Could not update block');
    alert('Block settings updated');
  } catch (e) { alert(e.message); }
}
async function chatGroupManage() {
  const add = prompt('Add user ID (blank to skip):');
  if (add) { try { await api('/chat/groups/' + CHAT_ID, { method: 'PATCH', body: { add_id: Number(add) } }); openChat(CHAT_ID); } catch (e) { alert(e.message); } }
}
async function chatGroupLeave() {
  if (!confirm('Leave this group?')) return;
  try { await api('/chat/groups/' + CHAT_ID, { method: 'PATCH', body: { leave: true } }); CHAT_ID = null; closeChatView(); }
  catch (e) { alert(e.message); }
}
async function chatLoadOlder() {
  if (!CHAT_ID) return;
  const first = document.querySelector('#msgScroll .bubble');
  if (!first) return;
  try {
    const params = '?before=' + encodeURIComponent(first.dataset.id || 0);
    const r = await api('/chat/conversations/' + CHAT_ID + '/messages' + params);
    const sc = document.getElementById('msgScroll');
    if (sc && r.messages.length) sc.insertAdjacentHTML('afterbegin', r.messages.map(m => `<div class="msg-wrap ${m.sender_id === (USER ? USER.id : 0) ? 'mine' : ''}"><div class="bubble ${m.sender_id === (USER ? USER.id : 0) ? 'mine' : ''}" data-id="${m.id}">${escapeHtml(m.body || '')}</div><small class="bubble-time">${new Date(m.created_at).toLocaleDateString()} ${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>`).join(''));
  } catch (e) {}
}
let CHAT_TYPING_T = 0;
function typingNow() {
  if (!CHAT_ID || Date.now() - CHAT_TYPING_T < 2000) return;
  CHAT_TYPING_T = Date.now();
  api('/chat/conversations/' + CHAT_ID + '/typing', { method: 'POST', body: {} }).catch(() => {});
}
let CHAT_XHR = null;
// Message options: owner-only 3-dot menu with "Delete message".
function closeMsgMenus() { document.querySelectorAll('.msg-drop').forEach(d => d.remove()); }
function toggleMsgMenu(e, id) {
  e.stopPropagation();
  const open = document.querySelector('.msg-drop');
  closeMsgMenus();
  if (open) return;
  const holder = e.currentTarget.parentElement || e.currentTarget.closest('.bubble'); if (!holder) return;
  const drop = document.createElement('div');
  drop.className = 'msg-drop';
  drop.innerHTML = '<button type="button" onclick="deleteOwnMessage(' + Number(id) + ')">Delete message</button>';
  holder.appendChild(drop);
}
document.addEventListener('click', closeMsgMenus);
async function deleteOwnMessage(id) {
  closeMsgMenus();
  if (!confirm('Delete this message?')) return;
  try { await api('/chat/messages/' + id + '?mode=everyone', { method: 'DELETE' }); } catch (e) { alert(e.message); return; }
  // Update this bubble only: a full reload scrolls the chat to the newest message.
  const bubble = document.querySelector('#msgScroll .bubble[data-id="' + id + '"]');
  if (!bubble) return;
  const scroll = document.getElementById('msgScroll');
  const top = scroll ? scroll.scrollTop : 0;
  const mediaNode = bubble.querySelector('.bubble-media,video,audio,.file-link');
  const holder = bubble.closest('.msg-line') && bubble.closest('.msg-line').querySelector('.menu-holder');
  if (holder) holder.remove();
  bubble.innerHTML = '';
  if (mediaNode) bubble.appendChild(mediaNode.cloneNode(true));
  bubble.insertAdjacentHTML('afterbegin', `<span class="deleted-msg">${adaqIcon('circle')} Deleted message</span>`);
  if (scroll) scroll.scrollTop = top;
  loadConversations(); // refresh only the chat list preview, never the open chat
}
function showMsgNotice(text) {
  const n = document.getElementById('msgNotice'); if (!n) return;
  n.textContent = text; n.style.display = 'block';
  clearTimeout(window.__msgNotice);
  window.__msgNotice = setTimeout(() => { n.style.display = 'none'; }, 3500);
}
function chatImgError(img, fallback) {
  // First try the original image when a thumbnail is missing or unreadable.
  if (!img.dataset.fallback) { img.dataset.fallback = '1'; img.src = fileUrl(fallback); return; }
  img.style.display = 'none'; // never leave a broken-image/white panel in the chat
}
function viewMedia(url) {
  MEDIA_URL=url;MEDIA_SCALE=1;MEDIA_X=0;MEDIA_Y=0;
  const v=document.getElementById('mediaViewer'),img=document.getElementById('mediaViewImg');
  if(img){img.style.transform='';img.src=fileUrl(url)}
  if(v)v.classList.remove('hidden');
}
let MEDIA_SCALE=1,MEDIA_X=0,MEDIA_Y=0,MEDIA_URL='';
function applyMediaTransform(){/* media is fitted to the screen: no pan or zoom */}
function zoomMedia(d){/* disabled: the viewer fits any image with no scrollbars */}
function closeMedia(){document.getElementById('mediaViewer').classList.add('hidden');const img=document.getElementById('mediaViewImg');if(img){img.src='';img.style.transform=''};MEDIA_SCALE=1;MEDIA_X=0;MEDIA_Y=0}
function downloadMedia(){const a=document.createElement('a');a.href=fileUrl(MEDIA_URL)+'&download=1';a.download='attachment';a.click()}

let CHAT_PENDING_FILE = null, CHAT_PREVIEW_URL = '';
function prepareChatFile(file) {
  if (!file || !CHAT_ID) return;
  const maxMb = Number((window.ADAQ_LIMITS && window.ADAQ_LIMITS.max_file_mb) || 5);
  if (file.size > maxMb * 1024 * 1024) { alert('Maximum Max 5 mb Attachment'); return; }
  const ext = String(file.name || '').toLowerCase().split('.').pop();
  const ok = /^(image\/(png|jpeg|webp|gif)|(audio|video)\/(webm|mp4)|text\/plain|application\/(pdf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/.test(file.type || '')
    || ['png','jpg','jpeg','webp','gif','mp4','webm','m4a','pdf','txt','docx'].includes(ext);
  if (!ok) { alert('files not supported'); return; }
  CHAT_PENDING_FILE = file;
  const box = document.getElementById('attachConfirm');
  if (!box) return;
  const preview = document.getElementById('attachPreview');
  if (CHAT_PREVIEW_URL) { URL.revokeObjectURL(CHAT_PREVIEW_URL); CHAT_PREVIEW_URL = ''; }
  preview.innerHTML = '';
  if (String(file.type || '').startsWith('image/')) {
    CHAT_PREVIEW_URL = URL.createObjectURL(file);
    preview.innerHTML = '<img src="' + CHAT_PREVIEW_URL + '" alt="">';
  } else preview.innerHTML = adaqIcon('attach');
  document.getElementById('attachName').textContent = file.name || 'Voice message';
  box.classList.remove('hidden');
}
function clearPendingAttachment() {
  CHAT_PENDING_FILE = null;
  const box = document.getElementById('attachConfirm');
  if (box) box.classList.add('hidden');
  const preview = document.getElementById('attachPreview');
  if (preview) preview.innerHTML = '';
  if (CHAT_PREVIEW_URL) { URL.revokeObjectURL(CHAT_PREVIEW_URL); CHAT_PREVIEW_URL = ''; }
  const input = document.getElementById('chatFile');
  if (input) input.value = '';
}
function cancelSendAttachment() { clearPendingAttachment(); }
function confirmSendAttachment() {
  const file = CHAT_PENDING_FILE;
  clearPendingAttachment();
  if (file) sendChatFile(file);
}
function sendChatFile(provided) {
  const input = document.getElementById('chatFile');
  const file = provided || (input && input.files ? input.files[0] : null);
  if (!file || !CHAT_ID) return;
  const status = document.getElementById('uploadStatus');
  const fd = new FormData(); fd.append('file', file);
  const xhr = new XMLHttpRequest(); CHAT_XHR = xhr;
  xhr.open('POST', '/api/chat/conversations/' + CHAT_ID + '/media');
  xhr.setRequestHeader('authorization', 'Bearer ' + (sessionStorage.getItem('adaq_token') || ''));
  if (status) { status.style.display = 'block'; status.textContent = 'Uploading 0% (tap to cancel)'; status.onclick = () => xhr.abort(); }
  xhr.upload.onprogress = e => { if (e.lengthComputable && status) status.textContent = 'Uploading ' + Math.round(e.loaded / e.total * 100) + '% (tap to cancel)'; };
  xhr.onload = () => {
    CHAT_XHR = null;
    if (status) { status.style.display = 'none'; status.onclick = null; }
    if (xhr.status === 200) { if (input) input.value = ''; if (CHAT_ID) loadChatMessages(CHAT_ID); loadConversations(); if (typeof window.refreshUnread === 'function') window.refreshUnread(); if (typeof window.updateBubble === 'function') window.updateBubble(); }
    else { try { alert(JSON.parse(xhr.responseText).error || 'Upload failed'); } catch (e) { alert('Upload failed'); } }
  };
  xhr.onerror = () => { CHAT_XHR = null; if (status) status.style.display = 'none'; alert('Upload failed'); };
  xhr.onabort = () => { CHAT_XHR = null; if (status) { status.style.display = 'none'; status.textContent = 'Upload cancelled'; } };
  xhr.send(fd);
}
function pasteImage(e){
  const items=e.clipboardData&&e.clipboardData.items;
  if(!items)return;
  for(const it of items){if(it.type&&it.type.startsWith('image/')){
    const f=it.getAsFile();if(f){e.preventDefault();prepareChatFile(f);return}
  }}
}
let VOICE_REC=null,VOICE_T=0,VOICE_TIMER=null;
async function toggleVoice(){
  const btn=document.getElementById('micBtn');if(!btn)return;
  if(VOICE_REC){VOICE_REC.stop();return}
  if(!navigator.mediaDevices||!window.MediaRecorder){alert('Voice recording is not supported here');return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mime=MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':'audio/webm';
    VOICE_REC=new MediaRecorder(stream,{mimeType:mime});
    const chunks=[];VOICE_T=0;
    VOICE_REC.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    VOICE_REC.onstop=()=>{
      clearInterval(VOICE_TIMER);VOICE_TIMER=null;
      stream.getTracks().forEach(t=>t.stop());
      const secs=Math.round(VOICE_T/1000);VOICE_REC=null;
      if(btn)btn.innerHTML=adaqIcon('mic');
      const st=document.getElementById('uploadStatus');if(st)st.style.display='none';
      if(!secs)return;
      const blob=new Blob(chunks,{type:mime});
      const f=new File([blob],'voice.'+(mime.includes('mp4')?'m4a':'webm'),{type:mime});
      prepareChatFile(f);
    };
    VOICE_REC.start();
    VOICE_TIMER=setInterval(()=>{
      VOICE_T+=1000;
      const st=document.getElementById('uploadStatus');
      const max=Number(document.getElementById('voiceMax')?.value||120);
      if(st){st.style.display='block';st.textContent='Recording '+Math.round(VOICE_T/1000)+'s / '+max+'s (tap mic to send)';st.onclick=null}
      if(btn){const b=btn.querySelector('svg');if(b)b.style.color='#ea3943'}
      if(VOICE_T>=max*1000)VOICE_REC.stop();
    },1000);
  }catch(e){alert('Microphone permission denied or unavailable')}
}
let REPLY_ID = null;
async function chatAction(id, action) {
  try {
    if (action === 'react') { await api('/chat/messages/' + id + '/reactions', { method: 'POST', body: { emoji: '👍' } }); }
    else if (action === 'reply') { REPLY_ID = id; const i = document.getElementById('chatInput'); if (i) { i.placeholder = 'Replying...'; i.focus(); } return; }
    else if (action === 'copy') { const m = [...document.querySelectorAll('.bubble')].find(b => Number(b.dataset.id) === Number(id)); await navigator.clipboard.writeText(m ? m.innerText : ''); return; }
    else if (action === 'edit') { const body = prompt('Edit message:'); if (body === null) return; await api('/chat/messages/' + id + '/edit', { method: 'PATCH', body: { body } }); }
    else if (action === 'unsend') { if (!confirm('Remove this message for everyone?')) return; await api('/chat/messages/' + id + '?mode=everyone', { method: 'DELETE' }); }
    else if (action === 'delete') { await api('/chat/messages/' + id, { method: 'DELETE' }); }
    else if (action === 'forward') { const to = prompt('Forward to conversation ID:'); if (!to) return; const msgs = (await api('/chat/conversations/' + CHAT_ID + '/messages')).messages || []; const m = msgs.find(x => x.id === Number(id)); if (m) await api('/chat/conversations/' + to + '/messages', { method: 'POST', body: { body: m.body } }); return; }
    else if (action === 'report') { const reason = prompt('Report reason:'); if (!reason) return; await api('/chat/messages/' + id + '/report', { method: 'POST', body: { reason } }); alert('Report sent for review'); return; }
    if (CHAT_ID) await loadChatMessages(CHAT_ID);
  } catch (e) { alert(e.message); }
}
async function sendChatMessage() {
  if (!CHAT_ID) return;
  const input = document.getElementById('chatInput');
  const body = input ? input.value.trim() : '';
  if (!body) return;
  if (input) input.value = '';
  try {
    const payload = { body };
    if (REPLY_ID) { payload.reply_to = REPLY_ID; REPLY_ID = null; if (input) input.placeholder = 'Type a message'; }
    const r = await api('/chat/conversations/' + CHAT_ID + '/messages', { method: 'POST', body: payload });
    if (r.message) {
      sessionStorage.removeItem('greet_' + CHAT_ID);
      const sc = document.getElementById('msgScroll');
      const d = new Date(r.message.created_at);
      const html = `<div class="msg-wrap mine"><div class="bubble mine" data-id="${r.message.id}">${escapeHtml(r.message.body || '')}</div><small class="bubble-time">${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>`;
      if (sc) { sc.insertAdjacentHTML('beforeend', html); sc.scrollTop = sc.scrollHeight; }
    }
    loadConversations();
  } catch (e) {
    if (input) input.value = body;
    if (!navigator.onLine) { const q = LS('chat_queue', []); q.push({ cid: CHAT_ID, body }); SV('chat_queue', q); alert('Offline - message queued'); }
    else alert(e.message);
  }
}
window.addEventListener('online', async () => {
  const q = LS('chat_queue', []);
  for (const item of q) { try { await api('/chat/conversations/' + item.cid + '/messages', { method: 'POST', body: { body: item.body } }); } catch (e) {} }
  SV('chat_queue', []);
  if (CHAT_ID) loadChatMessages(CHAT_ID);
});
window.addEventListener('adaq:chat', e => {
  const t = e.detail;
  if (t && t.type === 'chat_message' && t.data && t.data.conversation_id === CHAT_ID) {
    sessionStorage.removeItem('greet_' + CHAT_ID);
    loadChatMessages(CHAT_ID);
    const st = LS('chat_settings', { sounds: false, online: true, receipts: true });
    if (st.sounds === true) { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(); o.connect(a.destination); o.frequency.value = 720; o.start(); o.stop(a.currentTime + .12); } catch (x) {} }
  }
  if (t && t.type === 'chat_typing') {
    const note = document.getElementById('typingNote');
    if (note) { note.style.display = 'block'; clearTimeout(window.__typingHide); window.__typingHide = setTimeout(() => { note.style.display = 'none'; }, 2500); }
  }
  if (t && t.type === 'presence') { loadFriendStrip(); loadConversations(); }
  if (t && t.type === 'chat_read' && CHAT_ID) loadChatMessages(CHAT_ID);
  if (t && t.type === 'chat_updated') { loadConversations(); }
  if (t && t.type === 'chat_deleted' && t.data && t.data.conversation_id === CHAT_ID) {
    closeChatView();
  }
  refreshUnread();
});

window.__authLoaded = 'done';
