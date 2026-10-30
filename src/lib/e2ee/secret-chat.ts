// Server-side rules for secret chats, as pure functions so every code path
// that touches message text (sendMessage, editMessage, push previews, the
// inbox, story replies) applies exactly the same rule and it can be tested
// without a database. The server never decrypts anything: its whole job here
// is to (1) know when a conversation is secret, (2) refuse plaintext in one,
// and (3) never put message text — or ciphertext — anywhere it shouldn't go.

import { isEncryptedContent, isWellFormedEncryptedContent } from "./constants";
import type { MessageMediaType as MediaType } from "@/generated/prisma/enums";

/**
 * A conversation is a secret chat only while BOTH people in a 1:1 have opted
 * in. Groups never are: keys for a changing set of members are a much bigger
 * problem than this feature takes on.
 */
export function isSecretChat(conversation: { isGroup: boolean; members: { e2eeEnabledAt: Date | null }[] }): boolean {
  return !conversation.isGroup && conversation.members.length === 2 && conversation.members.every((m) => m.e2eeEnabledAt !== null);
}

/**
 * `conversations` minus the secret chats, for every share/forward picker: shares and forwards are written by the
 * server, never encrypted on a device, so a secret chat is never offered as a destination (and the send refuses it
 * too, see createNonE2eeMessage in src/lib/non-e2ee-message.ts). Order is kept.
 */
export function withoutSecretChats<T extends { isGroup: boolean; members: { e2eeEnabledAt: Date | null }[] }>(
  conversations: readonly T[],
): T[] {
  return conversations.filter((c) => !isSecretChat(c));
}

/**
 * The gate every message write goes through — in BOTH directions:
 *  - In a secret chat, non-empty text MUST be ciphertext. A client that
 *    forgets (or is tricked, or a race turned secret mode on mid-send) is
 *    refused rather than allowed to put plaintext into a thread both people
 *    believe is encrypted.
 *  - In a chat that is NOT secret, ciphertext is refused. Otherwise anyone
 *    could put `e2ee:v1:` in front of a message in any chat and the server —
 *    which never scans what looks like ciphertext — would wave it through,
 *    turning the encryption feature into a way to dodge text moderation.
 * Either refusal is recoverable: the client re-reads the chat's state and
 * sends again the right way. Empty text is fine (a caption-less photo).
 */
export function checkSecretSend(params: {
  secret: boolean;
  content: string;
}): "plaintext_in_secret_chat" | "not_a_secret_chat" | null {
  if (params.content === "") return null;
  if (params.secret) return isWellFormedEncryptedContent(params.content) ? null : "plaintext_in_secret_chat";
  return isEncryptedContent(params.content) ? "not_a_secret_chat" : null;
}

/**
 * What text (if any) the server may hand to the content-moderation API. In a
 * secret chat that's nothing: the server can't read it, and ciphertext sent
 * to a third-party scanner would be both useless and a needless disclosure of
 * who is talking. Photos/videos are still scanned — media isn't encrypted.
 */
export function textForModeration(params: { secret: boolean; content: string }): string {
  return params.secret || isEncryptedContent(params.content) ? "" : params.content;
}

/**
 * The one-line summary used for push notifications. Never contains ciphertext,
 * and never text from a secret chat. What a secret chat gets instead must not
 * say it is one: a notification is read on a lock screen, by whoever is near
 * the phone. `words` are the lines in the recipient's language (push.message
 * in src/lib/i18n); the choice between them is the same in every language.
 */
export function pushPreview(
  params: { secret: boolean; content: string; mediaType: MediaType },
  words: { photo: string; video: string; gif: string; voice: string; unreadable: string } = {
    photo: "Sent a photo",
    video: "Sent a video",
    gif: "Sent a GIF",
    voice: "Sent a voice note",
    unreadable: "New message",
  },
): string {
  switch (params.mediaType) {
    case "IMAGE":
      return words.photo;
    case "VIDEO":
      return words.video;
    case "GIF":
      return words.gif;
    case "AUDIO":
      return words.voice;
    default:
      // Encrypted-looking text in a chat that isn't (or is no longer) secret
      // gets the same line: never show ciphertext in a notification.
      return params.secret || isEncryptedContent(params.content) ? words.unreadable : params.content;
  }
}

/**
 * The inbox's last-message line: ciphertext is unreadable noise, so show a plain stand-in that doesn't mark the chat
 * as secret. `standIn` is that word in the reader's language ("Message", `fallback.message` in src/lib/i18n).
 */
export function inboxPreview(content: string, standIn = "Message"): string {
  return isEncryptedContent(content) ? standIn : content;
}
