// What the native app (Capacitor iOS/Android, whose WebView survives backgrounding) does when the person comes back to
// it. Pure, so the rules are unit-tested (app-resume.test.ts); capacitor-bridge.tsx, hidden-relock.tsx and
// stale-build-client.ts apply them.
//
// Owner rule (2026-11-15): returning to the app restores the screen the person left, on every screen (a chat thread,
// a profile, a Circle, Settings, a composer...). The "resume" event never navigates. It used to send everyone back to
// /home (added 2026-09-15 with "Reset navigation to /home on every app resume, not just cold start": a product choice
// to make a return look like a fresh launch), which then needed a pile of exceptions: auth flows, the Android photo
// picker (whose Activity hand-off fires "resume" too), calls and ringing, push taps, emailed links. What that reset
// incidentally gave (a fresh Home) is kept by better means instead:
//  - freshness: every useRealtimeEvent resyncs on visibilitychange (shared scheduler), the stale-build check reloads a
//    WebView left behind by a deploy IN PLACE (same URL; the one exception is a just-tapped notification, see
//    staleReloadDestination), and after a longer absence the current route's server data is re-read in place
//    (shouldRefreshOnReturn -> router.refresh(), which keeps client state such as a draft);
//  - privacy: HiddenRelock locks hidden chats the moment the page is hidden and, on return, turns the screen into the
//    PIN prompt (hiddenRelockStep, and the server redirect in messages/[id]/page.tsx);
//  - pushes / opened links: their own navigation (capacitor-bridge.tsx's openTapped / openLinked) is where the person
//    asked to go; nothing on resume overrides it (planAppReturn).
// A cold start (the process was killed) still opens Home, as any launch does. There is deliberately no "away too long,
// go Home" rule: a long absence only means a refresh (and, after a deploy, a reload of the same page).

/** After at least this long in the background, the current route's server data is re-read on return. */
export const RESUME_REFRESH_AFTER_MS = 2 * 60_000;

/**
 * Whether a return to the app should re-read the current route's server data in place (router.refresh()).
 * Not for a short trip away (live data already resyncs through useRealtimeEvent), not when the "resume" came from the
 * Android photo/video picker's Activity closing (the composer waiting on that pick is the screen; isNativePickerActive),
 * and not when a stale-build reload is already reloading the page. `awayMs` is null when the app never reported going
 * to the background (no "pause" seen): nothing to measure, nothing to refresh.
 */
export function shouldRefreshOnReturn({
  awayMs,
  pickerActive,
  reloading,
}: {
  awayMs: number | null;
  pickerActive: boolean;
  reloading: boolean;
}): boolean {
  if (awayMs === null || pickerActive || reloading) return false;
  return awayMs >= RESUME_REFRESH_AFTER_MS;
}

export type AppReturnPlan = { kind: "stay" } | { kind: "open"; path: string };

function withoutHash(path: string): string {
  return path.split("#")[0];
}

/**
 * Where the app should be when it comes back or (re)loads, given the pending notification tap / opened link
 * (pendingPushTap(): a push tap and an https://yukon3t.com link or yukon3t://open link that opened the app are all
 * recorded there), the page now open (pathname + search) and whether that page is a landing page (Home or "/": where a
 * cold start or a reload lands, never a page the person has since chosen).
 *
 * - Nothing pending: "stay". This is every ordinary return to the app: the screen they left.
 * - A tap/link pending and the app already on its page: "stay" (the caller clears the tap).
 * - A tap/link pending, not there yet, on a landing page: "open" its target. That is a cold start from the tap, or a
 *   reload that cut the tap's own navigation short.
 * - A tap/link pending, not there yet, anywhere else: "stay". The tap's own router.push is in flight (Android delivers
 *   the tap before "resume", iOS just after); doing it again would add a second entry, and moving away from a page
 *   the person chose afterwards would be wrong.
 */
export function planAppReturn({
  pendingTap,
  location,
  onLandingPage,
}: {
  pendingTap: string | null;
  location: string;
  onLandingPage: boolean;
}): AppReturnPlan {
  if (!pendingTap) return { kind: "stay" };
  if (withoutHash(pendingTap) === withoutHash(location)) return { kind: "stay" };
  return onLandingPage ? { kind: "open", path: pendingTap } : { kind: "stay" };
}

/** Home and "/" (which redirects there): where a cold start or a reload of the launch URL lands. */
export function isLandingPath(pathname: string): boolean {
  return pathname === "/home" || pathname === "/";
}

export type StaleReloadDestination = { kind: "reload" } | { kind: "replace"; path: string };

/**
 * Where a stale-build reload goes: the same page, always (location.reload(), so the URL and the screen stay), except
 * while a notification tap / opened link is pending, whose own in-app navigation the reload would cut short: then its
 * target (location.replace).
 */
export function staleReloadDestination(pendingTap: string | null): StaleReloadDestination {
  return pendingTap ? { kind: "replace", path: pendingTap } : { kind: "reload" };
}

export type HiddenRelockStep = "lock" | "show-pin-prompt" | "none";

/**
 * HiddenRelock (mounted only on an unlocked hidden-chats page or hidden thread), on a visibilitychange:
 * - hidden: "lock" (clear the unlock cookie and cover the screen), except under the Android picker, whose Activity
 *   hides the page like backgrounding does and must not throw away the attachment being picked;
 * - visible again after a lock: "show-pin-prompt": make sure the lock reached the server, then re-render the route,
 *   which the server answers with the PIN prompt (messages/[id]/page.tsx redirects to hiddenUnlockPath);
 * - anything else: "none".
 */
export function hiddenRelockStep({
  visibility,
  pickerActive,
  relocked,
}: {
  visibility: "hidden" | "visible";
  pickerActive: boolean;
  relocked: boolean;
}): HiddenRelockStep {
  if (visibility === "hidden") return pickerActive ? "none" : "lock";
  return relocked ? "show-pin-prompt" : "none";
}
