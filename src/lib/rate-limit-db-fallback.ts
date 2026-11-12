import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// The database half of the fail-closed rate limiters (FAIL_CLOSED_WITH_DB_FALLBACK in src/lib/rate-limit.ts): while
// Upstash is down or out of quota, the limiters that send email or SMS count in Postgres instead of letting every
// request through. Used ONLY then: on a healthy Upstash nothing here runs, so the table stays empty in normal
// operation. Importing this module registers it (rate-limit.ts can't import Prisma itself, because src/proxy.ts
// bundles it); it is imported by every module that sends email or SMS (email.ts, twilio.ts) and by auth.ts, so the
// fallback is in place wherever one of those limiters is checked. If it is ever missing, those limiters refuse.

/** How long a window row is kept after it started. Longer than the longest limiter window (24h). */
const PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
/** Roughly one call in this many also deletes long-expired rows, so the table can't grow without bound. */
const PRUNE_ONE_IN = 200;

/**
 * The stored key: a SHA-256 of the limiter's key space and identifier. Identifiers can be an email address or an IP
 * (e.g. `resetreq:<ip>:<email>`), and nothing needs them back in readable form.
 */
export function fallbackRowKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Counts one request against `key` in a fixed window of `windowMs` and answers whether it fits within `limit`. One
 * atomic upsert: a window that has run out starts again at 1, so concurrent requests can't both slip past the limit.
 * Throws on a database error (the caller then refuses the request).
 */
export async function databaseFixedWindowAllows(key: string, limit: number, windowMs: number): Promise<boolean> {
  const rowKey = fallbackRowKey(key);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitFallback" ("key", "windowStart", "count")
    VALUES (${rowKey}, (now() AT TIME ZONE 'UTC'), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitFallback"."windowStart" <= (now() AT TIME ZONE 'UTC') - (${windowMs}::bigint * interval '1 millisecond')
        THEN 1
        ELSE "RateLimitFallback"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitFallback"."windowStart" <= (now() AT TIME ZONE 'UTC') - (${windowMs}::bigint * interval '1 millisecond')
        THEN (now() AT TIME ZONE 'UTC')
        ELSE "RateLimitFallback"."windowStart"
      END
    RETURNING "count"`;
  if (Math.random() < 1 / PRUNE_ONE_IN) {
    void prisma.$executeRaw`
      DELETE FROM "RateLimitFallback"
      WHERE "windowStart" < (now() AT TIME ZONE 'UTC') - (${PRUNE_AFTER_MS}::bigint * interval '1 millisecond')`.catch(
      (err: unknown) => console.error("[rate-limit] pruning the database fallback failed", err),
    );
  }
  const count = Number(rows[0]?.count ?? Number.POSITIVE_INFINITY);
  return count <= limit;
}

// The same slot registerRateLimitFallback (src/lib/rate-limit.ts) writes, set directly so this module doesn't import
// rate-limit.ts (tests often replace that module with a mock).
(globalThis as Record<symbol, unknown>)[Symbol.for("yukon3t.rateLimitDbFallback")] = databaseFixedWindowAllows;
