// "Send to a friend" from the share sheets (post, Muse, Story, sharing in from another app) to several chats at once:
// the pure rules, shared by the server actions (sendToConversations / shareMuseToConversations in
// src/app/actions/share-to-chats.ts, shareStoryToConversations in src/app/actions/stories.ts), the picker
// (send-to-chats-picker.tsx) and the tests. Client-safe: no database, no server-only imports.

import { isSecretChat } from "@/lib/e2ee/secret-chat";

/** Most chats one share can go to. The same cap as forwarding a chat message (FORWARD_MAX_RECIPIENTS). */
export const SHARE_MAX_RECIPIENTS = 5;

/** De-duplicated destination ids, in the order picked. */
export function uniqueShareTargets(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** A destination chat as the send reads it (SHARE_TARGET_SELECT in share-to-chats-server.ts). */
export type ShareTargetRow = {
  id: string;
  isGroup: boolean;
  members: {
    userId: string;
    e2eeEnabledAt: Date | null;
    hiddenAt: Date | null;
    user: { status: string };
  }[];
};

/**
 * Why `row` can't take a share from `userId`, or null when it can. Checked for every destination on its own, so one
 * bad id never stops the others. Refused: a chat the caller isn't in (or that doesn't exist), a 1:1 with someone
 * blocked either way or whose account isn't active, and a secret chat unless `allowSecret` (a share that carries no
 * text, like a Muse video, may go into one; plaintext never does). The hidden-chat lock is checked by the caller
 * (it needs the unlock cookie). Every refusal is the same "unavailable", so the result never says which it was.
 */
export function shareTargetRefusal(
  row: ShareTargetRow | undefined,
  userId: string,
  blockedIds: ReadonlySet<string>,
  options: { allowSecret: boolean },
): "unavailable" | null {
  if (!row || !row.members.some((m) => m.userId === userId)) return "unavailable";
  if (row.isGroup) return null;
  if (!options.allowSecret && isSecretChat(row)) return "unavailable";
  const other = row.members.find((m) => m.userId !== userId);
  if (!other) return "unavailable";
  if (blockedIds.has(other.userId)) return "unavailable";
  if (other.user.status !== "ACTIVE") return "unavailable";
  return null;
}

/** What a multi-chat send answers: counts only, or one error when nothing was sent. */
export type ShareToChatsResult =
  | { error: null; sent: number; failed: number }
  | { error: "rate_limited" | "unavailable" };

/**
 * The answer once every destination was tried. Something sent: the counts (a partial success is still a success).
 * Nothing sent: "rate_limited" if the send limit is what stopped it, otherwise the generic "unavailable".
 */
export function shareToChatsResult(tally: { sent: number; failed: number; rateLimited: boolean }): ShareToChatsResult {
  if (tally.sent === 0) return { error: tally.rateLimited ? "rate_limited" : "unavailable" };
  return { error: null, sent: tally.sent, failed: tally.failed };
}

/**
 * The picker's selection after tapping `id`: ticked again it is removed; otherwise it is added at the end unless
 * `max` are already ticked (then nothing changes). Pure, so the cap and order are unit-tested.
 */
export function toggleShareSelection(selected: readonly string[], id: string, max = SHARE_MAX_RECIPIENTS): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= max) return [...selected];
  return [...selected, id];
}
