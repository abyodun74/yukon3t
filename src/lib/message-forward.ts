// Forwarding a chat message into other conversations: the pure rules, shared by the server action
// (forwardMessage / getForwardTargets in src/app/actions/messages.ts), the chat bubble's menu and the tests.
// Client-safe: no database, no server-only imports.

import { isEncryptedContent } from "@/lib/e2ee/constants";
import { isSecretChat } from "@/lib/e2ee/secret-chat";
import type { MessageMediaType as MediaType } from "@/generated/prisma/enums";

/** Most conversations one forward can go to. */
export const FORWARD_MAX_RECIPIENTS = 5;

/** The stored fields of the message being forwarded that decide whether it can be. */
export type ForwardSource = {
  content: string;
  mediaType: MediaType;
  mediaUrl: string | null;
  mediaThumbnailUrl: string | null;
  moderationStatus: "PUBLISHED" | "FLAGGED" | "REMOVED";
  deletedForEveryoneAt: Date | null;
  viewOnce: boolean;
  storyId: string | null;
};

/**
 * Why a message can't be forwarded, or null when it can. Never forwarded:
 *  - deleted for everyone (nothing left to forward) or held/removed by moderation;
 *  - view-once media (its file is in the private bucket and exists to be seen once, by one person);
 *  - ciphertext (a secret-chat message, or one left over from a chat that was secret): the server can't read it and
 *    must never be the one to decrypt it. The caller also refuses anything from a chat that is secret right now;
 *  - a story reply or shared story: the story has its own audience rules (and expires); forwarding the reply
 *    alone would be a message without its context;
 *  - a media message whose file is gone, and an empty message.
 */
export function forwardSourceRefusal(source: ForwardSource): "not_forwardable" | null {
  if (source.deletedForEveryoneAt) return "not_forwardable";
  if (source.moderationStatus !== "PUBLISHED") return "not_forwardable";
  if (source.viewOnce) return "not_forwardable";
  if (source.storyId) return "not_forwardable";
  if (isEncryptedContent(source.content)) return "not_forwardable";
  if (source.mediaType !== "NONE" && !source.mediaUrl) return "not_forwardable";
  if (source.mediaType === "NONE" && source.content.trim() === "") return "not_forwardable";
  return null;
}

/**
 * Whether the chat bubble offers "Forward". The same rule as the server's, on what the browser has: the bubble is
 * not offered in a secret chat at all (hidden exactly like "Suggest a correction"), nor on a message that arrived as
 * ciphertext, nor while it is still sending.
 */
export function canOfferForward(params: {
  secretActive: boolean;
  wasEncrypted?: boolean;
  sending: boolean;
  message: Omit<ForwardSource, "storyId"> & { story: unknown | null };
}): boolean {
  const { secretActive, wasEncrypted, sending, message } = params;
  if (secretActive || wasEncrypted || sending) return false;
  return forwardSourceRefusal({ ...message, storyId: message.story ? "story" : null }) === null;
}

/** De-duplicated destination ids, in the order picked. */
export function uniqueForwardTargets(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The new message's data in one destination. Only the content travels: text, links and the media reference. Never
 * the original sender, the source conversation, a reply quote, a story, reactions, corrections, edit or read state.
 * The new message is the forwarder's own, marked `forwarded` so the bubble can say so, and nothing else.
 */
export function forwardedMessageData(
  source: Pick<ForwardSource, "content" | "mediaType" | "mediaUrl" | "mediaThumbnailUrl">,
  params: { conversationId: string; senderId: string },
) {
  return {
    conversationId: params.conversationId,
    senderId: params.senderId,
    content: source.content,
    mediaType: source.mediaType,
    mediaUrl: source.mediaType === "NONE" ? null : source.mediaUrl,
    mediaThumbnailUrl: source.mediaType === "VIDEO" ? source.mediaThumbnailUrl : null,
    moderationStatus: "PUBLISHED" as const,
    forwarded: true,
  };
}

/** A conversation as getForwardTargets reads it. */
export type ForwardTargetRow = {
  id: string;
  isGroup: boolean;
  name: string | null;
  members: {
    userId: string;
    e2eeEnabledAt: Date | null;
    user: { id: string; name: string | null; username: string | null; avatarUrl: string | null; status: string };
  }[];
};

/**
 * Why `row` can't take a forward from `userId`, or null when it can. Shared by the picker list and the send, so a
 * chat the picker doesn't offer is also refused when its id is sent anyway. A secret chat is refused (its text must be
 * encrypted on a device, and a forward is copied on the server); so is a 1:1 with someone blocked either way or whose
 * account isn't active. All of these answer the same "unavailable", so a refusal doesn't say which it was.
 */
export function forwardTargetRefusal(
  row: ForwardTargetRow,
  userId: string,
  blockedIds: ReadonlySet<string>,
): "unavailable" | null {
  if (!row.members.some((m) => m.userId === userId)) return "unavailable";
  if (row.isGroup) return null;
  if (isSecretChat(row)) return "unavailable";
  const other = row.members.find((m) => m.userId !== userId);
  if (!other) return "unavailable";
  if (blockedIds.has(other.userId)) return "unavailable";
  if (other.user.status !== "ACTIVE") return "unavailable";
  return null;
}

/** The picker's rows: only chats that can take a forward, labelled like the other "send to a friend" pickers. */
export function forwardTargetsFor(rows: readonly ForwardTargetRow[], userId: string, blockedIds: ReadonlySet<string>) {
  return rows
    .filter((row) => forwardTargetRefusal(row, userId, blockedIds) === null)
    .map((row) => {
      const other = row.isGroup ? null : row.members.find((m) => m.userId !== userId)?.user;
      return {
        id: row.id,
        isGroup: row.isGroup,
        label: row.isGroup ? row.name : (other?.name ?? null),
        avatarUrl: other?.avatarUrl ?? null,
        username: other?.username ?? null,
      };
    });
}
