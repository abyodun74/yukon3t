import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_LOCKOUT_THRESHOLD,
  ANY_SOURCE_KEY,
  LOCKOUT_LADDER_MS,
  SOURCE_LOCKOUT_THRESHOLD,
  lockoutDurationMs,
  lockoutSourceKeys,
  lockoutSubjectKey,
} from "@/lib/login-lockout";

// An in-memory stand-in for the two tables, whose increments behave like the real single-statement SQL: each call
// reads and writes in one synchronous step, but every call first yields to the event loop, so calls started together
// interleave the way parallel requests do.
type Counter = { failures: number; lockedUntil: Date | null; updatedAt: Date };
const counters = new Map<string, Counter>();
const users = new Map<string, { failedLoginAttempts: number; lockedUntil: Date | null; failedLoginAt: Date | null }>();
const key = (s: string, k: string) => `${s}|${k}`;
const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: async (_strings: TemplateStringsArray, _id: string, subjectKey: string, sourceKey: string, now: Date) => {
      await tick();
      const k = key(subjectKey, sourceKey);
      const row = counters.get(k) ?? { failures: 0, lockedUntil: null, updatedAt: now };
      row.failures += 1;
      row.updatedAt = now;
      counters.set(k, row);
      return [{ failures: row.failures }];
    },
    loginFailureCounter: {
      updateMany: async ({ where, data }: { where: { subjectKey: string; sourceKey: string }; data: Partial<Counter> }) => {
        await tick();
        const row = counters.get(key(where.subjectKey, where.sourceKey));
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
      findMany: async ({
        where,
      }: {
        where: { subjectKey: string; sourceKey: { in: string[] }; lockedUntil: { gt: Date } };
      }) =>
        where.sourceKey.in
          .filter((s) => {
            const row = counters.get(key(where.subjectKey, s));
            return row?.lockedUntil && row.lockedUntil > where.lockedUntil.gt;
          })
          .map((sourceKey) => ({ sourceKey })),
      deleteMany: async ({ where }: { where: { subjectKey: string; sourceKey?: { in: string[] } } }) => {
        let count = 0;
        for (const k of [...counters.keys()]) {
          const [s, src] = k.split("|");
          if (s === where.subjectKey && (!where.sourceKey || where.sourceKey.in.includes(src))) {
            counters.delete(k);
            count++;
          }
        }
        return { count };
      },
    },
    user: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { failedLoginAttempts?: { increment: number }; lockedUntil?: Date };
      }) => {
        await tick();
        const u = users.get(where.id)!;
        if (data.failedLoginAttempts) u.failedLoginAttempts += data.failedLoginAttempts.increment;
        if (data.lockedUntil) u.lockedUntil = data.lockedUntil;
        return { failedLoginAttempts: u.failedLoginAttempts };
      },
      updateMany: async ({ where, data }: { where: { id: string; failedLoginAt: null }; data: { failedLoginAt: Date } }) => {
        const u = users.get(where.id)!;
        if (u.failedLoginAt !== null) return { count: 0 };
        u.failedLoginAt = data.failedLoginAt;
        return { count: 1 };
      },
    },
  },
}));

const { isLoginLocked, recordLoginFailure, clearLoginFailures, clearAllLoginFailures } = await import(
  "@/lib/login-lockout-server"
);

const NOW = new Date("2026-11-11T12:00:00Z");

beforeEach(() => {
  counters.clear();
  users.clear();
  users.set("victim", { failedLoginAttempts: 0, lockedUntil: null, failedLoginAt: null });
});

describe("lockoutDurationMs", () => {
  it("locks only on each threshold-th failure, escalating 1 min, 5 min, 15 min, then 1 h", () => {
    expect(lockoutDurationMs(4, 5)).toBeNull();
    expect(lockoutDurationMs(5, 5)).toBe(60_000);
    expect(lockoutDurationMs(6, 5)).toBeNull();
    expect(lockoutDurationMs(10, 5)).toBe(5 * 60_000);
    expect(lockoutDurationMs(15, 5)).toBe(15 * 60_000);
    expect(lockoutDurationMs(20, 5)).toBe(60 * 60_000);
    expect(lockoutDurationMs(500, 5)).toBe(60 * 60_000);
    expect(lockoutDurationMs(0, 5)).toBeNull();
  });

  it("never locks for longer than an hour", () => {
    expect(Math.max(...LOCKOUT_LADDER_MS)).toBe(60 * 60_000);
  });
});

describe("keys", () => {
  it("hashes the subject and the sources, so no raw IP or device id is stored", () => {
    const [ipKey, devKey] = lockoutSourceKeys("203.0.113.9", "device-1");
    expect(ipKey).toMatch(/^[0-9a-f]{64}$/);
    expect(devKey).toMatch(/^[0-9a-f]{64}$/);
    expect(ipKey).not.toContain("203.0.113.9");
    expect(lockoutSubjectKey({ identifier: " Bola " })).toBe(lockoutSubjectKey({ identifier: "bola" }));
    expect(lockoutSubjectKey({ userId: "bola" })).not.toBe(lockoutSubjectKey({ identifier: "bola" }));
  });

  it("skips an unknown IP and a missing device id", () => {
    expect(lockoutSourceKeys("unknown", null)).toEqual([]);
    expect(lockoutSourceKeys("unknown", "d")).toHaveLength(1);
  });
});

describe("recordLoginFailure under concurrency", () => {
  const attacker = lockoutSourceKeys("198.51.100.7", "attacker-device");
  const owner = lockoutSourceKeys("203.0.113.9", "owner-phone");
  const subject = { userId: "victim" };
  const neverExempt = async () => false;

  it("counts every one of many parallel failures exactly once (no lost updates)", async () => {
    await Promise.all(Array.from({ length: 23 }, () => recordLoginFailure({ subject, sourceKeys: attacker, now: NOW })));
    const subjectKey = lockoutSubjectKey(subject);
    for (const k of attacker) expect(counters.get(key(subjectKey, k))?.failures).toBe(23);
    expect(users.get("victim")!.failedLoginAttempts).toBe(23);
    expect(users.get("victim")!.failedLoginAt).toEqual(NOW);
  });

  it("parallel guesses from one source can't skip the lock", async () => {
    await Promise.all(
      Array.from({ length: SOURCE_LOCKOUT_THRESHOLD }, () => recordLoginFailure({ subject, sourceKeys: attacker, now: NOW })),
    );
    expect(await isLoginLocked({ subject, sourceKeys: attacker, accountWideExempt: neverExempt, now: NOW })).toBe(true);
    const subjectKey = lockoutSubjectKey(subject);
    expect(counters.get(key(subjectKey, attacker[0]))?.lockedUntil).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it("an attacker's failures don't lock the owner on another network and device", async () => {
    await Promise.all(
      Array.from({ length: SOURCE_LOCKOUT_THRESHOLD * 2 }, () =>
        recordLoginFailure({ subject, sourceKeys: attacker, now: NOW }),
      ),
    );
    expect(await isLoginLocked({ subject, sourceKeys: owner, accountWideExempt: neverExempt, now: NOW })).toBe(false);
  });

  it("rotating the device cookie still hits the per-IP counter", async () => {
    for (let i = 0; i < SOURCE_LOCKOUT_THRESHOLD; i++) {
      await recordLoginFailure({ subject, sourceKeys: lockoutSourceKeys("198.51.100.7", `fresh-${i}`), now: NOW });
    }
    const next = lockoutSourceKeys("198.51.100.7", "fresh-next");
    expect(await isLoginLocked({ subject, sourceKeys: next, accountWideExempt: neverExempt, now: NOW })).toBe(true);
  });

  it("the account-wide lock spares an exempt (trusted) device but not a new one", async () => {
    // Spread over many IPs, so no per-source counter reaches its threshold.
    for (let i = 0; i < ACCOUNT_LOCKOUT_THRESHOLD; i++) {
      await recordLoginFailure({ subject, sourceKeys: lockoutSourceKeys(`198.51.100.${i}`, `d${i}`), now: NOW });
    }
    const lockedUntil = users.get("victim")!.lockedUntil;
    expect(lockedUntil).toEqual(new Date(NOW.getTime() + 60_000));
    const opts = { subject, sourceKeys: owner, accountLockedUntil: lockedUntil, now: NOW };
    expect(await isLoginLocked({ ...opts, accountWideExempt: neverExempt })).toBe(true);
    expect(await isLoginLocked({ ...opts, accountWideExempt: async () => true })).toBe(false);
  });

  it("an identifier with no account is counted and locked the same way (no existence oracle)", async () => {
    const ghost = { identifier: "nobody@example.com" };
    await Promise.all(
      Array.from({ length: SOURCE_LOCKOUT_THRESHOLD }, () => recordLoginFailure({ subject: ghost, sourceKeys: attacker, now: NOW })),
    );
    expect(await isLoginLocked({ subject: ghost, sourceKeys: attacker, accountWideExempt: neverExempt, now: NOW })).toBe(
      true,
    );
    // Its account-wide counter lives in the table under ANY_SOURCE_KEY.
    expect(counters.get(key(lockoutSubjectKey(ghost), ANY_SOURCE_KEY))?.failures).toBe(SOURCE_LOCKOUT_THRESHOLD);
  });

  it("the lock expires on its own", async () => {
    for (let i = 0; i < SOURCE_LOCKOUT_THRESHOLD; i++) await recordLoginFailure({ subject, sourceKeys: attacker, now: NOW });
    const later = new Date(NOW.getTime() + 61_000);
    expect(await isLoginLocked({ subject, sourceKeys: attacker, accountWideExempt: neverExempt, now: later })).toBe(false);
  });

  it("success clears this request's counters; a reset clears all of them", async () => {
    await recordLoginFailure({ subject, sourceKeys: attacker, now: NOW });
    await recordLoginFailure({ subject, sourceKeys: owner, now: NOW });
    await clearLoginFailures("victim", owner);
    const subjectKey = lockoutSubjectKey(subject);
    expect(counters.has(key(subjectKey, owner[0]))).toBe(false);
    expect(counters.has(key(subjectKey, attacker[0]))).toBe(true);
    await clearAllLoginFailures("victim");
    expect(counters.size).toBe(0);
  });
});
