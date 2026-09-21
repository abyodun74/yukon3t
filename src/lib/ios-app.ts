/**
 * Best-effort server-side guess that a request comes from the native iOS app
 * (the Capacitor WKWebView shell — see capacitor.config.ts). An embedded
 * WKWebView reports an iPhone/iPad user agent but, unlike Safari and every
 * other iOS browser, has no "Safari/" token. Used only to avoid painting
 * something the client-side check (Capacitor.getPlatform() === "ios",
 * components/hide-in-ios-app.tsx) is about to remove — the client check is the
 * authority, and other iOS in-app browsers matching this too is harmless.
 */
export function isLikelyIosAppUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /iPhone|iPad|iPod/.test(userAgent) && !/Safari\//.test(userAgent);
}
