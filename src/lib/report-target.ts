import { prisma } from "@/lib/prisma";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { canSeeCircle } from "@/lib/circle-visibility";
import { loadStandingCircleInvites } from "@/lib/circle-invite-data";
import { canViewCollab } from "@/lib/collab-permissions";
import { loadStandingCollabInvite } from "@/lib/collab-invites-server";
import { giftsEnabledFor } from "@/lib/gifts";

// Who a report is about is always worked out here, on the server, from the reported thing itself: the client only
// says what it reports (type + id), never whom. Before this, every type but MESSAGE took the accused user id from the
// form, so anyone could file a report on someone else's post "against" a third person, and the admin queue (and a
// SUSPEND/BAN, and the trust score) acted on that third person.

export type ReportTargetType = "USER" | "POST" | "MESSAGE" | "CIRCLE" | "COLLAB_POST" | "COMMENT" | "GIFT";

type Reporter = { id: string; isAdmin: boolean };

/**
 * The user a report on (targetType, targetId) is about, read from the target as it is now: the profile itself for
 * USER, the author for POST/COMMENT/COLLAB_POST, the sender for MESSAGE, the creator for CIRCLE. Null when the target
 * no longer exists. No visibility check: for the admin side (resolveReport, the moderation queue).
 */
export async function accusedUserIdOf(targetType: ReportTargetType, targetId: string): Promise<string | null> {
  switch (targetType) {
    case "USER": {
      const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
      return user?.id ?? null;
    }
    case "POST": {
      const post = await prisma.post.findUnique({ where: { id: targetId }, select: { authorId: true } });
      return post?.authorId ?? null;
    }
    case "COMMENT": {
      const comment = await prisma.comment.findUnique({ where: { id: targetId }, select: { authorId: true } });
      return comment?.authorId ?? null;
    }
    case "MESSAGE": {
      const message = await prisma.message.findUnique({ where: { id: targetId }, select: { senderId: true } });
      return message?.senderId ?? null;
    }
    case "CIRCLE": {
      const circle = await prisma.circle.findUnique({ where: { id: targetId }, select: { createdById: true } });
      return circle?.createdById ?? null;
    }
    case "COLLAB_POST": {
      const collab = await prisma.collabBoardPost.findUnique({ where: { id: targetId }, select: { authorId: true } });
      return collab?.authorId ?? null;
    }
    case "GIFT": {
      const send = await prisma.giftSend.findUnique({ where: { id: targetId }, select: { senderId: true } });
      return send?.senderId ?? null;
    }
    default:
      return null;
  }
}

/**
 * For fileReport: the accused user when `reporter` may report this target, else null. A target may be reported only
 * if it exists, the reporter can see it through the same rules the app shows it by, and it isn't the reporter's own
 * (or the reporter themselves). Every refusal is the same null, so a guessed id tells the caller nothing.
 */
export async function reportableTargetAccused(
  targetType: ReportTargetType,
  targetId: string,
  reporter: Reporter,
): Promise<string | null> {
  const accused = await visibleTargetAccused(targetType, targetId, reporter);
  if (!accused || accused === reporter.id) return null;
  return accused;
}

async function visibleTargetAccused(
  targetType: ReportTargetType,
  targetId: string,
  reporter: Reporter,
): Promise<string | null> {
  switch (targetType) {
    case "USER": {
      // The same people /u/[userId] shows: ACTIVE, named, not a site admin, not the guest-preview identity.
      const user = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, status: true, name: true, isAdmin: true, isGuestPreview: true },
      });
      if (!user || user.status !== "ACTIVE" || !user.name || user.isAdmin || user.isGuestPreview) return null;
      return user.id;
    }
    case "POST": {
      const post = await prisma.post.findFirst({
        where: { AND: [{ id: targetId }, await getVisiblePostsWhere(reporter.id)] },
        select: { authorId: true },
      });
      return post?.authorId ?? null;
    }
    case "COMMENT": {
      // A published comment by an active author, on a post the reporter can see (blocks are part of that).
      const comment = await prisma.comment.findFirst({
        where: {
          id: targetId,
          moderationStatus: "PUBLISHED",
          author: { status: "ACTIVE" },
          post: await getVisiblePostsWhere(reporter.id),
        },
        select: { authorId: true },
      });
      return comment?.authorId ?? null;
    }
    case "MESSAGE": {
      // In a conversation the reporter belongs to. The sender is taken from the message itself.
      const message = await prisma.message.findUnique({
        where: { id: targetId },
        select: { senderId: true, conversationId: true },
      });
      if (!message) return null;
      const membership = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId: reporter.id } },
        select: { id: true },
      });
      return membership ? message.senderId : null;
    }
    case "CIRCLE": {
      // A PRIVATE Circle exists only for its members and standing invitees (canSeeCircle).
      const circle = await prisma.circle.findUnique({
        where: { id: targetId },
        select: { id: true, visibility: true, createdById: true },
      });
      if (!circle) return null;
      if (circle.visibility === "PRIVATE") {
        const membership = await prisma.circleMembership.findUnique({
          where: { userId_circleId: { userId: reporter.id, circleId: circle.id } },
          select: { id: true },
        });
        const isMember = Boolean(membership);
        const hasStandingInvite = isMember
          ? false
          : (await loadStandingCircleInvites(reporter.id, [circle])).has(circle.id);
        if (!canSeeCircle(circle, { isMember, hasStandingInvite })) return null;
      }
      return circle.createdById;
    }
    case "COLLAB_POST": {
      const collab = await prisma.collabBoardPost.findUnique({
        where: { id: targetId },
        select: { id: true, authorId: true, visibility: true },
      });
      if (!collab) return null;
      if (collab.visibility === "PRIVATE" && collab.authorId !== reporter.id) {
        const participant = await prisma.collabParticipant.findFirst({
          where: { collabId: collab.id, userId: reporter.id },
          select: { id: true },
        });
        const isParticipant = Boolean(participant);
        const hasInvite = isParticipant ? false : Boolean(await loadStandingCollabInvite(reporter.id, collab));
        if (!canViewCollab(collab, isParticipant, reporter, hasInvite)) return null;
      }
      return collab.authorId;
    }
    case "GIFT": {
      // A gift is reported by the one person who knows who sent it: its recipient, while gifts are on for them and the
      // gift is theirs to see (delivered, opened or hidden by them). The accused is the sender.
      if (!giftsEnabledFor(reporter)) return null;
      const send = await prisma.giftSend.findUnique({
        where: { id: targetId },
        select: { senderId: true, recipientId: true, status: true },
      });
      if (!send || send.recipientId !== reporter.id) return null;
      if (send.status !== "DELIVERED" && send.status !== "OPENED" && send.status !== "HIDDEN_BY_RECIPIENT") return null;
      return send.senderId;
    }
    default:
      return null;
  }
}
