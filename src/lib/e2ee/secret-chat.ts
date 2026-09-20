// Server-side rules for secret chats, as pure functions so every code path
// that touches message text (sendMessage, editMessage, push previews, the
// inbox, story replies) applies exactly the same rule and it can be tested
// without a database. The server never decrypts anything: its whole job here
// is to (1) know when a conversation is secret, (2) refuse plaintext in one,
// and (3) never put message text — or ciphertext — anywhere it shouldn't go.

import { isEncryptedContent, isWellFormedEncryptedContent } from "./constants";

type MediaType = "NONE" | "AUDIO" | "VIDEO" | "IMAGE" | "GIF";

/**
 * A conversation is a secret chat only while BOTH people in a 1:1 have opted
 * in. Groups never are: keys for a changing set of members are a much bigger
 * problem than this feature takes on.
 */
export function isSecretChat(conversation: { isGroup: boolean; members: { e2eeEnabledAt: Date | null }[] }): boolean {
  return !conversation.isGroup && conversation.members.length === 2 && conversation.members.every((m) => m.e2eeEnabledAt !== null);
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

/** The one-line summary used for push notifications. Never contains ciphertext, and never text from a secret chat. */
export function pushPreview(params: { secret: boolean; content: string; mediaType: MediaType }): string {
  switch (params.mediaType) {
    case "IMAGE":
      return "Sent a photo";
    case "VIDEO":
      return "Sent a video";
    case "GIF":
      return "Sent a GIF";
    case "AUDIO":
      return "Sent a voice note";
    default:
      if (params.secret) return "New secret message";
      // Encrypted-looking text in a chat that isn't (or is no longer) secret:
      // still never show ciphertext in a notification.
      return isEncryptedContent(params.content) ? "New message" : params.content;
  }
}

/** The inbox's last-message line: ciphertext is unreadable noise, so show what it is instead. */
export function inboxPreview(content: string): string {
  return isEncryptedContent(content) ? "🔒 Secret message" : content;
}
