import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { postCardInclude } from "@/lib/post-card-data";
import { loadRotatedPage, orderByIds } from "@/lib/feed-rotation";
import { postRotationSource } from "@/lib/feed-rotation-sources";

/** Rotation's feed key for a Home tab: each category tab has its own mix. */
export function homeFeedKey(category: string | null) {
  return `home:${category ?? "all"}`;
}

/**
 * One rotated page of Home (src/lib/feed-rotation.ts) under `where` (the viewer's listable posts and the tab's
 * category filter, exactly what the newest-first feed uses): ids first, then the cards, hydrated with the same `where`
 * so a post that was deleted or stopped being visible since is simply left out, in the rotated order.
 */
export async function loadHomeRotatedPage({
  where,
  viewerId,
  category,
  cursor,
  pageSize,
  nowMs = Date.now(),
}: {
  where: Prisma.PostWhereInput;
  viewerId: string;
  category: string | null;
  cursor: string | null;
  pageSize: number;
  nowMs?: number;
}) {
  const page = await loadRotatedPage(postRotationSource(where), {
    viewerId,
    feedKey: homeFeedKey(category),
    nowMs,
    cursor,
    pageSize,
  });
  const rows = page.ids.length
    ? await prisma.post.findMany({ where: { AND: [where, { id: { in: page.ids } }] }, include: postCardInclude })
    : [];
  return { rows: orderByIds(page.ids, rows), nextCursor: page.nextCursor, servedAt: page.servedAt };
}
