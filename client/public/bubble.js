'use strict';
// Floating AssistiveTouch-style Messenger bubble. Never closable, draggable, edge-snapping.
(function () {
  const KEY = 'adaq_bubble_pos';
  const el = () => document.getElementById('msgBubble');
  let dragging = false, moved = false, x0 = 0, y0 = 0, bx = 0, by = 0, lastX = 0, lastY = 0, idleT = 0;
  function bounds() {
    const b = el().getBoundingClientRect();
    const pad = 8, safe = 12;
    return { minX: pad, maxX: innerWidth - b.width - pad, minY: safe, maxY: innerHeight - b.height - safe - (innerWidth < 600 ? 64 : 8) };
  }
  function place(x, y, save) {
    const r = bounds();
    x = Math.max(r.minX, Math.min(r.maxX, x));
    y = Math.max(r.minY, Math.min(r.maxY, y));
    el().style.left = x + 'px'; el().style.top = y + 'px'; el().style.right = 'auto'; el().style.bottom = 'auto';
    if (save) {
      const m = matchMedia('(orientation: portrait)').matches ? 'p' : 'l';
      try { const all = JSON.parse(sessionStorage.getItem(KEY) || '{}'); all[m] = { x, y }; sessionStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
    }
  }
  function restore() {
    const m = matchMedia('(orientation: portrait)').matches ? 'p' : 'l';
    let p = null;
    try { p = (JSON.parse(sessionStorage.getItem(KEY) || '{}'))[m]; } catch (e) {}
    const r = bounds();
    place(p && typeof p.x === 'number' ? p.x : r.maxX, p && typeof p.y === 'number' ? p.y : innerHeight * 0.6, false);
  }
  function wake() {
    const b = el(); if (!b) return;
    b.classList.remove('idle'); clearTimeout(idleT);
    idleT = setTimeout(() => b.classList.add('idle'), 3000);
  }
  function onDown(e) {
    const b = el(); if (!b) return;
    dragging = true; moved = false; wake();
    b.classList.add('dragging');
    x0 = e.clientX; y0 = e.clientY;
    const r = b.getBoundingClientRect(); bx = r.left; by = r.top;
    try { b.setPointerCapture && b.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
    if (moved) { lastX = bx + dx; lastY = by + dy; place(lastX, lastY, false); }
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    const b = el(); b.classList.remove('dragging'); try { b.releasePointerCapture && b.releasePointerCapture(e.pointerId); } catch (err) {}
    if (moved) {
      const half = el().getBoundingClientRect().width / 2 || 28;
      const left = lastX + half < innerWidth / 2;
      place(left ? bounds().minX : bounds().maxX, lastY, true);
    } else if (typeof window.openMessenger === 'function') window.openMessenger();
    wake();
  }
  async function updateBubble() {
    const b = el(); if (!b) return;
    const token = sessionStorage.getItem('adaq_token');
    if (!token || !USER_ID()) return;
    try {
      const h = { authorization: 'Bearer ' + token };
      const [u, cs] = await Promise.all([
        fetch('/api/chat/unread', { headers: h }).then(r => r.json()),
        fetch('/api/chat/conversations', { headers: h }).then(r => r.json())
      ]);
      const unread = u.unread || 0;
      const badge = document.getElementById('bubbleBadge');
      const img = document.getElementById('bubbleAvatar');
      const glyph = document.getElementById('bubbleGlyph');
      const last = (cs.conversations || []).find(c => c.unread > 0) || (cs.conversations || [])[0];
      if (unread > 0 && last) {
        const n = Math.max(0, Number(last.unread || unread || 0));
        img.src = last.avatar || '/default-avatar.svg'; img.style.display = 'block'; glyph.style.display = 'none';
        badge.style.display = n > 0 ? 'flex' : 'none'; badge.textContent = n > 99 ? '99+' : String(n);
      } else {
        img.style.display = 'none'; glyph.style.display = 'block'; badge.style.display = 'none';
      }
    } catch (e) {}
  }
  function USER_ID() { return sessionStorage.getItem('adaq_uid') || (typeof window !== 'undefined' && window.__adaqUid) || 1; }
  function start() {
    const b = el(); if (!b || b.dataset.ready) return; b.dataset.ready = '1';
    b.innerHTML = '<span id="bubbleGlyph">' + (window.adaqIcon ? adaqIcon('messenger') : '') + '</span><img id="bubbleAvatar" alt="" style="display:none"><span id="bubbleBadge" class="bubble-badge" style="display:none"></span>';
    b.setAttribute('tabindex', '0'); b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Messenger');
    b.addEventListener('pointerdown', onDown);
    b.addEventListener('pointermove', onMove);
    b.addEventListener('pointerup', onUp);
    b.addEventListener('pointercancel', onUp);
    b.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (typeof window.openMessenger === 'function') window.openMessenger(); }
      const r = b.getBoundingClientRect(), step = 24;
      if (e.key === 'ArrowLeft') place(r.left - step, r.top, true);
      if (e.key === 'ArrowRight') place(r.left + step, r.top, true);
      if (e.key === 'ArrowUp') place(r.left, r.top - step, true);
      if (e.key === 'ArrowDown') place(r.left, r.top + step, true);
      wake();
    });
    ['pointerdown', 'keydown', 'focus'].forEach(ev => b.addEventListener(ev, wake));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { restore(); wake(); } });
    addEventListener('resize', () => { restore(); wake(); });
    addEventListener('orientationchange', () => { restore(); wake(); });
    window.addEventListener('adaq:chat', e => { if (e.detail && (e.detail.type === 'unread' || e.detail.type === 'chat_message')) updateBubble(); });
    restore(); wake(); updateBubble();
  }
  window.initBubble = start;
  window.updateBubble = updateBubble;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
