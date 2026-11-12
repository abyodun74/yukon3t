"use server";

import { requireUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createDeviceChallenge } from "@/lib/device-challenge";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { getLocale } from "@/lib/i18n/server";
import { accountReauthMethod } from "@/lib/account-reauth";
import { REAUTH_PURPOSE, reauthActionSchema } from "@/lib/account-reauth-rules";

/**
 * "Send code" before "Export my data" or "Delete account", for an account that re-authenticates with an emailed code
 * (no password, or one that must be replaced: account-reauth-rules.ts). Emails a one-time code to the account's own
 * address through the same SecurityChallenge step-up as a new-device sign-in, under the action's own purpose, and
 * returns the challenge id the form sends back with the code. `deviceChallengeSend` (5 an hour per account) bounds the
 * emails; it fails closed with a database fallback if Upstash is down.
 */
export async function requestAccountReauthCode(action: unknown) {
  const user = await requireUser();
  const parsedAction = reauthActionSchema.safeParse(action);
  if (!parsedAction.success) return { error: "invalid" as const };
  if ((await accountReauthMethod(user.id)) === "password") return { error: "use_password" as const };
  if (!(await checkRateLimit("deviceChallengeSend", `devchallenge:send:${user.id}`))) {
    return { error: "rate_limited" as const };
  }

  const challenge = await createDeviceChallenge({
    userId: user.id,
    email: user.email,
    purpose: REAUTH_PURPOSE[parsedAction.data],
    deviceId: (await getDeviceId()) ?? "unknown",
    deviceLabel: await getDeviceLabel(),
    locale: await getLocale(),
  });
  return { error: null, challengeId: challenge.id };
}
