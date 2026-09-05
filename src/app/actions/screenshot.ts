"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { pushActivityNotification } from "@/lib/notify-push";

type ScreenshotTarget =
  | { type: "post"; id: string }
  | { type: "story"; id: string }
  | { type: "conversation"; id: string }
  | { type: "profile"; id: string };

async function notifyOne(
  recipientId: string,
  actorId: string,
  actorName: string,
  fk: { postId?: string; storyId?: string; conversationId?: string },
  url: string,
) {
  if (recipientId === actorId) return;
  await prisma.notification.create({
    data: { recipientId, actorId, type: "SCREENSHOT_TAKEN", ...fk },
  });
  await pushActivityNotification(recipientId, "SCREENSHOT_TAKEN", actorName, url);
}

/**
 * Called from global-call-frame.tsx's screenshot listener whenever a
 * screenshot fires outside of an active call (the in-call case broadcasts
 * to the other participant directly instead — see that component). The
 * owner is always re-derived here from `target.id`, never trusted from the
 * client, same as every other server action in this app.
 */
export async function notifyScreenshotTaken(target: ScreenshotTarget) {
  const user = await requireVerifiedUser();

  switch (target.type) {
    case "post": {
      const post = await prisma.post.findUnique({ where: { id: target.id }, select: { authorId: true } });
      if (!post) return { error: "not_found" };
      await notifyOne(post.authorId, user.id, user.name ?? "Someone", { postId: target.id }, `/post/${target.id}`);
      return { error: null };
    }
    case "story": {
      const story = await prisma.story.findUnique({ where: { id: target.id }, select: { authorId: true } });
      if (!story) return { error: "not_found" };
      await notifyOne(story.authorId, user.id, user.name ?? "Someone", { storyId: target.id }, `/u/${story.authorId}`);
      return { error: null };
    }
    case "conversation": {
      const members = await prisma.conversationMember.findMany({
        where: { conversationId: target.id, userId: { not: user.id } },
        select: { userId: true },
      });
      await Promise.all(
        members.map((m) =>
          notifyOne(m.userId, user.id, user.name ?? "Someone", { conversationId: target.id }, `/messages/${target.id}`),
        ),
      );
      return { error: null };
    }
    case "profile": {
      await notifyOne(target.id, user.id, user.name ?? "Someone", {}, `/u/${user.id}`);
      return { error: null };
    }
  }
}
