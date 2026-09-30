const CACHE = 'shop-ledger-shell-v5';
const BASE = new URL('./', self.registration.scope);
const SHELL = [BASE.href, new URL('manifest.webmanifest', BASE).href, new URL('icons/royal-logo.png', BASE).href, new URL('icons/ledger-192-v2.png', BASE).href, new URL('icons/ledger-512-v2.png', BASE).href];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('shop-ledger-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(BASE.href)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(BASE.href, response.clone()));
      return response;
    }).catch(() => caches.match(BASE.href)));
    return;
  }

  // Always request the current code first. Mixing cached and new modules can prevent startup.
  if (request.destination === 'script' || request.destination === 'style' || url.pathname.includes('/src/') || url.pathname.includes('/node_modules/')) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
