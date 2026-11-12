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

/**
 * The same token with a fresh SESSION_MAX_AGE_SECONDS expiry: every claim is carried over (sub, isAdmin, trustBand and
 * the stable issuedAt the revocation check reads) except the standard iat/exp/jti, which encode sets anew. This is what
 * Auth.js's own session handler does to slide a session.
 */
export async function reissueSessionToken(claims: JWT, secret: string, salt: string): Promise<string> {
  const rest: JWT = { ...claims };
  delete rest.iat;
  delete rest.exp;
  delete rest.jti;
  return encode({ token: rest, secret, salt, maxAge: SESSION_MAX_AGE_SECONDS });
}
