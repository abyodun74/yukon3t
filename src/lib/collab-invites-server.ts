import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { selectCircleInvitees } from "@/lib/collab-circle-invite";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import {
  collabInviteExcludesInvitee,
  collabInviteStillStands,
  isStaleCollabInvite,
  planCollabInvites,
} from "@/lib/collab-invite";

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
 * The inviter fields collabInviteStillStands needs (a CollabInviterStanding), with their participation in `collabId`
 * only. Server-side input to the rule; strip it before anything reaches a browser.
 */
function collabInviterStandingSelect(collabId: string) {
  return {
    select: {
      id: true,
      status: true,
      collabParticipations: { where: { collabId }, select: { collabId: true, role: true } },
    },
  } as const;
}

/**
 * Every invite to `collab` for its Invited list (admins only), oldest first, each PENDING one marked `stale` when it
 * can no longer be accepted (isStaleCollabInvite). The inviter's standing fields are dropped; only `inviterId` (for
 * splitVisibleInvites, server-side) and the invitee's display fields remain.
 */
export async function loadCollabInvitesForAdmins(collab: { id: string; authorId: string }) {
  const invites = await prisma.collabInvite.findMany({
    where: { collabId: collab.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      inviterId: true,
      inviteeId: true,
      invitee: { select: { id: true, name: true, username: true, avatarUrl: true } },
      inviter: collabInviterStandingSelect(collab.id),
    },
  });
  return invites.map(({ inviter, ...invite }) => ({
    ...invite,
    stale: isStaleCollabInvite(collab, { status: invite.status, inviter }),
  }));
}

/**
 * `inviteeId`'s PENDING invite to `collab` if it still stands (collabInviteStillStands), else null. A stale one is
 * never shown to the invitee (accepting it would fail and delete it), and doesn't let them view the collab.
 */
export async function loadStandingCollabInvite(inviteeId: string, collab: { id: string; authorId: string }) {
  const invite = await prisma.collabInvite.findFirst({
    where: { collabId: collab.id, inviteeId, status: "PENDING" },
    select: {
      id: true,
      inviter: { select: { ...collabInviterStandingSelect(collab.id).select, name: true } },
    },
  });
  if (!invite || !collabInviteStillStands(collab, invite.inviter)) return null;
  return { id: invite.id, inviterName: invite.inviter.name };
}

/**
 * Invites specific people (the inviter's accepted connections) and/or the members of Circles the inviter created
 * to an existing PRIVATE collab. The caller has already checked that `inviterId` may invite (canInviteToCollab), that
 * it's PRIVATE, and the request's shape (collabInviteSchema's limits). Nothing is written unless every check passes,
 * so an error here leaves no invite sent. `invited` and `skipped` count the Circle members only (the success line
 * names the Circles). Notifications are bell-only COLLAB_INVITE.
 *
 * Re-inviting (planCollabInvites): a DECLINED invite (individual invites only) or a stale PENDING one (individual or
 * Circle) is reset to PENDING from this inviter and notified again; a standing PENDING or an ACCEPTED one is left alone.
 */
export async function sendCollabInvites(
  inviterId: string,
  collab: { id: string; authorId: string },
  request: { inviteeIds: string[]; circleIds: string[] },
) {
  const collabId = collab.id;
  const { circleIds } = request;
  if (circleIds.length > 0 && !(await checkRateLimit("collabCircleInvite", inviterId))) {
    return { error: "rate_limited" as const };
  }

  const [acceptedConnectionIds, existingParticipants, existingRows] = await Promise.all([
    getAcceptedConnectionIds(inviterId),
    prisma.collabParticipant.findMany({ where: { collabId }, select: { userId: true } }),
    prisma.collabInvite.findMany({
      where: { collabId },
      select: {
        id: true,
        inviteeId: true,
        status: true,
        inviterId: true,
        inviter: collabInviterStandingSelect(collabId),
      },
    }),
  ]);
  const participantIds = new Set(existingParticipants.map((p) => p.userId));
  const inviteeIds = [...new Set(request.inviteeIds)].filter(
    (id) => acceptedConnectionIds.has(id) && !participantIds.has(id),
  );
  if (inviteeIds.length === 0 && circleIds.length === 0) {
    return { error: "invalid" as const };
  }

  const existingInvites = existingRows.map(({ inviter, ...invite }) => ({
    ...invite,
    stale: isStaleCollabInvite(collab, { status: invite.status, inviter }),
  }));

  // Expanded before anything is written, so a too_large refusal leaves the
  // individual invites in the same request unsent too. A stale PENDING invite
  // doesn't exclude its invitee: the Circle invite re-sends it (and counts it
  // against the cap like a new one).
  let circleInviteeIds: string[] = [];
  let skipped = 0;
  let circleNames: string[] = [];
  if (circleIds.length > 0) {
    const expanded = await expandCircleInvites(inviterId, circleIds, {
      participantIds: [...participantIds],
      existingInviteeIds: existingInvites.filter(collabInviteExcludesInvitee).map((i) => i.inviteeId),
      alsoInvitingIds: inviteeIds,
    });
    if (expanded.error) {
      return { error: expanded.error };
    }
    ({ inviteeIds: circleInviteeIds, skipped, circleNames } = expanded);
  }

  const plan = planCollabInvites({
    individualIds: inviteeIds,
    circleIds: circleInviteeIds,
    existing: new Map(existingInvites.map((i) => [i.inviteeId, i])),
  });
  if (plan.create.length === 0 && plan.circleCreate.length === 0 && plan.reset.length === 0) {
    return { error: null, invited: 0, skipped, circleNames };
  }

  // Only rows this request actually created or re-opened are notified:
  // skipDuplicates drops any a concurrent request got to first, and each
  // reset is guarded on the status and inviter it was read with, so two
  // admins re-sending the same invite at once reset and notify it only once.
  const toCreate = [...plan.create, ...plan.circleCreate];
  const createdIds =
    toCreate.length > 0
      ? (
          await prisma.collabInvite.createManyAndReturn({
            data: toCreate.map((inviteeId) => ({ collabId, inviterId, inviteeId })),
            skipDuplicates: true,
            select: { inviteeId: true },
          })
        ).map((c) => c.inviteeId)
      : [];
  const now = new Date();
  const resetDone = (
    await Promise.all(
      plan.reset.map(async (r) => {
        const { count } = await prisma.collabInvite.updateMany({
          where: { id: r.inviteId, status: r.status as "PENDING" | "DECLINED", inviterId: r.inviterId },
          // Whoever asks again becomes the inviter the invitee sees, and the one whose standing the invite rests on.
          data: { status: "PENDING", inviterId, createdAt: now, respondedAt: null },
        });
        return count > 0 ? r : null;
      }),
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);
  const notifiedIds = [...createdIds, ...resetDone.map((r) => r.inviteeId)];

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

  const circleCreated = new Set(plan.circleCreate);
  const invited =
    createdIds.filter((id) => circleCreated.has(id)).length + resetDone.filter((r) => r.fromCircle).length;
  return { error: null, invited, skipped, circleNames };
}
