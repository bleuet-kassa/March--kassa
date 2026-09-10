/* Service worker van de kassa: ontvangt pushmeldingen (bv. "dagafsluiting
   bevestigen") en opent bij een tik de bijbehorende pagina. Geen caching —
   de app blijft gewoon online werken zoals voorheen. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { tekst: e.data ? e.data.text() : '' }; }
  const titel = d.titel || 'Marché kassa';
  e.waitUntil(self.registration.showNotification(titel, {
    body: d.tekst || '',
    data: { url: d.url || '/kassa' },
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: d.tag || 'kassa',
    renotify: true,
    requireInteraction: true, // blijft staan tot je hem aantikt of wegveegt
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/kassa';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((vensters) => {
    for (const w of vensters) {
      if ('navigate' in w) { return w.navigate(url).then((v) => (v || w).focus()); }
    }
    return self.clients.openWindow(url);
  }));
});
