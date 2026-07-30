// Minimal PWA service worker — only caches the static app-shell assets
// (icons/manifest) needed for offline installability. Deliberately does
// NOT intercept navigation, API, or auth requests: this app is
// session/DB-driven, so caching dynamic responses would risk serving
// stale or wrong-user content. Everything else falls through to the
// network exactly as if this service worker didn't exist.
const CACHE = "yk3-shell-v1";
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !SHELL_ASSETS.includes(url.pathname)) {
    return; // let the browser handle it normally
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
