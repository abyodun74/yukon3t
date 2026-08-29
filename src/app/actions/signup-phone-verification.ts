"use server";

import { prisma } from "@/lib/prisma";
import { phoneSchema, verifyPhoneCodeSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { recomputeTrustScore } from "@/lib/trust";
import {
  isPhoneVerificationConfigured,
  startPhoneVerification,
  checkPhoneVerification,
} from "@/lib/twilio";
import {
  issuePendingVerificationCookie,
  readPendingVerification,
  clearPendingVerificationCookie,
} from "@/lib/pending-verification";
import { STUCK_UNVERIFIED_AFTER_MS } from "@/lib/login-issues";

/**
 * Signup-time counterpart to src/app/actions/phone-verification.ts —
 * identical logic, but for a brand-new account that has no session yet
 * (login is blocked until verification completes), so it's identified via
 * the pending-verification cookie instead of requireUser(). The phone
 * number is only ever written to User.phone on confirmed success, same
 * invariant as the authenticated flow.
 */
export async function requestSignupPhoneVerification(formData: FormData) {
  const pending = await readPendingVerification();
  if (!pending) return { error: "no_session" as const };

  const parsed = phoneSchema.safeParse(formData.get("phone"));
  if (!parsed.success) return { error: "invalid" as const };
  const phone = parsed.data;

  const allowed = await checkRateLimit("phoneVerifyRequest", pending.userId);
  if (!allowed) return { error: "rate_limited" as const };

  if (!isPhoneVerificationConfigured()) return { error: "not_configured" as const };

  const taken = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (taken && taken.id !== pending.userId) return { error: "phone_taken" as const };

  try {
    await startPhoneVerification(phone);
  } catch {
    return { error: "send_failed" as const };
  }

  // Re-issue the cookie with the phone attached — lets the verify-phone page
  // auto-resend on revisit instead of making the user retype the number.
  await issuePendingVerificationCookie(pending.userId, phone);
  return { error: null, phone };
}

export async function confirmSignupPhoneVerification(formData: FormData) {
  const pending = await readPendingVerification();
  if (!pending) return { error: "no_session" as const };

  const parsed = verifyPhoneCodeSchema.safeParse({
    phone: formData.get("phone"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { error: "invalid" as const };
  const { phone, code } = parsed.data;

  const allowed = await checkRateLimit("phoneVerifyCheck", pending.userId);
  if (!allowed) return { error: "rate_limited" as const };

  if (!isPhoneVerificationConfigured()) return { error: "not_configured" as const };

  const ok = await checkPhoneVerification(phone, code);
  if (!ok) return { error: "invalid_code" as const };

  const taken = await prisma.user.findFirst({ where: { phone, NOT: { id: pending.userId } }, select: { id: true } });
  if (taken) return { error: "phone_taken" as const };

  const now = new Date();
  const account = await prisma.user.findUnique({ where: { id: pending.userId }, select: { createdAt: true } });
  const wasStuck = !!account && now.getTime() - account.createdAt.getTime() > STUCK_UNVERIFIED_AFTER_MS;

  await prisma.user.update({
    where: { id: pending.userId },
    data: {
      phone,
      phoneVerifiedAt: now,
      pendingVerificationMethod: null,
      ...(wasStuck ? { loginIssueResolvedAt: now } : {}),
    },
  });
  await recomputeTrustScore(pending.userId);
  await clearPendingVerificationCookie();
  return { error: null };
}
