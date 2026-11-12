// The cap on how many people can watch one live stream at once. Daily bills every participant-minute past the free
// monthly allowance and has no spend cap of its own, so a single viral stream must not be able to run up an unbounded
// bill. Pure and client-safe (the feed card and the room read the constants too); the database half is
// joinLiveStream's locked claim in actions/live-streams.ts. Tests: live-viewer-cap.test.ts and
// actions/live-streams-viewer-cap.test.ts.

import { ONLINE_WINDOW_MS } from "@/lib/presence";

/** Most people who can watch one live stream at the same moment. The only place this number lives. */
export const MAX_LIVE_VIEWERS = 100;

/**
 * Extra Daily participants allowed on top of MAX_LIVE_VIEWERS by the room's own `max_participants` (createLiveStreamRoom):
 * the host, the stage (guests and co-hosts), site admins, and a reloading viewer's old session that Daily hasn't
 * dropped yet. That room property is Daily's own hard ceiling, so a leaked or reused token can't take a stream past it
 * whatever our database says.
 */
export const LIVE_ROOM_PARTICIPANT_HEADROOM = 20;
export const LIVE_ROOM_MAX_PARTICIPANTS = MAX_LIVE_VIEWERS + LIVE_ROOM_PARTICIPANT_HEADROOM;

/**
 * How long a live-stream join token can be used to join. A token is only checked when joining (it doesn't eject
 * anyone already in the room when it lapses, and every join, including a stage reconnect, mints a fresh one), so this
 * bounds what a leaked token is good for without cutting off a long live.
 */
export const LIVE_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * A viewer row holds a slot while it is "current": joined within this window, or its user's presence heartbeat
 * (User.lastSeenAt) is within it. The same window the app uses for "online now" (src/lib/presence.ts), so a crashed
 * or closed client stops holding a slot about two minutes after its last sign of life.
 */
export const LIVE_VIEWER_FRESH_MS = ONLINE_WINDOW_MS;

/** After a preview is told the stream is full, it doesn't ask again for this long, whatever the counts say. */
export const PREVIEW_FULL_BACKOFF_MS = 60_000;

/** Serializes the count-and-claim of one stream's viewer slots (pg_advisory_xact_lock), so two joiners can't both take the last one. */
export function liveViewerLockKey(liveStreamId: string) {
  return `live-viewers:${liveStreamId}`;
}

export function viewerFreshSince(now: Date) {
  return new Date(now.getTime() - LIVE_VIEWER_FRESH_MS);
}

/**
 * Rows that hold a viewer slot (a LiveStreamViewer `where`): not a co-host (the host's own row is stored as COHOST
 * too, see joinLiveStream) and current. Plain viewers, approved guests and feed previews all count: each is a real,
 * billed Daily participant.
 */
export function slotHoldingViewerWhere(now: Date) {
  const since = viewerFreshSince(now);
  return {
    role: { not: "COHOST" as const },
    OR: [{ joinedAt: { gte: since } }, { user: { lastSeenAt: { gte: since } } }],
  };
}

/**
 * A person's viewings of streams other than `exceptLiveStreamId` (a LiveStreamViewer `where`): what joining a stream
 * ends, because a person watches one live at a time. A viewing is a VIEWER or GUEST row; a co-host seat is not one,
 * and nothing on a stream they host is ever touched (their own row there is COHOST anyway; the host check says so
 * explicitly), so watching someone else never ends or empties their own live.
 */
export function otherViewingsWhere(userId: string, exceptLiveStreamId: string) {
  return {
    userId,
    liveStreamId: { not: exceptLiveStreamId },
    role: { in: ["VIEWER" as const, "GUEST" as const] },
    liveStream: { hostId: { not: userId } },
  };
}

/** Whether a row (with its user's last heartbeat) holds a slot right now: slotHoldingViewerWhere for one row. */
export function holdsViewerSlot(
  row: { role: string; joinedAt: Date } | null | undefined,
  lastSeenAt: Date | null | undefined,
  now: Date,
) {
  if (!row || row.role === "COHOST") return false;
  const since = viewerFreshSince(now).getTime();
  return row.joinedAt.getTime() >= since || (lastSeenAt != null && lastSeenAt.getTime() >= since);
}

/** The host, the stream's co-hosts and site admins are always let in, whatever the count. */
export function isViewerCapExempt(input: { isHost: boolean; isAdmin: boolean; existingRole: string | null | undefined }) {
  return input.isHost || input.isAdmin || input.existingRole === "COHOST";
}

/**
 * Whether a joiner gets in. `othersHoldingSlots` counts everyone else holding a slot (the joiner's own row is left
 * out, so a reload or reconnect is never counted twice); someone already holding a slot is never turned away.
 */
export function viewerCapDecision(input: {
  exempt: boolean;
  alreadyHoldsSlot: boolean;
  othersHoldingSlots: number;
}): "admit" | "full" {
  if (input.exempt || input.alreadyHoldsSlot) return "admit";
  return input.othersHoldingSlots < MAX_LIVE_VIEWERS ? "admit" : "full";
}

export function isStreamFull(slotsHeld: number) {
  return slotsHeld >= MAX_LIVE_VIEWERS;
}

/**
 * What a feed preview does with joinLiveStream's answer: play it, back off because the stream is full, or just stay
 * on its placeholder (any other failure: someone scrolling Home is never shown an error for a preview).
 */
export function previewJoinOutcome(result: { error: string | null; roomUrl?: string; token?: string }) {
  if (result.error === "stream_full") return "full" as const;
  if (result.error || !result.roomUrl || !result.token) return "skip" as const;
  return "play" as const;
}

/**
 * Remembers, per stream, when a feed preview was last refused as full. A preview never asks to join while the latest
 * count says the stream is full (`listedFull`), nor until PREVIEW_FULL_BACKOFF_MS after a refusal, even if a count
 * says a slot opened in between: a freed slot is tried at most once per backoff, never in a loop. Kept at module
 * level (previewFullGate) so scrolling away and back, or leaving Home and returning, can't reset it.
 */
export function createPreviewFullGate(backoffMs = PREVIEW_FULL_BACKOFF_MS) {
  const until = new Map<string, number>();
  return {
    markFull(liveStreamId: string, now: number) {
      until.set(liveStreamId, now + backoffMs);
    },
    mayJoin(liveStreamId: string, listedFull: boolean, now: number) {
      if (listedFull) return false;
      const end = until.get(liveStreamId);
      if (end === undefined) return true;
      if (now < end) return false;
      until.delete(liveStreamId);
      return true;
    },
    /** When a held-back preview may try again (ms timestamp), or null when nothing is holding it back. */
    retryAt(liveStreamId: string) {
      return until.get(liveStreamId) ?? null;
    },
  };
}

/** The page's one gate, shared by every LiveStreamPreviewEmbed. */
export const previewFullGate = createPreviewFullGate();
