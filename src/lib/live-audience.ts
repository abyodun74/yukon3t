// The "Only the people I selected" live audience (LiveStream.selectedOnly). Pure and client-safe: the Go live sheet
// (live-stream-strip.tsx), canAccessLiveStream, the Home strip query and the invite server half all read these.
// Tests: live-audience.test.ts.
//
// Who may see and join a selectedOnly stream: its host, anyone with a LiveStreamInvite row for it that is not
// CANCELLED (the invite table is the allow-list: picked in the Go live sheet, or invited later by the host or a
// co-host), and anyone on its stage (a GUEST or COHOST LiveStreamViewer row, kept until they leave). Nobody else, in any
// list or by id; a block either way with the host shuts them out too. Declining or letting a stage invite run out only
// answers the stage question: the person keeps watching access. Cancelling an invite they never accepted removes it.

import { LIVE_INVITE_MAX_PER_REQUEST, type LiveInviteStatus } from "@/lib/live-stage";

/**
 * Most people one selectedOnly stream's allow-list can hold (invite rows not CANCELLED), counting the up to
 * LIVE_INVITE_MAX_PER_REQUEST picked at the start and everyone invited mid-stream. Past it, a new invite is refused
 * as `limit`. Well under the viewer cap (MAX_LIVE_VIEWERS, 100), so everyone allowed can actually get in.
 */
export const LIVE_SELECTED_AUDIENCE_MAX = 50;

/** The Go live sheet's "Who can watch" value for this audience (the others: "" Everyone, "circle:<id>", "user:<id>"). */
export const SELECTED_AUDIENCE_VALUE = "selected";

/**
 * The Go live sheet's audience after the picked people change. Picking the first person switches Everyone to "Only the
 * people I selected" automatically, unless the host deliberately chose Everyone while people were picked
 * (`keepEveryone`); clearing everyone goes back to Everyone. A Circle or one person is never changed here.
 */
export function audienceForInvitees(input: { audience: string; count: number; keepEveryone: boolean }): string {
  if (input.count === 0) return input.audience === SELECTED_AUDIENCE_VALUE ? "" : input.audience;
  if (input.audience === "" && !input.keepEveryone) return SELECTED_AUDIENCE_VALUE;
  return input.audience;
}

/** Whether an invite row (or none) lets its invitee watch a selectedOnly stream, together with any stage role. */
export function isSelectedViewer(input: { inviteStatus: LiveInviteStatus | null; stageRole: string | null }): boolean {
  if (input.stageRole === "GUEST" || input.stageRole === "COHOST") return true;
  return input.inviteStatus !== null && input.inviteStatus !== "CANCELLED";
}

/** Whether inviting someone with this existing row (or none) adds a person to the allow-list (counts toward the cap). */
export function addsToSelectedAudience(existingStatus: LiveInviteStatus | null | undefined): boolean {
  return !existingStatus || existingStatus === "CANCELLED";
}

/** The allow-list rows of a stream (a LiveStreamInvite `where`), for counting against LIVE_SELECTED_AUDIENCE_MAX. */
export function selectedAudienceInviteWhere(liveStreamId: string) {
  return { liveStreamId, status: { not: "CANCELLED" as const } };
}

/**
 * Home's "Live now" list for `userId` (a LiveStream `where`): LIVE streams whose room is attached, either for
 * Everyone or a PUBLIC Circle (never selectedOnly, never one specific person, never a PRIVATE Circle), or selectedOnly
 * ones they host or are on the allow-list of, whose host isn't blocked either way with them (`blockedIds`).
 */
export function activeLiveStreamsWhere(userId: string, blockedIds: Iterable<string>) {
  return {
    status: "LIVE" as const,
    // A start still attaching its room isn't listed until it can be joined.
    roomName: { not: "" },
    targetUserId: null,
    OR: [
      { selectedOnly: false, OR: [{ circleId: null }, { circle: { visibility: "PUBLIC" as const } }] },
      { selectedOnly: true, circleId: null, hostId: userId },
      {
        selectedOnly: true,
        circleId: null,
        hostId: { notIn: [...blockedIds] },
        ...selectedViewerStreamWhere(userId),
      },
    ],
  };
}

/**
 * The selectedOnly streams `userId` may see (a LiveStream `where` fragment, combined with `selectedOnly: true` by the
 * caller): an invite row not CANCELLED, or a stage seat. Same rule as isSelectedViewer, as a query.
 */
export function selectedViewerStreamWhere(userId: string) {
  return {
    OR: [
      { stageInvites: { some: { inviteeId: userId, status: { not: "CANCELLED" as const } } } },
      { viewers: { some: { userId, role: { in: ["GUEST" as const, "COHOST" as const] } } } },
    ],
  };
}

/** What a person shut out of a selectedOnly stream is told when they open it from a stale invite. */
export type SelectedInviteGone = "cancelled" | "expired" | "ended";

/**
 * Whether someone refused by canAccessLiveStream on a selectedOnly stream gets the friendly "this invite is no longer
 * available" note instead of a 404: only if they HAD an invite row for it (any status) and no block stands between them
 * and the host or the inviter. The note says only why (the live ended, the invite was cancelled or ran out): never the
 * title, the host or anything else about the stream. Everyone else gets the normal 404.
 */
export function selectedInviteGoneNotice(input: {
  selectedOnly: boolean;
  inviteStatus: LiveInviteStatus | null;
  streamLive: boolean;
  blocked: boolean;
}): SelectedInviteGone | null {
  if (!input.selectedOnly || input.inviteStatus === null || input.blocked) return null;
  if (!input.streamLive) return "ended";
  return input.inviteStatus === "CANCELLED" ? "cancelled" : "expired";
}

/** How many picked people couldn't be invited, from the room's `?notInvited=` (the Go live sheet's redirect). */
export function parseNotInvited(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= LIVE_INVITE_MAX_PER_REQUEST ? n : 0;
}