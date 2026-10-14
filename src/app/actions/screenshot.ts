"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { pushActivityNotification } from "@/lib/notify-push";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { screenshotTargetSchema } from "@/lib/validations";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { getHiddenPeerIds, getMembersHidingConversation } from "@/lib/hidden-chats";
import { HIDDEN_PUSH_TYPE } from "@/lib/hidden-chats-rules";
import { hiddenPush } from "@/lib/push-text";

type ScreenshotTarget =
  | { type: "post"; id: string }
  | { type: "story"; id: string }
  | { type: "conversation"; id: string }
  | { type: "profile"; id: string };

// The same person screenshotting the same thing again inside this window is
// one fact, not several — the owner hears about it once.
const REPEAT_WINDOW_MS = 10 * 60 * 1000;

async function notifyOne(
  recipientId: string,
  actorId: string,
  actorName: string | null,
  fk: { postId?: string; storyId?: string; conversationId?: string },
  url: string,
  // The recipient has this conversation hidden: the row is still written (the bell and its count leave out rows of
  // a hidden chat, and it is there if they unhide it), but the push names nobody and doesn't link to the thread.
  hiddenForRecipient = false,
) {
  if (recipientId === actorId) return;
  if (await isBlockedEitherWay(recipientId, actorId)) return;
  const recent = await prisma.notification.findFirst({
    where: {
      recipientId,
      actorId,
      type: "SCREENSHOT_TAKEN",
      postId: fk.postId ?? null,
      storyId: fk.storyId ?? null,
      conversationId: fk.conversationId ?? null,
      createdAt: { gt: new Date(Date.now() - REPEAT_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recent) return;
  await prisma.notification.create({
    data: { recipientId, actorId, type: "SCREENSHOT_TAKEN", ...fk },
  });
  // Also when the recipient has hidden their 1:1 chat with this person and the screenshot was of something else (a
  // post, a story, their profile): that bell row is left out too (HIDDEN_PEER_NOTIFICATION_TYPES).
  if (hiddenForRecipient || (await getHiddenPeerIds(recipientId)).includes(actorId)) {
    await sendFcmActivityToUser(recipientId, (locale) => ({ ...hiddenPush(locale), type: HIDDEN_PUSH_TYPE }));
    return;
  }
  await pushActivityNotification(recipientId, "SCREENSHOT_TAKEN", actorName, url);
}

/**
 * Called from global-call-frame.tsx's screenshot listener whenever a
 * screenshot fires outside of an active call (the in-call case broadcasts
 * to the other participant directly instead — see that component). The
 * owner is always re-derived here from `target.id`, never trusted from the
 * client, same as every other server action in this app.
 *
 * Nothing here can prove a screenshot really happened — the call comes from
 * the client — so what it can do to someone else is bounded instead: a
 * per-caller rate limit, one notice per target per REPEAT_WINDOW_MS, never
 * across a block, and only for a conversation the caller is actually in.
 */
export async function notifyScreenshotTaken(input: ScreenshotTarget) {
  const user = await requireVerifiedUser();

  const parsed = screenshotTargetSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const target = parsed.data;

  if (!(await checkRateLimit("screenshotNotice", user.id))) return { error: "rate_limited" };

  switch (target.type) {
    case "post": {
      const post = await prisma.post.findUnique({ where: { id: target.id }, select: { authorId: true } });
      if (!post) return { error: "not_found" };
      await notifyOne(post.authorId, user.id, user.name, { postId: target.id }, `/post/${target.id}`);
      return { error: null };
    }
    case "story": {
      const story = await prisma.story.findUnique({ where: { id: target.id }, select: { authorId: true } });
      if (!story) return { error: "not_found" };
      await notifyOne(story.authorId, user.id, user.name, { storyId: target.id }, `/u/${story.authorId}`);
      return { error: null };
    }
    case "conversation": {
      const members = await prisma.conversationMember.findMany({
        where: { conversationId: target.id },
        select: { userId: true },
      });
      // Only someone in the conversation can have screenshotted it.
      if (!members.some((m) => m.userId === user.id)) return { error: "not_found" };
      const others = members.filter((m) => m.userId !== user.id).map((m) => m.userId);
      const hiding = new Set(await getMembersHidingConversation(target.id, others));
      await Promise.all(
        others.map((recipientId) =>
          notifyOne(
            recipientId,
            user.id,
            user.name,
            { conversationId: target.id },
            `/messages/${target.id}`,
            hiding.has(recipientId),
          ),
        ),
      );
      return { error: null };
    }
    case "profile": {
      const owner = await prisma.user.findUnique({ where: { id: target.id }, select: { id: true } });
      if (!owner) return { error: "not_found" };
      await notifyOne(target.id, user.id, user.name, {}, `/u/${user.id}`);
      return { error: null };
    }
  }
}
