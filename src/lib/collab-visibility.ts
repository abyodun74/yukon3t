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
 * touch. leaveCollab is deliberately not gated server-side, but a blocked viewer has no UI entry point to it (the
 * collab page 404s for them).
 *
 * THE COLLAB'S GROUP CHAT (CollabBoardPost.conversationId, an ordinary group Conversation) follows the same rule: for
 * a viewer blocked either way with the collab's author it does not exist either. The decision is
 * collabChatHiddenWhere below (a relation filter on Conversation); every list adds collabChatVisibleWhere in the same
 * query, every one-chat read asks collabChatHiddenFor and every fan-out goes through collabChatRecipientsOnly (both in
 * collab-chat-visibility-server.ts, built on this fragment). Their ConversationMember rows are never touched.
 * leaveGroup, like leaveCollab, is not gated server-side, but has no UI entry point for them (the thread page 404s). src/lib/collab-chat-visibility-exposure.test.ts
 * checks it from the source.
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
  return {
    AND: [
      { NOT: { collab: { author: authorBlockedWithWhere(recipientId) } } },
      // Rows tied to the collab's group chat (MESSAGE, GROUP_ADDED, SCREENSHOT_TAKEN, written before the block or by a
      // fan-out that couldn't tell) go the same way; rows with no conversation are untouched.
      { NOT: { conversation: collabChatHiddenWhere(recipientId) } },
    ],
  };
}

/**
 * THE decision for a collab's group chat: matches a Conversation that is a collab's group chat whose author is
 * blocked either way with `viewerId`. Never the author's own collab (a block with yourself can't exist, and the
 * authorId test says so anyway), never a chat that belongs to no collab (the relation is null), never a block between
 * two participants (only the author's blocks count). One relation filter, answered inside the query that uses it from
 * the unique index on CollabBoardPost.conversationId and the Block indexes: no extra query, no N+1.
 */
export function collabChatHiddenWhere(viewerId: string): Prisma.ConversationWhereInput {
  return { collabBoardPost: { is: { authorId: { not: viewerId }, author: authorBlockedWithWhere(viewerId) } } };
}

/**
 * For every query that lists conversations to `viewerId` (inbox, hidden list, share/forward pickers, group search):
 * drops a collab chat hidden from them by a block with its author. Spread it into the conversation `where` (its only
 * key is `NOT`), or put it inside `AND: [...]` when the query has its own `NOT`.
 */
export function collabChatVisibleWhere(viewerId: string): Prisma.ConversationWhereInput {
  return { NOT: collabChatHiddenWhere(viewerId) };
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
