// ANT PWA Service Worker
// Keep immutable assets fast, but never serve stale session HTML. The session
// app changes often and cache-first navigation can leave installed PWAs on an
// old shell after deploys.

const CACHE_NAME = 'ant-v3-cache-v3';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icons/ant-icon-192.png',
  '/icons/ant-icon-512.png',
];

// Install: cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS),
    ),
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
}

// Fetch: network for API/navigation, cache-first for immutable app assets.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: always network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp/')) {
    return;
  }

  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/')) || Response.error()),
    );
    return;
  }

  const cacheableStatic =
    url.pathname.startsWith('/_app/immutable/') ||
    url.pathname.startsWith('/icons/') ||
    STATIC_ASSETS.includes(url.pathname);

  if (cacheableStatic) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      }),
    );
  }
});
