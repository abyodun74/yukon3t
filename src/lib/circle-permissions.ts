import { prisma } from "@/lib/prisma";
import { keepCircleContentViewers } from "@/lib/circle-visibility";

/**
 * Co-admins are CircleMembership rows with role "MODERATOR" — the enum name
 * predates this feature (it was previously unused everywhere except a
 * Daily.co owner-token flag), but "co-admin" is the user-facing label.
 */
export function isCircleAdmin(
  circle: { createdById: string },
  membership: { role: string } | null,
  user: { id: string; isAdmin: boolean },
) {
  return circle.createdById === user.id || membership?.role === "MODERATOR" || user.isAdmin;
}

export function getCircleMembership(circleId: string, userId: string) {
  return prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId, circleId } },
  });
}

/**
 * Of `userIds`, the ones who may still see `circleId`'s content (keepCircleContentViewers): all of them for a PUBLIC
 * Circle, current members only for a PRIVATE one. For fan-outs whose recipients come from RSVPs, bring-list claims or a
 * post's author rather than membership, so nobody who left (or joined while it was public) hears about a private
 * Circle's event.
 */
export async function filterCircleContentViewers(circleId: string, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const circle = await prisma.circle.findUnique({ where: { id: circleId }, select: { visibility: true } });
  if (!circle) return [];
  if (circle.visibility !== "PRIVATE") return [...userIds];
  const members = await prisma.circleMembership.findMany({
    where: { circleId, userId: { in: [...userIds] } },
    select: { userId: true },
  });
  return keepCircleContentViewers(circle, userIds, members.map((m) => m.userId));
}
