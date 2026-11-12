// Pure rules for starting a live stream and announcing it, shared by startLiveStream (actions/live-streams.ts), the
// announcement fan-out (live-stream-announce.ts) and the end-inactive-streams cron. No database or network here, so
// every rule is unit-tested (live-stream-start.test.ts).

/**
 * A LIVE row whose Daily room was never attached (roomName still "") and is older than this is a start that died
 * part-way (the function timed out or crashed between creating the row and creating the room). Well past any
 * serverless function's limit, so a start still genuinely in progress is never mistaken for one.
 */
export const LIVE_START_PENDING_STALE_MS = 2 * 60_000;

/**
 * Serializes concurrent starts by the same host only (a double tap, two devices, a client retry). Keyed per host,
 * so different people going live at the same moment never wait on each other.
 */
export function liveStartLockKey(hostId: string) {
  return `live-start:${hostId}`;
}

export function liveAnnounceLockKey(liveStreamId: string) {
  return `live-announce:${liveStreamId}`;
}

export type ExistingLiveStream = { id: string; roomName: string; startedAt: Date };

/**
 * What a new start does about the host's current LIVE row, if any:
 * - "start": none, go ahead.
 * - "already_live": a working stream, or a start of theirs still in progress (the double tap) — answer with its id.
 * - "reclaim": an abandoned half-created start (see LIVE_START_PENDING_STALE_MS) — end it and start fresh, instead
 *   of blocking the host with "already live" until the inactivity cron finally clears it 30 minutes later.
 */
export function existingLiveDecision(existing: ExistingLiveStream | null, now: Date): "start" | "already_live" | "reclaim" {
  if (!existing) return "start";
  if (existing.roomName) return "already_live";
  return now.getTime() - existing.startedAt.getTime() >= LIVE_START_PENDING_STALE_MS ? "reclaim" : "already_live";
}

/**
 * The announcement normally runs right after the start answers (next/server `after`). The cron retries any stream
 * still unannounced once it is this old: long enough that it never races the normal path.
 */
export const LIVE_ANNOUNCE_RETRY_AFTER_MS = 30_000;
/** Past this, "X is live" is old news: an unannounced stream is marked announced without sending anything. */
export const LIVE_ANNOUNCE_MAX_AGE_MS = 15 * 60_000;
/** At most this many streams are announced per cron run (each is its own small transaction). */
export const LIVE_ANNOUNCE_SWEEP_LIMIT = 20;
/** Notification rows are inserted this many per statement, so a host with many subscribers never builds one huge INSERT. */
export const NOTIFICATION_INSERT_BATCH = 1000;

/** Splits a list into consecutive chunks of at most `size` (size >= 1). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/** Which kind of announcement a stream gets, from who it was started for (the same three-way choice startLiveStream validates). */
export function announcementKind(stream: { targetUserId: string | null; circleId: string | null }) {
  if (stream.targetUserId) return "invite" as const;
  if (stream.circleId) return "circle" as const;
  return "subscribers" as const;
}

/** How the cron treats an unannounced LIVE stream of this age: still too fresh (the normal path owns it), retry it, or too old to announce. */
export function announceSweepAction(startedAt: Date, now: Date): "wait" | "announce" | "expire" {
  const age = now.getTime() - startedAt.getTime();
  if (age < LIVE_ANNOUNCE_RETRY_AFTER_MS) return "wait";
  return age > LIVE_ANNOUNCE_MAX_AGE_MS ? "expire" : "announce";
}

/** How many Daily room deletions the cron runs at once (deletes are rate-limited more tightly than other Daily calls). */
export const ROOM_DELETE_CONCURRENCY = 3;

/** Runs `fn` over `items` with at most `limit` in flight; never rejects (each failure is swallowed by the caller's fn). */
export async function runWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<unknown>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch {
        // Best-effort per item.
      }
    }
  });
  await Promise.all(workers);
}
