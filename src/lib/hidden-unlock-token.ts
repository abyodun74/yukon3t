import { encode, decode } from "next-auth/jwt";

// The token inside the hidden-chats unlock cookie. Same signed-token pattern as the pending-login cookie in
// device-challenge.ts: an Auth.js-encoded token under its own salt, so it can never be swapped with a session cookie or
// any other signed cookie this app issues. Kept apart from hidden-chats.ts (cookies, database) so it can be unit-tested.

export const HIDDEN_UNLOCK_COOKIE = "yukon3t.hidden-unlock";
export const HIDDEN_UNLOCK_MAX_AGE_SECONDS = 10 * 60;

export function encodeHiddenUnlockToken(userId: string, secret: string): Promise<string> {
  return encode({
    token: { sub: userId },
    secret,
    salt: HIDDEN_UNLOCK_COOKIE,
    maxAge: HIDDEN_UNLOCK_MAX_AGE_SECONDS,
  });
}

/** True only for an unexpired, untampered token that was issued to this same user. */
export async function verifyHiddenUnlockToken(
  token: string | undefined,
  userId: string,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const payload = await decode({ token, secret, salt: HIDDEN_UNLOCK_COOKIE });
    return !!payload?.sub && payload.sub === userId;
  } catch {
    return false;
  }
}
