import { prisma } from "@/lib/prisma";
import { isCircleAdmin } from "@/lib/circle-permissions";

/**
 * Access rule used everywhere a Channel is read or posted into: must be a
 * Circle member, and the channel must either be PUBLIC, or the caller has an
 * explicit ChannelMembership row (private-channel allow-list), or the caller
 * is the Circle's owner/co-admin (moderation override, same pattern as
 * isCircleAdmin's other overrides).
 */
export async function canAccessChannel(
  channel: { id: string; circleId: string; visibility: string },
  circle: { createdById: string },
  user: { id: string; isAdmin: boolean },
) {
  const circleMembership = await prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId: user.id, circleId: channel.circleId } },
  });
  if (!circleMembership) return false;
  if (channel.visibility === "PUBLIC") return true;
  if (isCircleAdmin(circle, circleMembership, user)) return true;

  const channelMembership = await prisma.channelMembership.findUnique({
    where: { channelId_userId: { channelId: channel.id, userId: user.id } },
  });
  return Boolean(channelMembership);
}
