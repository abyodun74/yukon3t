"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    // Dev-mode Turbopack chunks aren't content-hashed the same immutable way
    // production's are — the same /_next/static/** URL can serve different
    // bytes across a Fast Refresh, so the SW's cache-first strategy for
    // those (see sw.js) ends up serving a stale chunk after every edit,
    // throwing "module factory is not available" until a hard reload.
    // Registering only in production sidesteps that entirely.
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      return;
    }

    // Dev mode: proactively unregister + clear any SW/caches left over from
    // before this file stopped registering one in dev, so an existing
    // local checkout self-heals without a manual devtools step.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  }, []);
  return null;
}
