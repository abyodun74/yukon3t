/**
 * Browser half of the password-reset link (server half: reset-token.ts). Client-safe, no dependencies.
 */

/** Where the reset page's inline script leaves the token for ResetPasswordForm. */
export const RESET_TOKEN_GLOBAL = "__ykResetToken";

/** The token from a `#token=...` fragment, or null. */
export function readResetTokenFromHash(hash: string): string | null {
  const match = /(?:^#|&)token=([^&]*)/.exec(hash);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * Inline script rendered at the top of /reset-password's HTML, so it runs while the page is still being parsed: before
 * hydration and before Google Tag Manager, PostHog or a Sentry navigation breadcrumb can read the address. It moves
 * the token into a window property and replaces the URL with the bare path (query and fragment dropped).
 */
export const RESET_TOKEN_CAPTURE_SCRIPT = `(function(){try{var h=location.hash,m=/(?:^#|&)token=([^&]*)/.exec(h);if(m&&m[1]){window[${JSON.stringify(
  RESET_TOKEN_GLOBAL,
)}]=decodeURIComponent(m[1]);}if(h||location.search){history.replaceState(history.state,"",location.pathname);}}catch(e){}})();`;
