// Where a tapped push notification leads, and remembering that tap for long enough that nothing else on the way back
// into the app can move the user off it.
//
// The native app (components/capacitor-bridge.tsx) gets the tap as a `notificationActionPerformed` event carrying the
// push's `url` data field (lib/fcm.ts). Two other things run at that same moment, and both used to win over the tap:
//  - the "resume" listener, which sends a returning user back to /home; on Android the tap event arrives *before*
//    resume (onNewIntent runs before onResume), so the reset overrode the tap whenever the user had left Home;
//  - the stale-build check (lib/stale-build-client.ts), which reloads a WebView left behind by a deploy, i.e. on most
//    first opens after a deploy; the reload threw away the navigation still in flight, and the plugin doesn't deliver
//    the tap again to the reloaded page.
// So a tap is recorded here (memory + sessionStorage, which survives that reload) for PUSH_TAP_TTL_MS: the resume reset
// stands down while one is pending, a stale-build reload goes to it instead of reloading the old page, and the bridge
// re-applies it after a reload. It is cleared once the app is on that page.
//
// The pure parts (safeInAppPath, parsePushTap, isPushTapPending) are unit-tested; the store functions only touch
// sessionStorage inside try/catch, so blocked storage just means the in-memory copy is used.

/** How long a tap keeps the resume reset and a stale-build reload away. Long enough for a slow cold start. */
export const PUSH_TAP_TTL_MS = 20_000;
export const PUSH_TAP_KEY = "yukon3t:push-tap";

const PLACEHOLDER_ORIGIN = "https://in-app.invalid";

/**
 * The same-origin path (with its query and #fragment) a push may open, or null. Only a path on this site: a full URL,
 * a protocol-relative `//host`, a backslash form browsers treat as one (`/\host`), a `javascript:` URL or anything
 * with control characters is refused, so a push payload can never send the app somewhere else.
 */
export function safeInAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export type PushTap = { url: string; at: number };

export function parsePushTap(raw: string | null): PushTap | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { url?: unknown; at?: unknown };
    const url = safeInAppPath(value.url);
    if (!url || typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
    return { url, at: value.at };
  } catch {
    return null;
  }
}

export function isPushTapPending(tap: PushTap | null, now: number): tap is PushTap {
  return tap !== null && now >= tap.at && now - tap.at < PUSH_TAP_TTL_MS;
}

/** Whether `location` (pathname + search, as the page is now) is the page the tap opens. The #fragment doesn't count. */
export function isAtPushTarget(tapUrl: string, location: string): boolean {
  return tapUrl.split("#")[0] === location.split("#")[0];
}

let memoryTap: PushTap | null = null;

/** Records a tap on a push notification that opens `url` (already passed through safeInAppPath). */
export function rememberPushTap(url: string, now = Date.now()) {
  memoryTap = { url, at: now };
  try {
    sessionStorage.setItem(PUSH_TAP_KEY, JSON.stringify(memoryTap));
  } catch {}
}

/** The tapped push's target while it is still pending, else null. */
export function pendingPushTap(now = Date.now()): string | null {
  let tap = memoryTap;
  if (!tap) {
    try {
      tap = parsePushTap(sessionStorage.getItem(PUSH_TAP_KEY));
    } catch {}
  }
  return isPushTapPending(tap, now) ? tap.url : null;
}

export function clearPushTap() {
  memoryTap = null;
  try {
    sessionStorage.removeItem(PUSH_TAP_KEY);
  } catch {}
}
