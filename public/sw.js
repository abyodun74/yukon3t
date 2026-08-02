// PWA service worker providing basic offline resilience:
//  - Precaches the static app shell (icons/manifest/offline page).
//  - Caches Next's content-hashed static assets (/_next/static/**) on
//    first use, cache-first, so the JS/CSS shell can load without a
//    network round-trip on repeat visits.
//  - For page navigations, always tries the network first; only on a
//    genuine network failure does it fall back to a cached "You're
//    offline" page, instead of the browser's native offline error.
// Deliberately does NOT cache API, auth, or page HTML responses: this
// app is session/DB-driven, so caching dynamic responses would risk
// serving stale or wrong-user content. Everything dynamic falls
// through to the network exactly as if this service worker didn't
// exist.
const SHELL_CACHE = "yk3-shell-v2";
const STATIC_CACHE = "yk3-static-v2";
const OFFLINE_URL = "/offline";
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  OFFLINE_URL,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // let the browser handle it normally

  const url = new URL(request.url);

  // Full-page navigations: network-first, offline-page fallback. Online
  // behavior is completely unchanged — the cache is only ever consulted
  // after a real network failure.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Next's content-hashed static assets: cache-first. Safe because the
  // filename changes whenever the content does, so a cache hit is
  // always the correct, current version.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
    return;
  }

  // Everything else (API routes, auth, page data) — let the browser
  // handle it normally, exactly as if this service worker didn't exist.
});
