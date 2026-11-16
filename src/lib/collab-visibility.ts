import type { Prisma } from "@/generated/prisma/client";

/**
 * Blocks and collabs. Pure (no database), so the rule is unit-tested and every surface shares it; the server half
 * (one Block lookup per collab or per fan-out) is collab-visibility-server.ts.
 *
 * THE RULE: if a viewer and a collab's author are blocked either way (a Block row in either direction), the collab
 * does not exist for that viewer. Its page answers the same notFound() as a collab that was never created; it is left
 * out of the Collab board (public list and "your private collabs") and of search (exact and smart); its polls, its
 * session-participant list and its calendar file answer not found / empty; joining, requesting, accepting or declining
 * an invite, inviting, managing and starting/joining its session answer the generic `not_found` those actions already
 * use for a missing collab; it can't be shared; notifications about it stop showing (read time, nothing deleted); and
 * new fan-outs (poll created, session started, session reminders) skip that person.
 *
 * It applies to existing participants and invitees too (a block is the strongest signal), but nothing is deleted or
 * changed: their participation / invite / join-request rows stay as they are, and everything comes back if the block
 * is lifted. The author can never be blocked with themselves, so they are never affected. Site admins get no
 * shortcut on these member-facing surfaces (same as private Circles); their moderation views are the /admin pages
 * (/admin/circles lists every collab with Delete, /admin/moderation previews reported ones), which this rule doesn't
 * touch. Leaving a collab (leaveCollab) is deliberately still possible.
 */

/** Whether a collab is hidden from `viewerId` because of a block either way with its author. */
export function collabHiddenByBlock(
  collab: { authorId: string },
  viewerId: string,
  blockedEitherWayWithAuthor: boolean,
): boolean {
  return collab.authorId !== viewerId && blockedEitherWayWithAuthor;
}

/** The author relation filter matching an author blocked either way with `viewerId`. */
function authorBlockedWithWhere(viewerId: string): Prisma.UserWhereInput {
  return {
    OR: [{ blocksMade: { some: { blockedId: viewerId } } }, { blocksReceived: { some: { blockerId: viewerId } } }],
  };
}

/**
 * For every query that lists collabs to `viewerId`: drops collabs whose author is blocked either way with them. A
 * relation filter inside the same query (no extra lookup, no N+1). Put it in an `AND: [...]` so it never clashes with
 * the query's own `author` / `NOT` keys.
 */
export function collabNotBlockedWhere(viewerId: string): Prisma.CollabBoardPostWhereInput {
  return { NOT: { author: authorBlockedWithWhere(viewerId) } };
}

/**
 * Notifications that may be shown to (and counted for) `recipientId`: drops every row about a collab whose author is
 * blocked either way with them. Read time only; nothing is deleted, so the rows come back if the block is lifted.
 * Rows with no collab are untouched.
 */
export function collabNotificationVisibleWhere(recipientId: string): Prisma.NotificationWhereInput {
  return { NOT: { collab: { author: authorBlockedWithWhere(recipientId) } } };
}

/**
 * People (a join request's requester, say) not blocked either way with `authorId`: the ones the collab still exists
 * for. Used to keep a blocked person's pending join request out of the organizers' list (the row itself stays).
 */
export function notBlockedWithAuthorUserWhere(authorId: string): Prisma.UserWhereInput {
  return { NOT: authorBlockedWithWhere(authorId) };
}

/** Of `userIds`, the ones who may still see a collab, given everyone blocked either way with its author. */
export function keepCollabViewers(
  collab: { authorId: string },
  userIds: Iterable<string>,
  blockedWithAuthor: ReadonlySet<string>,
): string[] {
  return [...userIds].filter((id) => !collabHiddenByBlock(collab, id, blockedWithAuthor.has(id)));
}
