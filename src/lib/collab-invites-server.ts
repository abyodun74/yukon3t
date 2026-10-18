import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { selectCircleInvitees } from "@/lib/collab-circle-invite";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { getHiddenPeerIds } from "@/lib/hidden-chats";

// The server half of inviting people to a PRIVATE collab, shared by createCollabPost and inviteToCollab
// (actions/collab.ts) and startCollabSession (actions/collab-session.ts). Kept out of those "use server" files on
// purpose: every export of one is a callable Server Action, and these take an already-authorized inviter.

/** Accepted Connections of `userId`, as a flat set of the *other* user's id — same rule used by messages/[id]/page.tsx's group-add candidates and post-visibility.ts. */
export async function getAcceptedConnectionIds(userId: string): Promise<Set<string>> {
  const connections = await prisma.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { targetId: userId }] },
  });
  return new Set(connections.map((c) => (c.requesterId === userId ? c.targetId : c.requesterId)));
}

/**
 * The members of `circleIds` to invite to a PRIVATE collab, with every exclusion and the cap applied by
 * selectCircleInvitees. Owner-only: each Circle must have been created by `inviterId` — deliberately not
 * isCircleAdmin, whose site-admin shortcut would let a site admin invite anyone's Circle, and not its co-admins.
 * Circle members don't have to be the inviter's connections; that rule stays on individual invites.
 */
export async function expandCircleInvites(
  inviterId: string,
  circleIds: string[],
  exclude: { participantIds: string[]; existingInviteeIds: string[]; alsoInvitingIds: string[] },
) {
  const uniqueCircleIds = [...new Set(circleIds)];
  const circles = await prisma.circle.findMany({
    where: { id: { in: uniqueCircleIds }, createdById: inviterId },
    select: { name: true, parent: { select: { name: true } } },
  });
  if (circles.length !== uniqueCircleIds.length) {
    return { error: "forbidden" as const };
  }

  const [members, blockedIds, hiddenPeerIds] = await Promise.all([
    prisma.circleMembership.findMany({
      where: { circleId: { in: uniqueCircleIds } },
      select: { userId: true, user: { select: { status: true } } },
    }),
    getBlockedEitherWayIds(inviterId),
    getHiddenPeerIds(inviterId),
  ]);

  const selection = selectCircleInvitees({
    inviterId,
    members: members.map((m) => ({ userId: m.userId, status: m.user.status })),
    ...exclude,
    blockedIds,
    hiddenPeerIds,
  });
  if (!selection.ok) {
    return { error: selection.error };
  }
  return {
    error: null,
    inviteeIds: selection.inviteeIds,
    skipped: selection.skipped,
    circleNames: circles.map((c) => (c.parent ? `${c.parent.name} › ${c.name}` : c.name)),
  };
}

/**
 * Invites specific people (the inviter's accepted connections) and/or the members of Circles the inviter created
 * to an existing PRIVATE collab. The caller has already checked that `inviterId` may manage the collab, that it's
 * PRIVATE, and the request's shape (collabInviteSchema's limits). Nothing is written unless every check passes, so
 * an error here leaves no invite sent. `invited` and `skipped` count the Circle members only (the success line
 * names the Circles). Notifications are bell-only COLLAB_INVITE.
 */
export async function sendCollabInvites(
  inviterId: string,
  collabId: string,
  request: { inviteeIds: string[]; circleIds: string[] },
) {
  const { circleIds } = request;
  if (circleIds.length > 0 && !(await checkRateLimit("collabCircleInvite", inviterId))) {
    return { error: "rate_limited" as const };
  }

  const [acceptedConnectionIds, existingParticipants, existingInvites] = await Promise.all([
    getAcceptedConnectionIds(inviterId),
    prisma.collabParticipant.findMany({ where: { collabId }, select: { userId: true } }),
    prisma.collabInvite.findMany({ where: { collabId }, select: { id: true, inviteeId: true, status: true } }),
  ]);
  const participantIds = new Set(existingParticipants.map((p) => p.userId));
  const inviteeIds = [...new Set(request.inviteeIds)].filter(
    (id) => acceptedConnectionIds.has(id) && !participantIds.has(id),
  );
  if (inviteeIds.length === 0 && circleIds.length === 0) {
    return { error: "invalid" as const };
  }

  const existingByInvitee = new Map(existingInvites.map((i) => [i.inviteeId, i]));
  // Already-pending or already-accepted invitees are a no-op re-invite —
  // only brand-new invitees and DECLINED ones being re-sent need action.
  const toCreate = inviteeIds.filter((id) => !existingByInvitee.has(id));
  const toReset = inviteeIds.filter((id) => existingByInvitee.get(id)?.status === "DECLINED");

  // Expanded before anything is written, so a too_large refusal leaves the
  // individual invites in the same request unsent too.
  let circleInviteeIds: string[] = [];
  let skipped = 0;
  let circleNames: string[] = [];
  if (circleIds.length > 0) {
    const expanded = await expandCircleInvites(inviterId, circleIds, {
      participantIds: [...participantIds],
      existingInviteeIds: [...existingByInvitee.keys()],
      alsoInvitingIds: inviteeIds,
    });
    if (expanded.error) {
      return { error: expanded.error };
    }
    ({ inviteeIds: circleInviteeIds, skipped, circleNames } = expanded);
  }

  if (toCreate.length === 0 && toReset.length === 0 && circleInviteeIds.length === 0) {
    return { error: null, invited: 0, skipped, circleNames };
  }

  // Bulk Circle invites go through createManyAndReturn so only the rows this
  // request actually created (skipDuplicates drops any a concurrent request
  // got to first) are notified.
  let circleCreatedIds: string[] = [];
  if (circleInviteeIds.length > 0) {
    const created = await prisma.collabInvite.createManyAndReturn({
      data: circleInviteeIds.map((inviteeId) => ({ collabId, inviterId, inviteeId })),
      skipDuplicates: true,
      select: { inviteeId: true },
    });
    circleCreatedIds = created.map((c) => c.inviteeId);
  }
  const notifiedIds = [...toCreate, ...toReset, ...circleCreatedIds];

  await Promise.all(
    toReset.map((inviteeId) =>
      prisma.collabInvite.update({
        where: { id: existingByInvitee.get(inviteeId)!.id },
        data: { status: "PENDING", respondedAt: null },
      }),
    ),
  );
  if (toCreate.length > 0) {
    await prisma.collabInvite.createMany({
      data: toCreate.map((inviteeId) => ({ collabId, inviterId, inviteeId })),
      skipDuplicates: true,
    });
  }
  // Bell-only, no push — same as an individual invite.
  if (notifiedIds.length > 0) {
    await prisma.notification.createMany({
      data: notifiedIds.map((inviteeId) => ({
        recipientId: inviteeId,
        actorId: inviterId,
        type: "COLLAB_INVITE" as const,
        collabId,
      })),
      skipDuplicates: true,
    });
  }

  return { error: null, invited: circleCreatedIds.length, skipped, circleNames };
}
