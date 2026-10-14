// Whether a Google or Apple sign-in proves the person controls the email address it came with. Auth.js creates every
// OAuth account with emailVerified: null (it doesn't read the provider's own claim), and requireVerifiedUser
// (src/lib/auth-guards.ts) refuses an account verified neither by email nor by phone, so without this a Google/Apple
// sign-up could sign in but use nothing. Only the provider's explicit claim counts, never an assumption: Google sends
// email_verified as a boolean, Apple as a boolean or the string "true" (private-relay addresses included, which Apple
// itself delivers). Any other provider, a missing claim or a false one means "not verified". Pure; auth.ts does the write.

const TRUSTED_PROVIDERS = new Set(["google", "apple"]);

/** The email address the provider vouches for, lowercased, or null when it doesn't vouch for one. */
export function providerVerifiedEmail(provider: string | undefined, profile: unknown): string | null {
  if (!provider || !TRUSTED_PROVIDERS.has(provider)) return null;
  if (!profile || typeof profile !== "object") return null;
  const { email, email_verified: claim } = profile as { email?: unknown; email_verified?: unknown };
  if (typeof email !== "string" || !email.includes("@")) return null;
  const verified = claim === true || (provider === "apple" && claim === "true");
  return verified ? email.trim().toLowerCase() : null;
}
