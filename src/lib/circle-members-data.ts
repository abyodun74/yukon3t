import { prisma } from "@/lib/prisma";
import {
  CIRCLE_MEMBER_ORDER,
  CIRCLE_MEMBERS_PAGE_SIZE,
  circleMemberPageWhere,
  splitCircleMemberPage,
  type CircleMemberCursor,
  type CircleMemberPage,
  type CircleMemberView,
} from "@/lib/circle-members";

/**
 * One page of a Circle's members (see lib/circle-members.ts). Callers decide who may see the list: the Circle page
 * (members and the owner of a Circle whose content they can see) and loadCircleMembers, which applies that same rule.
 * Selects only the user fields the lists render, never a whole User row.
 *
 * `channelId` (a channel of this Circle; the caller has checked the viewer is a Circle admin) adds `hasChannelAccess`
 * for exactly the members on this page, so a private channel's access picker no longer needs the channel's whole
 * member list.
 */
export async function loadCircleMemberPage(
  circleId: string,
  cursor: CircleMemberCursor | null,
  channelId: string | null = null,
  pageSize: number = CIRCLE_MEMBERS_PAGE_SIZE,
): Promise<CircleMemberPage> {
  const rows = await prisma.circleMembership.findMany({
    where: circleMemberPageWhere(circleId, cursor),
    orderBy: CIRCLE_MEMBER_ORDER,
    take: pageSize + 1,
    select: {
      id: true,
      joinedAt: true,
      role: true,
      user: { select: { id: true, name: true, username: true, avatarUrl: true } },
    },
  });
  const page = splitCircleMemberPage(
    rows.map(
      (r): CircleMemberView => ({
        membershipId: r.id,
        joinedAt: r.joinedAt.toISOString(),
        role: r.role,
        user: r.user,
      }),
    ),
    pageSize,
  );
  if (!channelId || page.members.length === 0) return page;

  const onChannel = await prisma.channelMembership.findMany({
    where: { channelId, userId: { in: page.members.map((m) => m.user.id) } },
    select: { userId: true },
  });
  const onChannelIds = new Set(onChannel.map((m) => m.userId));
  return {
    ...page,
    members: page.members.map((m) => ({ ...m, hasChannelAccess: onChannelIds.has(m.user.id) })),
  };
}
