import { getBlockedEitherWayIds, isBlockedEitherWay } from "@/lib/blocks";
import { collabHiddenByBlock, keepCollabViewers } from "@/lib/collab-visibility";

// The server half of lib/collab-visibility.ts (read its header for the rule). Every page, action, route and fan-out
// that reads one collab for a viewer asks collabHiddenFromViewer; every collab list uses collabNotBlockedWhere; every
// fan-out about a collab goes through collabViewersOnly. src/lib/collab-visibility-exposure.test.ts checks it.

/**
 * Whether `collab` must not exist for `viewerId`: blocked either way with its author. The author is never hidden
 * from their own collab (and costs no query).
 */
export async function collabHiddenFromViewer(collab: { authorId: string }, viewerId: string): Promise<boolean> {
  if (collab.authorId === viewerId) return false;
  return collabHiddenByBlock(collab, viewerId, await isBlockedEitherWay(viewerId, collab.authorId));
}

/** Of `userIds`, the ones a collab may still notify: everyone not blocked either way with its author. One query. */
export async function collabViewersOnly(collab: { authorId: string }, userIds: Iterable<string>): Promise<string[]> {
  const ids = [...userIds];
  if (ids.length === 0) return [];
  return keepCollabViewers(collab, ids, await getBlockedEitherWayIds(collab.authorId));
}
