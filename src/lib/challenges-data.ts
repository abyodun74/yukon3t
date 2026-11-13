import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { canAccessLiveStream } from "@/lib/live-stream-access";
import {
  CHALLENGE_PARTICIPANTS_MAX,
  CHALLENGE_RECENT_MS,
  CHALLENGE_WINNER_EFFECT,
  LIVE_CHALLENGE_MOMENT_WINDOW_MS,
  canRunChallenge,
  canViewerSeeChallenge,
  hostAccountOldEnough,
  runsCircle,
  withinEditWindow,
  type ChallengeContext,
  type ChallengeStatusValue,
} from "@/lib/challenges";

// The server half of challenges (rules: src/lib/challenges.ts): who may see and run a challenge, the lists the Circle
// page and the live room show, the live room's winner moments, and the facts the gift occasion engine needs. READS
// ONLY: every write is in app/actions/challenges.ts (and the award / revoke helpers it calls), so this file can't
// notify anyone. What goes to a browser is a ChallengeView: names and ids only, never a User row, and nobody blocked
// either way with the viewer is named.

/** A person as a challenge list shows them. */
export type ChallengePerson = { id: string; name: string | null };

export type ChallengeView = {
  id: string;
  title: string;
  description: string | null;
  status: ChallengeStatusValue;
  createdAt: string;
  decidedAt: string | null;
  editableUntil: string | null;
  /** Cancelled by a moderator (a reversal), not by its host. */
  reversed: boolean;
  participantCount: number;
  /** People who joined, minus anyone blocked either way with the viewer (so the count can be higher). */
  participants: ChallengePerson[];
  /** Declared winners (unranked, in the order they were declared); someone blocked with the viewer has no name. */
  winners: ChallengePerson[];
  joined: boolean;
  youWon: boolean;
  /** The viewer started it. */
  isHost: boolean;
  /** May declare winners or cancel it while OPEN (canRunChallenge). */
  canRun: boolean;
  /** Its declarer, within 24h of the decision: may change the winners or cancel. */
  canEdit: boolean;
};

export const challengeAccessSelect = {
  id: true,
  title: true,
  status: true,
  hostId: true,
  circleId: true,
  liveStreamId: true,
  decidedAt: true,
  decidedById: true,
  editableUntil: true,
  circle: { select: { id: true, slug: true, createdById: true, visibility: true } },
  liveStream: { select: { id: true, hostId: true, status: true, circleId: true, targetUserId: true } },
} as const;

export type ChallengeAccess = {
  challenge: {
    id: string;
    title: string;
    status: ChallengeStatusValue;
    hostId: string | null;
    circleId: string | null;
    liveStreamId: string | null;
    decidedAt: Date | null;
    decidedById: string | null;
    editableUntil: Date | null;
    circle: { id: string; slug: string; createdById: string; visibility: string } | null;
    liveStream: { id: string; hostId: string; status: string; circleId: string | null; targetUserId: string | null } | null;
  };
  context: ChallengeContext;
  /** The viewer may see it at all: a Circle challenge to its members only, a live one to whoever may see the stream. */
  canSee: boolean;
  /** canRunChallenge. */
  canRun: boolean;
};

/** Who `user` is to a challenge, or null when there is no such challenge. */
export async function loadChallengeAccess(
  challengeId: string,
  user: { id: string; isAdmin: boolean },
): Promise<ChallengeAccess | null> {
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId }, select: challengeAccessSelect });
  if (!challenge) return null;
  if (challenge.circle) {
    const membership = await prisma.circleMembership.findUnique({
      where: { userId_circleId: { userId: user.id, circleId: challenge.circle.id } },
      select: { role: true },
    });
    const isMember = Boolean(membership);
    const context: ChallengeContext = {
      kind: "CIRCLE",
      isMember,
      runsCircle: isMember && runsCircle({ userId: user.id, circleOwnerId: challenge.circle.createdById, role: membership?.role ?? null }),
    };
    return { challenge, context, canSee: isMember, canRun: canRunChallenge({ userId: user.id, hostId: challenge.hostId, context }) };
  }
  if (challenge.liveStream) {
    const context: ChallengeContext = { kind: "LIVE", streamHostId: challenge.liveStream.hostId };
    const canSee = await canAccessLiveStream(challenge.liveStream, user);
    return { challenge, context, canSee, canRun: canSee && canRunChallenge({ userId: user.id, hostId: challenge.hostId, context }) };
  }
  return null;
}

const personSelect = { select: { id: true, name: true } } as const;

const listSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  createdAt: true,
  decidedAt: true,
  decidedById: true,
  editableUntil: true,
  cancelledByAdmin: true,
  hostId: true,
  _count: { select: { participants: true } },
  participants: { orderBy: { joinedAt: "asc" as const }, take: CHALLENGE_PARTICIPANTS_MAX, select: { user: personSelect } },
  winners: { orderBy: { createdAt: "asc" as const }, select: { user: personSelect } },
} as const;

type ListRow = {
  id: string;
  title: string;
  description: string | null;
  status: ChallengeStatusValue;
  createdAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
  editableUntil: Date | null;
  cancelledByAdmin: boolean;
  hostId: string | null;
  _count: { participants: number };
  participants: { user: ChallengePerson }[];
  winners: { user: ChallengePerson }[];
};

/** Open challenges, and ones decided or cancelled in the last CHALLENGE_RECENT_MS. */
function recentWhere(now: Date) {
  const since = new Date(now.getTime() - CHALLENGE_RECENT_MS);
  return { OR: [{ status: "OPEN" as const }, { decidedAt: { gte: since } }, { cancelledAt: { gte: since } }] };
}

/** Never a challenge whose host is blocked either way with the viewer (one whose host's account is gone is fine). */
function notBlockedHostWhere(blocked: Set<string>) {
  return blocked.size === 0 ? {} : { OR: [{ hostId: null }, { hostId: { notIn: [...blocked] } }] };
}

function toView(row: ListRow, viewerId: string, blocked: Set<string>, context: ChallengeContext, now: Date): ChallengeView {
  const named = (user: ChallengePerson): ChallengePerson => (blocked.has(user.id) ? { id: user.id, name: null } : user);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    editableUntil: row.editableUntil?.toISOString() ?? null,
    reversed: row.cancelledByAdmin,
    participantCount: row._count.participants,
    participants: row.participants.map((p) => p.user).filter((u) => !blocked.has(u.id)),
    winners: row.winners.map((w) => named(w.user)),
    joined: row.participants.some((p) => p.user.id === viewerId),
    youWon: row.status === "DECIDED" && row.winners.some((w) => w.user.id === viewerId),
    isHost: row.hostId === viewerId,
    canRun: row.status === "OPEN" && canRunChallenge({ userId: viewerId, hostId: row.hostId, context }),
    canEdit: row.status === "DECIDED" && row.decidedById === viewerId && withinEditWindow(row.editableUntil, now),
  };
}

const LIST_MAX = 20;

/**
 * A Circle's challenges for one of its members (the caller has checked membership): open ones and recently decided or
 * cancelled ones, newest first, and whether the viewer may start one (runs the Circle, account old enough).
 */
export async function listCircleChallengeViews(
  circle: { id: string; createdById: string },
  viewer: { id: string; createdAt: Date },
  role: string | null,
  now = new Date(),
): Promise<{ challenges: ChallengeView[]; canCreate: boolean }> {
  const blocked = await getBlockedEitherWayIds(viewer.id);
  const context: ChallengeContext = {
    kind: "CIRCLE",
    isMember: true,
    runsCircle: runsCircle({ userId: viewer.id, circleOwnerId: circle.createdById, role }),
  };
  const rows = await prisma.challenge.findMany({
    where: { AND: [{ circleId: circle.id }, recentWhere(now), notBlockedHostWhere(blocked)] },
    orderBy: { createdAt: "desc" },
    take: LIST_MAX,
    select: listSelect,
  });
  return {
    challenges: rows.map((row) => toView(row as ListRow, viewer.id, blocked, context, now)),
    canCreate: context.runsCircle && hostAccountOldEnough(viewer.createdAt, now),
  };
}

/** A live stream's challenges for someone who may see the stream (the caller has checked). */
export async function listLiveChallengeViews(
  stream: { id: string; hostId: string; status: string },
  viewer: { id: string; createdAt: Date },
  now = new Date(),
): Promise<{ challenges: ChallengeView[]; canCreate: boolean }> {
  const blocked = await getBlockedEitherWayIds(viewer.id);
  const context: ChallengeContext = { kind: "LIVE", streamHostId: stream.hostId };
  const rows = await prisma.challenge.findMany({
    where: { AND: [{ liveStreamId: stream.id }, recentWhere(now), notBlockedHostWhere(blocked)] },
    orderBy: { createdAt: "desc" },
    take: LIST_MAX,
    select: listSelect,
  });
  return {
    challenges: rows.map((row) => toView(row as ListRow, viewer.id, blocked, context, now)),
    canCreate: stream.hostId === viewer.id && stream.status === "LIVE" && hostAccountOldEnough(viewer.createdAt, now),
  };
}

export type LiveChallengeMoment = {
  /** Unique per decision (challenge id + decision time), so the effect queue plays it once. */
  id: string;
  effect: typeof CHALLENGE_WINNER_EFFECT;
  title: string;
  winnerCount: number;
  youWon: boolean;
};

/**
 * The winner moments a live room should play: this stream's challenges decided in the last
 * LIVE_CHALLENGE_MOMENT_WINDOW_MS (never one whose host is blocked either way with the viewer). A title and a count;
 * nobody else's name.
 */
export async function loadLiveChallengeMoments(
  liveStreamId: string,
  viewerId: string,
  now = new Date(),
): Promise<LiveChallengeMoment[]> {
  const blocked = await getBlockedEitherWayIds(viewerId);
  const rows = await prisma.challenge.findMany({
    where: {
      AND: [
        { liveStreamId, status: "DECIDED", decidedAt: { gte: new Date(now.getTime() - LIVE_CHALLENGE_MOMENT_WINDOW_MS) } },
        notBlockedHostWhere(blocked),
      ],
    },
    orderBy: { decidedAt: "asc" },
    take: 5,
    select: { id: true, title: true, decidedAt: true, winners: { select: { userId: true } } },
  });
  return rows.map((row) => ({
    id: `${row.id}:${row.decidedAt?.getTime() ?? 0}`,
    effect: CHALLENGE_WINNER_EFFECT,
    title: row.title,
    winnerCount: row.winners.length,
    youWon: row.winners.some((w) => w.userId === viewerId),
  }));
}

/** At most this many recent wins are looked at for one recipient. */
const MAX_WINS = 20;

/**
 * For the gift occasion engine (CHALLENGE_WIN): when each challenge `recipientId` currently wins was decided, in the
 * last CHALLENGE_RECENT_MS, for the challenges `viewerId` may see (canViewerSeeChallenge). Only DECIDED challenges
 * count (a cancelled or reversed one doesn't), and only current winner rows (someone taken off isn't a winner). Times
 * only: nothing about which challenge, where, or who declared it leaves this function.
 */
export async function loadVisibleChallengeWins(recipientId: string, viewerId: string, now = new Date()): Promise<Date[]> {
  const viewerMember = { where: { userId: viewerId }, select: { id: true }, take: 1 } as const;
  const rows = await prisma.challengeWinner.findMany({
    where: {
      userId: recipientId,
      challenge: { status: "DECIDED", decidedAt: { gte: new Date(now.getTime() - CHALLENGE_RECENT_MS), lte: now } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_WINS,
    select: {
      challenge: {
        select: {
          decidedAt: true,
          hostId: true,
          circle: { select: { visibility: true, members: viewerMember } },
          liveStream: {
            select: {
              hostId: true,
              targetUserId: true,
              circle: { select: { visibility: true, members: viewerMember } },
            },
          },
        },
      },
    },
  });
  if (rows.length === 0) return [];
  const blocked = await getBlockedEitherWayIds(viewerId);
  const out: Date[] = [];
  for (const { challenge } of rows) {
    if (!challenge.decidedAt) continue;
    const circleView = (c: { visibility: string; members: { id: string }[] } | null) =>
      c ? { visibility: c.visibility, viewerIsMember: c.members.length > 0 } : null;
    const visible = canViewerSeeChallenge({
      viewerId,
      hostId: challenge.hostId,
      blockedWithHost: challenge.hostId !== null && blocked.has(challenge.hostId),
      circle: circleView(challenge.circle),
      stream: challenge.liveStream
        ? {
            hostId: challenge.liveStream.hostId,
            targetUserId: challenge.liveStream.targetUserId,
            circle: circleView(challenge.liveStream.circle),
          }
        : null,
    });
    if (visible) out.push(challenge.decidedAt);
  }
  return out;
}
