/**
 * StudyMate AI — service worker
 * ─────────────────────────────────────────────────────────────────────────
 * BUMP `CACHE_VERSION` ON EVERY FRONTEND RELEASE. Activation deletes every
 * cache whose name isn't the current one, so old versions can't linger.
 *
 * Strategy (so a deploy actually reaches users):
 *   • Navigations + HTML + the app's own JS/JSON (same-origin) → NETWORK
 *     FIRST. The latest version is fetched whenever the network is up; the
 *     cached copy is only a fallback when offline. (The previous
 *     cache-first strategy served the old index.html until the cache name
 *     happened to change.)
 *   • Static assets (icons, manifest, images) → stale-while-revalidate.
 *   • /api/* and every cross-origin request → never touched, never cached.
 *     (Auth, AI, payments and usage must always hit the network.)
 *
 * The app still installs and opens offline from the last cached copy.
 */
const CACHE_VERSION = 'v40-2026-10-09';
const CACHE = `studymate-${CACHE_VERSION}`;
const APP_FILES = [
  '/', '/index.html', '/app-config.js', '/supabase-client.js', '/weakness-sync.js',
  '/curriculum-data.js', '/weakness-profile.js', '/bagley-context.js',
  '/personalization.css', '/personalization-art.js', '/personalization-data.js', '/personalization.js', '/manifest.webmanifest', '/icons/icon.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/personalization-scenes.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // `cache: 'reload'` bypasses the browser HTTP cache so a new worker
      // never precaches stale copies of the new release.
      await Promise.all(APP_FILES.map(async (url) => {
        try {
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (res.ok) await cache.put(url, res);
        } catch (_) { /* offline during install: that file just isn't precached */ }
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isAppCode(url, request) {
  if (request.mode === 'navigate') return true;
  return /\.(?:html|js|json|webmanifest)$/.test(url.pathname) || url.pathname === '/';
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request, { cache: 'no-cache' }); // revalidate with the server
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request) || (request.mode === 'navigate' ? await cache.match('/index.html') : null);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;     // Supabase, Paystack, fonts, CDNs: untouched
  if (url.pathname.startsWith('/api/')) return;        // never cache API traffic

  event.respondWith(isAppCode(url, request) ? networkFirst(request) : staleWhileRevalidate(request));
});
