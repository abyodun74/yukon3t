// Fewer Upstash commands for src/proxy.ts's page-level rate limit. Every proxy check used to cost one Upstash command
// per bucket per request (two for a request from a known device), so ordinary browsing alone burned through the plan's
// command quota, and an exhausted quota is exactly when the limiters stop working. Instead, a check reserves a small
// batch of requests from the bucket in one command (Upstash's `rate` option) and this server instance spends the rest
// locally, without asking Upstash again, until they run out or expire. Edge-safe and pure (the clock is passed in);
// unit-tested in page-limit-credits.test.ts.
//
// The trade-off is bounded: a reservation counts against the bucket at once, so a device can at most be refused up to
// BATCH - 1 requests early on each instance it reached, and an instance can let through at most BATCH - 1 requests
// after the bucket filled elsewhere, for at most TTL. Against page buckets of 300 to 3,000 a minute that is noise.

/** Requests reserved per Upstash command. */
export const PAGE_LIMIT_CREDIT_BATCH = 10;
/** How long reserved, unspent requests stay usable on one instance. */
export const PAGE_LIMIT_CREDIT_TTL_MS = 10_000;
/** Most identifiers one instance holds credit for at once (memory bound). */
export const PAGE_LIMIT_CREDIT_MAX_KEYS = 10_000;

type Credit = { left: number; expiresAt: number };

export type CreditCache = {
  /** Spends one locally held request for `key`; false when there is none (the caller must ask Upstash). */
  take(key: string, now: number): boolean;
  /** Stores `count` reserved requests for `key`, valid for the cache's TTL. */
  grant(key: string, count: number, now: number): void;
  size(): number;
};

export function createCreditCache({
  ttlMs = PAGE_LIMIT_CREDIT_TTL_MS,
  maxKeys = PAGE_LIMIT_CREDIT_MAX_KEYS,
}: { ttlMs?: number; maxKeys?: number } = {}): CreditCache {
  const credits = new Map<string, Credit>();

  function prune(now: number) {
    for (const [key, credit] of credits) {
      if (credit.expiresAt <= now || credit.left <= 0) credits.delete(key);
    }
  }

  return {
    take(key, now) {
      const credit = credits.get(key);
      if (!credit) return false;
      if (credit.expiresAt <= now || credit.left <= 0) {
        credits.delete(key);
        return false;
      }
      credit.left -= 1;
      if (credit.left === 0) credits.delete(key);
      return true;
    },
    grant(key, count, now) {
      if (count <= 0) return;
      if (!credits.has(key) && credits.size >= maxKeys) {
        prune(now);
        // Still full: drop the oldest entry (Map keeps insertion order). Losing credit only costs an Upstash command.
        if (credits.size >= maxKeys) {
          const oldest = credits.keys().next().value;
          if (oldest !== undefined) credits.delete(oldest);
        }
      }
      credits.set(key, { left: count, expiresAt: now + ttlMs });
    },
    size() {
      return credits.size;
    },
  };
}

/**
 * Whether one request for `key` is allowed: from local credit when there is some, else by reserving a batch with one
 * call to `check(rate)` (the remainder kept as credit). A batch that doesn't fit (the bucket is nearly full) is
 * retried for this one request alone, so nobody is refused while a single request would still fit.
 */
export async function allowWithCredits(
  cache: CreditCache,
  key: string,
  check: (rate: number) => Promise<boolean>,
  now: number,
  batch: number = PAGE_LIMIT_CREDIT_BATCH,
): Promise<boolean> {
  if (cache.take(key, now)) return true;
  if (batch > 1 && (await check(batch))) {
    cache.grant(key, batch - 1, now);
    return true;
  }
  return check(1);
}
