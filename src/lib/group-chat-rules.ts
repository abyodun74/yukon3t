/**
 * Group chat membership rules (pure; the server half is in actions/messages.ts). Shared by the non-member view of a
 * group (/messages/[id]), requestToJoinGroup, respondToJoinRequest, createGroupChat and addGroupMembers so the page
 * and the actions can't drift apart.
 */

/**
 * Whether a non-member may see a group's join screen and ask to join. Only a discoverable group can be joined by
 * request (creating one without "discoverable" is described as an invite-only group), and never by someone blocked
 * either way with anyone in it. Every refusal looks the same as a group that doesn't exist.
 */
export function groupJoinRequestRefusal(input: {
  isGroup: boolean;
  discoverable: boolean;
  isMember: boolean;
  blockedWithAMember: boolean;
}): "not_found" | "already_member" | null {
  if (!input.isGroup) return "not_found";
  if (input.isMember) return "already_member";
  if (!input.discoverable || input.blockedWithAMember) return "not_found";
  return null;
}

/** A join request can be answered only while it is still PENDING. */
export function canAnswerJoinRequest(status: string): boolean {
  return status === "PENDING";
}

/**
 * Whether people may be put into a group (approving a request, creating a group, adding members): every one of them
 * is an ACTIVE account, and nobody among them is blocked either way with anyone already in the group or with another
 * of them. The caller loads `activeCount` (how many of `newIds` are ACTIVE) and `blockBetween` (any block row between
 * a new person and anyone in the group after the change).
 */
export function groupMembersEligible(input: { newIds: readonly string[]; activeCount: number; blockBetween: boolean }) {
  return input.newIds.length > 0 && input.activeCount === new Set(input.newIds).size && !input.blockBetween;
}

/** The Block filter for groupMembersEligible: a row between a new person and anyone in the group afterwards. */
export function blockBetweenWhere(newIds: readonly string[], everyoneAfter: readonly string[]) {
  return {
    OR: [
      { blockerId: { in: [...newIds] }, blockedId: { in: [...everyoneAfter] } },
      { blockerId: { in: [...everyoneAfter] }, blockedId: { in: [...newIds] } },
    ],
  };
}

/** The AuditLog reason for a site admin deleting someone else's group (deleteGroupChat). */
export function adminGroupDeleteReason(group: { id: string; name: string | null; memberCount: number }) {
  return `Group chat "${group.name ?? "(unnamed)"}" (${group.id}, ${group.memberCount} members) deleted by a site admin`;
}
