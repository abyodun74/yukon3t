import { createHash } from "node:crypto";

/**
 * Password sign-in lockout rules (pure; the database half is login-lockout-server.ts).
 *
 * Failures are counted twice, each with its own escalating lock:
 *  - per source: the account (or, for an identifier matching no account, that identifier) together with the client
 *    IP, and again together with the device id, so whoever is guessing locks only themselves out. Rotating the device
 *    cookie still hits the IP counter, and the IP counter alone never touches the owner on another network.
 *  - account-wide: every failure on the account from anywhere, at a much higher threshold, to cap a guesser spread
 *    over many IPs. A device the account already trusts (KnownDevice) is exempt from this one, so a remote attacker
 *    can't lock the owner out of their own phone.
 *
 * Every threshold-th failure locks, for the next step of LOCKOUT_LADDER_MS (1 min, 5 min, 15 min, then 1 h each
 * time). Attempts while locked aren't checked, so they don't count. A successful sign-in resets the counters, and a
 * password reset clears all of them.
 */
export const SOURCE_LOCKOUT_THRESHOLD = 5;
export const ACCOUNT_LOCKOUT_THRESHOLD = 20;
export const LOCKOUT_LADDER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

/** How long the failure that brought the counter to `failures` locks for, or null when it doesn't lock. */
export function lockoutDurationMs(failures: number, threshold: number): number | null {
  if (failures <= 0 || failures % threshold !== 0) return null;
  const step = failures / threshold - 1;
  return LOCKOUT_LADDER_MS[Math.min(step, LOCKOUT_LADDER_MS.length - 1)];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Whose failures: the account when one matched, otherwise the typed identifier (case-insensitive). */
export function lockoutSubjectKey(subject: { userId: string } | { identifier: string }): string {
  return "userId" in subject
    ? sha256(`u:${subject.userId}`)
    : sha256(`i:${subject.identifier.trim().toLowerCase()}`);
}

/** The account-wide counter's source key, used in the table only for identifiers that match no account. */
export const ANY_SOURCE_KEY = "*";

/** The per-source counters this request falls under (hashed, so no raw IP or device id is stored). */
export function lockoutSourceKeys(ip: string, deviceId: string | null): string[] {
  const keys: string[] = [];
  if (ip && ip !== "unknown") keys.push(sha256(`ip:${ip}`));
  if (deviceId) keys.push(sha256(`dev:${deviceId}`));
  return keys;
}
