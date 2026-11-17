// Where the moderate-videos cron keeps its Hive cooldown (src/lib/video-scan-budget.ts: hiveCooldownAfter).
//
// Primary: Upstash Redis, the same instance (UPSTASH_REDIS_REST_URL / TOKEN) the rate limiters in
// src/lib/rate-limit.ts use, one key, so every serverless instance sees it. No table, no migration.
// Fallback: a module-level value, always written too. It only holds within one warm instance, so with Redis missing or
// down a cold instance will call Hive once more and then set its own. Redis errors and timeouts are logged and never
// fail the run: at worst a run calls Hive and gets the same 429 again.

import { Redis } from "@upstash/redis";
import { parseHiveCooldown, type HiveCooldown } from "@/lib/video-scan-budget";

const KEY = "cron:moderate-videos:hive-cooldown";
/** Redis is given this long per call; a slow Redis must not eat the run's budget. */
const REDIS_TIMEOUT_MS = 1_000;
/** The record outlives its cooldown by this much so a 429 soon after it ends counts as "in a row". */
const KEEP_AFTER_MS = 2 * 60 * 60_000;

export type CooldownStoreKind = "redis" | "memory";

let memory: HiveCooldown | null = null;
let client: Redis | null | undefined;

function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("redis timeout")), REDIS_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** The stored cooldown (Redis first, else this instance's memory) and which store answered. */
export async function readHiveCooldown(): Promise<{ cooldown: HiveCooldown | null; store: CooldownStoreKind }> {
  const r = redis();
  if (r) {
    try {
      const value = await withTimeout(r.get<unknown>(KEY));
      const fromRedis = parseHiveCooldown(value);
      // Keep the later of the two: a write to Redis that failed earlier is still known here.
      if (memory && (!fromRedis || memory.untilMs > fromRedis.untilMs)) return { cooldown: memory, store: "memory" };
      return { cooldown: fromRedis, store: "redis" };
    } catch (err) {
      console.error(`[moderate-videos] cooldown read failed, using memory: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { cooldown: memory, store: "memory" };
}

/** Saves a cooldown in memory and, when configured, in Redis. Returns the store that holds it durably. */
export async function writeHiveCooldown(cooldown: HiveCooldown): Promise<CooldownStoreKind> {
  memory = cooldown;
  const r = redis();
  if (!r) return "memory";
  try {
    const ttlMs = Math.max(1, cooldown.untilMs - Date.now()) + KEEP_AFTER_MS;
    await withTimeout(r.set(KEY, JSON.stringify(cooldown), { px: ttlMs }));
    return "redis";
  } catch (err) {
    console.error(`[moderate-videos] cooldown write failed, memory only: ${err instanceof Error ? err.message : err}`);
    return "memory";
  }
}

/** Tests only. */
export function resetHiveCooldownStoreForTests() {
  memory = null;
  client = undefined;
}
