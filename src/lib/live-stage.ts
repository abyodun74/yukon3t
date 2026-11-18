// The live stream stage: who can be on it (the host plus up to MAX_LIVE_STAGE guests and co-hosts), invitations to
// come on stage, and how video quality steps down as the stage grows. Pure and client-safe: the room, the picker and
// the server actions (actions/live-streams.ts, actions/live-stream-invites.ts, src/lib/live-stage-server.ts) all read
// these. Tests: live-stage.test.ts.

import { UNVERIFIED_ACCOUNT_WHERE } from "@/lib/account-verification";
import { LIVE_ROOM_PARTICIPANT_HEADROOM } from "@/lib/live-viewer-cap";

/** Most guests and co-hosts on stage at once, on top of the host. The only place this number lives. */
export const MAX_LIVE_STAGE = 10;

/**
 * Daily's documented guidance (docs.daily.co, "Interactive live streaming"): calls with more than 12 active
 * participants (devices on) need their support team. The host plus a full stage must stay at or under it; a test
 * holds MAX_LIVE_STAGE to that.
 */
export const DAILY_ACTIVE_SENDERS_WITHOUT_SUPPORT = 12;

/** The room's max_participants headroom (live-viewer-cap.ts) must cover the host and a full stage. */
export const STAGE_FITS_ROOM_HEADROOM = MAX_LIVE_STAGE + 1 <= LIVE_ROOM_PARTICIPANT_HEADROOM;

/** How long an unanswered invite stays open. Past it (or once the stream ends) it reads as expired. */
export const LIVE_INVITE_TTL_MS = 15 * 60 * 1000;
/** Most people one invite request (the Go live sheet or the in-room picker) can name. */
export const LIVE_INVITE_MAX_PER_REQUEST = MAX_LIVE_STAGE;
/** Most invites one stream can have open (pending, not expired) at once. */
export const LIVE_INVITE_MAX_PENDING = 20;
/** Most times one person can be invited to the same stream (a re-invite after a cancel or expiry counts). */
export const LIVE_INVITE_MAX_SENDS = 2;
/** Most invites one inviter can send the same person over 24 hours, across all their streams. */
export const LIVE_INVITE_PAIR_DAILY_MAX = 3;
export const LIVE_INVITE_PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Where an invite's bell row and push lead: the stream, marked as opened from an invite, so a stale one (cancelled,
 * expired, answered, the live over) lands on a clear "this invite is no longer available" note instead of an error.
 */
export function liveInviteHref(liveStreamId: string) {
  return `/live/${liveStreamId}?invite=1`;
}

/**
 * The replacement key (web push tag, Android notification tag, APNs collapse id; src/lib/push-replace.ts) of an
 * invite's push, so a later correction ("This invite was cancelled") takes its place on the device. One per stream:
 * every device getting it is the invitee's own. Well under the 64-byte APNs limit for a cuid.
 */
export function liveInvitePushKey(liveStreamId: string) {
  return `live-invite:${liveStreamId}`;
}

/** Why an invite's push is being corrected: the host or a co-host withdrew it, it ran out, or the live ended. */
export type LiveInviteRecallReason = "cancelled" | "expired" | "ended";

/** How many past-due invites one sweep run settles (and corrects pushes for) at most. */
export const LIVE_INVITE_SWEEP_LIMIT = 200;

/** Serializes the count-and-claim of one stream's stage seats (pg_advisory_xact_lock): approvals and accepted invites alike. */
export function liveStageLockKey(liveStreamId: string) {
  return `live-stage:${liveStreamId}`;
}

/** Whether one more person fits on stage. `othersOnStage` leaves out the host and the person asking. */
export function stageSeatDecision(input: { alreadyOnStage: boolean; othersOnStage: number }): "admit" | "full" {
  if (input.alreadyOnStage) return "admit";
  return input.othersOnStage < MAX_LIVE_STAGE ? "admit" : "full";
}

export type LiveInviteStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";

/** An invite's status as everyone should see it: a PENDING row past its TTL, or on a stream that is over, is EXPIRED. */
export function liveInviteStatus(
  invite: { status: LiveInviteStatus; createdAt: Date },
  streamLive: boolean,
  now: Date,
): LiveInviteStatus {
  if (invite.status !== "PENDING") return invite.status;
  if (!streamLive) return "EXPIRED";
  return now.getTime() - invite.createdAt.getTime() >= LIVE_INVITE_TTL_MS ? "EXPIRED" : "PENDING";
}

/** Why an invite can't be answered any more, as the invitee is told when they open it. */
export type LiveInviteGone = "cancelled" | "expired" | "answered" | "ended";

/** The note for a settled invite (`status` from liveInviteStatus, never PENDING): an ended live wins over expiry. */
export function liveInviteGone(status: Exclude<LiveInviteStatus, "PENDING">, streamLive: boolean): LiveInviteGone {
  if (status === "ACCEPTED" || status === "DECLINED") return "answered";
  if (status === "CANCELLED") return "cancelled";
  return streamLive ? "expired" : "ended";
}

/** Rows that are open invites right now (a LiveStreamInvite `where`), for counting and listing. */
export function openInviteWhere(liveStreamId: string, now: Date) {
  return { liveStreamId, status: "PENDING" as const, createdAt: { gt: new Date(now.getTime() - LIVE_INVITE_TTL_MS) } };
}

/**
 * What inviting someone who may already have a row for this stream does. `create`: a new invite. `resend`: reuse the
 * row (a cancelled or expired invite, under LIVE_INVITE_MAX_SENDS). `noop`: nothing to do, answered as success (an
 * invite still open, or one already accepted). `declined` / `too_many`: refused for that person.
 */
export function inviteSendDecision(
  existing: { status: LiveInviteStatus; createdAt: Date; sendCount: number } | null | undefined,
  now: Date,
): "create" | "resend" | "noop" | "declined" | "too_many" {
  if (!existing) return "create";
  const status = liveInviteStatus(existing, true, now);
  if (status === "PENDING" || status === "ACCEPTED") return "noop";
  if (status === "DECLINED") return "declined";
  return existing.sendCount >= LIVE_INVITE_MAX_SENDS ? "too_many" : "resend";
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The invitee ids a request names: strings of the id shape only, trimmed, de-duplicated, never the inviter. Null when
 * the input isn't a list of such ids or names more than LIVE_INVITE_MAX_PER_REQUEST people.
 */
export function parseInviteeIds(raw: unknown, inviterId: string): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") return null;
    const id = value.trim();
    if (!ID_PATTERN.test(id)) return null;
    if (id === inviterId || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids.length > LIVE_INVITE_MAX_PER_REQUEST ? null : ids;
}

/**
 * Who may be invited by `inviterId` (a User `where`), before the stream's own audience rule: an active, verified, named
 * member (never the guest-preview identity), and either an accepted connection of the inviter's or someone who shows
 * up in people search ("Show my profile in Discover" on, not a site admin). So the picker never reaches anyone people
 * search couldn't, apart from the inviter's own connections. `excludedIds` covers blocks either way, the inviter, the
 * host and anyone already on stage or invited.
 */
export function liveInviteeUserWhere(inviterId: string, excludedIds: Iterable<string>) {
  return {
    id: { notIn: [inviterId, ...excludedIds] },
    status: "ACTIVE" as const,
    name: { not: null },
    isGuestPreview: false,
    NOT: UNVERIFIED_ACCOUNT_WHERE,
    OR: [
      { discoverable: true, isAdmin: false },
      { sentConnections: { some: { targetId: inviterId, status: "ACCEPTED" as const } } },
      { receivedConnections: { some: { requesterId: inviterId, status: "ACCEPTED" as const } } },
    ],
  };
}

/** The name/username match for the picker's search box (the query is already normalized, see discover-search.ts). */
export function liveInviteeQueryWhere(query: string) {
  return {
    OR: [
      { name: { contains: query, mode: "insensitive" as const } },
      { username: { contains: query, mode: "insensitive" as const } },
    ],
  };
}

// ---------- Video quality as the stage grows ----------

export type StageQualityTier = "full" | "reduced" | "minimal";

/** Up to this many people on stage (besides the host), everyone sends and receives full quality. */
export const FULL_QUALITY_MAX_ON_STAGE = 4;
/** Up to this many, one step down; past it, the lowest. */
export const REDUCED_QUALITY_MAX_ON_STAGE = 7;

/**
 * The quality for a stage of `onStage` guests and co-hosts (the host not counted): full up to 4, then smaller tiles
 * with lower resolution and bitrate. `sendMaxQuality` is the highest simulcast layer each broadcaster publishes
 * (Daily updateSendSettings `video.maxQuality`: "medium" publishes low and medium only); `receiveLayer` is the
 * simulcast layer every viewer asks for (updateReceiveSettings `base.video.layer`, 0 lowest, 2 highest; mobile senders
 * have only 0-1). Simulcast layers apply in Daily's SFU mode, which a live room with an audience is in.
 */
export function stageQuality(onStage: number): {
  tier: StageQualityTier;
  sendMaxQuality: "high" | "medium" | "low";
  receiveLayer: 0 | 1 | 2;
} {
  if (onStage <= FULL_QUALITY_MAX_ON_STAGE) return { tier: "full", sendMaxQuality: "high", receiveLayer: 2 };
  if (onStage <= REDUCED_QUALITY_MAX_ON_STAGE) return { tier: "reduced", sendMaxQuality: "medium", receiveLayer: 1 };
  return { tier: "minimal", sendMaxQuality: "low", receiveLayer: 0 };
}

/**
 * Grid for `tiles` video tiles (host included, up to MAX_LIVE_STAGE + 1) so every tile fits on one screen without
 * scrolling: columns x rows, chosen for a portrait phone or a landscape screen.
 */
export function stageGrid(tiles: number, landscape: boolean): { columns: number; rows: number } {
  const n = Math.max(1, Math.floor(tiles));
  let columns: number;
  if (landscape) {
    columns = n <= 1 ? 1 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  } else {
    columns = n <= 2 ? 1 : n <= 6 ? 2 : 3;
  }
  return { columns, rows: Math.ceil(n / columns) };
}
