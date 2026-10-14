// What "verified" means for an account, in one place. Sign-up verifies by email code (emailVerified) or by text
// (phoneVerifiedAt, src/app/actions/signup-phone-verification.ts), and either one counts: password sign-in lets an
// account in on the same rule (src/app/actions/password-auth.ts) and requireVerifiedUser (src/lib/auth-guards.ts)
// unlocks posting, messaging and the rest on it. Pure and client-safe.

type VerificationColumns = { emailVerified: Date | null; phoneVerifiedAt: Date | null };

/** True once the account has confirmed its email address or its phone number. */
export function isAccountVerified(user: VerificationColumns): boolean {
  return Boolean(user.emailVerified || user.phoneVerifiedAt);
}

/**
 * The same rule as a Prisma `where` fragment, negated: matches an account verified neither by email nor by phone.
 * Spread it into a User query (`{ ...UNVERIFIED_ACCOUNT_WHERE, createdAt: … }`) wherever "still unverified" is
 * selected in the database, so that and isAccountVerified can't disagree.
 */
export const UNVERIFIED_ACCOUNT_WHERE = { emailVerified: null, phoneVerifiedAt: null } as const;

/**
 * Whether a password sign-in has to stop at a verify screen first. The App Review demo account is exempt (its reviewer
 * can't read a mailbox or receive a text); that exemption is for signing in only, never for requireVerifiedUser.
 */
export function signInNeedsVerification(user: VerificationColumns & { isAppReviewDemo: boolean }): boolean {
  return !user.isAppReviewDemo && !isAccountVerified(user);
}
