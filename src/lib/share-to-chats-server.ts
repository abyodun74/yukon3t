import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { isMembershipLocked } from "@/lib/hidden-chats";
import { captureError } from "@/lib/error-tracking";
import { shareTargetRefusal, type ShareTargetRow } from "@/lib/share-to-chats";

// The server half of sending one share to several chats (src/lib/share-to-chats.ts has the rules). In a lib file, not
// a "use server" one: every export of those is callable from the browser, and this trusts its arguments.

/** What each destination is read with: enough for shareTargetRefusal, the hidden-chat lock and afterMessageSent. */
const SHARE_TARGET_SELECT = {
  id: true,
  isGroup: true,
  members: {
    select: { userId: true, e2eeEnabledAt: true, hiddenAt: true, user: { select: { status: true } } },
  },
} as const;

/**
 * Tries every destination on its own and calls `send` for each one that may take the share: the caller is a member,
 * the chat isn't hidden-and-locked for them, shareTargetRefusal passes (blocks either way, inactive peer, secret chat
 * unless `allowSecret`), and the ordinary per-message send limit (`messageSend`) still has room, since each copy is a
 * message sent. Once that limit says no, every destination left counts as failed. A `send` that throws counts as
 * failed too (reported, not rethrown), so the ones already sent stand. Returns counts only.
 */
export async function sendToEachChat({
  userId,
  targetIds,
  allowSecret,
  send,
}: {
  userId: string;
  targetIds: readonly string[];
  allowSecret: boolean;
  send: (target: ShareTargetRow) => Promise<void>;
}): Promise<{ sent: number; failed: number; rateLimited: boolean }> {
  const [targets, blockedIds] = await Promise.all([
    prisma.conversation.findMany({ where: { id: { in: [...targetIds] } }, select: SHARE_TARGET_SELECT }),
    getBlockedEitherWayIds(userId),
  ]);
  const targetById = new Map<string, ShareTargetRow>(targets.map((t) => [t.id, t]));

  let sent = 0;
  let failed = 0;
  let rateLimited = false;
  for (const conversationId of targetIds) {
    const target = targetById.get(conversationId);
    const membership = target?.members.find((m) => m.userId === userId);
    if (!target || !membership || shareTargetRefusal(target, userId, blockedIds, { allowSecret })) {
      failed++;
      continue;
    }
    if (await isMembershipLocked(membership, userId)) {
      failed++;
      continue;
    }
    if (rateLimited || !(await checkRateLimit("messageSend", userId))) {
      rateLimited = true;
      failed++;
      continue;
    }
    try {
      await send(target);
      sent++;
    } catch (err) {
      console.error("[share-to-chats] send to one chat failed", err);
      await captureError(err, { step: "shareToChats", conversationId });
      failed++;
    }
  }
  return { sent, failed, rateLimited };
}
