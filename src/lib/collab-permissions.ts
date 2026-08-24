import { prisma } from "@/lib/prisma";

/**
 * Co-admins are CollabParticipant rows with role "MODERATOR" — same shape as
 * isCircleAdmin, so a Collab's author gets the same co-admin delegation
 * powers a Circle owner already has.
 */
export function isCollabAdmin(
  collab: { authorId: string },
  membership: { role: string } | null,
  user: { id: string; isAdmin: boolean },
) {
  return collab.authorId === user.id || membership?.role === "MODERATOR" || user.isAdmin;
}

export function getCollabMembership(collabId: string, userId: string) {
  return prisma.collabParticipant.findUnique({
    where: { userId_collabId: { userId, collabId } },
  });
}

/**
 * PUBLIC collabs are visible to anyone. PRIVATE collabs are visible only to
 * the organizer, an existing participant, someone with a pending invite (so
 * they can actually reach the accept/decline banner), or a site admin —
 * everyone else gets a 404 from the detail page, and they're excluded from
 * /collab and search entirely (see collab/page.tsx, search/page.tsx,
 * search-embeddings.ts).
 */
export function canViewCollab(
  collab: { authorId: string; visibility: string },
  isParticipant: boolean,
  user: { id: string; isAdmin: boolean },
  hasPendingInvite: boolean,
) {
  return (
    collab.visibility === "PUBLIC" ||
    collab.authorId === user.id ||
    isParticipant ||
    hasPendingInvite ||
    user.isAdmin
  );
}
