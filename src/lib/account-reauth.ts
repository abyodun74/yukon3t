import { prisma } from "@/lib/prisma";
import { getPasswordHash, isPasswordResetRequired } from "@/lib/auth-guards";
import { verifyPassword } from "@/lib/passwords";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyDeviceChallenge } from "@/lib/device-challenge";
import {
  REAUTH_PURPOSE,
  codeFailureToReauthError,
  reauthMethodFor,
  reauthProofSchema,
  type ReauthAction,
  type ReauthError,
  type ReauthMethod,
} from "@/lib/account-reauth-rules";

// Server half of re-authentication before an irreversible account action (rules and the why: account-reauth-rules.ts).

/** How the signed-in account `userId` re-authenticates: its password, or a code emailed to its address. */
export async function accountReauthMethod(userId: string): Promise<ReauthMethod> {
  const hasPassword = Boolean(await getPasswordHash(userId));
  return reauthMethodFor({ hasPassword, passwordResetRequired: hasPassword && (await isPasswordResetRequired(userId)) });
}

export type ReauthResult = { ok: true } | { ok: false; error: ReauthError };

/**
 * Checks the proof the browser sent for `action` by the signed-in account `userId`. Password attempts are limited by
 * `accountReauth` (10 an hour per account, fails closed with a database fallback); code attempts by
 * `deviceChallengeCheck` plus the challenge's own 5-attempt budget. A code is accepted only for a challenge of this
 * account, of this action's purpose, unexpired and unused, and is consumed on success, so it can't be replayed.
 */
export async function verifyAccountReauth(userId: string, action: ReauthAction, rawProof: unknown): Promise<ReauthResult> {
  const parsed = reauthProofSchema.safeParse(rawProof ?? {});
  const method = await accountReauthMethod(userId);

  if (method === "password") {
    if (!parsed.success || !parsed.data.password) return { ok: false, error: parsed.success ? "reauth_required" : "wrong_password" };
    if (!(await checkRateLimit("accountReauth", `reauth:${userId}`))) return { ok: false, error: "rate_limited" };
    const hash = await getPasswordHash(userId);
    if (!hash || !(await verifyPassword(parsed.data.password, hash))) return { ok: false, error: "wrong_password" };
    return { ok: true };
  }

  if (!parsed.success) return { ok: false, error: "wrong_code" };
  const { challengeId, code } = parsed.data;
  if (!challengeId || !code) return { ok: false, error: "reauth_required" };
  if (!(await checkRateLimit("deviceChallengeCheck", `devchallenge:${userId}`))) return { ok: false, error: "rate_limited" };
  // Looked up first so a code issued for something else (a sign-in, the other action) is refused without being used up.
  const pending = await prisma.securityChallenge.findUnique({
    where: { id: challengeId },
    select: { userId: true, purpose: true },
  });
  if (!pending || pending.userId !== userId || pending.purpose !== REAUTH_PURPOSE[action]) {
    return { ok: false, error: "code_expired" };
  }
  const result = await verifyDeviceChallenge(challengeId, userId, code);
  if (!result.ok) return { ok: false, error: codeFailureToReauthError(result.error) };
  return { ok: true };
}
