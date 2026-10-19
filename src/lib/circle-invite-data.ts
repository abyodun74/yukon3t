import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import {
  inviteStillStands,
  isStaleCircleInvite,
  type CircleInviteExclusions,
} from "@/lib/circle-invite";

// Server half of lib/circle-invite.ts: loads what its pure rules need. Shared by inviteToCircle and the Circle page's
// invite picker, so the two always agree on who can be invited.

/**
 * The inviter fields inviteStillStands needs (an InviterStanding), with memberships of `circleIds` only. Server-side
 * input to the rule; strip it before anything reaches a browser.
 */
export function inviterStandingSelect(circleIds: string[]) {
  return {
    select: {
      id: true,
      status: true,
      circleMemberships: { where: { circleId: { in: circleIds } }, select: { circleId: true, role: true } },
    },
  } as const;
}

/**
 * Every invite to `circle` for its Invited list (admins only), oldest first, each PENDING one marked `stale` when it
 * can no longer be accepted (isStaleCircleInvite). Only the invitee's display fields leave; the inviter's are dropped.
 */
export async function loadCircleInvitesForAdmins(circle: { id: string; createdById: string }) {
  const invites = await prisma.circleInvite.findMany({
    where: { circleId: circle.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      inviteeId: true,
      invitee: { select: { id: true, name: true, username: true, avatarUrl: true } },
      inviter: inviterStandingSelect([circle.id]),
    },
  });
  return invites.map(({ inviter, ...invite }) => ({
    ...invite,
    stale: isStaleCircleInvite(circle, { status: invite.status, inviter }),
  }));
}

/** The other side of each of `userId`'s accepted Connections, with the name the picker shows. */
export async function getAcceptedConnectionUsers(userId: string) {
  const connections = await prisma.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { targetId: userId }] },
    select: {
      requesterId: true,
      requester: { select: { id: true, name: true } },
      target: { select: { id: true, name: true } },
    },
  });
  return connections.map((c) => (c.requesterId === userId ? c.target : c.requester));
}

/**
 * `inviteeId`'s PENDING invites to any of `circles` that still stand (canInviterStillInvite), keyed by circle id, in
 * one query. An invite whose inviter has since lost the right to invite is left out, so neither the accept banner nor
 * an "Accept invite" button offers it (accepting it would fail and delete it).
 */
export async function loadStandingCircleInvites(
  inviteeId: string,
  circles: { id: string; createdById: string }[],
): Promise<Map<string, { id: string; inviterName: string | null }>> {
  if (circles.length === 0) return new Map();
  const circleIds = circles.map((c) => c.id);
  const invites = await prisma.circleInvite.findMany({
    where: { inviteeId, status: "PENDING", circleId: { in: circleIds } },
    select: {
      id: true,
      circleId: true,
      inviter: {
        select: { ...inviterStandingSelect(circleIds).select, name: true },
      },
    },
  });
  const circleById = new Map(circles.map((c) => [c.id, c]));
  const out = new Map<string, { id: string; inviterName: string | null }>();
  for (const invite of invites) {
    const circle = circleById.get(invite.circleId);
    if (circle && inviteStillStands(circle, invite.inviter)) {
      out.set(invite.circleId, { id: invite.id, inviterName: invite.inviter.name });
    }
  }
  return out;
}

/**
 * Everything eligibleCircleInvitees checks, for `candidateIds` only. Blocks count with the inviter and with the
 * Circle's owner, so a co-admin can't bring in someone the owner blocked (or who blocked the owner).
 */
export async function loadCircleInviteExclusions(
  circle: { id: string; createdById: string },
  inviterId: string,
  candidateIds: string[],
  connectionIds?: Iterable<string>,
): Promise<CircleInviteExclusions> {
  const [connections, members, inviterBlocked, ownerBlocked, hiddenPeerIds, users] = await Promise.all([
    connectionIds
      ? Promise.resolve([...connectionIds])
      : getAcceptedConnectionUsers(inviterId).then((users) => users.map((u) => u.id)),
    prisma.circleMembership.findMany({
      where: { circleId: circle.id, userId: { in: candidateIds } },
      select: { userId: true },
    }),
    getBlockedEitherWayIds(inviterId),
    circle.createdById === inviterId ? Promise.resolve(new Set<string>()) : getBlockedEitherWayIds(circle.createdById),
    getHiddenPeerIds(inviterId),
    prisma.user.findMany({ where: { id: { in: candidateIds } }, select: { id: true, status: true } }),
  ]);
  return {
    inviterId,
    connectionIds: connections,
    memberIds: members.map((m) => m.userId),
    blockedIds: [...inviterBlocked, ...ownerBlocked],
    hiddenPeerIds,
    statusById: new Map(users.map((u) => [u.id, u.status])),
  };
}
