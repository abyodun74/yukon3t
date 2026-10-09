/**
 * Pure decision logic for components/stale-build-reload.tsx: a tab opened
 * before a deploy keeps the old client runtime, and the next lazily-loaded
 * chunk it asks for no longer exists (Netlify/Vercel deploys are atomic), so
 * the webpack/Turbopack runtime throws. These helpers decide whether an error
 * looks like that, and whether reloading is actually warranted — the build-id
 * comparison is what separates a stale tab from a genuine bug that merely
 * matches one of these messages.
 */

export const STALE_BUILD_RELOAD_KEY = "yukon3t:stale-build-reload";
export const STALE_BUILD_RELOAD_COOLDOWN_MS = 30_000;

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
];

export function looksLikeStaleBuildError(error: unknown): boolean {
  if (error == null) return false;
  const { name, message, stack } =
    typeof error === "string"
      ? { name: "", message: error, stack: "" }
      : (error as { name?: unknown; message?: unknown; stack?: unknown });
  const msg = typeof message === "string" ? message : "";
  const trace = typeof stack === "string" ? stack : "";

  if (name === "ChunkLoadError") return true;
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
