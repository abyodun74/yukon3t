/**
 * The rule Circle invites (circle-invite.ts) and Collab invites (collab-invite.ts) share: who may invite, and whether
 * an invite still stands. Each caller names its own owner id and the membership roles that may invite. Pure.
 */

/** Whether `userId` may invite: the owner (`ownerId`), or holding one of `inviterRoles` there. No site-admin shortcut. */
export function holdsInviteRight(
  ownerId: string,
  userId: string,
  role: string | null | undefined,
  inviterRoles: readonly string[],
) {
  return ownerId === userId || (role != null && inviterRoles.includes(role));
}

/**
 * Whether a PENDING invite still stands: its inviter must still hold the right to invite (holdsInviteRight, with the
 * inviter's current role there; demoted, left or removed means no) and their account must still be ACTIVE.
 */
export function inviterStillQualifies(
  ownerId: string,
  inviter: { id: string; status: string } | null | undefined,
  inviterRole: string | null | undefined,
  inviterRoles: readonly string[],
) {
  if (!inviter || inviter.status !== "ACTIVE") return false;
  return holdsInviteRight(ownerId, inviter.id, inviterRole, inviterRoles);
}

/**
 * The guarded claim that answers a PENDING invite (accept, decline, or deleting a stale one): it only matches while the
 * row is still PENDING, still the invitee's, and still from the inviter the caller judged. A re-sent invite (same row,
 * new inviter), a cancel or an earlier answer in between makes it match nothing, and a 0 count means "already handled":
 * the caller returns its not-found error and does nothing else.
 */
export function pendingInviteClaimWhere(invite: { id: string; inviteeId: string; inviterId: string }) {
  return { id: invite.id, inviteeId: invite.inviteeId, status: "PENDING" as const, inviterId: invite.inviterId };
}
