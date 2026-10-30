import { Prisma, type MessageMediaType, type ModerationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * "The latest message of each of these conversations", as one index probe per conversation.
 *
 * Don't write this as a nested relation with `take: 1` (`conversation.findMany({ select: { messages: { orderBy:
 * createdAt desc, take: 1 } } })`): Prisma 7 runs that as one `SELECT ... FROM "Message" WHERE "conversationId" IN
 * (...) ORDER BY "createdAt" DESC` with NO LIMIT and trims each group in JavaScript, so it reads every message of
 * every conversation listed. The LATERAL subquery below is answered from the `Message(conversationId, createdAt)`
 * index with one row per conversation.
 *
 * Unfiltered on purpose, exactly like the nested `take: 1` it replaces: the newest row whatever its moderation state,
 * deletion or view-once flags. A conversation with no messages is simply absent from the map.
 */

export type LatestMessage = {
  conversationId: string;
  createdAt: Date;
  senderId: string;
  content: string;
  mediaType: MessageMediaType;
  moderationStatus: ModerationStatus;
};

/** Bounds the IN list of one statement (Postgres caps a statement at 65535 parameters). */
const CHUNK = 1000;

function chunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) out.push(unique.slice(i, i + CHUNK));
  return out;
}

/** Newest message per conversation: who sent it, when, and the fields an inbox preview needs. */
export async function latestMessagesByConversation(
  conversationIds: readonly string[],
): Promise<Map<string, LatestMessage>> {
  const result = new Map<string, LatestMessage>();
  for (const ids of chunks(conversationIds)) {
    const rows = await prisma.$queryRaw<LatestMessage[]>`
      SELECT c."id" AS "conversationId", m."createdAt", m."senderId", m."content",
             m."mediaType"::text AS "mediaType", m."moderationStatus"::text AS "moderationStatus"
      FROM "Conversation" c
      CROSS JOIN LATERAL (
        SELECT "createdAt", "senderId", "content", "mediaType", "moderationStatus"
        FROM "Message"
        WHERE "conversationId" = c."id"
        ORDER BY "createdAt" DESC
        LIMIT 1
      ) m
      WHERE c."id" IN (${Prisma.join(ids)})`;
    for (const row of rows) result.set(row.conversationId, { ...row, createdAt: new Date(row.createdAt) });
  }
  return result;
}

/** Only the time of the newest message per conversation (activity ordering). */
export async function latestMessageAtByConversation(conversationIds: readonly string[]): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  for (const ids of chunks(conversationIds)) {
    const rows = await prisma.$queryRaw<{ conversationId: string; createdAt: Date }[]>`
      SELECT c."id" AS "conversationId", m."createdAt"
      FROM "Conversation" c
      CROSS JOIN LATERAL (
        SELECT "createdAt"
        FROM "Message"
        WHERE "conversationId" = c."id"
        ORDER BY "createdAt" DESC
        LIMIT 1
      ) m
      WHERE c."id" IN (${Prisma.join(ids)})`;
    for (const row of rows) result.set(row.conversationId, new Date(row.createdAt));
  }
  return result;
}

/**
 * The Messages badge: how many of the user's non-hidden conversations have a message from someone else, not deleted
 * for the user, newer than the user's own `lastReadAt` (or any such message when they never opened the chat). The
 * same answer as "the newest such message is newer than lastReadAt", counted in the database with one EXISTS per
 * membership instead of loading messages.
 */
export async function countConversationsWithUnread(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ unread: number }[]>`
    SELECT count(*)::int AS "unread"
    FROM "ConversationMember" cm
    WHERE cm."userId" = ${userId}
      AND cm."hiddenAt" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "Message" m
        WHERE m."conversationId" = cm."conversationId"
          AND m."senderId" <> ${userId}
          AND NOT (${userId} = ANY (m."deletedForUserIds"))
          AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
      )`;
  return Number(rows[0]?.unread ?? 0);
}
