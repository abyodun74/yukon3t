import { describe, expect, it } from "vitest";
import {
  OWN_POSTS_HEAD_MS,
  ROTATION_BUCKET_MS,
  ROTATION_CURSOR_MAX_AGE_MS,
  ROTATION_POOL_CAP,
  ROTATION_WINDOW_MS,
  bucketStartMs,
  buildRotationList,
  clampServedAt,
  decodeRotationCursor,
  encodeRotationCursor,
  isCursorBucketUsable,
  isRotationCursor,
  loadRotatedPage,
  orderByIds,
  parseFeedOrder,
  permalinkRotationCursor,
  rankByRotation,
  recencyWeight,
  resumeIndex,
  rotationBucket,
  rotationSeed,
  seededUniform,
  type RotationRow,
  type RotationSource,
  type TailBoundary,
} from "@/lib/feed-rotation";

const HOUR = 60 * 60_000;
// A bucket boundary plus a few minutes, so "now" is inside bucket B.
const B = 1_970_000;
const START = bucketStartMs(B);
const NOW = START + 5 * 60_000;
const VIEWER = "viewer1";

function row(id: string, createdAtMs: number, authorId = "someone"): RotationRow {
  return { id, createdAt: new Date(createdAtMs), authorId };
}

/** An in-memory feed with the same contract as the Prisma sources, which counts its queries. */
function memorySource(initial: RotationRow[]) {
  let rows = [...initial];
  const calls = { inRange: 0, olderThan: 0 };
  const newestFirst = (list: RotationRow[]) =>
    [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const source: RotationSource = {
    async inRange(range, take) {
      calls.inRange++;
      return newestFirst(
        rows.filter((r) => {
          const t = r.createdAt.getTime();
          return (
            t >= range.gte.getTime() &&
            (range.lt ? t < range.lt.getTime() : true) &&
            (range.lte ? t <= range.lte.getTime() : true)
          );
        }),
      ).slice(0, take);
    },
    async olderThan(boundary: TailBoundary, take) {
      calls.olderThan++;
      return newestFirst(
        rows.filter((r) => {
          const t = r.createdAt.getTime();
          return t < boundary.at || (boundary.id !== null && t === boundary.at && r.id < boundary.id);
        }),
      ).slice(0, take);
    },
  };
  return {
    source,
    calls,
    remove: (id: string) => {
      rows = rows.filter((r) => r.id !== id);
    },
    add: (r: RotationRow) => {
      rows.push(r);
    },
  };
}

/** Reads every page until the cursor runs out (capped so a bug can't loop forever). */
async function readAll(
  source: RotationSource,
  opts: { nowMs?: number; pageSize?: number; cursor?: string | null; excludeId?: string | null; between?: (n: number) => void } = {},
) {
  const seen: string[] = [];
  let cursor = opts.cursor ?? null;
  for (let page = 0; page < 1000; page++) {
    const result = await loadRotatedPage(source, {
      viewerId: VIEWER,
      feedKey: "home:all",
      nowMs: opts.nowMs ?? NOW,
      cursor,
      pageSize: opts.pageSize ?? 7,
      excludeId: opts.excludeId,
    });
    seen.push(...result.ids);
    if (!result.nextCursor) return seen;
    cursor = result.nextCursor;
    opts.between?.(page);
  }
  throw new Error("never ended");
}

function spread(count: number, newestMs: number, stepMs: number, prefix = "p") {
  return Array.from({ length: count }, (_, i) => row(`${prefix}${String(i).padStart(4, "0")}`, newestMs - i * stepMs));
}

describe("buckets and the seed", () => {
  it("changes bucket every 15 minutes", () => {
    expect(ROTATION_BUCKET_MS).toBe(900_000);
    expect(rotationBucket(START)).toBe(B);
    expect(rotationBucket(START + ROTATION_BUCKET_MS - 1)).toBe(B);
    expect(rotationBucket(START + ROTATION_BUCKET_MS)).toBe(B + 1);
  });

  it("hashes to a number strictly between 0 and 1, the same every time", () => {
    for (const key of ["", "a", "viewer:home:all:1:post", "ü"]) {
      const u = seededUniform(key);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(seededUniform(key)).toBe(u);
    }
    expect(seededUniform("a")).not.toBe(seededUniform("b"));
  });

  it("is built from the viewer, the feed and the bucket only", () => {
    expect(rotationSeed("u1", "muse", 7)).toBe("u1:muse:7");
  });

  it("halves an item's weight every 36 hours", () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(-5)).toBe(1);
    expect(recencyWeight(36 * HOUR)).toBeCloseTo(0.5);
    expect(recencyWeight(72 * HOUR)).toBeCloseTo(0.25);
  });
});

describe("rankByRotation", () => {
  const rows = spread(60, START - 1000, 2 * HOUR);

  it("is deterministic for the same viewer, feed and bucket", () => {
    const seed = rotationSeed(VIEWER, "home:all", B);
    const a = rankByRotation(rows, seed, START).map((r) => r.id);
    const b = rankByRotation([...rows].reverse(), seed, START).map((r) => r.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(rows.length);
  });

  it("gives a different order in the next bucket and to another viewer", () => {
    const now = rankByRotation(rows, rotationSeed(VIEWER, "home:all", B), START).map((r) => r.id);
    const next = rankByRotation(rows, rotationSeed(VIEWER, "home:all", B + 1), START).map((r) => r.id);
    const other = rankByRotation(rows, rotationSeed("viewer2", "home:all", B), START).map((r) => r.id);
    expect(next).not.toEqual(now);
    expect(other).not.toEqual(now);
    expect([...next].sort()).toEqual([...now].sort());
  });

  it("is not simply newest first", () => {
    const ranked = rankByRotation(rows, rotationSeed(VIEWER, "home:all", B), START).map((r) => r.id);
    expect(ranked).not.toEqual(rows.map((r) => r.id));
  });

  it("puts newer items higher on average across many viewers", () => {
    // 20 items one day old against 20 items five days old: over many seeds the newer ones must rank higher on average.
    const fresh = spread(20, START - 24 * HOUR, 60_000, "new");
    const old = spread(20, START - 5 * 24 * HOUR, 60_000, "old");
    let newRankSum = 0;
    let oldRankSum = 0;
    let newInTopTen = 0;
    const seeds = 300;
    for (let s = 0; s < seeds; s++) {
      const ranked = rankByRotation([...fresh, ...old], rotationSeed(`v${s}`, "home:all", B), START);
      ranked.forEach((r, index) => {
        if (r.id.startsWith("new")) {
          newRankSum += index;
          if (index < 10) newInTopTen++;
        } else oldRankSum += index;
      });
    }
    expect(newRankSum / (20 * seeds)).toBeLessThan(oldRankSum / (20 * seeds) - 5);
    // Most of the top ten is newer posts, but older posts still get there sometimes (it's a mix, not a sort).
    expect(newInTopTen / (10 * seeds)).toBeGreaterThan(0.75);
    expect(newInTopTen / (10 * seeds)).toBeLessThan(1);
  });
});

describe("buildRotationList: the fresh head", () => {
  it("puts items from this bucket and the viewer's own posts from the last 24 hours first, newest first", () => {
    const fresh = [row("f2", START + 2000), row("f1", START + 1000)];
    const pool = [
      row("a", START - 1 * HOUR),
      row("mine-recent", START - 2 * HOUR, VIEWER),
      row("b", START - 3 * HOUR),
      row("mine-old", START - OWN_POSTS_HEAD_MS - HOUR, VIEWER),
      row("c", START - 30 * HOUR),
      row("mine-23h", START - 23 * HOUR, VIEWER),
    ];
    const list = buildRotationList({
      fresh,
      pool,
      poolCapped: false,
      viewerId: VIEWER,
      seed: rotationSeed(VIEWER, "home:all", B),
      bucket: B,
    });
    expect(list.ids.slice(0, 4)).toEqual(["f2", "f1", "mine-recent", "mine-23h"]);
    // The rest is the rotated body, with the viewer's older post in it like anyone else's; nothing twice.
    expect([...list.ids.slice(4)].sort()).toEqual(["a", "b", "c", "mine-old"]);
    expect(new Set(list.ids).size).toBe(list.ids.length);
  });

  it("starts the tail at the window's edge, or below the pool's oldest item when the pool was capped", () => {
    const pool = spread(3, START - HOUR, HOUR);
    const base = { fresh: [], pool, viewerId: VIEWER, seed: "s", bucket: B };
    expect(buildRotationList({ ...base, poolCapped: false }).tail).toEqual({ at: START - ROTATION_WINDOW_MS, id: null });
    expect(buildRotationList({ ...base, poolCapped: true }).tail).toEqual({ at: START - 3 * HOUR, id: "p0002" });
  });

  it("leaves out the excluded id", () => {
    const list = buildRotationList({
      fresh: [row("f", START + 1)],
      pool: spread(5, START - HOUR, HOUR),
      poolCapped: false,
      viewerId: VIEWER,
      seed: "s",
      bucket: B,
      excludeId: "p0002",
    });
    expect(list.ids).not.toContain("p0002");
    expect(list.ids).toHaveLength(5);
  });
});

describe("cursors", () => {
  it("round-trips both kinds and is opaque", () => {
    const r = { m: "r" as const, b: B, t: NOW, i: 14, l: "cl0abc", x: "muse1" };
    const c = { m: "c" as const, b: B, at: START - 9 * 24 * HOUR, id: null };
    expect(decodeRotationCursor(encodeRotationCursor(r))).toEqual(r);
    expect(decodeRotationCursor(encodeRotationCursor(c))).toEqual(c);
    expect(encodeRotationCursor(r)).toMatch(/^r1\.[A-Za-z0-9_-]+$/);
    expect(isRotationCursor(encodeRotationCursor(r))).toBe(true);
    expect(isRotationCursor("cl0abc")).toBe(false);
  });

  it("refuses anything malformed without throwing", () => {
    const bad = [
      null,
      undefined,
      "",
      "cl0abc",
      "r1.",
      "r1.!!!",
      "r1." + "A".repeat(700),
      encodeRotationCursor({ m: "r", b: B, t: NOW, i: -1, l: null }),
      encodeRotationCursor({ m: "r", b: B, t: NOW, i: 1.5, l: null }),
      encodeRotationCursor({ m: "r", b: B, t: NOW, i: 0, l: "bad id with spaces" }),
      encodeRotationCursor({ m: "c", b: B, at: -1, id: null }),
      "r1." + Buffer.from(JSON.stringify({ m: "z", b: 1 })).toString("base64url"),
      "r1." + Buffer.from("not json").toString("base64url"),
      "r1." + Buffer.from(JSON.stringify({ m: "r", b: 1, t: 1, i: 0, l: null, x: { $ne: 1 } })).toString("base64url"),
    ];
    for (const value of bad) expect(decodeRotationCursor(value as string), String(value)).toBeNull();
  });

  it("only continues a bucket that has begun and is at most 6 hours old", () => {
    const at = (b: number) => ({ m: "r" as const, b, t: bucketStartMs(b), i: 0, l: null });
    expect(isCursorBucketUsable(at(B), NOW)).toBe(true);
    expect(isCursorBucketUsable(at(B + 1), NOW)).toBe(false);
    const sixHoursOfBuckets = ROTATION_CURSOR_MAX_AGE_MS / ROTATION_BUCKET_MS;
    expect(isCursorBucketUsable(at(B - sixHoursOfBuckets + 1), NOW)).toBe(true);
    expect(isCursorBucketUsable(at(B - sixHoursOfBuckets - 1), NOW)).toBe(false);
  });

  it("keeps the served-at time inside the bucket and not past now", () => {
    expect(clampServedAt({ b: B, t: START - 999 }, NOW)).toBe(START);
    expect(clampServedAt({ b: B, t: NOW + 10 * HOUR }, NOW)).toBeLessThanOrEqual(NOW + 60_000);
    expect(clampServedAt({ b: B, t: NOW - 1 }, NOW)).toBe(NOW - 1);
  });

  it("resumes after the last item served, or at the served count if that item is gone", () => {
    const ids = ["a", "b", "c", "d"];
    expect(resumeIndex(ids, null)).toBe(0);
    expect(resumeIndex(ids, { i: 2, l: "b" })).toBe(2);
    expect(resumeIndex(["a", "c", "d"], { i: 2, l: "b" })).toBe(2);
    expect(resumeIndex(["x", "a", "b", "c"], { i: 2, l: "b" })).toBe(3);
    expect(resumeIndex(ids, { i: 99, l: null })).toBe(4);
  });

  it("parses the switch's cookie with rotation as the default", () => {
    expect(parseFeedOrder(undefined)).toBe("mixed");
    expect(parseFeedOrder("mixed")).toBe("mixed");
    expect(parseFeedOrder("latest")).toBe("latest");
    expect(parseFeedOrder("LATEST")).toBe("mixed");
  });
});

describe("loadRotatedPage", () => {
  // 120 posts over the past 10 days (some past the 7-day window, so the tail is used), plus 3 made this bucket.
  const corpus = () => [
    ...spread(120, START - 1000, 2 * HOUR),
    row("fresh1", START + 60_000),
    row("fresh2", START + 120_000),
    row("fresh3", START + 4 * 60_000),
    row("mine", START - 3 * HOUR, VIEWER),
  ];

  it("serves every item exactly once across pages, rotated first and then the older tail", async () => {
    const { source } = memorySource(corpus());
    const seen = await readAll(source);
    expect(seen).toHaveLength(124);
    expect(new Set(seen).size).toBe(124);
    // Fresh head on top, newest first, with the viewer's own recent post after this bucket's posts.
    expect(seen.slice(0, 4)).toEqual(["fresh3", "fresh2", "fresh1", "mine"]);
    // Everything older than the 7-day window comes last, newest first.
    const tailIds = spread(120, START - 1000, 2 * HOUR)
      .filter((r) => r.createdAt.getTime() < START - ROTATION_WINDOW_MS)
      .map((r) => r.id);
    expect(seen.slice(-tailIds.length)).toEqual(tailIds);
  });

  it("gives the same pages for the same viewer and bucket, and a new order in a new bucket", async () => {
    const { source } = memorySource(corpus());
    expect(await readAll(source)).toEqual(await readAll(source));
    const later = await readAll(source, { nowMs: NOW + ROTATION_BUCKET_MS });
    expect(later).not.toEqual(await readAll(source));
    expect([...later].sort()).toEqual([...(await readAll(source))].sort());
  });

  it("neither skips nor repeats when an item already served, or one not yet served, is deleted mid-scroll", async () => {
    const mem = memorySource(corpus());
    const full = await readAll(mem.source);
    const servedEarly = full[3];
    const notYetServed = full[60];
    const seen = await readAll(mem.source, {
      between: (page) => {
        if (page === 1) {
          mem.remove(servedEarly);
          mem.remove(notYetServed);
        }
      },
    });
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(servedEarly);
    expect(seen).not.toContain(notYetServed);
    expect([...seen].sort()).toEqual(full.filter((id) => id !== notYetServed).sort());
  });

  it("resumes exactly where it was when the last item served was deleted (own post or anyone's)", async () => {
    const mem = memorySource(corpus());
    const full = await readAll(mem.source);
    const first = await loadRotatedPage(mem.source, {
      viewerId: VIEWER,
      feedKey: "home:all",
      nowMs: NOW,
      cursor: null,
      pageSize: 7,
    });
    mem.remove(first.ids[6]);
    const rest = await readAll(mem.source, { cursor: first.nextCursor });
    expect([...first.ids, ...rest]).toEqual(full);
    expect(new Set(rest).size).toBe(rest.length);
  });

  it("puts a deleted own post back in the head when resuming after it", async () => {
    const mem = memorySource(corpus());
    const full = await readAll(mem.source, { pageSize: 4 });
    // Page one is fresh3, fresh2, fresh1, mine: the cursor's last item is the viewer's own post.
    const first = await loadRotatedPage(mem.source, {
      viewerId: VIEWER,
      feedKey: "home:all",
      nowMs: NOW,
      cursor: null,
      pageSize: 4,
    });
    expect(first.ids[3]).toBe("mine");
    expect(decodeRotationCursor(first.nextCursor)).toMatchObject({ m: "r", l: "mine", lo: 1 });
    mem.remove("mine");
    const rest = await readAll(mem.source, { cursor: first.nextCursor, pageSize: 4 });
    expect([...first.ids, ...rest]).toEqual(full);
  });

  it("keeps posts made after the first page out of later pages (the newer-posts fetch brings those)", async () => {
    const mem = memorySource(corpus());
    const seen = await readAll(mem.source, {
      between: () => mem.add(row(`late${Math.random()}`.replace(".", ""), NOW + 1000)),
    });
    expect(seen.some((id) => id.startsWith("late"))).toBe(false);
  });

  it("starts again from the top for a cursor from the future or more than 6 hours old", async () => {
    const { source } = memorySource(corpus());
    const top = await loadRotatedPage(source, { viewerId: VIEWER, feedKey: "home:all", nowMs: NOW, cursor: null, pageSize: 7 });
    for (const b of [B + 2, B - 30]) {
      const stale = encodeRotationCursor({ m: "r", b, t: bucketStartMs(b), i: 21, l: null });
      const page = await loadRotatedPage(source, { viewerId: VIEWER, feedKey: "home:all", nowMs: NOW, cursor: stale, pageSize: 7 });
      expect(page.ids).toEqual(top.ids);
    }
  });

  it("continues the cursor's own bucket even after the clock has moved on", async () => {
    const { source } = memorySource(corpus());
    const first = await loadRotatedPage(source, { viewerId: VIEWER, feedKey: "home:all", nowMs: NOW, cursor: null, pageSize: 7 });
    const sameBucket = await loadRotatedPage(source, {
      viewerId: VIEWER,
      feedKey: "home:all",
      nowMs: NOW,
      cursor: first.nextCursor,
      pageSize: 7,
    });
    const anHourLater = await loadRotatedPage(source, {
      viewerId: VIEWER,
      feedKey: "home:all",
      nowMs: NOW + HOUR,
      cursor: first.nextCursor,
      pageSize: 7,
    });
    expect(anHourLater.ids).toEqual(sameBucket.ids);
  });

  it("starts a permalink's feed from the top of the mix without that item, on every page", async () => {
    const { source } = memorySource(corpus());
    const full = await readAll(source);
    const target = full[10];
    const seen = await readAll(source, { cursor: permalinkRotationCursor(target, NOW) });
    expect(seen).not.toContain(target);
    expect(seen).toEqual(full.filter((id) => id !== target));
    const tailTarget = full[full.length - 3];
    const seenTail = await readAll(source, { cursor: permalinkRotationCursor(tailTarget, NOW) });
    expect(seenTail).toEqual(full.filter((id) => id !== tailTarget));
  });

  it("pages through a pool capped at ROTATION_POOL_CAP into the tail without a gap", async () => {
    // Every post inside the window, more than the cap: the tail must start right below the pool's oldest post.
    const many = spread(ROTATION_POOL_CAP + 40, START - 1000, 60_000);
    const { source } = memorySource(many);
    const seen = await readAll(source, { pageSize: 50 });
    expect(seen).toHaveLength(many.length);
    expect(new Set(seen).size).toBe(many.length);
    expect(seen.slice(-40)).toEqual(many.slice(-40).map((r) => r.id));
  });

  it("answers an empty feed with no cursor", async () => {
    const { source } = memorySource([]);
    const page = await loadRotatedPage(source, { viewerId: VIEWER, feedKey: "muse", nowMs: NOW, cursor: null, pageSize: 10 });
    expect(page).toEqual({ ids: [], nextCursor: null, servedAt: new Date(NOW) });
  });

  it("reads ids only twice per rotated page", async () => {
    const mem = memorySource(corpus());
    await loadRotatedPage(mem.source, { viewerId: VIEWER, feedKey: "home:all", nowMs: NOW, cursor: null, pageSize: 7 });
    expect(mem.calls).toEqual({ inRange: 2, olderThan: 0 });
  });
});

describe("orderByIds", () => {
  it("restores the ranked order and drops ids that did not come back", () => {
    const rows = [{ id: "c" }, { id: "a" }];
    expect(orderByIds(["a", "b", "c"], rows)).toEqual([{ id: "a" }, { id: "c" }]);
  });
});
