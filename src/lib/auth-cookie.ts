import { createHash } from "node:crypto";

// Auth.js's own cookie name convention (see @auth/core/lib/utils/cookie.js):
// the "__Secure-" prefix is used whenever cookies are served over HTTPS.
// Sessions are JWT cookies (strategy "jwt", src/lib/auth.ts). Password login
// (issueSessionCookie) and the session refresh route (/api/session/refresh)
// write that cookie themselves, so they must use the exact name, salt and
// secret Auth.js uses, or `auth()` would not read it.
export function sessionCookieName() {
  const secure = process.env.AUTH_URL?.startsWith("https://") ?? true;
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/** The shortest AUTH_SECRET a production server accepts (`openssl rand -base64 32` gives 44 characters). */
export const MIN_SESSION_SECRET_BYTES = 32;

// SHA-256 of the placeholder values that have been published (SECURITY.md's old "dev placeholder" line and
// .env.example's hint). A secret anyone can read signs anyone's session cookie, so production refuses them. Only the
// hashes live here so the values themselves aren't repeated in yet another file.
const PUBLIC_PLACEHOLDER_SECRET_SHA256 = new Set([
  "c45a7a639ba9e9901827ebe096f8db950e017ec55e68c9c7c71c4fbb2b11384c",
  "8e2889a4ad5c2c03cb8e40f73669ae87afcfaba47276e54372c04168c2490b9d",
]);

export type SessionSecretProblem = "missing" | "placeholder" | "too_short";

/** What is wrong with a session secret for production use, or null when it is usable. Pure. */
export function sessionSecretProblem(secret: string): SessionSecretProblem | null {
  if (!secret) return "missing";
  if (PUBLIC_PLACEHOLDER_SECRET_SHA256.has(createHash("sha256").update(secret, "utf8").digest("hex"))) {
    return "placeholder";
  }
  if (Buffer.byteLength(secret, "utf8") < MIN_SESSION_SECRET_BYTES) return "too_short";
  return null;
}

type Env = Partial<Record<"NODE_ENV" | "NEXT_PHASE" | "AUTH_SECRET" | "NEXTAUTH_SECRET", string>>;

function rawSessionSecret(env: Env): string {
  return env.AUTH_SECRET ?? env.NEXTAUTH_SECRET ?? "";
}

let checkedSecret: string | null = null;

/**
 * Throws when a production server is about to run with a missing, publicly known placeholder or too-short
 * AUTH_SECRET: refusing to start is better than issuing session cookies anyone could forge. A no-op outside
 * production (local dev and tests use the placeholder on purpose) and during `next build`, which runs with
 * NODE_ENV=production but never signs a session and may run without the runtime secrets. Called at server start
 * (src/instrumentation.ts) and on every use of the secret (sessionSecret), so it holds even where instrumentation
 * doesn't run.
 */
export function assertSessionSecretUsable(env: Env = process.env as Env): void {
  if (env.NODE_ENV !== "production") return;
  if (env.NEXT_PHASE === "phase-production-build") return;
  const secret = rawSessionSecret(env);
  if (secret === checkedSecret) return;
  const problem = sessionSecretProblem(secret);
  if (problem) {
    const why =
      problem === "missing"
        ? "is not set"
        : problem === "placeholder"
          ? "is a publicly documented placeholder value"
          : `is shorter than ${MIN_SESSION_SECRET_BYTES} bytes`;
    throw new Error(
      `[auth] AUTH_SECRET ${why}. Refusing to run in production: anyone could forge session cookies. ` +
        "Set a real secret (openssl rand -base64 32), the same value on Vercel and Netlify, then redeploy.",
    );
  }
  checkedSecret = secret;
}

/**
 * The secret session JWTs are encrypted with, resolved the same way next-auth does (next-auth/lib/env.js:
 * AUTH_SECRET, else NEXTAUTH_SECRET). Must be the same value on Netlify and Vercel and must never change between
 * deploys: a different value makes every existing session cookie unreadable, which signs everyone out. In production
 * it throws instead of returning a missing, placeholder or too-short secret (assertSessionSecretUsable).
 */
export function sessionSecret(): string {
  assertSessionSecretUsable();
  return rawSessionSecret(process.env as Env);
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

