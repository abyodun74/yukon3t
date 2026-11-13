import { giftsEnabledFor, giftsHref } from "@/lib/gifts";

// Challenges (Gift Universe Phase B, "Challenge foundation"): pure rules, unit-tested (challenges.test.ts) and
// client-safe. The app has NO game, score, ranking, bracket or leaderboard, and this adds none: a challenge is a title
// a host puts up (in a Circle they run, or on their own live stream), people join, and the host DECLARES 1..10 unranked
// winners from the people who joined. Every declaration is on the record (AuditLog), editable by its declarer for 24h,
// then locked; moderators can reverse it from the report queue. Each winner gets the free Arena Champion badge (a
// SYSTEM_AWARD gift, src/lib/challenge-awards.ts) and, for 72h, the CHALLENGE_WIN gift occasion that puts Gaming gifts
// on the picker's "Right now" shelf (src/lib/gift-occasions.ts). The server half is src/lib/challenges-data.ts, the
// actions are src/app/actions/challenges.ts.
//
// Anti-abuse, because a win promotes PAID gifts and fake wins are the risk: a host's account is verified and at least
// 7 days old; create 3 / declare 5 a day per host and join 30 a day per person (fail-closed limiters with the database
// fallback); at most 5 open challenges per host and per Circle / stream; at least 2 participants besides the declarer;
// the declarer can never win; one host can't declare the same person a winner in more than 3 challenges in 7 days; and
// one recipient gets at most one CHALLENGE_WIN occasion per 72h window, however many times they win.

/**
 * THE feature gate: whether challenges exist for this person at all. Every challenge action and every UI entry point
 * (the Circle page's Challenges section, the live room's panel and its winner moment, the moderation queue's preview)
 * goes through this one function, server-side. Phase B: exactly the gifts gate (site admins only), because a win
 * gives a gift and promotes gifts. A later phase changes this body, and nothing else, to open challenges up.
 */
export function challengesEnabledFor(
  user: { isAdmin: boolean; isGuestPreview?: boolean } | null | undefined,
): boolean {
  return giftsEnabledFor(user);
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Longest title (characters as the user sees them), and longest description. */
export const CHALLENGE_TITLE_MAX = 80;
export const CHALLENGE_DESCRIPTION_MAX = 280;
/** At most this many winners, all equal (no first place). */
export const CHALLENGE_WINNERS_MAX = 10;
/** A challenge can be decided only once this many people other than the declarer have joined. */
export const CHALLENGE_MIN_PARTICIPANTS = 2;
/** At most this many people can join one challenge. */
export const CHALLENGE_PARTICIPANTS_MAX = 200;
/** After deciding, the declarer may change the winners or cancel for this long; then the result is locked. */
export const CHALLENGE_EDIT_WINDOW_MS = 24 * HOUR;
/** At most this many OPEN challenges per host, and per Circle / live stream. */
export const CHALLENGE_OPEN_MAX = 5;
/** A host's account must be at least this old. */
export const CHALLENGE_HOST_MIN_ACCOUNT_AGE_MS = 7 * DAY;
/** One declarer can name the same winner in at most this many challenges in CHALLENGE_SAME_WINNER_WINDOW_MS. */
export const CHALLENGE_SAME_WINNER_MAX = 3;
export const CHALLENGE_SAME_WINNER_WINDOW_MS = 7 * DAY;
/** A win is a gift occasion for this long after it was declared (one window per recipient, see challengeWinWindowStart). */
export const CHALLENGE_WIN_OCCASION_WINDOW_MS = 72 * HOUR;
/** Decided and cancelled challenges stay listed this long. */
export const CHALLENGE_RECENT_MS = 7 * DAY;
/** How far back the live room asks for winner moments when told a result changed. */
export const LIVE_CHALLENGE_MOMENT_WINDOW_MS = 30_000;
/** The effect key of a winner moment in the live room's one effect queue (shared with gift effects). */
export const CHALLENGE_WINNER_EFFECT = "challenge-winner";

export type ChallengeStatusValue = "OPEN" | "DECIDED" | "CANCELLED";

/** The trimmed text (inner whitespace runs collapsed), or null when nothing is left. */
export function normalizeChallengeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

const length = (text: string) => [...text].length;

/** Why a title / description can't be used (before moderation), or null. */
export function challengeTextRefusal(
  title: string | null,
  description: string | null,
): "title_required" | "title_too_long" | "description_too_long" | null {
  if (!title) return "title_required";
  if (length(title) > CHALLENGE_TITLE_MAX) return "title_too_long";
  if (description && length(description) > CHALLENGE_DESCRIPTION_MAX) return "description_too_long";
  return null;
}

/** Whether an account is old enough to host or declare (CHALLENGE_HOST_MIN_ACCOUNT_AGE_MS). */
export function hostAccountOldEnough(createdAt: Date | null | undefined, now: Date): boolean {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return false;
  return now.getTime() - createdAt.getTime() >= CHALLENGE_HOST_MIN_ACCOUNT_AGE_MS;
}

/**
 * Whether the person runs this Circle for challenges: its owner (creator) or a co-admin (a MODERATOR / OWNER
 * membership). By membership role only: a site admin gets no shortcut (isCircleAdmin's would open any Circle).
 */
export function runsCircle(input: { userId: string; circleOwnerId: string; role: string | null }): boolean {
  if (input.userId === input.circleOwnerId) return true;
  return input.role === "MODERATOR" || input.role === "OWNER";
}

/**
 * Who may put up a challenge on a live stream: its host, on their own stream, while it is live. (Co-hosts are a
 * presence row the host can hand out and take back at any time, so they join challenges rather than run them.)
 */
export function canHostLiveChallenge(input: { userId: string; streamHostId: string; streamStatus: string }): boolean {
  return input.userId === input.streamHostId && input.streamStatus === "LIVE";
}

export type ChallengeContext =
  | { kind: "CIRCLE"; runsCircle: boolean; isMember: boolean }
  | { kind: "LIVE"; streamHostId: string };

/**
 * Who may declare (or, while it is OPEN, cancel) a challenge: in a Circle, its host while still a member, or anyone
 * who runs the Circle now; on a live stream, its host (who is the stream's host).
 */
export function canRunChallenge(input: { userId: string; hostId: string | null; context: ChallengeContext }): boolean {
  const { userId, hostId, context } = input;
  if (context.kind === "CIRCLE") return context.runsCircle || (hostId === userId && context.isMember);
  return hostId === userId && context.streamHostId === userId;
}

export type DeclareRefusal =
  | "not_open"
  | "invalid_winners"
  | "self_win"
  | "not_participant"
  | "too_few_participants";

/**
 * Why these winners can't be declared, or null: the challenge must be OPEN (or, for an edit, DECIDED: `editing`), the
 * winners 1..CHALLENGE_WINNERS_MAX distinct people who joined, never the declarer, and at least
 * CHALLENGE_MIN_PARTICIPANTS people besides the declarer must have joined.
 */
export function declareRefusal(input: {
  status: ChallengeStatusValue;
  declarerId: string;
  participantIds: readonly string[];
  winnerIds: readonly string[];
  editing?: boolean;
}): DeclareRefusal | null {
  const { status, declarerId, participantIds, winnerIds, editing = false } = input;
  if (status !== (editing ? "DECIDED" : "OPEN")) return "not_open";
  if (winnerIds.length < 1 || winnerIds.length > CHALLENGE_WINNERS_MAX || new Set(winnerIds).size !== winnerIds.length) {
    return "invalid_winners";
  }
  if (winnerIds.includes(declarerId)) return "self_win";
  const joined = new Set(participantIds);
  if (winnerIds.some((id) => !joined.has(id))) return "not_participant";
  if ([...joined].filter((id) => id !== declarerId).length < CHALLENGE_MIN_PARTICIPANTS) return "too_few_participants";
  return null;
}

/** When a decision made at `decidedAt` locks. */
export function editableUntilFor(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + CHALLENGE_EDIT_WINDOW_MS);
}

/** Whether a decided challenge's result can still be changed by its declarer. */
export function withinEditWindow(editableUntil: Date | null | undefined, now: Date): boolean {
  return editableUntil instanceof Date && now.getTime() <= editableUntil.getTime();
}

/** Why the user can't change a decided challenge's winners now, or null. Only its declarer, only within 24h. */
export function editRefusal(input: {
  status: ChallengeStatusValue;
  decidedById: string | null;
  editableUntil: Date | null;
  userId: string;
  now: Date;
}): "not_decided" | "forbidden" | "locked" | null {
  if (input.status !== "DECIDED") return "not_decided";
  if (input.decidedById !== input.userId) return "forbidden";
  if (!withinEditWindow(input.editableUntil, input.now)) return "locked";
  return null;
}

/**
 * Why the user can't cancel, or null. OPEN: whoever may run it (canRunChallenge). DECIDED: its declarer only, within
 * the 24h edit window (after that only moderators, from the report queue). CANCELLED: already.
 */
export function cancelRefusal(input: {
  status: ChallengeStatusValue;
  canRun: boolean;
  decidedById: string | null;
  editableUntil: Date | null;
  userId: string;
  now: Date;
}): "already_cancelled" | "forbidden" | "locked" | null {
  if (input.status === "CANCELLED") return "already_cancelled";
  if (input.status === "OPEN") return input.canRun ? null : "forbidden";
  if (input.decidedById !== input.userId) return "forbidden";
  if (!withinEditWindow(input.editableUntil, input.now)) return "locked";
  return null;
}

/** Why the user can't join, or null. */
export function joinRefusal(input: {
  status: ChallengeStatusValue;
  isHost: boolean;
  alreadyJoined: boolean;
  participantCount: number;
  blocked: boolean;
}): "not_open" | "host" | "already_joined" | "full" | "unavailable" | null {
  if (input.status !== "OPEN") return "not_open";
  if (input.isHost) return "host";
  if (input.blocked) return "unavailable";
  if (input.alreadyJoined) return "already_joined";
  if (input.participantCount >= CHALLENGE_PARTICIPANTS_MAX) return "full";
  return null;
}

/** Why another challenge can't be opened: the host, or the Circle / stream, already has CHALLENGE_OPEN_MAX open. */
export function openLimitRefusal(openByHost: number, openInContext: number): "too_many_open" | null {
  return openByHost >= CHALLENGE_OPEN_MAX || openInContext >= CHALLENGE_OPEN_MAX ? "too_many_open" : null;
}

/**
 * Anti-farming: "farming" when any of `winnerIds` has already been declared a winner by this declarer in
 * CHALLENGE_SAME_WINNER_MAX other decided challenges in the last CHALLENGE_SAME_WINNER_WINDOW_MS. `priorWins` counts,
 * per winner, those other challenges (the caller leaves this challenge out).
 */
export function farmingRefusal(priorWins: ReadonlyMap<string, number>, winnerIds: readonly string[]): "farming" | null {
  return winnerIds.some((id) => (priorWins.get(id) ?? 0) >= CHALLENGE_SAME_WINNER_MAX) ? "farming" : null;
}

/** Who an edit adds and removes. */
export function winnerChanges(current: readonly string[], next: readonly string[]): { added: string[]; removed: string[] } {
  const now = new Set(current);
  const then = new Set(next);
  return { added: next.filter((id) => !now.has(id)), removed: current.filter((id) => !then.has(id)) };
}

/**
 * The start of the recipient's CHALLENGE_WIN occasion window that `now` falls in, or null. One window per 72h per
 * recipient: windows open at a win and last CHALLENGE_WIN_OCCASION_WINDOW_MS; a win inside an open window doesn't start
 * or extend one, so winning again and again never keeps Gaming gifts promoted. Wins are taken oldest first (invalid
 * dates and future ones ignored), so the answer never depends on input order.
 */
export function challengeWinWindowStart(wins: readonly (Date | null | undefined)[], now: Date): Date | null {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const times = wins
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()) && d.getTime() <= now.getTime())
    .map((d) => d.getTime())
    .sort((a, b) => a - b);
  let windowStart: number | null = null;
  for (const t of times) {
    if (windowStart === null || t > windowStart + CHALLENGE_WIN_OCCASION_WINDOW_MS) windowStart = t;
  }
  if (windowStart === null || now.getTime() > windowStart + CHALLENGE_WIN_OCCASION_WINDOW_MS) return null;
  return new Date(windowStart);
}

/**
 * Whether a viewer may know about a challenge (its existence, for the occasion engine and lists): never across a block
 * with its host; a Circle challenge as far as the Circle's content is visible (PUBLIC, or a member: a PRIVATE Circle
 * doesn't exist for anyone else, site admins included); a live challenge as far as the stream is (its host, the one
 * person it was started for, or, without one, everyone for an "Everyone" stream or a PUBLIC Circle's, members for a
 * PRIVATE Circle's). No site-admin shortcut anywhere.
 */
export function canViewerSeeChallenge(input: {
  viewerId: string;
  hostId: string | null;
  blockedWithHost: boolean;
  circle: { visibility: string; viewerIsMember: boolean } | null;
  stream: {
    hostId: string;
    targetUserId: string | null;
    circle: { visibility: string; viewerIsMember: boolean } | null;
  } | null;
}): boolean {
  if (input.blockedWithHost) return false;
  if (input.circle) return input.circle.visibility !== "PRIVATE" || input.circle.viewerIsMember;
  const stream = input.stream;
  if (!stream) return false;
  if (stream.hostId === input.viewerId) return true;
  if (stream.targetUserId) return stream.targetUserId === input.viewerId;
  if (!stream.circle) return true;
  return stream.circle.visibility !== "PRIVATE" || stream.circle.viewerIsMember;
}

/** Where a winner's CHALLENGE_RESULT notice (bell and push) leads: the Circle's Challenges, else their own Gifts area. */
export function challengeResultHref(input: { circleSlug: string | null; recipientId: string }): string {
  return input.circleSlug ? `/circles/${input.circleSlug}#challenges` : giftsHref(input.recipientId);
}

/** The AuditLog reason of a challenge action: ids only (no title, nobody's name). */
export function challengeAuditReason(
  action: "decided" | "edited" | "cancelled",
  challengeId: string,
  winners: readonly string[],
  extra?: { added?: readonly string[]; removed?: readonly string[] },
): string {
  const parts = [`challenge:${challengeId}`, action, `winners:${winners.join(",") || "-"}`];
  if (extra?.added?.length) parts.push(`added:${extra.added.join(",")}`);
  if (extra?.removed?.length) parts.push(`removed:${extra.removed.join(",")}`);
  return parts.join(" ");
}

/** The advisory-lock key that serializes opening challenges for one host (the CHALLENGE_OPEN_MAX count). */
export function challengeOpenLockKey(scope: string): string {
  return `challenge-open:${scope}`;
}

/** The advisory-lock key that serializes everything that changes one challenge's participants or result. */
export function challengeRowLockKey(challengeId: string): string {
  return `challenge:${challengeId}`;
}

/** The advisory-lock key that serializes one declarer's decisions (the same-winner count). */
export function challengeDeclareLockKey(declarerId: string): string {
  return `challenge-declare:${declarerId}`;
}
