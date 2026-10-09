"use client";

import { useEffect, useState } from "react";
import { isNativePickerActive } from "@/lib/native-picker-activity";
import { hasSendingOptimisticPost } from "@/lib/optimistic-posts-store";
import {
  STALE_BUILD_RELOAD_KEY,
  holdReload,
  isBuildCheckThrottled,
  isReloadHeld,
  isReloadSafe,
  parseReloadRecord,
  shouldReloadForBuild,
  type ReloadHold,
  type ReloadRecord,
  type ReloadTrigger,
} from "@/lib/stale-build";

// The one place that asks the server which build it is on and reloads a
// client left behind by a deploy. Every entry point goes through
// reloadIfStale: the window error listener and foreground check
// (components/stale-build-reload.tsx), the native "resume" event
// (components/capacitor-bridge.tsx) and both error boundaries.

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
]);
const BUILD_ID_TIMEOUT_MS = 8_000;
// How long an error boundary holds back its own screen for the check, so a
// stale client goes straight to the reload without flashing the error first.
const BOUNDARY_CHECK_GRACE_MS = 2_500;

const clientBuildId = process.env.APP_BUILD_ID;
let lastCheckAt: number | null = null;
let inFlight: Promise<string | null> | null = null;
// A newer server build we know about but couldn't reload for yet (a call, an
// upload, a half-typed message). Later triggers retry it without refetching.
let staleTarget: string | null = null;
let blurWatched: HTMLElement | null = null;

function focusedFieldWithText(): HTMLElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return el.value !== "" ? el : null;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type) && el.value !== "" ? el : null;
  return el instanceof HTMLElement && el.isContentEditable && (el.textContent ?? "") !== "" ? el : null;
}

function hasWorkInProgress(): boolean {
  return (
    isReloadHeld("work") ||
    hasSendingOptimisticPost() ||
    // Coming back from the OS photo/camera picker looks exactly like coming
    // back to the app, and the composer waiting on that pick must survive.
    isNativePickerActive() ||
    // Every composer sheet, recorder, viewer and ringing dialog is one of
    // these (see sheet.tsx) — the user is in the middle of something.
    document.querySelector('[aria-modal="true"]') !== null
  );
}

async function fetchServerBuildId(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUILD_ID_TIMEOUT_MS);
  try {
    const res = await fetch("/api/build-id", { cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;
    const { buildId } = (await res.json()) as { buildId?: unknown };
    return typeof buildId === "string" && buildId !== "" ? buildId : null;
  } catch {
    // Offline or the route itself failed — nothing to compare, leave it.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function tryReload(trigger: ReloadTrigger): boolean {
  if (!staleTarget) return false;
  let lastReload: ReloadRecord | null = null;
  try {
    lastReload = parseReloadRecord(sessionStorage.getItem(STALE_BUILD_RELOAD_KEY));
  } catch {}
  if (!shouldReloadForBuild({ clientBuildId, serverBuildId: staleTarget, lastReload, now: Date.now() })) {
    // Forget it rather than give up for good: a later check asks again and
    // may find a build this one hasn't already reloaded for.
    staleTarget = null;
    return false;
  }

  const typingIn = focusedFieldWithText();
  const busy = { call: isReloadHeld("call"), work: hasWorkInProgress(), typing: typingIn !== null };
  if (!isReloadSafe(trigger, busy)) {
    if (typingIn && blurWatched !== typingIn) {
      blurWatched = typingIn;
      typingIn.addEventListener(
        "blur",
        () => {
          blurWatched = null;
          tryReload("error");
        },
        { once: true },
      );
    }
    return false;
  }

  // No record means no loop guard across the reload, so don't reload at all
  // if sessionStorage is unavailable (private mode, blocked storage).
  try {
    sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, JSON.stringify({ target: staleTarget, at: Date.now() }));
  } catch {
    staleTarget = null;
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Reloads onto the server's build if this client is on an older one and it is
 * safe to (see isReloadSafe). Resolves true only when a reload has started.
 * When the builds match this is one small request and nothing else, so a
 * genuine bug never causes a reload.
 */
export async function reloadIfStale(trigger: ReloadTrigger): Promise<boolean> {
  if (!staleTarget) {
    if (trigger === "hidden" || navigator.onLine === false) return false;
    if (trigger === "foreground" && (inFlight || isBuildCheckThrottled(lastCheckAt, Date.now()))) return false;
    lastCheckAt = Date.now();
    inFlight ??= fetchServerBuildId().finally(() => {
      inFlight = null;
    });
    const serverBuildId = await inFlight;
    if (!serverBuildId || serverBuildId === clientBuildId) return false;
    staleTarget = serverBuildId;
  }
  return tryReload(trigger);
}

/** Keeps stale-build reloads away for as long as `active` is true. */
export function useReloadHold(kind: ReloadHold, active: boolean) {
  useEffect(() => (active ? holdReload(kind) : undefined), [kind, active]);
}

/**
 * For error.tsx / global-error.tsx. Most of what lands on those screens right
 * after a deploy is this client being a build behind, which a reload fixes
 * and "Try again" (a re-render of the same stale client) does not. `checking`
 * is true while the first check is still deciding; `retry` is "Try again".
 */
export function useStaleBuildRecovery(reset: () => void) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let reloading = false;
    const show = () => {
      if (!reloading) setChecking(false);
    };
    const timer = setTimeout(show, BOUNDARY_CHECK_GRACE_MS);
    void reloadIfStale("boundary").then((started) => {
      reloading = started;
      show();
    });
    return () => clearTimeout(timer);
  }, []);

  async function retry() {
    if (!(await reloadIfStale("boundary"))) reset();
  }

  return { checking, retry };
}
