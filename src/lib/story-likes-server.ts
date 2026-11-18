import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds, isBlockedEitherWay } from "@/lib/blocks";
import { pushActivityNotification } from "@/lib/notify-push";
import { storyHref } from "@/lib/notification-href";
import {
  STORY_LIKERS_LIMIT,
  shouldNotifyStoryLike,
  storyLikeNotifyLockKey,
  storyLikeStateFor,
  type StoryLikeState,
} from "@/lib/story-likes";

// Server half of Story likes (rules and privacy model: src/lib/story-likes.ts). Every caller has already passed the
// story through loadViewableStory (or, for the author's own sheet, checked authorship), so these never re-decide
// visibility; they only read and write likes.

/**
 * Who liked one of the author's stories, as the author sees it: most recent first, capped at STORY_LIKERS_LIMIT,
 * leaving out anyone blocked either way with the author (their like stays stored but is never shown or counted).
 * Exact selects only: an id, a display name and when.
 */
export async function loadStoryLikersForAuthor(storyId: string, authorId: string) {
  const blocked = [...(await getBlockedEitherWayIds(authorId))];
  const where = { storyId, ...(blocked.length > 0 ? { userId: { notIn: blocked } } : {}) };
  const [rows, count] = await Promise.all([
    prisma.storyLike.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: STORY_LIKERS_LIMIT,
      select: { createdAt: true, user: { select: { id: true, name: true } } },
    }),
    prisma.storyLike.count({ where }),
  ]);
  return {
    likers: rows.map((r) => ({ id: r.user.id, name: r.user.name ?? "Unknown", likedAt: r.createdAt })),
    count,
  };
}

/** The like state one viewer is shown for a story they may see: their own heart, or (author) the count. */
export async function storyLikeStateForViewer(
  viewerId: string,
  story: { id: string; authorId: string },
): Promise<StoryLikeState> {
  if (story.authorId === viewerId) {
    const { count } = await loadStoryLikersForAuthor(story.id, story.authorId);
    return storyLikeStateFor({ isAuthor: true, likedByViewer: false, likeCount: count });
  }
  const mine = await prisma.storyLike.findUnique({
    where: { storyId_userId: { storyId: story.id, userId: viewerId } },
    select: { id: true },
  });
  return storyLikeStateFor({ isAuthor: false, likedByViewer: Boolean(mine), likeCount: 0 });
}

/**
 * Tells the author about a new like: one STORY_LIKE bell row per liker per story, ever (checked and written under a
 * per-(story, liker) advisory lock, so two racing likes can't both write one), then a push in the author's language.
 * Never for a self-like or across a block. Best-effort: a failure here never undoes the like.
 */
export async function notifyStoryLike(
  story: { id: string; authorId: string },
  liker: { id: string; name: string | null },
): Promise<boolean> {
  if (liker.id === story.authorId) return false;
  try {
    const blockedEitherWay = await isBlockedEitherWay(liker.id, story.authorId);
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storyLikeNotifyLockKey(story.id, liker.id)}))`;
      const existing = await tx.notification.findFirst({
        where: { recipientId: story.authorId, actorId: liker.id, type: "STORY_LIKE", storyId: story.id },
        select: { id: true },
      });
      if (
        !shouldNotifyStoryLike({
          likerId: liker.id,
          authorId: story.authorId,
          newlyLiked: true,
          alreadyNotified: Boolean(existing),
          blockedEitherWay,
        })
      ) {
        return false;
      }
      await tx.notification.create({
        data: { recipientId: story.authorId, actorId: liker.id, type: "STORY_LIKE", storyId: story.id },
      });
      return true;
    });
    if (created) {
      await pushActivityNotification(story.authorId, "STORY_LIKE", liker.name, storyHref(story.authorId, story.id));
    }
    return created;
  } catch (err) {
    console.error("[notifyStoryLike] failed", err);
    return false;
  }
}
