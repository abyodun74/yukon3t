import { decode, encode, type JWT } from "next-auth/jwt";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";

/**
 * Decodes a session cookie value. Null for anything that isn't a valid, unexpired token under this secret and salt
 * (tampered, expired, a different AUTH_SECRET); never throws.
 */
export async function decodeSessionToken(raw: string | undefined, secret: string, salt: string): Promise<JWT | null> {
  if (!raw || !secret) return null;
  try {
    return await decode({ token: raw, secret, salt });
  } catch {
    return null;
  }
}

/** The claims re-read from the database at every refresh, so a renewed cookie never carries stale ones. */
export type FreshSessionClaims = { isAdmin: boolean; trustBand: string | null };

/**
 * The same token with a fresh expiry (`maxAgeSeconds`, SESSION_MAX_AGE_SECONDS unless the absolute session limit cuts
 * it: refreshedSessionMaxAge). The subject and the stable issuedAt the revocation check and the absolute limit read are
 * carried over; isAdmin and trustBand are replaced by `fresh` (read from the database by the caller), so an admin
 * whose role was removed, or a member whose trust band changed, doesn't keep the old value for as long as they stay
 * active; the standard iat/exp/jti are set anew by encode. This is what Auth.js's own session handler does to slide a
 * session, minus the stale claims.
 */
export async function reissueSessionToken(
  claims: JWT,
  secret: string,
  salt: string,
  fresh: FreshSessionClaims,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const rest: JWT = { ...claims, isAdmin: fresh.isAdmin };
  if (fresh.trustBand) rest.trustBand = fresh.trustBand;
  else delete rest.trustBand;
  delete rest.iat;
  delete rest.exp;
  delete rest.jti;
  return encode({ token: rest, secret, salt, maxAge: maxAgeSeconds });
}
