/**
 * Pure decision logic for lib/stale-build-client.ts: a tab (or the native
 * app's WebView, which stays alive for days) opened before a deploy keeps the
 * old client runtime. The next lazily-loaded chunk it asks for no longer
 * exists (Netlify/Vercel deploys are atomic), and every Server Action id it
 * holds is unknown to the new build (ids are salted with a per-build key), so
 * the runtime throws. These helpers decide whether an error looks like that,
 * and whether reloading is actually warranted — the build-id comparison is
 * what separates a stale tab from a genuine bug that merely matches one of
 * these messages.
 */

export const STALE_BUILD_RELOAD_KEY = "yukon3t:stale-build-reload";
export const STALE_BUILD_RELOAD_COOLDOWN_MS = 30_000;
export const BUILD_CHECK_MIN_INTERVAL_MS = 60_000;

const STALE_BUILD_MESSAGE_PATTERNS = [
  /Loading chunk \S+ failed/i,
  /Loading CSS chunk/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  // Safari/WKWebView's wording for the same dynamic-import failure.
  /Importing a module script failed/i,
  // Turbopack's runtime, when a chunk references a module the page's
  // already-loaded runtime has never heard of.
  /module factory is not available/i,
  // Next's client router (UnrecognizedActionError), when the server answers
  // an action call with its "action not found" header.
  /Server Action "[^"]*" was not found on the server/i,
  // The server-side wording of the same thing, for a form posted without JS.
  /Failed to find Server Action/i,
];

export function looksLikeStaleBuildError(error: unknown): boolean {
  if (error == null) return false;
  const { name, message, stack } =
    typeof error === "string"
      ? { name: "", message: error, stack: "" }
      : (error as { name?: unknown; message?: unknown; stack?: unknown });
  const msg = typeof message === "string" ? message : "";
  const trace = typeof stack === "string" ? stack : "";

  if (name === "ChunkLoadError" || name === "UnrecognizedActionError") return true;
  if (STALE_BUILD_MESSAGE_PATTERNS.some((re) => re.test(msg))) return true;
  // The webpack runtime's missing-module-factory case ("i[e] is not a
  // function") — far too generic on its own, so only when it's thrown from
  // Next's own bundled code rather than e.g. an inline or third-party script.
  return /is not a function/.test(msg) && trace.includes("/_next/static/");
}

export type ReloadRecord = { target: string; at: number };

export function parseReloadRecord(raw: string | null): ReloadRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReloadRecord>;
    return typeof parsed.target === "string" && typeof parsed.at === "number"
      ? { target: parsed.target, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

export function shouldReloadForBuild({
  clientBuildId,
  serverBuildId,
  lastReload,
  now,
}: {
  clientBuildId: string | undefined;
  serverBuildId: string | null | undefined;
  lastReload: ReloadRecord | null;
  now: number;
}): boolean {
  if (!clientBuildId || !serverBuildId) return false;
  // Same build on both sides: the error is a real bug, not staleness.
  if (serverBuildId === clientBuildId) return false;
  if (lastReload) {
    // Already reloaded once for this exact build and it didn't help (e.g. a
    // CDN still handing out old HTML) — another reload would just loop.
    if (lastReload.target === serverBuildId) return false;
    if (now - lastReload.at < STALE_BUILD_RELOAD_COOLDOWN_MS) return false;
  }
  return true;
}

/** Foreground checks only: at most one build-id request per interval. */
export function isBuildCheckThrottled(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt !== null && now - lastCheckAt < BUILD_CHECK_MIN_INTERVAL_MS;
}

/**
 * What asked for the reload. "boundary" is an error boundary already on
 * screen — the page is broken, so there is nothing left on it to lose.
 * "hidden" is the page going to the background with a reload still owed.
 */
export type ReloadTrigger = "foreground" | "error" | "boundary" | "hidden";

export function isReloadSafe(
  trigger: ReloadTrigger,
  busy: { call: boolean; work: boolean; typing: boolean },
): boolean {
  // The call UI lives in the root layout and outlives a page-level error
  // boundary, so a reload would hang up even then.
  if (busy.call) return false;
  if (trigger === "boundary") return true;
  if (busy.work) return false;
  // A half-typed message waits for blur, or for the page to be put away.
  return trigger === "hidden" || !busy.typing;
}

// Things in flight that a reload would destroy, registered by whoever owns
// them. "work" is an upload or a recording; a call is kept apart because it
// is the one thing that still matters once the page itself has crashed.
export type ReloadHold = "call" | "work";

const holds: Record<ReloadHold, number> = { call: 0, work: 0 };

/** Blocks stale-build reloads until the returned release function is called. */
export function holdReload(kind: ReloadHold): () => void {
  holds[kind]++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds[kind]--;
  };
}

export function isReloadHeld(kind: ReloadHold): boolean {
  return holds[kind] > 0;
}
