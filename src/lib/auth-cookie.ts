// Auth.js's own cookie name convention (see @auth/core/lib/utils/cookie.js):
// the "__Secure-" prefix is used whenever cookies are served over HTTPS.
// Password-based login writes a Session row directly (bypassing Auth.js's
// Credentials provider, which doesn't support the "database" session
// strategy this app uses) and must set the exact same cookie Auth.js would,
// so `auth()` reads it identically regardless of how the session began.
export function sessionCookieName() {
  const secure = process.env.AUTH_URL?.startsWith("https://") ?? true;
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
