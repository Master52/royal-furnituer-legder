const CACHE = 'shop-ledger-shell-v6';
const BASE = new URL('./', self.registration.scope);
const SHELL = [BASE.href, new URL('manifest.webmanifest', BASE).href, new URL('icons/royal-logo.png', BASE).href, new URL('icons/ledger-192-v2.png', BASE).href, new URL('icons/ledger-512-v2.png', BASE).href];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('shop-ledger-') && key !== CACHE).map(key => caches.delete(key)))).catch(() => {}).then(() => self.clients.claim()));
});

function remember(event, key, response) {
  if (!response.ok) return;
  // Clone before returning the response: its body may be consumed immediately.
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)).catch(() => {}));
}
async function cached(key) {
  try { return await caches.match(key); } catch { return undefined; }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(BASE.href)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      remember(event, BASE.href, response);
      return response;
    }).catch(async () => await cached(BASE.href) || new Response('The app is offline. Reconnect and reload to open it.', {status: 503, headers: {'Content-Type': 'text/plain;charset=utf-8'}})));
    return;
  }

  // Always request the current code first. Mixing cached and new modules can prevent startup.
  if (request.destination === 'script' || request.destination === 'style' || url.pathname.includes('/src/') || url.pathname.includes('/node_modules/')) {
    event.respondWith(fetch(request).then(response => {
      remember(event, request, response);
      return response;
    }).catch(async () => await cached(request) || Response.error()));
    return;
  }
  event.respondWith(cached(request).then(cachedResponse => cachedResponse || fetch(request).then(response => {
    remember(event, request, response);
    return response;
  })).catch(() => Response.error()));
});
