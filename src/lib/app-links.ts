// Links to YuKon3t itself: the one canonical origin every shared link uses, how a tapped link is classified (in-app
// page vs. another site), where a link that opened the native app (universal link / Android App Link) leads, and the
// apple-app-site-association document that lets iOS open https://yukon3t.com links in the app. Pure and client-safe:
// no window/document, so it is unit-tested in Vitest's node environment (app-links.test.ts).
//
// Owner rule (2026-11-15): a yukon3t.com link tapped inside the app opens inside the app (same WebView, in-app
// navigation), never the system browser; a link shared out of the app is always https://yukon3t.com/..., never a
// preview / Vercel / Netlify host or localhost, so the OS can hand it to the installed app.

import { notificationDeepLinkPath, safeInAppPath } from "@/lib/push-target";
import { APP_PACKAGE_ID } from "@/lib/app-version";

/** The production origin. Every link the app builds for sharing or email starts with this. */
export const CANONICAL_ORIGIN = "https://yukon3t.com";

/** Hosts that are YuKon3t itself. www redirects to the apex (Netlify 301), so a www link is still this app. */
export const APP_HOSTS: ReadonlySet<string> = new Set(["yukon3t.com", "www.yukon3t.com"]);

/** Apple Developer Team ID (ios/App/App.xcodeproj DEVELOPMENT_TEAM) and bundle id (capacitor.config.ts appId). */
export const IOS_TEAM_ID = "3465L6ZHRJ";
export const IOS_APP_ID = `${IOS_TEAM_ID}.${APP_PACKAGE_ID}`;

/** https://yukon3t.com + an in-app path ("/post/abc"). Anything that is not a safe in-app path falls back to "/". */
export function canonicalUrl(path: string): string {
  return `${CANONICAL_ORIGIN}${safeInAppPath(path) ?? "/"}`;
}

export type LinkTarget =
  /** A page of this app: open it in place (router navigation), never in a browser. `path` passed safeInAppPath. */
  | { kind: "internal"; path: string }
  /** Another website: opens outside the app (system browser), `rel="noopener noreferrer"`. */
  | { kind: "external"; url: string }
  /** mailto:, tel:, sms: and similar: left to the OS. */
  | { kind: "scheme"; url: string }
  /** javascript:, data:, blob:, vbscript:, unparsable or empty: never followed. */
  | { kind: "unsafe" };

const UNSAFE_PROTOCOLS = new Set(["javascript:", "data:", "blob:", "vbscript:", "file:"]);

/**
 * What a tapped link is. `baseUrl` is the page's own address (window.location.href in the browser), used to resolve a
 * relative href and to treat a link to the host the page is being served from (a preview deployment, localhost) as
 * internal there too; without it only absolute yukon3t.com / www.yukon3t.com links count as internal.
 */
export function classifyLink(href: string | null | undefined, baseUrl?: string): LinkTarget {
  const raw = (href ?? "").trim();
  if (!raw) return { kind: "unsafe" };
  let url: URL;
  try {
    url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch {
    return { kind: "unsafe" };
  }
  const protocol = url.protocol.toLowerCase();
  if (UNSAFE_PROTOCOLS.has(protocol)) return { kind: "unsafe" };
  if (protocol !== "https:" && protocol !== "http:") return { kind: "scheme", url: url.href };
  if (url.username || url.password) return { kind: "external", url: url.href };
  const host = url.hostname.toLowerCase();
  let sameOrigin = false;
  if (baseUrl) {
    try {
      sameOrigin = new URL(baseUrl).origin === url.origin;
    } catch {
      sameOrigin = false;
    }
  }
  const isApp = sameOrigin || (APP_HOSTS.has(host) && (url.port === "" || url.port === "443" || url.port === "80"));
  if (!isApp) return { kind: "external", url: url.href };
  const path = safeInAppPath(`${url.pathname}${url.search}${url.hash}`);
  return path ? { kind: "internal", path } : { kind: "unsafe" };
}

/** The in-app path of a link to this app, or null for anything else (another site, a scheme, an unsafe link). */
export function inAppPathFor(href: string | null | undefined, baseUrl?: string): string | null {
  const target = classifyLink(href, baseUrl);
  return target.kind === "internal" ? target.path : null;
}

/**
 * Paths that must be loaded as a document rather than by client-side navigation: route handlers (an emailed sign-in
 * link's /api/auth/callback/..., which sets the session cookie and redirects) and the reset-password page, whose inline
 * script takes the token out of the #fragment before anything else runs (src/lib/reset-token-client.ts).
 */
export function needsDocumentLoad(path: string): boolean {
  const bare = path.split(/[?#]/)[0];
  return bare.startsWith("/api/") || bare === "/reset-password";
}

/** `fromNotification`: the app's own yukon3t://open notification link (treated like a push tap, marks it read). */
export type OpenedUrlTarget = { path: string; documentLoad: boolean; fromNotification: boolean };

/**
 * Where a URL that opened the native app leads (Capacitor App plugin: `getLaunchUrl` on a cold start, `appUrlOpen`
 * while running): an https://yukon3t.com/... universal link / App Link, or the app's own `yukon3t://open?path=`
 * notification link (notificationDeepLinkPath). Anything else (other hosts, `yukon3t://call` ring links handled by
 * incoming-call-listener.tsx, the `yukon3t://share` share-in hand-off) is null.
 */
export function openedUrlTarget(raw: unknown): OpenedUrlTarget | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return null;
  const notificationPath = notificationDeepLinkPath(raw);
  if (notificationPath) {
    return { path: notificationPath, documentLoad: needsDocumentLoad(notificationPath), fromNotification: true };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !APP_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.port !== "" || url.username || url.password) return null;
  const path = safeInAppPath(`${url.pathname}${url.search}${url.hash}`);
  return path ? { path, documentLoad: needsDocumentLoad(path), fromNotification: false } : null;
}

/**
 * The key a launch URL is remembered under once handled (claimLaunchUrl keeps it in sessionStorage so a later reload
 * doesn't open it again). A link loaded as a document carries a secret (a sign-in token in the query, a reset token in
 * the #fragment), so only its bare path plus a 32-bit FNV-1a digest of the whole URL is kept, never the token itself.
 */
export function launchUrlKey(url: string, target: OpenedUrlTarget): string {
  if (!target.documentLoad) return url;
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${target.path.split(/[?#]/)[0]}#${hash.toString(16)}`;
}

/**
 * Which yukon3t.com paths the installed app claims (iOS universal links; the Android intent-filter mirrors it, see the
 * report in docs). First match wins. Everything opens the app (pages, sign-in/sign-up, invites, legal, FAQ) except:
 * - API routes, apart from /api/auth/callback/* (the emailed sign-in link, so it signs the app in);
 * - Next.js assets, the service worker, the web manifest, robots/sitemap, icons, gift artwork and .well-known itself;
 * - /advertise: ad booking is a web/Stripe purchase that the iOS app doesn't show (HideInIosApp), Stripe's return
 *   URLs land there too.
 */
export const APP_LINK_EXCLUDED_PATTERNS = [
  "/_next/*",
  "/.well-known/*",
  "/sw.js",
  "/offline.html",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  "/icons/*",
  "/gifts/*",
  "/advertise",
  "/advertise/*",
] as const;

type AasaComponent = { "/": string; exclude?: true; comment?: string };

export function appleAppSiteAssociation() {
  const components: AasaComponent[] = [
    { "/": "/api/auth/callback/*", comment: "Emailed sign-in links sign the app in" },
    { "/": "/api/*", exclude: true },
    ...APP_LINK_EXCLUDED_PATTERNS.map((pattern) => ({ "/": pattern, exclude: true as const })),
    { "/": "*", comment: "Every other page opens in the app" },
  ];
  return {
    applinks: {
      details: [{ appIDs: [IOS_APP_ID], components }],
    },
    // Lets iOS offer passwords saved for yukon3t.com (Safari, iCloud Keychain) on the app's sign-in screen, once the
    // app carries the matching webcredentials entitlement.
    webcredentials: { apps: [IOS_APP_ID] },
  };
}
