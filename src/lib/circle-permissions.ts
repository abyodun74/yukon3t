import { prisma } from "@/lib/prisma";

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
