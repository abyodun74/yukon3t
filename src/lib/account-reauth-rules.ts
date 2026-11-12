// Pure, client-safe rules for confirming it's really the account holder before an irreversible account action:
// downloading all of the account's data ("Export my data") and deleting the account. The server half is
// src/lib/account-reauth.ts, the code request src/app/actions/account-reauth.ts, the UI account-danger-zone.tsx.
//
// A live session alone isn't enough for these: the threat is a stolen or borrowed session (a shared or unlocked
// phone, XSS, malware), which can do everything the account can, but doesn't know the password and can't read the
// account's email. So the action needs the account password, or, for an account that has none (email link, Google or
// Apple sign-in), a fresh one-time code emailed to the account's address.
import { z } from "zod";

export type ReauthAction = "delete" | "export";
export type ReauthMethod = "password" | "email";

/** The SecurityChallenge purpose of each action's emailed code: a code for one never works for the other. */
export const REAUTH_PURPOSE = { delete: "ACCOUNT_DELETE", export: "DATA_EXPORT" } as const satisfies Record<
  ReauthAction,
  string
>;

export const reauthActionSchema = z.enum(["delete", "export"]);

/**
 * How this account proves it's the holder. The password, when it has one that is still trusted; a password that must
 * be replaced (User.passwordResetRequiredAt: it may have been exposed) isn't proof of anything, so those accounts get
 * the emailed code like accounts without a password.
 */
export function reauthMethodFor(account: { hasPassword: boolean; passwordResetRequired: boolean }): ReauthMethod {
  return account.hasPassword && !account.passwordResetRequired ? "password" : "email";
}

/** What the browser sends with the action: the password, or the emailed code with the challenge it belongs to. */
export const reauthProofSchema = z.object({
  password: z.string().min(1).max(256).optional(),
  challengeId: z.string().trim().min(1).max(64).optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});
export type ReauthProof = z.infer<typeof reauthProofSchema>;

export type ReauthError = "reauth_required" | "wrong_password" | "wrong_code" | "code_expired" | "rate_limited";

/** A verifyDeviceChallenge failure, as the re-auth form explains it. */
export function codeFailureToReauthError(error: "not_found" | "expired" | "too_many_attempts" | "invalid_code"): ReauthError {
  return error === "invalid_code" ? "wrong_code" : "code_expired";
}
