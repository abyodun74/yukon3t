import { encode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { sessionCookieName, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";

type ClaimsSource = { isAdmin?: boolean; trustBand?: string | null };

/**
 * Single source of truth for what goes into a session JWT's custom claims.
 * Used both by NextAuth's own `jwt` callback (OAuth/magic-link sign-ins)
 * and by issueSessionCookie below (password sign-ins, which bypass NextAuth's
 * Credentials flow entirely since it doesn't support this app's status/
 * verification-gated login logic). Only call this at session-creation time —
 * Auth.js re-signs the JWT on every request to slide its expiry, which resets
 * the standard `iat` claim to "now" each time, so `issuedAt` here is a
 * separate, stable marker of when the session actually began.
 */
export function sessionTokenClaims(user: ClaimsSource) {
  return {
    isAdmin: Boolean(user.isAdmin),
    trustBand: user.trustBand ?? undefined,
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Issues a session cookie identical in shape to the one Auth.js would create
 * for OAuth/magic-link sign-ins — same secret, salt (the cookie name, per
 * Auth.js's own convention), and claim shape — so `auth()` reads it
 * identically regardless of how the session began.
 */
export async function issueSessionCookie(user: {
  id: string;
  isAdmin?: boolean;
  trustBand?: string | null;
}) {
  const cookieName = sessionCookieName();
  const token = await encode({
    token: { sub: user.id, ...sessionTokenClaims(user) },
    secret: process.env.AUTH_SECRET!,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.AUTH_URL?.startsWith("https://") ?? true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}
