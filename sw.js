// Booklog service worker: makes the app open instantly and work offline.
// When you change the app: bump VERSION here AND the ?v= numbers in index.html (and SHELL below) so every device gets the update.
const VERSION = 'booklog-v6';
const SHELL = ['./', 'index.html', 'styles.css?v=6', 'app.js?v=6', 'manifest.json', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
const COVERS = 'booklog-covers';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== COVERS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Book covers: cache-first so your shelf looks right offline.
  if (url.hostname === 'covers.openlibrary.org' || url.hostname === 'books.google.com' || url.hostname.endsWith('googleusercontent.com') ||/\.(jpe?g|png|webp)$/i.test(url.pathname) && url.origin !== location.origin) {
    e.respondWith(
      caches.open(COVERS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
          return res;
        } catch (_) {
          return Response.error();
        }
      })
    );
    return;
  }

  // App shell: network-first (so updates show up), falling back to cache offline.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }) // always check GitHub for a newer copy
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
    );
  }
  // Everything else (book search API, fonts) goes straight to the network.
});
