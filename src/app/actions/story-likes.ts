"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { loadViewableStory } from "@/lib/profile-access-server";
import { notifyStoryLike } from "@/lib/story-likes-server";

/**
 * The heart on a Story (rules and privacy: src/lib/story-likes.ts). `like` is the state the caller wants (the viewer
 * sends what its optimistic heart now shows), so a repeated or retried call is a no-op rather than a flip; omitted, it
 * flips the current state. Exactly the same gate as viewing the story (loadViewableStory: unexpired, the author's
 * profile rule, no block either way), so nobody can like a story they can't see, or one that has expired. The author
 * can't like their own story (`own_story`; the viewer shows them the count instead of a heart). Rate-limited with the
 * shared `like` limiter. Answers only the caller's own state: never a count, never who else liked.
 */
export async function toggleStoryLike(storyId: string, like?: boolean) {
  const user = await requireVerifiedUser();

  if (typeof storyId !== "string" || !storyId || (like !== undefined && typeof like !== "boolean")) {
    return { error: "invalid" as const };
  }

  if (!(await checkRateLimit("like", user.id))) {
    return { error: "rate_limited" as const };
  }

  const story = await loadViewableStory(user.id, storyId);
  if (!story) {
    return { error: "not_found" as const };
  }
  if (story.authorId === user.id) {
    return { error: "own_story" as const };
  }

  const key = { storyId_userId: { storyId: story.id, userId: user.id } };
  const want =
    like ?? !(await prisma.storyLike.findUnique({ where: key, select: { id: true } }));

  if (!want) {
    // deleteMany: unliking something not liked (a doubled tap, a retry) is a no-op, not an error.
    await prisma.storyLike.deleteMany({ where: { storyId: story.id, userId: user.id } });
    return { error: null, liked: false };
  }

  let newlyLiked: boolean;
  try {
    // skipDuplicates: a second like (doubled tap, retry, two tabs) writes nothing and reports 0, so it never notifies.
    const { count } = await prisma.storyLike.createMany({
      data: [{ storyId: story.id, userId: user.id }],
      skipDuplicates: true,
    });
    newlyLiked = count > 0;
  } catch {
    // The story was deleted (or swept as expired) between the check and the write: the foreign key refuses the row.
    return { error: "not_found" as const };
  }

  if (newlyLiked) {
    await notifyStoryLike(story, { id: user.id, name: user.name ?? null });
  }
  return { error: null, liked: true };
}
