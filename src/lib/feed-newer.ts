// Home's "newer posts" fetch (PostFeedSection.refetchNewer), pure so it can be tested without React.
//
// With rotation (src/lib/feed-rotation.ts) the list is no longer newest first: posts[0] can be an old post the mix put
// on top, and asking for "everything newer than posts[0]" would pull in posts the mix still has further down. So the
// fetch asks for posts newer than the newest thing the list already accounts for: the newest post shown, or the time
// the first page was served (servedAt; every post up to then is already somewhere in the rotated list), whichever is
// later.

type Dated = { id: string; createdAt: Date | string };

/** The `after` time for the newer-posts fetch, or null when there is nothing to measure from. */
export function newerPostsAfter(posts: readonly Dated[], servedAt: Date | string | null): Date | null {
  let newest = servedAt ? new Date(servedAt).getTime() : Number.NaN;
  for (const post of posts) {
    const at = new Date(post.createdAt).getTime();
    if (Number.isNaN(newest) || at > newest) newest = at;
  }
  return Number.isNaN(newest) ? null : new Date(newest);
}

/** Newer posts go on top (only ones not already in the list); the rest of the list never moves. */
export function prependNewer<T extends { id: string }>(prev: T[], fresh: readonly T[]): T[] {
  const existing = new Set(prev.map((p) => p.id));
  const toAdd = fresh.filter((p) => !existing.has(p.id));
  return toAdd.length ? [...toAdd, ...prev] : prev;
}
