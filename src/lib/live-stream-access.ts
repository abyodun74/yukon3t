import { prisma } from "@/lib/prisma";
import { getCircleMembership } from "@/lib/circle-permissions";
import { isBlockedWithAny } from "@/lib/blocks";
import { isSelectedViewer, selectedInviteGoneNotice, type SelectedInviteGone } from "@/lib/live-audience";

/** The LiveStream fields canAccessLiveStream reads: select exactly these (or the whole row) before calling it. */
export const LIVE_STREAM_ACCESS_SELECT = {
  id: true,
  hostId: true,
  circleId: true,
  targetUserId: true,
  selectedOnly: true,
} as const;

/**
 * Who may see or take part in a live stream. A stream started for "Everyone"
 * (no circleId, no targetUserId, not selectedOnly) or for a PUBLIC Circle is
 * open to any signed-in user — the Home "Live now" strip lists both. A stream
 * started for a PRIVATE Circle or sub-circle is for THAT Circle's members
 * only. A stream started for one specific person (targetUserId) is for that
 * person only — not even their other connections. A stream for "Only the
 * people I selected" (selectedOnly) is for the people on its allow-list
 * (src/lib/live-audience.ts: an invite not CANCELLED, or a stage seat), and
 * never across a block with the host. None of these are for anyone else —
 * not the host's followers, not a Home feed, not anyone who merely has the
 * stream's id (from a notification, a shared link, or a guess). The host and
 * site admins (who moderate) are always allowed.
 *
 * Every read/write path for a stream — its page, joining, the comment feed,
 * recordings, viewer counts — must go through this one rule, so they can't
 * drift apart the way per-action checks did before (comments and recordings
 * had no check at all).
 */
export async function canAccessLiveStream(
  liveStream: { id: string; circleId: string | null; targetUserId: string | null; hostId: string; selectedOnly: boolean },
  user: { id: string; isAdmin: boolean },
): Promise<boolean> {
  if (liveStream.hostId === user.id || user.isAdmin) return true;
  if (liveStream.selectedOnly) return isOnSelectedAudience(liveStream, user.id);
  if (liveStream.targetUserId) return user.id === liveStream.targetUserId;
  if (!liveStream.circleId) return true;
  const circle = await prisma.circle.findUnique({ where: { id: liveStream.circleId }, select: { visibility: true } });
  if (!circle) return false;
  if (circle.visibility === "PUBLIC") return true;
  return Boolean(await getCircleMembership(liveStream.circleId, user.id));
}

/** The allow-list check of a selectedOnly stream for one person (the host is handled by the caller). */
async function isOnSelectedAudience(liveStream: { id: string; hostId: string }, userId: string): Promise<boolean> {
  const [invite, seat] = await Promise.all([
    prisma.liveStreamInvite.findUnique({
      where: { liveStreamId_inviteeId: { liveStreamId: liveStream.id, inviteeId: userId } },
      select: { status: true },
    }),
    prisma.liveStreamViewer.findUnique({
      where: { liveStreamId_userId: { liveStreamId: liveStream.id, userId } },
      select: { role: true },
    }),
  ]);
  if (!isSelectedViewer({ inviteStatus: invite?.status ?? null, stageRole: seat?.role ?? null })) return false;
  return !(await isBlockedWithAny(userId, [liveStream.hostId]));
}

/**
 * For someone canAccessLiveStream just refused: the friendly note for a stale invite on a selectedOnly stream
 * (selectedInviteGoneNotice), or null for the normal 404. Reads only their own invite row's status and inviter, and
 * the blocks between them and the host or inviter.
 */
export async function selectedInviteGoneFor(
  liveStream: { id: string; hostId: string; selectedOnly: boolean; status: string },
  userId: string,
): Promise<SelectedInviteGone | null> {
  if (!liveStream.selectedOnly) return null;
  const invite = await prisma.liveStreamInvite.findUnique({
    where: { liveStreamId_inviteeId: { liveStreamId: liveStream.id, inviteeId: userId } },
    select: { status: true, invitedById: true },
  });
  if (!invite) return null;
  const blocked = await isBlockedWithAny(userId, [liveStream.hostId, invite.invitedById]);
  return selectedInviteGoneNotice({
    selectedOnly: true,
    inviteStatus: invite.status,
    streamLive: liveStream.status === "LIVE",
    blocked,
  });
}