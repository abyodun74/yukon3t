"use server";

import { revalidatePath } from "next/cache";
import { getPasswordHash, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyPassword } from "@/lib/passwords";
import { notifyBadgeChange } from "@/lib/realtime-server";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { createDeviceChallenge, verifyDeviceChallenge } from "@/lib/device-challenge";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import {
  hiddenPinSchema,
  setHiddenPinSchema,
  changeHiddenPinSchema,
  resetHiddenPinSchema,
  resetHiddenPinWithCodeSchema,
  hiddenConversationIdSchema,
} from "@/lib/validations";
import {
  checkHiddenPin,
  checkHiddenSecret,
  clearHiddenUnlockCookie,
  getHiddenPinState,
  hashHiddenPin,
  isHiddenUnlocked,
  issueHiddenUnlockCookie,
  type HiddenSecretCheck,
} from "@/lib/hidden-chats";

function failedCheck(result: Exclude<HiddenSecretCheck, { ok: true }>) {
  return result.error === "locked"
    ? { error: "locked" as const, lockedUntil: result.lockedUntil }
    : { error: "wrong" as const, attemptsLeft: result.attemptsLeft };
}

/** First-time setup only. Changing an existing PIN needs the current one (changeHiddenPin) or a reset. */
export async function setHiddenPin(pin: string, confirmPin: string) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("hiddenPin", user.id))) return { error: "rate_limited" as const };

  const parsed = setHiddenPinSchema.safeParse({ newPin: pin, confirmPin });
  if (!parsed.success) return { error: "invalid" as const };

  // Guarded on "still no PIN" so this can never overwrite one that exists.
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, hiddenChatsPinHash: null },
    data: { hiddenChatsPinHash: await hashHiddenPin(parsed.data.newPin) },
  });
  if (count === 0) return { error: "already_set" as const };
  return { error: null };
}

export async function changeHiddenPin(currentPin: string, newPin: string, confirmPin: string) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("hiddenPin", user.id))) return { error: "rate_limited" as const };

  const parsed = changeHiddenPinSchema.safeParse({ currentPin, newPin, confirmPin });
  if (!parsed.success) return { error: "invalid" as const };
  const pinState = await getHiddenPinState(user.id);
  if (!pinState.hiddenChatsPinHash) return { error: "no_pin" as const };

  const check = await checkHiddenPin(pinState, parsed.data.currentPin);
  if (!check.ok) return failedCheck(check);

  await prisma.user.update({
    where: { id: user.id },
    data: { hiddenChatsPinHash: await hashHiddenPin(parsed.data.newPin) },
  });
  return { error: null };
}

export async function unlockHiddenChats(pin: string) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("hiddenPin", user.id))) return { error: "rate_limited" as const };

  const parsed = hiddenPinSchema.safeParse(pin);
  if (!parsed.success) return { error: "invalid" as const };
  const pinState = await getHiddenPinState(user.id);
  if (!pinState.hiddenChatsPinHash) return { error: "no_pin" as const };

  const check = await checkHiddenPin(pinState, parsed.data);
  if (!check.ok) return failedCheck(check);

  await issueHiddenUnlockCookie(user.id);
  return { error: null };
}

export async function lockHiddenChats() {
  await requireVerifiedUser();
  await clearHiddenUnlockCookie();
  return { error: null };
}

/** Moves a conversation into the caller's hidden area. Nothing changes for anyone else in it. */
export async function hideConversation(conversationId: string) {
  const user = await requireVerifiedUser();

  const parsed = hiddenConversationIdSchema.safeParse(conversationId);
  if (!parsed.success) return { error: "invalid" as const };
  // Without a PIN a hidden chat could never be opened again.
  if (!(await getHiddenPinState(user.id)).hiddenChatsPinHash) return { error: "no_pin" as const };

  const { count } = await prisma.conversationMember.updateMany({
    where: { conversationId: parsed.data, userId: user.id },
    data: { hiddenAt: new Date() },
  });
  if (count === 0) return { error: "not_a_member" as const };

  await notifyBadgeChange(user.id);
  revalidatePath("/messages");
  return { error: null };
}

export async function unhideConversation(conversationId: string) {
  const user = await requireVerifiedUser();

  const parsed = hiddenConversationIdSchema.safeParse(conversationId);
  if (!parsed.success) return { error: "invalid" as const };
  if (!(await isHiddenUnlocked(user.id))) return { error: "hidden_locked" as const };

  const { count } = await prisma.conversationMember.updateMany({
    where: { conversationId: parsed.data, userId: user.id },
    data: { hiddenAt: null },
  });
  if (count === 0) return { error: "not_a_member" as const };

  await notifyBadgeChange(user.id);
  revalidatePath("/messages");
  return { error: null };
}

async function applyResetPin(userId: string, newPin: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { hiddenChatsPinHash: await hashHiddenPin(newPin), hiddenPinFailedAttempts: 0, hiddenPinLockedUntil: null },
  });
  // The chats stay hidden, and the new PIN has to be entered to see them.
  await clearHiddenUnlockCookie();
}

/**
 * "Forgot PIN" for an account that has a password: the ACCOUNT password, not the old PIN, proves who is asking. A wrong
 * password counts against the same lockout as a wrong PIN, so this can't be used to guess either one freely.
 */
export async function resetHiddenPin(accountPassword: string, newPin: string, confirmPin: string) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("hiddenPin", user.id))) return { error: "rate_limited" as const };

  const parsed = resetHiddenPinSchema.safeParse({ accountPassword, newPin, confirmPin });
  if (!parsed.success) return { error: "invalid" as const };
  const passwordHash = await getPasswordHash(user.id);
  if (!passwordHash) return { error: "no_password" as const };

  const check = await checkHiddenSecret(await getHiddenPinState(user.id), () =>
    verifyPassword(parsed.data.accountPassword, passwordHash),
  );
  if (!check.ok) return failedCheck(check);

  await applyResetPin(user.id, parsed.data.newPin);
  return { error: null };
}

/**
 * "Forgot PIN" for an account with no password to re-prove (magic-link or OAuth sign-in only): emails a one-time code
 * to the account's address, the same SecurityChallenge step-up used for a new-device login or password change.
 * Refused for an account that does have a password, which must use resetHiddenPin.
 */
export async function requestHiddenPinResetCode() {
  const user = await requireVerifiedUser();
  if (await getPasswordHash(user.id)) return { error: "use_password" as const };
  if (!(await checkRateLimit("deviceChallengeSend", `devchallenge:send:${user.id}`))) {
    return { error: "rate_limited" as const };
  }

  const challenge = await createDeviceChallenge({
    userId: user.id,
    email: user.email,
    purpose: "HIDDEN_PIN_RESET",
    deviceId: (await getDeviceId()) ?? "unknown",
    deviceLabel: await getDeviceLabel(),
    locale: DEFAULT_LOCALE,
  });
  return { error: null, challengeId: challenge.id };
}

export async function resetHiddenPinWithCode(challengeId: string, code: string, newPin: string, confirmPin: string) {
  const user = await requireVerifiedUser();
  if (await getPasswordHash(user.id)) return { error: "use_password" as const };
  if (!(await checkRateLimit("deviceChallengeCheck", `devchallenge:${user.id}`))) {
    return { error: "rate_limited" as const };
  }

  const parsed = resetHiddenPinWithCodeSchema.safeParse({ challengeId, code, newPin, confirmPin });
  if (!parsed.success) return { error: "invalid" as const };

  // Looked up first so a code issued for some other purpose is refused without being consumed.
  const pending = await prisma.securityChallenge.findUnique({
    where: { id: parsed.data.challengeId },
    select: { userId: true, purpose: true },
  });
  if (!pending || pending.userId !== user.id || pending.purpose !== "HIDDEN_PIN_RESET") {
    return { error: "invalid_code" as const };
  }
  const result = await verifyDeviceChallenge(parsed.data.challengeId, user.id, parsed.data.code);
  if (!result.ok) {
    return { error: result.error === "too_many_attempts" || result.error === "expired" ? ("code_expired" as const) : ("invalid_code" as const) };
  }

  await applyResetPin(user.id, parsed.data.newPin);
  return { error: null };
}
