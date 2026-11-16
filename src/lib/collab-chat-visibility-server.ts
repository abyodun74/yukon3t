import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { collabChatHiddenWhere } from "@/lib/collab-visibility";
import { collabViewersOnly } from "@/lib/collab-visibility-server";

// The server half of the collab group-chat rule (read the header of lib/collab-visibility.ts): a collab's group chat
// does not exist for someone blocked either way with the collab's author. Every one-chat read for a viewer (the
// thread page, every message action that takes a conversation or message id) asks collabChatHiddenFor; lists add
// collabChatVisibleWhere to their own query; raw-SQL counts add collabChatHiddenSql; fan-outs about a chat (new
// message, screenshot notice) go through collabChatRecipientsOnly. src/lib/collab-chat-visibility-exposure.test.ts
// checks it. All of it is read time: no ConversationMember row is ever changed, so lifting the block brings it all back.

/**
 * Of `conversationIds`, the ones that are a collab's group chat hidden from `viewerId` by a block with its author.
 * ONE query whatever the number of ids (and none for an empty list): the ids plus collabChatHiddenWhere, answered from
 * the primary key, the unique index on CollabBoardPost.conversationId and the Block indexes.
 */
export async function collabChatsHiddenFor(viewerId: string, conversationIds: Iterable<string>): Promise<Set<string>> {
  const ids = [...new Set(conversationIds)].filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return new Set();
  const rows = await prisma.conversation.findMany({
    where: { id: { in: ids }, ...collabChatHiddenWhere(viewerId) },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * Whether this conversation must not exist for `viewerId`: a collab's group chat whose author is blocked either way
 * with them. Callers answer exactly what they answer a non-member (or `not_found` where there is no membership step).
 * False for any chat that belongs to no collab, for the author, and for a block between two participants.
 */
export async function collabChatHiddenFor(viewerId: string, conversationId: string): Promise<boolean> {
  return (await collabChatsHiddenFor(viewerId, [conversationId])).has(conversationId);
}

/**
 * Of `userIds`, the ones a fan-out about this chat may reach: everyone, unless the chat is a collab's group chat, in
 * which case not those blocked either way with its author (collabViewersOnly). One query to find the collab (primary
 * key + the unique conversationId index), plus collabViewersOnly's one Block query only when it is a collab chat.
 */
export async function collabChatRecipientsOnly(conversationId: string, userIds: Iterable<string>): Promise<string[]> {
  const ids = [...userIds];
  if (ids.length === 0) return [];
  const chat = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { collabBoardPost: { select: { authorId: true } } },
  });
  const collab = chat?.collabBoardPost;
  if (!collab) return ids;
  return collabViewersOnly(collab, ids);
}

/**
 * collabChatHiddenWhere for raw SQL (the Messages badge count): true when the conversation in `conversationIdColumn`
 * is a collab's group chat whose author is blocked either way with `viewerId`. Wrap it in NOT (...).
 */
export function collabChatHiddenSql(viewerId: string, conversationIdColumn: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
        SELECT 1
        FROM "CollabBoardPost" cb
        WHERE cb."conversationId" = ${conversationIdColumn}
          AND cb."authorId" <> ${viewerId}
          AND EXISTS (
            SELECT 1
            FROM "Block" b
            WHERE (b."blockerId" = cb."authorId" AND b."blockedId" = ${viewerId})
               OR (b."blockerId" = ${viewerId} AND b."blockedId" = cb."authorId")
          )
      )`;
}
