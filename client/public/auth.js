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
function rememberUser(u) {
  if (!u || !u.username) return;
  if (u.username === 'admin') return; // admin is only shown on the admin URL
  LAST_USER = { username: u.username, avatar: u.avatar || '' };
  try { localStorage.setItem('adaq_last_user', JSON.stringify(LAST_USER)); } catch (e) {}
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
}

function logout() {
  TOKEN = ''; sessionStorage.removeItem('adaq_token'); USER = null;
  if (typeof S !== 'undefined' && S) { S.bannerLocked = true; S.stickySig = null; S.sig = null; }
  ['profileModal','cpModal','adminModal','enrollModal'].forEach(id => { const m = document.getElementById(id); if (m) m.classList.add('hidden'); });
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
async function loadAdmin() {
  try {
    const r = await api('/admin/users');
    const el = document.getElementById('adminUsers');
    if (el) el.innerHTML = (r.users || []).map(u => `<div class="msg-item">${escapeHtml(u.username)} <span class="${u.online ? 'online' : 'offline'}">?</span> <small>${u.role} ? ${u.online ? 'online' : 'offline'}</small><br>${u.id !== USER.id && u.role !== 'admin' ? `<button onclick="deleteUser(${u.id})" style="margin-right:4px">Delete</button>` : ''}${u.id !== USER.id ? ` <button onclick="genRecovery(${u.id})">Recovery Link</button>` : ''}<div id="rec_${u.id}" style="word-break:break-all;font-size:11px;margin-top:4px"></div></div>`).join('');
  } catch (e) {}
  try {
    const r = await api('/admin/activity');
    const el = document.getElementById('adminActivity');
    if (el) el.innerHTML = (r.activity || []).slice(0, 50).map(a => `<div class="msg-item"><small>${new Date(a.created_at).toLocaleString()}</small> <b>${escapeHtml(a.username || '')}</b> ${a.kind === 'bot' ? '<span class="tag">BOT</span> ' : ''}${escapeHtml(a.action)} ${escapeHtml(a.detail || '')}</div>`).join('');
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
  if (t === 'reports') { loadReports(); loadDesigns(); }
  if (t === 'meeting') loadMeeting();
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
