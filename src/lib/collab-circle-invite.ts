/**
 * Inviting whole Circles to a PRIVATE collab (inviteToCollab / createCollabPost in actions/collab.ts). The members of
 * the chosen Circles are copied into ordinary PENDING CollabInvite rows at invite time — there's no live link to the
 * Circle, and each member still has to accept. Pure, so every exclusion and the cap are unit-tested.
 */

/** How many Circles one request may name. */
export const COLLAB_CIRCLE_IDS_MAX = 5;

/** New invites one Circle invite may create. Past it the whole request is refused, never a subset invited. */
export const COLLAB_CIRCLE_INVITE_MAX = 200;

export type CircleInviteSelection =
  | { ok: true; inviteeIds: string[]; skipped: number }
  | { ok: false; error: "too_large"; eligible: number };

export function selectCircleInvitees({
  inviterId,
  members,
  participantIds,
  existingInviteeIds,
  alsoInvitingIds = [],
  blockedIds,
  hiddenPeerIds,
  max = COLLAB_CIRCLE_INVITE_MAX,
}: {
  inviterId: string;
  /** Every membership of every chosen Circle; someone in two of them appears twice. */
  members: { userId: string; status: string }[];
  /** Already in the collab. */
  participantIds: Iterable<string>;
  /**
   * Anyone with a CollabInvite to this collab, whatever its status: PENDING and ACCEPTED are already handled, and a
   * DECLINED one isn't re-sent by a bulk invite (an individual invite can still reset it).
   */
  existingInviteeIds: Iterable<string>;
  /** Invited individually in the same request, so they aren't counted twice. */
  alsoInvitingIds?: Iterable<string>;
  /** Blocked either way with the inviter (getBlockedEitherWayIds). */
  blockedIds: Iterable<string>;
  /** The inviter's hidden-chat peers (getHiddenPeerIds), like every other people list. */
  hiddenPeerIds: Iterable<string>;
  max?: number;
}): CircleInviteSelection {
  const excluded = new Set<string>([
    ...participantIds,
    ...existingInviteeIds,
    ...alsoInvitingIds,
    ...blockedIds,
    ...hiddenPeerIds,
  ]);

  const seen = new Set<string>();
  const inviteeIds: string[] = [];
  let skipped = 0;
  for (const { userId, status } of members) {
    // The inviter is in their own Circle; leaving them out isn't a "skip" worth reporting.
    if (userId === inviterId || seen.has(userId)) continue;
    seen.add(userId);
    if (excluded.has(userId) || status !== "ACTIVE") {
      skipped++;
      continue;
    }
    inviteeIds.push(userId);
  }

  if (inviteeIds.length > max) {
    return { ok: false, error: "too_large", eligible: inviteeIds.length };
  }
  return { ok: true, inviteeIds, skipped };
}

/**
 * Who an admin sees by name in a PRIVATE collab's "Invited" list. Nothing records whether an invite came from a
 * Circle, so the rule is about the viewer instead: an invite is shown when the viewer sent it, it was accepted (the
 * person is a participant, already listed by name), or the viewer is connected to the invitee or shares a Circle
 * with them. Every other invite is only counted — otherwise a co-admin could read the member list of someone else's
 * private Circle off this page.
 */
export function splitVisibleInvites<T extends { inviterId: string; inviteeId: string; status: string }>(
  invites: T[],
  viewerId: string,
  knownIds: ReadonlySet<string>,
): { visible: T[]; hiddenCount: number } {
  const visible: T[] = [];
  let hiddenCount = 0;
  for (const invite of invites) {
    if (invite.inviterId === viewerId || invite.status === "ACCEPTED" || knownIds.has(invite.inviteeId)) {
      visible.push(invite);
    } else {
      hiddenCount++;
    }
  }
  return { visible, hiddenCount };
}
