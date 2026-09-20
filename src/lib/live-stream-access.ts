import { getCircleMembership } from "@/lib/circle-permissions";

/**
 * Who may see or take part in a live stream. A stream started for "Everyone"
 * (no circleId) is open to any signed-in user. A stream started for a specific
 * Circle or sub-circle is for THAT Circle's members only — not the host's
 * followers, not a Home feed, not anyone who merely has the stream's id (from
 * a notification, a shared link, or a guess). The host and site admins (who
 * moderate) are always allowed.
 *
 * Every read/write path for a stream — its page, joining, the comment feed,
 * recordings, viewer counts — must go through this one rule, so they can't
 * drift apart the way per-action checks did before (comments and recordings
 * had no check at all).
 */
export async function canAccessLiveStream(
  liveStream: { circleId: string | null; hostId: string },
  user: { id: string; isAdmin: boolean },
): Promise<boolean> {
  if (!liveStream.circleId) return true;
  if (liveStream.hostId === user.id || user.isAdmin) return true;
  return Boolean(await getCircleMembership(liveStream.circleId, user.id));
}
