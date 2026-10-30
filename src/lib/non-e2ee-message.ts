import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSecretChat } from "@/lib/e2ee/secret-chat";

// The one way the server writes a chat message that was NOT composed and encrypted inside the chat it lands in:
// shares from the post/Muse/Story/share-target sheets, forwards, story replies. None of these can be end-to-end
// encrypted (the server builds or copies them), so none of them may ever land in a secret chat, whatever they carry
// (a link, a video, a story, a photo from another app). Every such insert goes through createNonE2eeMessage, which
// re-reads the destination inside the same transaction and refuses a secret chat with "secret_chat".
//
// The only paths allowed to write `prisma.message.create` directly are the chat thread's own composer (sendMessage,
// which applies checkSecretSend to encrypted payloads, and sendViewOnceMessage); src/lib/secret-chat-insert-guard.test.ts
// scans the source and fails on any other direct insert. In a lib file, not a "use server" one: every export of those
// is callable from the browser, and this trusts its arguments (the caller has already checked membership etc.).

export type NonE2eeMessageResult = { error: "secret_chat" } | { error: null; id: string };

/**
 * Creates `data` unless its conversation is a secret chat right now. The members' rows are read `FOR SHARE` in the
 * same transaction as the insert, so turning secret chat on (an UPDATE of `ConversationMember.e2eeEnabledAt`) can't
 * slip in between the check and the write. Callers report a refusal as the generic failure they use for any
 * destination that can't take the message; the caller already knows which of their own chats are secret.
 */
export async function createNonE2eeMessage(data: Prisma.MessageUncheckedCreateInput): Promise<NonE2eeMessageResult> {
  return prisma.$transaction(async (tx) => {
    const members = await tx.$queryRaw<{ isGroup: boolean; e2eeEnabledAt: Date | null }[]>`
      SELECT c."isGroup", m."e2eeEnabledAt"
      FROM "ConversationMember" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE m."conversationId" = ${data.conversationId}
      FOR SHARE OF m`;
    if (members.length > 0 && isSecretChat({ isGroup: members[0].isGroup, members })) {
      return { error: "secret_chat" as const };
    }
    const message = await tx.message.create({ data, select: { id: true } });
    return { error: null, id: message.id };
  });
}
