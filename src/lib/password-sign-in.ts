export type PasswordSignInOutcome = "wrong_password" | "reset_required" | "proceed";

/**
 * What loginWithPassword does once it has compared the typed password with the stored hash. A forced reset
 * (User.passwordResetRequiredAt) is only ever revealed to someone who typed the correct password: a wrong one gets the
 * same answer whether or not the flag is set. The App Store review demo account is never asked to reset, since its
 * mailbox can't be read by the reviewers.
 */
export function passwordSignInOutcome({
  passwordOk,
  resetRequiredAt,
  isAppReviewDemo,
}: {
  passwordOk: boolean;
  resetRequiredAt: Date | null;
  isAppReviewDemo: boolean;
}): PasswordSignInOutcome {
  if (!passwordOk) return "wrong_password";
  if (resetRequiredAt && !isAppReviewDemo) return "reset_required";
  return "proceed";
}
