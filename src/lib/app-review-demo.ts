import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The App Store review demo accounts (`User.isAppReviewDemo`): the identity typed into App Store Connect's demo-account
 * field, plus any other account the owner flagged (e.g. a second one so reviewers can test messaging between the two).
 *
 * Server-only. The password is never in the repository: it comes from APP_REVIEW_DEMO_PASSWORD (set on Netlify and
 * Vercel, never NEXT_PUBLIC_), and with it unset (or too short) every demo account refuses to sign in and the admin
 * "Fix demo account" button refuses to run. There is deliberately no default.
 */

/** A demo password shorter than this is treated as not configured. */
export const APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH = 16;

// Non-secret identifiers of the primary demo account, overridable from the environment.
const DEFAULT_DEMO_USERNAME = "abiodunapplereview";
const DEFAULT_DEMO_EMAIL = "appreview@yukon3t.com";

type Env = Record<string, string | undefined>;

/** The configured demo password, or null when it is unset or weaker than the minimum (never a fallback value). */
export function appReviewDemoPassword(env: Env = process.env): string | null {
  const value = env.APP_REVIEW_DEMO_PASSWORD;
  if (!value || value.length < APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH) return null;
  return value;
}

/** Username and email of the primary demo account (the one the admin button finds or creates). */
export function appReviewDemoIdentity(env: Env = process.env): { username: string; email: string } {
  return {
    username: env.APP_REVIEW_DEMO_USERNAME?.trim() || DEFAULT_DEMO_USERNAME,
    email: (env.APP_REVIEW_DEMO_EMAIL?.trim() || DEFAULT_DEMO_EMAIL).toLowerCase(),
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Whether `typed` is the currently configured demo password (constant-time). False whenever the password isn't
 * configured, so a demo account can't be signed in to with whatever hash happens to be stored (e.g. one set from an
 * old, now-public value) once the variable is removed or rotated.
 */
export function matchesAppReviewDemoPassword(typed: string, env: Env = process.env): boolean {
  const configured = appReviewDemoPassword(env);
  if (!configured) return false;
  return timingSafeEqual(digest(typed), digest(configured));
}

/** The error code every action refuses a demo account with. */
export const APP_REVIEW_DEMO_REFUSED = "demo_account" as const;

/**
 * Demo accounts only reach each other: a demo account can't start a chat, call or connection request with a real
 * member, and a real member can't with a demo account. Callers answer the same way as for a blocked target.
 */
export function isDemoContactRefused(a: { isAppReviewDemo: boolean }, b: { isAppReviewDemo: boolean }): boolean {
  return a.isAppReviewDemo !== b.isAppReviewDemo;
}
