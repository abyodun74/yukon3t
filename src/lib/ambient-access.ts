import { prisma } from "@/lib/prisma";
import { getHiddenPeerIds } from "@/lib/hidden-chats";

// Who an inner circle actually shows (audit M4, 2026-10-29). An InnerCircleMember row was checked only when it was
// added, so a later block or a dropped connection kept the owner (and the owner's long-lived widget token) receiving
// that person's ambient photos. Every reader of the ambient feed — the in-app preview (getAmbientFeed) and the
// widget route (GET /api/ambient/feed) — goes through this, so the rules are re-checked on every read:
//  - an ACCEPTED connection between owner and member right now,
//  - no block either way,
//  - the member's account is ACTIVE,
//  - not a hidden-chat peer of the owner (lock-screen surface, see CLAUDE.md "Hidden chats").

/** The owner's inner-circle members whose ambient moments may be shown to the owner right now. */
export async function currentInnerCircleMemberIds(ownerId: string): Promise<string[]> {
  const hidden = await getHiddenPeerIds(ownerId);
  const rows = await prisma.innerCircleMember.findMany({
    where: { ownerId, memberId: { notIn: hidden }, member: { status: "ACTIVE" } },
    select: { memberId: true },
  });
  const ids = rows.map((r) => r.memberId);
  if (ids.length === 0) return [];

  const [connections, blocks] = await Promise.all([
    prisma.connection.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: ownerId, targetId: { in: ids } },
          { targetId: ownerId, requesterId: { in: ids } },
        ],
      },
      select: { requesterId: true, targetId: true },
    }),
    prisma.block.findMany({
      where: {
        OR: [
          { blockerId: ownerId, blockedId: { in: ids } },
          { blockedId: ownerId, blockerId: { in: ids } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
  ]);
  const connected = new Set(connections.map((c) => (c.requesterId === ownerId ? c.targetId : c.requesterId)));
  const blocked = new Set(blocks.map((b) => (b.blockerId === ownerId ? b.blockedId : b.blockerId)));
  return ids.filter((id) => connected.has(id) && !blocked.has(id));
}

/** Both directions of inner-circle membership between two people — for blockUser's transaction. */
export function innerCircleRowsBetween(userAId: string, userBId: string) {
  return {
    OR: [
      { ownerId: userAId, memberId: userBId },
      { ownerId: userBId, memberId: userAId },
    ],
  };
}

/** Data for revoking every still-active widget token of a user (password reset/change, ban, suspension). */
export function activeWidgetTokensOf(userId: string) {
  return { where: { userId, revokedAt: null }, data: { revokedAt: new Date() } };
}
