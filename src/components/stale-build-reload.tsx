"use client";

import { useEffect } from "react";
import {
  STALE_BUILD_RELOAD_KEY,
  looksLikeStaleBuildError,
  parseReloadRecord,
  shouldReloadForBuild,
} from "@/lib/stale-build";

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
]);

function hasUnsavedTyping(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return el.value !== "";
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type) && el.value !== "";
  return el instanceof HTMLElement && el.isContentEditable && (el.textContent ?? "") !== "";
}

// Recovers a tab left open across a deploy: once it asks for a chunk the new
// deploy no longer has, reload onto the new build instead of leaving the page
// broken. Only listens — no network at all until a matching error fires, and
// never calls preventDefault, so Sentry still sees every one of these errors.
export function StaleBuildReload() {
  useEffect(() => {
    const clientBuildId = process.env.APP_BUILD_ID;
    let checking = false;
    let reloadScheduled = false;

    function reloadFor(target: string) {
      // No record means no loop guard across the reload, so don't reload at
      // all if sessionStorage is unavailable (private mode, blocked storage).
      try {
        sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, JSON.stringify({ target, at: Date.now() }));
      } catch {
        return;
      }
      window.location.reload();
    }

    function scheduleReload(target: string) {
      reloadScheduled = true;
      const focused = document.activeElement;
      if (!hasUnsavedTyping(focused)) {
        reloadFor(target);
        return;
      }
      // Don't throw away a half-typed message: wait until the user leaves
      // the field or the page, whichever comes first.
      const fire = () => {
        focused.removeEventListener("blur", fire);
        document.removeEventListener("visibilitychange", onVisibility);
        reloadFor(target);
      };
      const onVisibility = () => {
        if (document.visibilityState === "hidden") fire();
      };
      focused.addEventListener("blur", fire);
      document.addEventListener("visibilitychange", onVisibility);
    }

    async function check(error: unknown) {
      if (checking || reloadScheduled || !looksLikeStaleBuildError(error)) return;
      checking = true;
      try {
        const res = await fetch("/api/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        let lastReload = null;
        try {
          lastReload = parseReloadRecord(sessionStorage.getItem(STALE_BUILD_RELOAD_KEY));
        } catch {}
        if (shouldReloadForBuild({ clientBuildId, serverBuildId: buildId, lastReload, now: Date.now() })) {
          scheduleReload(buildId as string);
        }
      } catch {
        // Offline or the route itself failed — nothing to compare, leave it.
      } finally {
        checking = false;
      }
    }

    const onError = (event: ErrorEvent) => void check(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => void check(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
