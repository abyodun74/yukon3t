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
//
// The offline fallback (OFFLINE_URL) is a plain static HTML file, not
// a Next.js page: Next's rendered pages pull in framework bootstrap
// scripts (webpack/main-app/route chunks), and if any one of those
// isn't already cached, Next's own client-side hydration throws and
// replaces the whole document with its internal error boundary —
// confirmed live via diagnostic logging showing the service worker
// correctly returning the full, byte-correct cached HTML every time,
// while the rendered page still ended up blank. The one page that
// most needs to work with zero network can't depend on any JS at
// all, framework or otherwise.
//
// IMPORTANT: the browser only re-installs this service worker when
// this file's own bytes change. If a future change touches anything
// in SHELL_ASSETS, bump these version strings too — otherwise every
// browser with this SW already installed keeps serving the stale
// precached content forever, even after a new deploy.
const SHELL_CACHE = "yk3-shell-v5";
const STATIC_CACHE = "yk3-static-v5";
const OFFLINE_URL = "/offline.html";
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

// Web Push: shows a system notification for an incoming call or new
// message even if no tab is open. Only reachable once a client has called
// pushManager.subscribe() — see push-notifications-toggle.tsx.
self.addEventListener("push", (event) => {
  let payload = { title: "YuKon3t", body: "" , url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: notificationTarget(payload.url) },
    }),
  );
});

// The absolute URL a notification opens: its `url` (the exact post, Muse,
// story, chat, event, Circle... — the same path the in-app bell row links
// to, see src/lib/notification-href.ts) resolved against this site, or the
// site root for anything that doesn't resolve to this same origin (a full
// URL elsewhere, `//host`, `/\host`, `javascript:`...), so a push payload can
// never open another site.
function notificationTarget(raw) {
  const home = new URL("/", self.location.origin).href;
  if (typeof raw !== "string" || raw === "") return home;
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.href : home;
  } catch {
    return home;
  }
}

// Opens the notification's exact target. An app window that is already open
// is reused: focused, then navigated to the target (a window already on that
// exact URL is only focused). Only with no window of ours open, or when the
// browser won't navigate the one there is (a window this worker doesn't
// control yet), is a new one opened. Comparing whole URLs (path, query and
// #fragment), not just the pathname: `/u/x?story=y` and `/u/x` are different
// targets.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const ours = windows.filter((c) => new URL(c.url).origin === self.location.origin);
      const exact = ours.find((c) => c.url === target);
      if (exact) {
        await exact.focus();
        return;
      }
      const client = ours.find((c) => c.focused) ?? ours[0];
      if (client) {
        try {
          const focused = await client.focus();
          const navigated = await (focused ?? client).navigate(target);
          if (navigated) return;
        } catch {
          // Not controlled by this worker (navigate rejects): open a window instead.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
