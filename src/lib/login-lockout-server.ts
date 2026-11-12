import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  ACCOUNT_LOCKOUT_THRESHOLD,
  ANY_SOURCE_KEY,
  SOURCE_LOCKOUT_THRESHOLD,
  lockoutDurationMs,
  lockoutSubjectKey,
} from "@/lib/login-lockout";

/**
 * Database half of the password sign-in lockout (rules in login-lockout.ts). Kept in the database, not Upstash, because
 * the Upstash limiter fails open. Per-source counters live in `LoginFailureCounter` (no relation to User, so an
 * identifier matching no account is counted exactly like a real one and the lockout says nothing about whether an
 * account exists); the account-wide counter of a real account is `User.failedLoginAttempts` / `lockedUntil`, which the
 * admin "Login issues" queue reads, and for an unknown identifier the table row with source ANY_SOURCE_KEY.
 *
 * Every increment is a single atomic statement (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, or `UPDATE ... SET
 * x = x + 1 RETURNING`), and only the failure whose returned count is a multiple of the threshold sets the lock, so
 * parallel guesses can neither skip a lock nor get extra tries.
 */

export type LoginSubject = { userId: string } | { identifier: string };

function keysFor(subject: LoginSubject, sourceKeys: string[]): string[] {
  return "userId" in subject ? sourceKeys : [...sourceKeys, ANY_SOURCE_KEY];
}

/**
 * Whether this attempt must be refused without checking the password. `accountLockedUntil` is the matched account's
 * `User.lockedUntil`; `accountWideExempt` (asked only when the account-wide lock is on) says whether this request
 * comes from a device the account already trusts, or is otherwise exempt.
 */
export async function isLoginLocked(opts: {
  subject: LoginSubject;
  sourceKeys: string[];
  accountLockedUntil?: Date | null;
  accountWideExempt: () => Promise<boolean>;
  now?: Date;
}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const keys = keysFor(opts.subject, opts.sourceKeys);
  const rows =
    keys.length > 0
      ? await prisma.loginFailureCounter.findMany({
          where: { subjectKey: lockoutSubjectKey(opts.subject), sourceKey: { in: keys }, lockedUntil: { gt: now } },
          select: { sourceKey: true },
        })
      : [];
  if (rows.some((r) => r.sourceKey !== ANY_SOURCE_KEY)) return true;

  const accountLocked =
    "userId" in opts.subject
      ? Boolean(opts.accountLockedUntil && opts.accountLockedUntil > now)
      : rows.some((r) => r.sourceKey === ANY_SOURCE_KEY);
  if (!accountLocked) return false;
  return !(await opts.accountWideExempt());
}

async function bumpCounter(subjectKey: string, sourceKey: string, now: Date) {
  const rows = await prisma.$queryRaw<{ failures: number }[]>`
    INSERT INTO "LoginFailureCounter" ("id", "subjectKey", "sourceKey", "failures", "updatedAt")
    VALUES (${randomUUID()}, ${subjectKey}, ${sourceKey}, 1, ${now})
    ON CONFLICT ("subjectKey", "sourceKey")
    DO UPDATE SET "failures" = "LoginFailureCounter"."failures" + 1, "updatedAt" = ${now}
    RETURNING "failures"`;
  const failures = Number(rows[0]?.failures ?? 0);
  const threshold = sourceKey === ANY_SOURCE_KEY ? ACCOUNT_LOCKOUT_THRESHOLD : SOURCE_LOCKOUT_THRESHOLD;
  const ms = lockoutDurationMs(failures, threshold);
  if (ms !== null) {
    await prisma.loginFailureCounter.updateMany({
      where: { subjectKey, sourceKey },
      data: { lockedUntil: new Date(now.getTime() + ms) },
    });
  }
}

async function bumpAccount(userId: string, now: Date) {
  const { failedLoginAttempts } = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  // failedLoginAt anchors "how long has this been unresolved" for the resolve-login-issues cron: set on the first
  // failure of a run only.
  await prisma.user.updateMany({ where: { id: userId, failedLoginAt: null }, data: { failedLoginAt: now } });
  const ms = lockoutDurationMs(failedLoginAttempts, ACCOUNT_LOCKOUT_THRESHOLD);
  if (ms !== null) {
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(now.getTime() + ms) } });
  }
}

/** Counts one wrong password (or unknown identifier) against every counter this attempt falls under. */
export async function recordLoginFailure(opts: { subject: LoginSubject; sourceKeys: string[]; now?: Date }) {
  const now = opts.now ?? new Date();
  const subjectKey = lockoutSubjectKey(opts.subject);
  await Promise.all([
    ...keysFor(opts.subject, opts.sourceKeys).map((sourceKey) => bumpCounter(subjectKey, sourceKey, now)),
    ...("userId" in opts.subject ? [bumpAccount(opts.subject.userId, now)] : []),
  ]);
}

/** After a successful sign-in: this request's own per-source counters (the account-wide one is reset by the caller). */
export async function clearLoginFailures(userId: string, sourceKeys: string[]) {
  if (sourceKeys.length === 0) return;
  await prisma.loginFailureCounter.deleteMany({
    where: { subjectKey: lockoutSubjectKey({ userId }), sourceKey: { in: sourceKeys } },
  });
}

/** After a password reset (proof of email ownership): every per-source counter on the account. */
export async function clearAllLoginFailures(userId: string) {
  await prisma.loginFailureCounter.deleteMany({ where: { subjectKey: lockoutSubjectKey({ userId }) } });
}

/** Cron housekeeping: counters idle since `before` and not currently locking anything. */
export async function pruneLoginFailureCounters(before: Date, now: Date = new Date()) {
  const { count } = await prisma.loginFailureCounter.deleteMany({
    where: { updatedAt: { lt: before }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
  });
  return count;
}
