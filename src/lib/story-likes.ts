/**
 * The heart on a Story (owner request 2026-11-18, "add the like/heart to Story"). Pure rules only (no Prisma, no React),
 * so they are unit-tested in node and safe to import from the client. Server half: src/lib/story-likes-server.ts;
 * action: toggleStoryLike in src/app/actions/story-likes.ts; UI: the heart in src/components/story-viewer.tsx.
 *
 * Privacy (Instagram-style, the owner's default):
 * - The like count and the list of who liked are shown ONLY to the story's author (the "Seen by" sheet, with a heart
 *   on each viewer who liked). Nobody else sees a count or another person's like; a viewer sees only their own heart.
 * - The author has no heart on their own story; they see the count there instead.
 * - Who may like is exactly who may view (loadViewableStory: unexpired, author's profile rule, no block either way).
 *   No like after the story expires; likes go with the story (cascade).
 *
 * Notifications: one STORY_LIKE bell row (+ push) per liker per story, ever, so liking, unliking and liking again
 * never notifies twice; never for the author's own like or across a block.
 *
 * Double-tap to like is deliberately NOT offered: the story's tap zones act on the first tap (advance / go back, see
 * handlePointerUp in story-viewer.tsx), so telling a double tap from a single one would delay every advance by the
 * double-tap window, and the first tap of a double tap would already have moved on to the next story.
 */

/** How many likers the author's sheet lists (most recent first), same cap as its viewers list. */
export const STORY_LIKERS_LIMIT = 200;

/** The advisory lock that makes "one notification per liker per story" hold under racing likes. */
export function storyLikeNotifyLockKey(storyId: string, likerId: string): string {
  return `story-like-notify:${storyId}:${likerId}`;
}

/** What the viewer is told about a story's likes: their own heart, and the count only when they are its author. */
export type StoryLikeState = { liked: boolean; likeCount: number | null };

export function storyLikeStateFor(input: { isAuthor: boolean; likedByViewer: boolean; likeCount: number }): StoryLikeState {
  if (input.isAuthor) return { liked: false, likeCount: input.likeCount };
  return { liked: input.likedByViewer, likeCount: null };
}

/** Whether a new like should produce a bell row + push for the author. */
export function shouldNotifyStoryLike(input: {
  likerId: string;
  authorId: string;
  newlyLiked: boolean;
  alreadyNotified: boolean;
  blockedEitherWay: boolean;
}): boolean {
  return (
    input.newlyLiked && input.likerId !== input.authorId && !input.alreadyNotified && !input.blockedEitherWay
  );
}

/**
 * The author's "Seen by" list with likes merged in: each viewer marked `liked`, and anyone who liked without a
 * recorded view (a like is only possible while viewing, but the view write is separate) added as a viewer too.
 */
export function mergeViewersWithLikers<V extends { id: string; viewedAt: Date }>(
  viewers: V[],
  likers: { id: string; name: string; likedAt: Date }[],
  toViewer: (liker: { id: string; name: string; likedAt: Date }) => V,
): (V & { liked: boolean })[] {
  const likerIds = new Set(likers.map((l) => l.id));
  const seen = new Set(viewers.map((v) => v.id));
  const merged: (V & { liked: boolean })[] = viewers.map((v) => ({ ...v, liked: likerIds.has(v.id) }));
  for (const liker of likers) {
    if (!seen.has(liker.id)) merged.push({ ...toViewer(liker), liked: true });
  }
  return merged.sort((a, b) => b.viewedAt.getTime() - a.viewedAt.getTime());
}

// --- Client: optimistic heart ------------------------------------------------------------------------------------

/** The heart as shown at once on a tap, before the server answers. */
export function optimisticStoryLike(before: { liked: boolean }): { liked: boolean } {
  return { liked: !before.liked };
}

/** The heart once the server answered: its state on success, or back to what it was on any failure. */
export function settleStoryLike(
  before: { liked: boolean },
  result: { error: string | null; liked?: boolean },
): { liked: boolean } {
  if (result.error === null && typeof result.liked === "boolean") return { liked: result.liked };
  return { liked: before.liked };
}
