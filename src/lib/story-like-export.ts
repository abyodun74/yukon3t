import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { capList, namedPerson } from "@/lib/gift-export";
import type { HiddenState } from "@/lib/hidden-chats-rules";

// The "Story likes" part of "Export my data" (exportMyData, src/app/actions/profile.ts). Stories last 24 hours and their
// likes go with them, so this only ever holds likes on stories that are still up. Same conventions as the gifts and
// live-invite parts (src/lib/gift-export.ts, src/lib/live-invite-export.ts): exact selects, never a User row; the
// other person is named only by display name and username, and only while ACTIVE and not blocked either way / a
// hidden-chat peer ("not_shown" otherwise); a like on a hidden peer's story, or by a hidden peer on yours, is left out
// unless the PIN unlock is live (the caller passes an empty HiddenState then). A story is referenced by its id and
// when it was posted, never its media or caption.
//
// - given: the stories you liked, with whose story it is.
// - received: who liked your own stories (the same people your "Seen by" sheet marks with a heart; only you, the
//   author, are ever shown this).

/** Most recent rows per list; a longer history is cut with `truncated: true`. */
export const STORY_LIKE_EXPORT_LIMIT = 500;

const personSelect = { select: { id: true, name: true, username: true, status: true } } as const;

export async function loadStoryLikeExport(userId: string, hidden: HiddenState) {
  const blocked = await getBlockedEitherWayIds(userId);
  const withheld = new Set<string>([...blocked, ...hidden.peerIds]);
  const take = STORY_LIKE_EXPORT_LIMIT + 1;
  const hiddenPeers = hidden.peerIds.length > 0 ? { notIn: hidden.peerIds } : undefined;

  const [givenRows, receivedRows] = await Promise.all([
    prisma.storyLike.findMany({
      where: { userId, ...(hiddenPeers ? { story: { authorId: hiddenPeers } } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      select: { createdAt: true, story: { select: { id: true, createdAt: true, author: personSelect } } },
    }),
    prisma.storyLike.findMany({
      where: { story: { authorId: userId }, ...(hiddenPeers ? { userId: hiddenPeers } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      select: { createdAt: true, story: { select: { id: true, createdAt: true } }, user: personSelect },
    }),
  ]);

  return {
    given: capList(
      givenRows.map((row) => ({
        story: { id: row.story.id, postedAt: row.story.createdAt },
        storyBy: namedPerson(row.story.author, withheld),
        likedAt: row.createdAt,
      })),
      STORY_LIKE_EXPORT_LIMIT,
    ),
    received: capList(
      receivedRows.map((row) => ({
        story: { id: row.story.id, postedAt: row.story.createdAt },
        likedBy: namedPerson(row.user, withheld),
        likedAt: row.createdAt,
      })),
      STORY_LIKE_EXPORT_LIMIT,
    ),
  };
}
