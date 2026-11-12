import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionCookieName, sessionSecret, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";
import { decodeSessionToken, reissueSessionToken } from "@/lib/session-refresh";
import { mayRefreshSession, refreshedSessionMaxAge } from "@/lib/session-refresh-rules";

function done(refreshed: boolean) {
  return NextResponse.json({ refreshed }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Slides a signed-in member's session: re-issues the session cookie with a fresh 30-day expiry, so someone who keeps
 * using the app is never signed out by the cookie simply running out (see session-refresh-rules.ts for why Auth.js
 * doesn't do this here on its own). Called by SessionKeepAlive at most every 12 hours per device. A session is only
 * slid until SESSION_ABSOLUTE_MAX_AGE_SECONDS (120 days) after it began (its `issuedAt`); after that it isn't
 * extended and runs out by itself, and the last re-issue is cut to end exactly then (refreshedSessionMaxAge). The
 * isAdmin and trustBand claims are re-read from the database, never copied from the old token.
 *
 * It can only ever extend a session, never end one. Whatever goes wrong (no cookie, a token this server can't read
 * (e.g. a different AUTH_SECRET), a database error during a deploy or cold start, a revoked or inactive account) the
 * answer is `{ refreshed: false }` and the cookie the browser holds is left exactly as it was. Unlike Auth.js's own
 * /api/auth/session handler, which deletes a cookie it can't decode.
 */
export async function POST(request: NextRequest) {
  const cookieName = sessionCookieName();
  let secret;
  try {
    secret = sessionSecret();
  } catch (err) {
    // Production with an unusable AUTH_SECRET (see assertSessionSecretUsable): nothing can be signed; touch nothing.
    console.error("[session-refresh] session secret unusable; cookie left as is", err);
    return done(false);
  }
  const claims = await decodeSessionToken(request.cookies.get(cookieName)?.value, secret, cookieName);
  if (!claims) return done(false);

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: String(claims.sub ?? "") },
      select: { status: true, isGuestPreview: true, sessionInvalidatedAt: true, isAdmin: true, trustBand: true },
    });
  } catch (err) {
    console.error("[session-refresh] user lookup failed; cookie left as is", err);
    return done(false);
  }
  if (!user || !mayRefreshSession(claims, user)) return done(false);
  const maxAge = refreshedSessionMaxAge(claims, Math.floor(Date.now() / 1000), SESSION_MAX_AGE_SECONDS);
  if (maxAge === null) return done(false);

  let token;
  try {
    token = await reissueSessionToken(
      claims,
      secret,
      cookieName,
      { isAdmin: Boolean(user.isAdmin), trustBand: user.trustBand ?? null },
      maxAge,
    );
  } catch (err) {
    console.error("[session-refresh] could not re-issue the session token; cookie left as is", err);
    return done(false);
  }
  const response = done(true);
  // Same attributes Auth.js and issueSessionCookie give this cookie. A persistent cookie (Max-Age), so it survives the
  // native app's process being killed and browser restarts.
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: cookieName.startsWith("__Secure-"),
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return response;
}
