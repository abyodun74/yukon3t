import { encode, decode } from "next-auth/jwt";
import { cookies } from "next/headers";

/**
 * Identifies a just-created, not-yet-verified password-signup account across
 * the redirect to a verify page — there's no real session yet (login is
 * blocked until verified), so this signed, httpOnly cookie stands in for one.
 * Distinct name/salt from the real session cookie (src/lib/auth-cookie.ts)
 * so it can never be confused with it. `phone` is attached once a phone-path
 * signup submits a number, so a later auto-resend knows what to re-send to.
 */
const COOKIE_NAME = "yukon3t.pending-verification";
const MAX_AGE_SECONDS = 24 * 60 * 60;

type PendingVerificationPayload = {
  sub: string;
  phone?: string;
};

export async function issuePendingVerificationCookie(userId: string, phone?: string) {
  const token = await encode({
    token: { sub: userId, phone } satisfies PendingVerificationPayload,
    secret: process.env.AUTH_SECRET!,
    salt: COOKIE_NAME,
    maxAge: MAX_AGE_SECONDS,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.AUTH_URL?.startsWith("https://") ?? true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readPendingVerification(): Promise<{ userId: string; phone?: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const payload = (await decode({
      token,
      secret: process.env.AUTH_SECRET!,
      salt: COOKIE_NAME,
    })) as PendingVerificationPayload | null;
    if (!payload?.sub) return null;
    return { userId: payload.sub, phone: payload.phone };
  } catch {
    return null;
  }
}

export async function clearPendingVerificationCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
