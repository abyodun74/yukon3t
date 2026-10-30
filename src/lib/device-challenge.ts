import { encode, decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { deviceChallengeEmail } from "@/lib/account-emails";
import type { Locale } from "@/lib/i18n/locales";
import { generateOtpCode, hashOtpCode } from "@/lib/otp";
import { track } from "@/lib/analytics";
import type { SecurityChallengePurpose } from "@/generated/prisma/enums";

// Same TTL/attempt budget as the existing signup email OTP (src/lib/otp.ts)
// — no reason for this step-up code to behave differently from the one
// users already know from signing up.
const DEVICE_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const DEVICE_CHALLENGE_MAX_ATTEMPTS = 5;

/**
 * Creates a pending challenge row and emails its code, written in `locale`. Returns the row (never the plaintext
 * code — only this function ever sees it).
 */
export async function createDeviceChallenge(params: {
  userId: string;
  email: string;
  purpose: SecurityChallengePurpose;
  deviceId: string;
  deviceLabel: string;
  /** The request's language for a sign-in challenge; DEFAULT_LOCALE from the parts of the app that are still English. */
  locale: Locale;
  // PASSWORD_CHANGE only — see SecurityChallenge.newPasswordHash in schema.prisma.
  newPasswordHash?: string;
}) {
  const code = generateOtpCode();
  const challenge = await prisma.securityChallenge.create({
    data: {
      userId: params.userId,
      purpose: params.purpose,
      deviceId: params.deviceId,
      codeHash: hashOtpCode(code),
      newPasswordHash: params.newPasswordHash,
      expiresAt: new Date(Date.now() + DEVICE_CHALLENGE_TTL_MS),
    },
  });

  await sendEmail({
    to: params.email,
    ...deviceChallengeEmail(params.locale, params.purpose, code, params.deviceLabel),
  });
  await track("DEVICE_CHALLENGE_SENT", params.userId, { purpose: params.purpose });

  return challenge;
}

type DeviceChallengeResult =
  | {
      ok: true;
      challenge: {
        id: string;
        userId: string;
        purpose: SecurityChallengePurpose;
        deviceId: string;
        newPasswordHash: string | null;
      };
    }
  | { ok: false; error: "not_found" | "expired" | "too_many_attempts" | "invalid_code" };

/**
 * Verifies a submitted code against one specific pending challenge (not
 * "any challenge for this user" — the caller already knows which one, from
 * either the pending-login cookie or a challengeId round-tripped through
 * the client). Consumes it on success so it can't be replayed.
 */
export async function verifyDeviceChallenge(
  challengeId: string,
  userId: string,
  code: string,
): Promise<DeviceChallengeResult> {
  const challenge = await prisma.securityChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.userId !== userId || challenge.consumedAt) {
    return { ok: false, error: "not_found" };
  }
  if (challenge.expiresAt < new Date()) {
    return { ok: false, error: "expired" };
  }
  if (challenge.attempts >= DEVICE_CHALLENGE_MAX_ATTEMPTS) {
    return { ok: false, error: "too_many_attempts" };
  }
  // The attempt is counted BEFORE the code is compared, in an update that only succeeds while the budget isn't used
  // up, so a burst of parallel guesses gets no more tries than a patient one (same idea as checkHiddenSecret).
  const reserved = await prisma.securityChallenge.updateMany({
    where: { id: challenge.id, attempts: { lt: DEVICE_CHALLENGE_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    return { ok: false, error: "too_many_attempts" };
  }
  if (hashOtpCode(code) !== challenge.codeHash) {
    await track("DEVICE_CHALLENGE_FAILED", userId, { purpose: challenge.purpose });
    return { ok: false, error: "invalid_code" };
  }

  await prisma.securityChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  await track("DEVICE_CHALLENGE_PASSED", userId, { purpose: challenge.purpose });
  return {
    ok: true,
    challenge: {
      id: challenge.id,
      userId: challenge.userId,
      purpose: challenge.purpose,
      deviceId: challenge.deviceId,
      newPasswordHash: challenge.newPasswordHash,
    },
  };
}

// ---------- Pending-login cookie (LOGIN purpose only) ----------
// Password sign-in and magic-link/OAuth sign-in both hit this: neither has
// a real session yet when a new-device login needs to pause for a code, so
// (like src/lib/pending-verification.ts) a short-lived signed httpOnly
// cookie stands in for one across the redirect to the verify page. Distinct
// name/salt from both the real session cookie and pending-verification's
// own cookie.

const PENDING_LOGIN_COOKIE = "yukon3t.pending-device-challenge";
const PENDING_LOGIN_COOKIE_MAX_AGE_SECONDS = 15 * 60;

type PendingLoginChallengePayload = {
  sub: string;
  deviceId: string;
  challengeId: string;
};

export async function issuePendingDeviceChallengeCookie(userId: string, deviceId: string, challengeId: string) {
  const token = await encode({
    token: { sub: userId, deviceId, challengeId } satisfies PendingLoginChallengePayload,
    secret: process.env.AUTH_SECRET!,
    salt: PENDING_LOGIN_COOKIE,
    maxAge: PENDING_LOGIN_COOKIE_MAX_AGE_SECONDS,
  });

  const cookieStore = await cookies();
  cookieStore.set(PENDING_LOGIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.AUTH_URL?.startsWith("https://") ?? true,
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_LOGIN_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function readPendingDeviceChallengeCookie(): Promise<PendingLoginChallengePayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PENDING_LOGIN_COOKIE)?.value;
  if (!token) return null;

  try {
    const payload = (await decode({
      token,
      secret: process.env.AUTH_SECRET!,
      salt: PENDING_LOGIN_COOKIE,
    })) as PendingLoginChallengePayload | null;
    if (!payload?.sub || !payload.deviceId || !payload.challengeId) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function clearPendingDeviceChallengeCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(PENDING_LOGIN_COOKIE);
}
