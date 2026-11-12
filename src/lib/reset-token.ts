import { createHash, randomBytes } from "node:crypto";

/**
 * Password-reset tokens. The emailed link carries the token in the URL fragment (`/reset-password#token=...`), which
 * browsers never send to a server, so it isn't in any request log, Referer header or server-side analytics; the reset
 * page moves it into memory and replaces the URL before any analytics script runs (see reset-password/page.tsx).
 *
 * Only the SHA-256 of a token is stored (`PasswordResetToken.token`), and lookups hash what the browser sends, so a
 * database read can't be turned into a working reset link. Rows written before hashing held the raw token; a raw token
 * never hashes to itself, so those links simply stopped working (they expired within the hour anyway).
 */

/** 256 bits, URL-safe. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The link emailed to the account owner. `appUrl` is NEXT_PUBLIC_APP_URL. */
export function resetPasswordUrl(appUrl: string | undefined, token: string): string {
  return `${appUrl ?? ""}/reset-password#token=${encodeURIComponent(token)}`;
}
