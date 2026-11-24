self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch (x) { d = { title: 'ADAQ', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ADAQ', {
    body: d.body || '', tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/');
  }));
});
