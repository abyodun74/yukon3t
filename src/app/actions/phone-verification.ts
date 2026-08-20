"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { phoneSchema, verifyPhoneCodeSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { recomputeTrustScore } from "@/lib/trust";
import {
  isPhoneVerificationConfigured,
  startPhoneVerification,
  checkPhoneVerification,
} from "@/lib/twilio";

/**
 * Sends an SMS OTP to a phone number, not yet saved to the user's account —
 * the number is only written on successful confirmation (see
 * confirmPhoneVerification below), so an abandoned attempt never touches
 * User.phone. Returns a plain object (not a redirect) since this powers an
 * inline two-step client form, not a full-page navigation.
 */
export async function requestPhoneVerification(formData: FormData) {
  const user = await requireUser();
  const parsed = phoneSchema.safeParse(formData.get("phone"));
  if (!parsed.success) return { error: "invalid" as const };
  const phone = parsed.data;

  const allowed = await checkRateLimit("phoneVerifyRequest", user.id);
  if (!allowed) return { error: "rate_limited" as const };

  if (!isPhoneVerificationConfigured()) return { error: "not_configured" as const };

  const taken = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (taken && taken.id !== user.id) return { error: "phone_taken" as const };

  try {
    await startPhoneVerification(phone);
  } catch {
    return { error: "send_failed" as const };
  }
  return { error: null, phone };
}

/** Checks the submitted code with Twilio and, only on success, writes the
 * verified phone number and recomputes the trust score. */
export async function confirmPhoneVerification(formData: FormData) {
  const user = await requireUser();
  const parsed = verifyPhoneCodeSchema.safeParse({
    phone: formData.get("phone"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { error: "invalid" as const };
  const { phone, code } = parsed.data;

  const allowed = await checkRateLimit("phoneVerifyCheck", user.id);
  if (!allowed) return { error: "rate_limited" as const };

  if (!isPhoneVerificationConfigured()) return { error: "not_configured" as const };

  const ok = await checkPhoneVerification(phone, code);
  if (!ok) return { error: "invalid_code" as const };

  // Re-check right before writing — a race window exists between the
  // request step's check and now, same reasoning as every other
  // uniqueness check-then-write in this codebase.
  const taken = await prisma.user.findFirst({ where: { phone, NOT: { id: user.id } }, select: { id: true } });
  if (taken) return { error: "phone_taken" as const };

  await prisma.user.update({ where: { id: user.id }, data: { phone, phoneVerifiedAt: new Date() } });
  await recomputeTrustScore(user.id);
  revalidatePath("/settings");
  return { error: null };
}
