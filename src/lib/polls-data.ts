import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isCircleAdmin } from "@/lib/circle-permissions";
import { canSeeCircleContent } from "@/lib/circle-visibility";
import { isCollabAdmin } from "@/lib/collab-permissions";
import {
  POLLS_PAGE_SIZE,
  POLLS_REFRESH_MAX,
  canCreatePoll,
  canManagePoll,
  canSchedulePoll,
  isPollOpen,
  isUpcomingSession,
  leadingOptionIds,
  pollCursorWhere,
  votePercent,
  type PollCursor,
  type PollKindValue,
} from "@/lib/polls";

/**
 * The server half of polls: who may see, vote in, create and manage a Circle's or collab's polls, and the poll list
 * as the browser gets it (PollView: counts only, never who voted). The rules themselves are in the pure lib/polls.ts.
 */

type Viewer = { id: string; isAdmin: boolean };

export type PollParentAccess = {
  /** May see the parent's polls (results included). */
  canView: boolean;
  /** A member / participant: may vote, and is "still a member" for canManagePoll. */
  isMember: boolean;
  /** isCircleAdmin / isCollabAdmin: manage any poll there, schedule from any. */
  isParentAdmin: boolean;
  canCreate: boolean;
};

/**
 * A Circle's (or one of its channels') polls. Seen by whoever can see the Circle's posts: anyone for a PUBLIC Circle,
 * members only for a PRIVATE one (no site-admin shortcut: the Circle doesn't exist for a non-member); a PRIVATE channel's polls only by those who can open that channel (its
 * allow-list, or a Circle admin), same as canAccessChannel. Voting needs membership, and channel access for a channel
 * poll.
 */
export async function getCirclePollAccess(
  circle: { id: string; createdById: string; visibility: string },
  channel: { id: string; visibility: string } | null,
  viewer: Viewer,
): Promise<PollParentAccess> {
  const membership = await prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId: viewer.id, circleId: circle.id } },
    select: { role: true },
  });
  // A PRIVATE Circle doesn't exist for a non-member (lib/circle-visibility.ts), site admins included: no access at all.
  if (!canSeeCircleContent(circle, !!membership)) {
    return { canView: false, isMember: false, isParentAdmin: false, canCreate: false };
  }
  const isParentAdmin = isCircleAdmin(circle, membership, viewer);
  let channelOk = true;
  if (channel && channel.visibility !== "PUBLIC" && !isParentAdmin) {
    channelOk =
      !!membership &&
      !!(await prisma.channelMembership.findUnique({
        where: { channelId_userId: { channelId: channel.id, userId: viewer.id } },
        select: { id: true },
      }));
  }
  const isMember = !!membership && channelOk;
  return {
    canView: channelOk,
    isMember,
    isParentAdmin,
    canCreate: channelOk && canCreatePoll(membership?.role ?? null, circle.createdById === viewer.id),
  };
}

/**
 * A collab's polls: seen by anyone who can see a PUBLIC collab, and only by participants (and admins) of a PRIVATE one
 * (not by someone merely holding an invite). Voting needs to be a participant.
 */
export async function getCollabPollAccess(
  collab: { id: string; authorId: string; visibility: string },
  viewer: Viewer,
): Promise<PollParentAccess> {
  const participant = await prisma.collabParticipant.findUnique({
    where: { userId_collabId: { userId: viewer.id, collabId: collab.id } },
    select: { role: true },
  });
  const isParentAdmin = isCollabAdmin(collab, participant, viewer);
  return {
    canView: collab.visibility === "PUBLIC" || !!participant || isParentAdmin,
    isMember: !!participant,
    isParentAdmin,
    canCreate: canCreatePoll(participant?.role ?? null, collab.authorId === viewer.id),
  };
}

/** The parent of an existing poll, and the viewer's access to it. Null if the poll doesn't exist. */
export async function loadPollWithAccess(pollId: string, viewer: Viewer) {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      kind: true,
      status: true,
      closesAt: true,
      allowMultiple: true,
      createdById: true,
      circleId: true,
      channelId: true,
      collabId: true,
      question: true,
      description: true,
      scheduledAt: true,
      circle: { select: { id: true, slug: true, createdById: true, visibility: true } },
      channel: { select: { id: true, visibility: true } },
      collab: { select: { id: true, authorId: true, visibility: true, status: true, title: true } },
    },
  });
  if (!poll) return null;
  let access: PollParentAccess;
  if (poll.circle) {
    access = await getCirclePollAccess(poll.circle, poll.channel, viewer);
  } else if (poll.collab) {
    access = await getCollabPollAccess(poll.collab, viewer);
  } else {
    return null;
  }
  return { poll, access };
}

export type PollOptionView = {
  id: string;
  text: string | null;
  /** ISO instant, SCHEDULE polls only. */
  startsAt: string | null;
  count: number;
  percent: number;
};

/** One poll as the browser gets it. Counts only: nothing here says who voted for what, except the viewer's own picks. */
export type PollView = {
  id: string;
  kind: PollKindValue;
  question: string;
  description: string | null;
  allowMultiple: boolean;
  /** Effective: a poll past closesAt is CLOSED here. */
  open: boolean;
  closesAt: string | null;
  createdAt: string;
  creatorName: string | null;
  channelName: string | null;
  options: PollOptionView[];
  voterCount: number;
  myOptionIds: string[];
  leadingOptionIds: string[];
  scheduledAt: string | null;
  scheduledOptionId: string | null;
  scheduledPostId: string | null;
  /** The collab one-off session scheduled from this poll, while it's still ahead (its .ics is /api/collab/<id>/calendar?session=<this>). */
  scheduledSessionId: string | null;
  canVote: boolean;
  canManage: boolean;
  canSchedule: boolean;
};

/**
 * The polls matching `where` (newest first, then id; at most `take`) with their counts, as `viewer` sees them.
 * `access` is the viewer's access to the parent (one parent per call, or a function for per-poll access, e.g. channel
 * polls in a Circle). The caller has already decided the viewer may see these.
 */
export async function loadPollViews(
  where: Prisma.PollWhereInput,
  viewer: Viewer,
  access: PollParentAccess | ((poll: { channelId: string | null }) => PollParentAccess),
  take: number = POLLS_PAGE_SIZE,
): Promise<PollView[]> {
  const polls = await prisma.poll.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      kind: true,
      question: true,
      description: true,
      allowMultiple: true,
      status: true,
      closesAt: true,
      createdAt: true,
      createdById: true,
      channelId: true,
      scheduledAt: true,
      scheduledOptionId: true,
      scheduledPostId: true,
      oneOffSession: { select: { id: true, startsAt: true } },
      createdBy: { select: { name: true } },
      channel: { select: { name: true } },
      options: { orderBy: { position: "asc" }, select: { id: true, text: true, startsAt: true } },
    },
  });
  if (polls.length === 0) return [];
  const ids = polls.map((p) => p.id);

  const [optionCounts, voterCounts, mine] = await Promise.all([
    prisma.pollVote.groupBy({ by: ["optionId"], where: { pollId: { in: ids } }, _count: { _all: true } }),
    prisma.$queryRaw<{ pollId: string; voters: bigint }[]>`
      SELECT "pollId", COUNT(DISTINCT "userId") AS voters
      FROM "PollVote"
      WHERE "pollId" IN (${Prisma.join(ids)})
      GROUP BY "pollId"`,
    prisma.pollVote.findMany({ where: { pollId: { in: ids }, userId: viewer.id }, select: { pollId: true, optionId: true } }),
  ]);
  const countByOption = new Map(optionCounts.map((row) => [row.optionId, row._count._all]));
  const votersByPoll = new Map(voterCounts.map((row) => [row.pollId, Number(row.voters)]));
  const now = new Date();

  return polls.map((poll) => {
    const parent = typeof access === "function" ? access(poll) : access;
    const open = isPollOpen(poll, now);
    const voterCount = votersByPoll.get(poll.id) ?? 0;
    const options = poll.options.map((option) => {
      const count = countByOption.get(option.id) ?? 0;
      return {
        id: option.id,
        text: option.text,
        startsAt: option.startsAt?.toISOString() ?? null,
        count,
        percent: votePercent(count, voterCount),
      };
    });
    const isPollCreator = poll.createdById === viewer.id;
    const roles = { isPollCreator, isMember: parent.isMember, isParentAdmin: parent.isParentAdmin };
    return {
      id: poll.id,
      kind: poll.kind,
      question: poll.question,
      description: poll.description,
      allowMultiple: poll.allowMultiple,
      open,
      closesAt: poll.closesAt?.toISOString() ?? null,
      createdAt: poll.createdAt.toISOString(),
      creatorName: poll.createdBy.name,
      channelName: poll.channel?.name ?? null,
      options,
      voterCount,
      myOptionIds: mine.filter((v) => v.pollId === poll.id).map((v) => v.optionId),
      leadingOptionIds: leadingOptionIds(options),
      scheduledAt: poll.scheduledAt?.toISOString() ?? null,
      scheduledOptionId: poll.scheduledOptionId,
      scheduledPostId: poll.scheduledPostId,
      scheduledSessionId:
        poll.oneOffSession && isUpcomingSession(poll.oneOffSession.startsAt, now) ? poll.oneOffSession.id : null,
      canVote: parent.isMember && open,
      canManage: canManagePoll(roles),
      canSchedule: poll.kind === "SCHEDULE" && !poll.scheduledAt && canSchedulePoll({ ...roles, open }),
    };
  });
}

/** One poll's view (after a vote), or null if it no longer exists. */
export async function loadPollView(pollId: string, viewer: Viewer, access: PollParentAccess) {
  const [view] = await loadPollViews({ id: pollId }, viewer, access);
  return view ?? null;
}

/**
 * One page of a parent's polls. No cursor: the first page. "older": the page after `cursor` ("Load more"). "through":
 * everything from the newest down to `cursor` (a live refresh of what the viewer already has), at most
 * POLLS_REFRESH_MAX. `hasMore`: whether anything older than the last poll returned exists.
 */
export async function loadPollPage(
  where: Prisma.PollWhereInput,
  viewer: Viewer,
  access: PollParentAccess,
  cursor: PollCursor | null = null,
  mode: "older" | "through" = "older",
): Promise<{ polls: PollView[]; hasMore: boolean }> {
  const limit = cursor && mode === "through" ? POLLS_REFRESH_MAX : POLLS_PAGE_SIZE;
  const pageWhere: Prisma.PollWhereInput = cursor ? { AND: [where, pollCursorWhere(cursor, mode)] } : where;
  const views = await loadPollViews(pageWhere, viewer, access, limit + 1);
  if (views.length > limit) return { polls: views.slice(0, limit), hasMore: true };
  if (!cursor || mode === "older") return { polls: views, hasMore: false };
  // A refresh that fit: is there anything past the cursor (the part of the list not loaded yet)?
  const older = await prisma.poll.findFirst({
    where: { AND: [where, pollCursorWhere(cursor, "older")] },
    select: { id: true },
  });
  return { polls: views, hasMore: !!older };
}

/** Which of a Circle's polls a viewer sees: Circle-wide ones and those in the channels they can open. */
export function circlePollWhere(circleId: string, accessibleChannelIds: readonly string[]): Prisma.PollWhereInput {
  return { circleId, OR: [{ channelId: null }, { channelId: { in: [...accessibleChannelIds] } }] };
}

/**
 * The viewer's access to a Circle's poll list and the condition selecting the polls they see, or null when they may not
 * see the list at all. The same rules as the Circle page: a PRIVATE Circle's polls are for members only, and
 * a PRIVATE channel's for its allow-list and the Circle's admins.
 */
export async function circlePollScope(circleId: string, viewer: Viewer) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, createdById: true, visibility: true },
  });
  if (!circle) return null;
  const access = await getCirclePollAccess(circle, null, viewer);
  if (!access.canView) return null;
  const channels = await prisma.channel.findMany({
    where: {
      circleId,
      ...(access.isParentAdmin
        ? {}
        : { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: viewer.id } } }] }),
    },
    select: { id: true },
  });
  return { access, where: circlePollWhere(circleId, channels.map((c) => c.id)) };
}

/** The same for a collab: anyone who can see a PUBLIC collab, a PRIVATE one's participants (and admins). */
export async function collabPollScope(collabId: string, viewer: Viewer) {
  const collab = await prisma.collabBoardPost.findUnique({
    where: { id: collabId },
    select: { id: true, authorId: true, visibility: true },
  });
  if (!collab) return null;
  const access = await getCollabPollAccess(collab, viewer);
  if (!access.canView) return null;
  return { access, where: { collabId } satisfies Prisma.PollWhereInput };
}
