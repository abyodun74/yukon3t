// The pure half of src/proxy.ts's page-level rate limit: whose request this is, which buckets it counts against, and
// what a refused request gets back. Edge-safe (no Node APIs, no app imports beyond the pure locale helpers), and
// unit-tested in page-rate-limit.test.ts.

import { localeDirection, resolveLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";

type HeaderGetter = (name: string) => string | null;

/**
 * The client's IP, or null when the request doesn't say. Netlify (which serves yukon3t.com) puts the connecting
 * client's address in `x-nf-client-connection-ip` and sets it itself, so a client can't choose it; `x-forwarded-for`
 * there can carry whatever the client sent ahead of Netlify's own entry, so its first hop is only a fallback. Vercel
 * sets `x-real-ip` (and overwrites `x-forwarded-for`) to the client's address. Never a shared placeholder such as
 * "unknown": every request without an address would then count against one bucket for everybody.
 */
export type DeployPlatform = "netlify" | "vercel" | "other";

const BUILD_PLATFORM: DeployPlatform =
  process.env.DEPLOY_PLATFORM === "netlify" || process.env.DEPLOY_PLATFORM === "vercel" ? process.env.DEPLOY_PLATFORM : "other";

/**
 * Only the header the current host sets itself is trusted first: Netlify's x-nf-client-connection-ip on Netlify,
 * Vercel's x-real-ip on Vercel. Each passes the other's header through as the client sent it, so trusting both
 * everywhere would let anyone pick their own address (and their own rate-limit bucket) on the other host.
 */
export function clientIpFromHeaders(get: HeaderGetter, platform: DeployPlatform = BUILD_PLATFORM): string | null {
  const own =
    platform === "netlify"
      ? get("x-nf-client-connection-ip")?.trim()
      : platform === "vercel"
        ? get("x-real-ip")?.trim()
        : undefined;
  if (own) return own;
  const firstHop = get("x-forwarded-for")?.split(",")[0]?.trim();
  return firstHop || null;
}

// The device id cookie is minted by src/proxy.ts as crypto.randomUUID(). Anything else (a hand-made value) is not
// used as a rate-limit key: it would let a client pick its own bucket name.
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deviceIdForRateLimit(value: string | undefined | null): string | null {
  return value && DEVICE_ID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export type PageLimitCheck =
  | { limiter: "pageRequestDevice"; identifier: string }
  | { limiter: "pageRequestNetwork"; identifier: string }
  | { limiter: "pageRequest"; identifier: string };

/**
 * Which buckets a request counts against (see the three page limiters in src/lib/rate-limit.ts). A request from a
 * known device counts against that device and against its network's much larger shared ceiling, so several phones on
 * one Wi-Fi or a carrier's shared address don't use up each other's allowance, while one device is still bounded and
 * a client inventing device ids is still bounded by its network. A request with no device cookie (a first visit, or
 * a client that drops cookies) counts against the strict per-address bucket. With no address at all there is nothing
 * fair to count against, so it isn't counted (the caller logs that).
 */
export function pageLimitChecks(ip: string | null, deviceId: string | null): PageLimitCheck[] {
  if (!ip) return [];
  if (deviceId) {
    return [
      { limiter: "pageRequestDevice", identifier: deviceId },
      { limiter: "pageRequestNetwork", identifier: ip },
    ];
  }
  return [{ limiter: "pageRequest", identifier: ip }];
}

/**
 * Whether a refused request should get the self-reloading page (a document the WebView or browser will show) or a
 * bare 429 (an RSC fetch or prefetch, a Server Action, an API call: code reads those, and an HTML body there would
 * be the wrong thing to hand it).
 */
export function isDocumentRequest(get: HeaderGetter): boolean {
  if (get("next-action") || get("rsc") || get("next-router-prefetch")) return false;
  const dest = get("sec-fetch-dest");
  if (dest) return dest === "document";
  const mode = get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (get("accept") ?? "").includes("text/html");
}

/** Seconds a refused client is told to wait (Retry-After), and how long the page waits before reloading itself. */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 10;

const PAGE_TEXT: Record<Locale, { title: string; body: string; retry: string }> = {
  en: {
    title: "Just a moment",
    body: "Too many requests came from this device or network in a short time. This page will reload by itself in a few seconds.",
    retry: "Try again now",
  },
  es: {
    title: "Un momento",
    body: "Llegaron demasiadas solicitudes desde este dispositivo o esta red en poco tiempo. Esta página se volverá a cargar sola en unos segundos.",
    retry: "Reintentar ahora",
  },
  fr: {
    title: "Un instant",
    body: "Trop de requêtes ont été envoyées depuis cet appareil ou ce réseau en peu de temps. Cette page va se recharger d'elle-même dans quelques secondes.",
    retry: "Réessayer maintenant",
  },
  pt: {
    title: "Só um momento",
    body: "Chegaram muitas solicitações deste dispositivo ou desta rede em pouco tempo. Esta página vai recarregar sozinha em alguns segundos.",
    retry: "Tentar novamente agora",
  },
  ar: {
    title: "لحظة من فضلك",
    body: "وصل عدد كبير من الطلبات من هذا الجهاز أو هذه الشبكة خلال وقت قصير. سيُعاد تحميل هذه الصفحة تلقائيًا بعد ثوانٍ.",
    retry: "إعادة المحاولة الآن",
  },
};

export function rateLimitPageText(locale: Locale) {
  return PAGE_TEXT[locale];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The reader's language for the page: the language picker's cookie, else Accept-Language, else English. */
export function rateLimitPageLocale(cookieHeader: string | null, acceptLanguage: string | null): Locale {
  const cookie = (cookieHeader ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${LOCALE_COOKIE}=`));
  return resolveLocale(cookie?.slice(LOCALE_COOKIE.length + 1), acceptLanguage);
}

/**
 * A small self-contained page for a refused document request: no app JavaScript (nothing of the app can load while
 * it's refused), one nonce'd style block, and a meta refresh that reloads the same address after the wait, plus a
 * link to do it now. Light or dark like the app: its theme choice, else the device's setting. `path` is the request's own path and query.
 */
export function rateLimitPage({
  locale,
  path,
  nonce,
  theme = "system",
}: {
  locale: Locale;
  path: string;
  nonce: string;
  /** The app's own theme choice (THEME_COOKIE): an explicit choice wins over the device setting, as in the app. */
  theme?: "light" | "dark" | "system";
}): string {
  const t = PAGE_TEXT[locale];
  // Only a path on this site: not an absolute URL, and not "//host", which a browser reads as another site.
  const href = escapeHtml(path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/");
  return `<!doctype html>
<html lang="${locale}" dir="${localeDirection(locale)}"${theme === "system" ? "" : ` data-theme="${theme}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${RATE_LIMIT_RETRY_AFTER_SECONDS};url=${href}">
<title>${escapeHtml(t.title)}</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;--bg:#f7f3ec;--fg:#1f2326;--soft:#5b6166;--accent:#b5651d;--ink:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14181a;--fg:#eef0f1;--soft:#a7adb2;--accent:#e08a3c;--ink:#14181a}}
:root[data-theme=dark]{color-scheme:dark;--bg:#14181a;--fg:#eef0f1;--soft:#a7adb2;--accent:#e08a3c;--ink:#14181a}
:root[data-theme=light]{color-scheme:light}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:28rem;padding:2rem 1.5rem;text-align:center}
h1{font-size:1.5rem;margin:0 0 .75rem}
p{margin:0 0 1.5rem;color:var(--soft)}
a{display:inline-block;padding:.65rem 1.25rem;border-radius:.6rem;background:var(--accent);color:var(--ink);font-weight:600;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(t.title)}</h1>
<p>${escapeHtml(t.body)}</p>
<a href="${href}">${escapeHtml(t.retry)}</a>
</main>
</body>
</html>`;
}
