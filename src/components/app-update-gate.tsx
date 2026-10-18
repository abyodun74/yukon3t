"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { Download, X } from "lucide-react";
import {
  SOFT_SNOOZE_MS,
  UPDATE_CHECK_INTERVAL_MS,
  isOpenableStoreLink,
  snoozeKey,
  type AppPlatform,
} from "@/lib/app-version";
import { getNativeAppInfo } from "@/lib/native-app-info";
import { signOutThisDevice } from "@/lib/sign-out-client";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useShellText } from "@/components/ui-text";

const CACHE_KEY = "yk-app-update-check";
const SNOOZE_KEY = "yk-app-update-snooze";
const FETCH_TIMEOUT_MS = 8000;
// When the store app's own scheme didn't take the user anywhere (no store app), the https listing instead.
const NATIVE_LINK_FALLBACK_MS = 2500;

// Where the soft banner never shows: sign-in and onboarding steps, so it can't crowd a form (or its Turnstile check)
// someone is in the middle of.
const BANNER_HIDDEN_PREFIXES = ["/sign-in", "/sign-up", "/onboarding", "/verify-email", "/forgot-password", "/reset-password", "/invite"];
// Where the "Update required" screen steps aside, so its own Help link has somewhere to go.
const FORCE_EXEMPT_PREFIXES = ["/faq", "/legal"];

type Verdict = {
  status: "current" | "soft" | "force";
  storeUrl: string | null;
  nativeUrl: string | null;
  message: string | null;
  // What a "Not now" is remembered against (see snoozeKey).
  target: number | null;
};
type App = { platform: AppPlatform; build: number; version: string | null };
type CachedCheck = App & { at: number; verdict: Verdict };

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Storage can be unavailable (private mode, blocked site data); every read and write is optional.
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; the next launch just asks again.
  }
}

function sameApp(a: App, b: App) {
  return a.platform === b.platform && a.build === b.build && a.version === b.version;
}

/** The API's answer, keeping only what this component trusts: a known status and store links it may open. */
function toVerdict(json: unknown): Verdict | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  if (body.status !== "current" && body.status !== "soft" && body.status !== "force") return null;
  const storeUrl = isOpenableStoreLink(body.storeUrl) ? body.storeUrl : null;
  const nativeUrl = isOpenableStoreLink(body.nativeUrl) ? body.nativeUrl : null;
  // Nowhere to send the user means no prompt, whatever the status says.
  const status = storeUrl ? body.status : "current";
  return {
    status,
    storeUrl,
    nativeUrl,
    message: typeof body.message === "string" ? body.message.slice(0, 280) : null,
    target: typeof body.latestBuild === "number" ? body.latestBuild : null,
  };
}

async function fetchVerdict(app: App): Promise<Verdict | null> {
  const params = new URLSearchParams({ p: app.platform, b: String(app.build) });
  if (app.version) params.set("v", app.version);
  try {
    const response = await fetch(`/api/app-version?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok ? toVerdict(await response.json()) : null;
  } catch {
    return null;
  }
}

/** Opens the store: the store app's own scheme first, the https listing if that didn't take us anywhere. */
function openStore(verdict: Verdict) {
  const { nativeUrl, storeUrl } = verdict;
  if (!storeUrl) return;
  // Same way the rest of the app opens an outside link: the native shell hands it to the OS.
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  if (!nativeUrl) {
    open(storeUrl);
    return;
  }
  let left = false;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") left = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  open(nativeUrl);
  setTimeout(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (!left) open(storeUrl);
  }, NATIVE_LINK_FALLBACK_MS);
}

/**
 * "Please update the app" — mounted once in layout.tsx for everyone, native app only (Capacitor.isNativePlatform()),
 * modelled on ReviewPromptGate. At launch and on every return to the foreground it reads the installed build
 * (App.getInfo()) and asks GET /api/app-version, at most every 6 hours for the same build — every time while blocked,
 * so lifting a force update (or updating the app) takes effect on the next foreground. Policy and rules:
 * src/lib/app-version.ts, set by the owner on /admin/system.
 *
 * - soft: a dismissible "Update available" banner under the header; "Not now" hides it for 3 days for this build and
 *   this target release. Not shown on sign-in/onboarding pages.
 * - force (only from an owner-set minBuild): a full-screen "Update required" sheet with Update, Help & FAQ, and Sign
 *   out for a signed-in user. It steps aside on /faq and /legal so those stay readable, and sits under the call UI.
 *
 * Separate from StaleBuildReload, which reloads a stale *web* bundle; this is about the installed native shell.
 */
export function AppUpdateGate({ userId }: { userId: string | null }) {
  const { t, locale } = useShellText();
  const pathname = usePathname() ?? "/";
  const [app, setApp] = useState<App | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [snoozedKey, setSnoozedKey] = useState<string | null>(null);

  const check = useCallback(async () => {
    const info = await getNativeAppInfo();
    // An app that can't say which build it is is never prompted.
    if (!info || info.build === null) {
      setApp(null);
      setVerdict(null);
      return;
    }
    const current: App = { platform: info.platform, build: info.build, version: info.version };
    setApp(current);
    const snooze = readJson<{ key: string; until: number }>(SNOOZE_KEY);
    setSnoozedKey(snooze && snooze.until > Date.now() ? snooze.key : null);

    const cached = readJson<CachedCheck>(CACHE_KEY);
    const cachedHere = cached && sameApp(cached, current) ? cached : null;
    if (cachedHere) {
      setVerdict(cachedHere.verdict);
      const fresh = Date.now() - cachedHere.at < UPDATE_CHECK_INTERVAL_MS;
      if (fresh && cachedHere.verdict.status !== "force") return;
    }
    const answer = await fetchVerdict(current);
    // A failed check keeps whatever this build was last told (nothing, for a first check).
    if (!answer) return;
    setVerdict(answer);
    writeJson(CACHE_KEY, { ...current, at: Date.now(), verdict: answer } satisfies CachedCheck);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Off the mount's own tick (a timer, like ReviewPromptGate), so the first paint never waits on it.
    const timer = setTimeout(() => void check(), 0);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  const forceShown = verdict?.status === "force" && !startsWithAny(pathname, FORCE_EXEMPT_PREFIXES);
  const key = app && verdict ? snoozeKey(app.platform, app.build, verdict.target ?? app.version) : null;
  const bannerShown =
    verdict?.status === "soft" && key !== null && key !== snoozedKey && !startsWithAny(pathname, BANNER_HIDDEN_PREFIXES);
  // The owner's own note is written in English; other languages get the standard translated text only.
  const note = locale === "en" ? verdict?.message : null;

  function snooze() {
    if (!key) return;
    writeJson(SNOOZE_KEY, { key, until: Date.now() + SOFT_SNOOZE_MS });
    setSnoozedKey(key);
  }

  if (forceShown && verdict) {
    return <UpdateRequired verdict={verdict} note={note ?? null} userId={userId} />;
  }
  if (!bannerShown || !verdict) return null;

  return (
    <div className="px-4">
      <section
        aria-label={t.appUpdate.label}
        className="mx-auto mt-3 flex max-w-6xl items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow-sm)]"
      >
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t.appUpdate.bannerTitle}</p>
          <p className="mt-0.5 text-sm text-foreground-soft">{note || t.appUpdate.bannerBody}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openStore(verdict)}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              {t.appUpdate.update}
            </button>
            <button
              type="button"
              onClick={snooze}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground-soft hover:text-foreground"
            >
              {t.appUpdate.later}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={snooze}
          aria-label={t.common.close}
          className="-me-1 -mt-1 shrink-0 rounded-lg p-1.5 text-foreground-soft hover:bg-line"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </section>
    </div>
  );
}

function UpdateRequired({
  verdict,
  note,
  userId,
}: {
  verdict: Verdict;
  note: string | null;
  userId: string | null;
}) {
  const { t } = useShellText();
  const [signingOut, setSigningOut] = useState(false);
  // No Escape: there is nothing to go back to. Focus moves in so a screen reader lands on it.
  const dialogRef = useDialogFocus<HTMLDivElement>(true);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-required-title"
      aria-describedby="app-update-required-body"
      tabIndex={-1}
      className="fixed inset-0 z-[55] flex flex-col items-center justify-center overflow-y-auto bg-background px-6 text-center outline-none"
      style={{
        paddingTop: "max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px), 1.5rem)",
        paddingBottom: "max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px), 1.5rem)",
      }}
    >
      <div className="flex w-full max-w-sm flex-col items-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Download className="h-7 w-7" aria-hidden />
        </span>
        <h2 id="app-update-required-title" className="mt-4 text-xl font-semibold">
          {t.appUpdate.requiredTitle}
        </h2>
        <p id="app-update-required-body" className="mt-2 text-sm text-foreground-soft">
          {t.appUpdate.requiredBody}
        </p>
        {note && <p className="mt-2 text-sm text-foreground-soft">{note}</p>}
        <button
          type="button"
          onClick={() => openStore(verdict)}
          className="mt-6 w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-ink"
        >
          {t.appUpdate.update}
        </button>
        <Link
          href="/faq#update-the-app"
          className="mt-3 w-full rounded-lg border border-line px-4 py-3 text-sm font-medium hover:border-accent hover:text-accent"
        >
          {t.appUpdate.help}
        </Link>
        {userId !== null && (
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOutThisDevice(userId).finally(() => setSigningOut(false));
            }}
            className="mt-3 w-full rounded-lg px-4 py-3 text-sm font-medium text-foreground-soft hover:text-foreground disabled:opacity-50"
          >
            {t.nav.signOut}
          </button>
        )}
      </div>
    </div>
  );
}
