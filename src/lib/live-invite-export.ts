import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { capList, namedPerson } from "@/lib/gift-export";
import { liveInviteStatus } from "@/lib/live-stage";
import type { HiddenState } from "@/lib/hidden-chats-rules";

// The "Live stage invites" part of "Export my data" (exportMyData, src/app/actions/profile.ts): invites to join a live
// stream's stage that the requester sent (as host or co-host) and received. Same conventions as the gifts part
// (src/lib/gift-export.ts): exact selects, never a User row; the other person is named only by display name and
// username, and only while they are ACTIVE and not blocked either way / a hidden-chat peer ("not_shown" otherwise);
// an invite to or from a hidden peer is left out unless the PIN unlock is live (the caller passes an empty
// HiddenState then). The stream is referenced by its id and start time only, never its title or audience.

/** Most recent rows per list; a longer history is cut with `truncated: true`. */
export const LIVE_INVITE_EXPORT_LIMIT = 500;

const inviteSelect = {
  liveStreamId: true,
  status: true,
  sendCount: true,
  createdAt: true,
  respondedAt: true,
  liveStream: { select: { startedAt: true, status: true } },
} as const;
const personSelect = { select: { id: true, name: true, username: true, status: true } } as const;

export async function loadLiveInviteExport(userId: string, hidden: HiddenState) {
  const blocked = await getBlockedEitherWayIds(userId);
  const withheld = new Set<string>([...blocked, ...hidden.peerIds]);
  const now = new Date();
  const take = LIVE_INVITE_EXPORT_LIMIT + 1;

  const [sentRows, receivedRows] = await Promise.all([
    prisma.liveStreamInvite.findMany({
      where: { invitedById: userId, ...(hidden.peerIds.length > 0 ? { inviteeId: { notIn: hidden.peerIds } } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      select: { ...inviteSelect, invitee: personSelect },
    }),
    prisma.liveStreamInvite.findMany({
      where: { inviteeId: userId, ...(hidden.peerIds.length > 0 ? { invitedById: { notIn: hidden.peerIds } } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      select: { ...inviteSelect, invitedBy: personSelect },
    }),
  ]);

  const common = (row: (typeof sentRows)[number] | (typeof receivedRows)[number]) => ({
    liveStream: { id: row.liveStreamId, startedAt: row.liveStream.startedAt },
    // As the app reads it: an unanswered invite past its time, or on a live that ended, is EXPIRED.
    status: liveInviteStatus(row, row.liveStream.status === "LIVE", now),
    timesSent: row.sendCount,
    sentAt: row.createdAt,
    answeredAt: row.respondedAt,
  });

  return {
    sent: capList(
      sentRows.map((row) => ({ ...common(row), invited: namedPerson(row.invitee, withheld) })),
      LIVE_INVITE_EXPORT_LIMIT,
    ),
    received: capList(
      receivedRows.map((row) => ({ ...common(row), invitedBy: namedPerson(row.invitedBy, withheld) })),
      LIVE_INVITE_EXPORT_LIMIT,
    ),
  };
}
