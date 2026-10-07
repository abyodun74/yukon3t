import { prisma } from "@/lib/prisma";
import { getCircleMembership } from "@/lib/circle-permissions";

/**
 * Who may see or take part in a live stream. A stream started for "Everyone"
 * (no circleId, no targetUserId) or for a PUBLIC Circle is open to any
 * signed-in user — the Home "Live now" strip lists both. A stream started
 * for a PRIVATE Circle or sub-circle is for THAT Circle's members only. A
 * stream started for one specific person (targetUserId) is for that person
 * only — not even their other connections. None of these are for anyone
 * else — not the host's followers, not a Home feed, not anyone who merely
 * has the stream's id (from a notification, a shared link, or a guess). The
 * host and site admins (who moderate) are always allowed.
 *
 * Every read/write path for a stream — its page, joining, the comment feed,
 * recordings, viewer counts — must go through this one rule, so they can't
 * drift apart the way per-action checks did before (comments and recordings
 * had no check at all).
 */
export async function canAccessLiveStream(
  liveStream: { circleId: string | null; targetUserId: string | null; hostId: string },
  user: { id: string; isAdmin: boolean },
): Promise<boolean> {
  if (liveStream.hostId === user.id || user.isAdmin) return true;
  if (liveStream.targetUserId) return user.id === liveStream.targetUserId;
  if (!liveStream.circleId) return true;
  const circle = await prisma.circle.findUnique({ where: { id: liveStream.circleId }, select: { visibility: true } });
  if (!circle) return false;
  if (circle.visibility === "PUBLIC") return true;
  return Boolean(await getCircleMembership(liveStream.circleId, user.id));
}
