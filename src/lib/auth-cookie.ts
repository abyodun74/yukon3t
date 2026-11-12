// Auth.js's own cookie name convention (see @auth/core/lib/utils/cookie.js):
// the "__Secure-" prefix is used whenever cookies are served over HTTPS.
// Sessions are JWT cookies (strategy "jwt", src/lib/auth.ts). Password login
// (issueSessionCookie) and the session refresh route (/api/session/refresh)
// write that cookie themselves, so they must use the exact name, salt and
// secret Auth.js uses, or `auth()` would not read it.
export function sessionCookieName() {
  const secure = process.env.AUTH_URL?.startsWith("https://") ?? true;
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/**
 * The secret session JWTs are encrypted with, resolved the same way next-auth does (next-auth/lib/env.js:
 * AUTH_SECRET, else NEXTAUTH_SECRET). Must be the same value on Netlify and Vercel and must never change between
 * deploys: a different value makes every existing session cookie unreadable, which signs everyone out.
 */
export function sessionSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
