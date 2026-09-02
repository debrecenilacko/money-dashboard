// Network-first service worker: always prefer a fresh network response and
// only fall back to the cache when offline. Deliberately NOT cache-first —
// a cache-first strategy risks serving a stale index.html/app.js pair after
// a deploy (same lesson learned building the health-dashboard PWA).
const CACHE_NAME = 'penztarkonyv-dashboard-v1';
const SHELL_FILES = ['./', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let data = { title: 'Pénztárkönyv', body: '' };
  try { if (event.data) data = event.data.json(); } catch (err) { /* ignore malformed payload */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pénztárkönyv', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./index.html');
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
