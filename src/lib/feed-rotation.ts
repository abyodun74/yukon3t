// Home and Muse rotation (owner decision 2026-11-17): by default both feeds show a fresh, recency-weighted mix every
// 15 minutes instead of strictly newest first; the "Latest" switch (FEED_ORDER_COOKIE) brings back newest first.
//
// Pure and client-safe apart from loadRotatedPage, which only talks to the RotationSource it is handed (the Prisma
// sources are in feed-rotation-sources.ts), so every rule here is unit-tested without a database.
//
// How one list is built for (viewer, feed, 15-minute bucket b), at the bucket's start S = b * 15 min:
// - Fresh head, newest first: everything listable created in [S, t] (t = when the first page was served), plus the
//   viewer's own posts from [S - 24h, S). These are what the reader most expects to see at the top.
// - Rotated body: the listable items created in [S - 7d, S), at most ROTATION_POOL_CAP of the newest (ids only), each
//   given the weighted-sampling key ln(u) / w (Efraimidis-Spirakis, taken in log space so tiny weights can't
//   underflow), where u is a uniform number hashed from viewer:feed:bucket:itemId and w = 2^(-age / 36h) with the age
//   measured at S. Highest key first. Newer items are far more likely to be near the top, older ones still turn up.
// - Tail: when the body runs out, plain newest-first keyset paging ((createdAt, id) below the pool's oldest item).
//
// Nothing in the seed is behavioural: only the viewer's id, the feed's name and the clock. The same viewer gets the same
// order for the whole bucket (so paging is stable and needs no stored state); a new bucket only takes effect on a fresh
// first page (page load or pull-to-refresh), never mid-scroll, because every later page carries its bucket in the
// cursor. Each item's key is independent of the others, so an item disappearing (deleted, author blocked) never
// reorders the rest.

export const ROTATION_BUCKET_MS = 15 * 60_000;
export const ROTATION_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const ROTATION_HALF_LIFE_MS = 36 * 60 * 60_000;
export const OWN_POSTS_HEAD_MS = 24 * 60 * 60_000;
/** The most ids one pool query reads; anything older continues in the newest-first tail. */
export const ROTATION_POOL_CAP = 500;
/** The most fresh items (created since the bucket began) one list puts at the top. */
export const ROTATION_HEAD_CAP = 200;
/** A cursor whose bucket began longer ago than this (or in the future) starts over from the top. */
export const ROTATION_CURSOR_MAX_AGE_MS = 6 * 60 * 60_000;
/** How far a cursor's "served at" time may be past the server's clock before it is clamped. */
const CLOCK_SKEW_MS = 60_000;
const MAX_INDEX = 100_000;

// ---- The Latest switch ---------------------------------------------------------------------------------------------

/** Read on the server during SSR (src/lib/feed-order-server.ts) and written by FeedOrderToggle. */
export const FEED_ORDER_COOKIE = "yukon3t.feed-order";
export const FEED_ORDER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
/** "mixed" is the default (rotation); "latest" is newest first, exactly as before rotation existed. */
export type FeedOrder = "mixed" | "latest";

export function parseFeedOrder(value: string | null | undefined): FeedOrder {
  return value === "latest" ? "latest" : "mixed";
}

// ---- Buckets and hashing -------------------------------------------------------------------------------------------

export function rotationBucket(nowMs: number): number {
  return Math.floor(nowMs / ROTATION_BUCKET_MS);
}

export function bucketStartMs(bucket: number): number {
  return bucket * ROTATION_BUCKET_MS;
}

/** FNV-1a over UTF-16 code units, then murmur3's 32-bit finalizer so near-identical inputs spread out. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A deterministic number strictly between 0 and 1 for this key. */
export function seededUniform(key: string): number {
  return (hash32(key) + 0.5) / 4_294_967_296;
}

/** The seed of one viewer's list in one feed for one bucket: no behavioural signal, only who, which feed and when. */
export function rotationSeed(viewerId: string, feedKey: string, bucket: number): string {
  return `${viewerId}:${feedKey}:${bucket}`;
}

/** 1 for an item created at (or after) the reference time, halving every ROTATION_HALF_LIFE_MS of age. */
export function recencyWeight(ageMs: number): number {
  return Math.pow(2, -Math.max(0, ageMs) / ROTATION_HALF_LIFE_MS);
}

export type RotationRow = { id: string; createdAt: Date; authorId: string };

/** Efraimidis-Spirakis key u^(1/w) in log space: ln(u) / w. Higher comes first. */
export function rotationKey(row: Pick<RotationRow, "id" | "createdAt">, seed: string, refMs: number): number {
  const u = seededUniform(`${seed}:${row.id}`);
  return Math.log(u) / recencyWeight(refMs - row.createdAt.getTime());
}

function compareNewestFirst(a: Pick<RotationRow, "id" | "createdAt">, b: Pick<RotationRow, "id" | "createdAt">) {
  const d = b.createdAt.getTime() - a.createdAt.getTime();
  if (d !== 0) return d;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function sortNewestFirst<T extends Pick<RotationRow, "id" | "createdAt">>(rows: readonly T[]): T[] {
  return [...rows].sort(compareNewestFirst);
}

/** The rows in rotation order for this seed (ties, which need a hash collision, fall back to id). */
export function rankByRotation<T extends Pick<RotationRow, "id" | "createdAt">>(
  rows: readonly T[],
  seed: string,
  refMs: number,
): T[] {
  return rows
    .map((row) => ({ row, key: rotationKey(row, seed, refMs) }))
    .sort((a, b) => b.key - a.key || (a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0))
    .map((entry) => entry.row);
}

// ---- One list ------------------------------------------------------------------------------------------------------

/** Items strictly older than this, newest first: createdAt < at, or createdAt = at and id < id. */
export type TailBoundary = { at: number; id: string | null };

export type RotationList = { rows: RotationRow[]; ids: string[]; tail: TailBoundary };

/**
 * The whole ordered list for one viewer and bucket from what the two id queries returned: `fresh` (created in
 * [S, t]) and `pool` (created in [S - 7d, S), newest first, at most ROTATION_POOL_CAP). `poolCapped` says the pool query
 * hit its cap, so the tail starts below its oldest row rather than at the window's edge.
 */
export function buildRotationList({
  fresh,
  pool,
  poolCapped,
  viewerId,
  seed,
  bucket,
  excludeId = null,
}: {
  fresh: readonly RotationRow[];
  pool: readonly RotationRow[];
  poolCapped: boolean;
  viewerId: string;
  seed: string;
  bucket: number;
  excludeId?: string | null;
}): RotationList {
  const start = bucketStartMs(bucket);
  const ownSince = start - OWN_POSTS_HEAD_MS;
  const isOwnRecent = (row: RotationRow) => row.authorId === viewerId && row.createdAt.getTime() >= ownSince;

  const head = sortNewestFirst([...fresh, ...pool.filter(isOwnRecent)]);
  const body = rankByRotation(
    pool.filter((row) => !isOwnRecent(row)),
    seed,
    start,
  );

  const seen = new Set<string>();
  const rows: RotationRow[] = [];
  for (const row of [...head, ...body]) {
    if (row.id === excludeId || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }

  const oldest = pool.length ? sortNewestFirst(pool)[pool.length - 1] : null;
  const tail: TailBoundary =
    poolCapped && oldest
      ? { at: oldest.createdAt.getTime(), id: oldest.id }
      : { at: start - ROTATION_WINDOW_MS, id: null };
  return { rows, ids: rows.map((row) => row.id), tail };
}

// ---- Cursors -------------------------------------------------------------------------------------------------------

/**
 * "r": inside the rotated list of bucket b, first served at t; i items already served, the last of them l, created at
 * la (ms) and, when lo is 1, by the viewer. la/lo let the server find where l stood even once it has been deleted.
 * "c": in the newest-first tail, below (at, id).
 * x, when set, is left out everywhere (the Muse a /muse/<id> permalink already shows).
 */
export type RotationCursor =
  | { m: "r"; b: number; t: number; i: number; l: string | null; la?: number; lo?: 1; x?: string }
  | { m: "c"; b: number; at: number; id: string | null; x?: string };

const CURSOR_PREFIX = "r1.";

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function encodeRotationCursor(cursor: RotationCursor): string {
  return CURSOR_PREFIX + toBase64Url(JSON.stringify(cursor));
}

/** Whether a client-sent cursor is a rotation cursor at all (a plain id is a newest-first cursor). */
export function isRotationCursor(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(CURSOR_PREFIX);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);

/** The cursor, or null for anything malformed (never throws). */
export function decodeRotationCursor(value: string | null | undefined): RotationCursor | null {
  if (!isRotationCursor(value) || value.length > 600) return null;
  const json = fromBase64Url(value.slice(CURSOR_PREFIX.length));
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!isInt(c.b, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (c.x !== undefined && !isId(c.x)) return null;
  const x = c.x as string | undefined;
  if (c.m === "r") {
    if (!isInt(c.t, 0, Number.MAX_SAFE_INTEGER) || !isInt(c.i, 0, MAX_INDEX)) return null;
    if (c.l !== null && !isId(c.l)) return null;
    if (c.la !== undefined && !isInt(c.la, 0, Number.MAX_SAFE_INTEGER)) return null;
    if (c.lo !== undefined && c.lo !== 1) return null;
    return {
      m: "r",
      b: c.b,
      t: c.t,
      i: c.i,
      l: c.l as string | null,
      ...(c.la !== undefined ? { la: c.la } : {}),
      ...(c.lo === 1 ? { lo: 1 as const } : {}),
      ...(x ? { x } : {}),
    };
  }
  if (c.m === "c") {
    if (!isInt(c.at, 0, Number.MAX_SAFE_INTEGER)) return null;
    if (c.id !== null && !isId(c.id)) return null;
    return { m: "c", b: c.b, at: c.at, id: c.id as string | null, ...(x ? { x } : {}) };
  }
  return null;
}

/**
 * Whether a cursor's bucket may still be continued at nowMs: not in the future and begun at most
 * ROTATION_CURSOR_MAX_AGE_MS ago. Otherwise the feed starts again from the top of the current bucket.
 */
export function isCursorBucketUsable(cursor: RotationCursor, nowMs: number): boolean {
  const current = rotationBucket(nowMs);
  if (cursor.b > current) return false;
  return nowMs - bucketStartMs(cursor.b) <= ROTATION_CURSOR_MAX_AGE_MS;
}

/** A rotated cursor's "served at" time, kept inside [bucket start, now]. */
export function clampServedAt(cursor: { b: number; t: number }, nowMs: number): number {
  return Math.min(Math.max(cursor.t, bucketStartMs(cursor.b)), nowMs + CLOCK_SKEW_MS);
}

/** Where to resume in `ids`: just after the last item served if it is still there, else at the served count. */
export function resumeIndex(ids: readonly string[], cursor: { i: number; l: string | null } | null): number {
  if (!cursor) return 0;
  if (cursor.l) {
    const at = ids.indexOf(cursor.l);
    if (at >= 0) return at + 1;
  }
  return Math.min(cursor.i, ids.length);
}

/** The cursor a /muse/<id> permalink starts with: the rotated feed from its top, without that Muse. */
export function permalinkRotationCursor(excludeId: string, nowMs: number = Date.now()): string {
  return encodeRotationCursor({ m: "r", b: rotationBucket(nowMs), t: nowMs, i: 0, l: null, x: excludeId });
}

// ---- Paging --------------------------------------------------------------------------------------------------------

/** What a feed has to answer for rotation; both lists newest first ([createdAt desc, id desc]). */
export interface RotationSource {
  /** Rows created at or after `gte` and before `lt` (or at or before `lte`), at most `take`. */
  inRange(range: { gte: Date; lt?: Date; lte?: Date }, take: number): Promise<RotationRow[]>;
  /** Rows strictly older than the boundary, at most `take`. */
  olderThan(boundary: TailBoundary, take: number): Promise<RotationRow[]>;
}

export type RotatedPage = {
  /** In display order; hydrate with the feed's own visibility rules and keep this order. */
  ids: string[];
  nextCursor: string | null;
  /** Everything up to this time is in the list: newer items come only through the live "newer posts" fetch. */
  servedAt: Date;
};

/** The ordered list for one cursor position (both id queries run at once). */
export async function loadRotationList(
  source: RotationSource,
  opts: { viewerId: string; feedKey: string; bucket: number; servedAtMs: number; excludeId?: string | null },
): Promise<RotationList & { withRow: (extra: RotationRow) => RotationList }> {
  const start = bucketStartMs(opts.bucket);
  const [fresh, pool] = await Promise.all([
    source.inRange({ gte: new Date(start), lte: new Date(opts.servedAtMs) }, ROTATION_HEAD_CAP),
    source.inRange({ gte: new Date(start - ROTATION_WINDOW_MS), lt: new Date(start) }, ROTATION_POOL_CAP),
  ]);
  const build = (extraFresh: RotationRow[], extraPool: RotationRow[]) =>
    buildRotationList({
      fresh: [...fresh, ...extraFresh],
      pool: [...pool, ...extraPool],
      poolCapped: pool.length >= ROTATION_POOL_CAP,
      viewerId: opts.viewerId,
      seed: rotationSeed(opts.viewerId, opts.feedKey, opts.bucket),
      bucket: opts.bucket,
      excludeId: opts.excludeId,
    });
  return {
    ...build([], []),
    // The same list with one more row where it would have been: how a deleted last-served item is placed again.
    withRow: (extra) => (extra.createdAt.getTime() >= start ? build([extra], []) : build([], [extra])),
  };
}

/**
 * Where to resume: just after the last item served. If that item has gone since (deleted, or its author blocked), it
 * is put back where its own key placed it (the cursor has its id, time and whether it was the viewer's; no other item's
 * place depends on it), so nothing is skipped or repeated. A cursor without those falls back to the served count.
 */
function resumeAt(
  list: RotationList & { withRow: (extra: RotationRow) => RotationList },
  cursor: Extract<RotationCursor, { m: "r" }> | null,
  viewerId: string,
): number {
  if (!cursor) return 0;
  if (cursor.l && cursor.la !== undefined && !list.ids.includes(cursor.l)) {
    const ghost = { id: cursor.l, createdAt: new Date(cursor.la), authorId: cursor.lo ? viewerId : "" };
    const at = list.withRow(ghost).ids.indexOf(cursor.l);
    if (at >= 0) return at;
  }
  return resumeIndex(list.ids, cursor);
}

/**
 * One page of a rotated feed. `cursor` is what the previous page returned (null for the first page). A cursor that is
 * malformed, from the future or too old starts over from the top of the current bucket; callers that want to refuse
 * a malformed one check decodeRotationCursor first.
 */
export async function loadRotatedPage(
  source: RotationSource,
  opts: {
    viewerId: string;
    feedKey: string;
    nowMs: number;
    cursor: string | null;
    pageSize: number;
    /** For a first page only: leave this id out of the whole feed (later pages carry it in their cursor). */
    excludeId?: string | null;
  },
): Promise<RotatedPage> {
  const decoded = decodeRotationCursor(opts.cursor);
  const cursor = decoded && isCursorBucketUsable(decoded, opts.nowMs) ? decoded : null;
  const excludeId = cursor ? (cursor.x ?? null) : (decoded?.x ?? opts.excludeId ?? null);
  const pageSize = Math.max(1, opts.pageSize);
  const withX = excludeId ? { x: excludeId } : {};
  // One extra row says whether there is more; one more covers the excluded id coming back in it.
  const spare = excludeId ? 2 : 1;

  if (cursor?.m === "c") {
    const rows = (await source.olderThan({ at: cursor.at, id: cursor.id }, pageSize + spare)).filter(
      (row) => row.id !== excludeId,
    );
    return tailPage(rows, pageSize, cursor.b, withX, new Date(opts.nowMs));
  }

  const bucket = cursor ? cursor.b : rotationBucket(opts.nowMs);
  const servedAtMs = cursor ? clampServedAt(cursor, opts.nowMs) : opts.nowMs;
  const list = await loadRotationList(source, {
    viewerId: opts.viewerId,
    feedKey: opts.feedKey,
    bucket,
    servedAtMs,
    excludeId,
  });
  const from = resumeAt(list, cursor, opts.viewerId);
  const served = list.rows.slice(from, from + pageSize);
  const ids = served.map((row) => row.id);
  const servedAt = new Date(servedAtMs);
  const end = from + ids.length;

  if (end < list.ids.length) {
    const last = served[served.length - 1];
    const next = encodeRotationCursor({
      m: "r",
      b: bucket,
      t: servedAtMs,
      i: end,
      l: last?.id ?? null,
      ...(last ? { la: last.createdAt.getTime(), ...(last.authorId === opts.viewerId ? { lo: 1 as const } : {}) } : {}),
      ...withX,
    });
    return { ids, nextCursor: next, servedAt };
  }

  // The rotated list is used up: the rest of this page, and every later one, is the newest-first tail.
  const room = pageSize - ids.length;
  if (room === 0) {
    const next = encodeRotationCursor({ m: "c", b: bucket, at: list.tail.at, id: list.tail.id, ...withX });
    return { ids, nextCursor: next, servedAt };
  }
  const rows = (await source.olderThan(list.tail, room + spare)).filter((row) => row.id !== excludeId);
  const tail = tailPage(rows, room, bucket, withX, servedAt);
  return { ids: [...ids, ...tail.ids], nextCursor: tail.nextCursor, servedAt };
}

function tailPage(
  rows: RotationRow[],
  take: number,
  bucket: number,
  withX: { x?: string },
  servedAt: Date,
): RotatedPage {
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > take && last
      ? encodeRotationCursor({ m: "c", b: bucket, at: last.createdAt.getTime(), id: last.id, ...withX })
      : null;
  return { ids: page.map((row) => row.id), nextCursor, servedAt };
}

/** `rows` in the order of `ids`, dropping ids that didn't come back (deleted or no longer visible). */
export function orderByIds<T extends { id: string }>(ids: readonly string[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}
