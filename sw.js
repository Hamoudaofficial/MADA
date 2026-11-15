/* MADA Service Worker: Web Push only (no fetch handler, no caching) */
const views = new Map();
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.t === 'mada-view' && e.source) views.set(e.source.id, d.chat || null);
});
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch (_) {}
    const dt = d.data || {};
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (dt.type === 'chat' && wins.some(c => c.visibilityState === 'visible' && views.get(c.id) === dt.cid)) return;
    await self.registration.showNotification(d.title || 'MADA', {
      body: d.body || '',
      icon: d.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      dir: 'rtl',
      lang: 'ar',
      data: dt
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const dt = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.visibilityState === 'visible') || wins[0];
    if (w) {
      try { await w.focus(); } catch (_) {}
      w.postMessage({ t: 'mada-open', dt });
      return;
    }
    const o = dt.type === 'chat' ? 'chat.' + dt.cid + '.' + dt.peer
      : dt.type === 'profile' ? 'profile.' + dt.uid
      : dt.type === 'post' ? 'post.' + (dt.pid || '') : 'notif';
    await self.clients.openWindow('/?o=' + encodeURIComponent(o));
  })());
});
