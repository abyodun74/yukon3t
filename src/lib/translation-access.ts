import type { Prisma } from "@/generated/prisma/client";

// Which posts, comments and messages a viewer may have translated: exactly what they can already read, and nothing
// that is held or taken down. Pure where-fragments (the server half, src/lib/translation-server.ts, supplies the
// viewer's post visibility from getVisiblePostsWhere and their blocks); unit-tested in translation-access.test.ts.
// Anything that doesn't match is answered "unavailable", the same as an outage, so a guessed id reveals nothing.

/**
 * Posts: the viewer's own post visibility (buildVisiblePostsWhere: PUBLISHED only, active authors, audience, Circle
 * membership incl. PRIVATE Circles, HIDDEN accounts, blocks either way).
 */
export function translatablePostsWhere(ids: string[], visiblePostsWhere: Prisma.PostWhereInput): Prisma.PostWhereInput {
  return { AND: [{ id: { in: ids } }, visiblePostsWhere] };
}

/** Comments: PUBLISHED, by an active author the viewer hasn't blocked (or been blocked by), on a post they can see. */
export function translatableCommentsWhere(
  ids: string[],
  visiblePostsWhere: Prisma.PostWhereInput,
  blockedIds: ReadonlySet<string>,
): Prisma.CommentWhereInput {
  return {
    id: { in: ids },
    moderationStatus: "PUBLISHED",
    author: { status: "ACTIVE" },
    ...(blockedIds.size ? { authorId: { notIn: [...blockedIds] } } : {}),
    post: visiblePostsWhere,
  };
}

/**
 * Messages: in a conversation the viewer is a member of, PUBLISHED, not deleted for everyone or for this viewer, and
 * not a view-once message (those have no text). The caller still drops secret-chat ciphertext (isTranslatable) and
 * messages in a hidden chat that isn't unlocked (`lockedConversationIds`).
 */
export function translatableMessagesWhere(ids: string[], viewerId: string): Prisma.MessageWhereInput {
  return {
    id: { in: ids },
    moderationStatus: "PUBLISHED",
    deletedForEveryoneAt: null,
    viewOnce: false,
    NOT: { deletedForUserIds: { has: viewerId } },
    conversation: { members: { some: { userId: viewerId } } },
  };
}

/**
 * The conversations among `memberships` that are hidden by this viewer and not unlocked: their messages are refused
 * like every other hidden-chat read (see "Hidden chats" in CLAUDE.md).
 */
export function lockedConversationIds(
  memberships: { conversationId: string; hiddenAt: Date | null }[],
  hiddenUnlocked: boolean,
): Set<string> {
  if (hiddenUnlocked) return new Set();
  return new Set(memberships.filter((m) => m.hiddenAt !== null).map((m) => m.conversationId));
}
