import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { RotationRow, RotationSource, TailBoundary } from "@/lib/feed-rotation";

// The two feeds' RotationSource (src/lib/feed-rotation.ts). Each query reads ids, createdAt and authorId only, under
// exactly the `where` the feed already uses (getListablePostsWhere + category for Home, PUBLISHED + not blocked for
// Muse), ordered [createdAt desc, id desc]: the order the existing (moderationStatus, createdAt) indexes serve.
// Cards are hydrated afterwards with the same `where` plus `id IN (...)`, so an id read here grants nothing by itself.

const ROW_SELECT = { id: true, createdAt: true, authorId: true } as const;
const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

function rangeWhere(range: { gte: Date; lt?: Date; lte?: Date }) {
  return { createdAt: { gte: range.gte, ...(range.lt ? { lt: range.lt } : {}), ...(range.lte ? { lte: range.lte } : {}) } };
}

/** Strictly older than the boundary in [createdAt desc, id desc] order. */
export function olderThanWhere(boundary: TailBoundary) {
  const at = new Date(boundary.at);
  return boundary.id
    ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: boundary.id } }] }
    : { createdAt: { lt: at } };
}

export function postRotationSource(where: Prisma.PostWhereInput): RotationSource {
  return {
    inRange: (range, take): Promise<RotationRow[]> =>
      prisma.post.findMany({ where: { AND: [where, rangeWhere(range)] }, select: ROW_SELECT, orderBy: NEWEST_FIRST, take }),
    olderThan: (boundary, take): Promise<RotationRow[]> =>
      prisma.post.findMany({
        where: { AND: [where, olderThanWhere(boundary)] },
        select: ROW_SELECT,
        orderBy: NEWEST_FIRST,
        take,
      }),
  };
}

export function museRotationSource(where: Prisma.MuseWhereInput): RotationSource {
  return {
    inRange: (range, take): Promise<RotationRow[]> =>
      prisma.muse.findMany({ where: { AND: [where, rangeWhere(range)] }, select: ROW_SELECT, orderBy: NEWEST_FIRST, take }),
    olderThan: (boundary, take): Promise<RotationRow[]> =>
      prisma.muse.findMany({
        where: { AND: [where, olderThanWhere(boundary)] },
        select: ROW_SELECT,
        orderBy: NEWEST_FIRST,
        take,
      }),
  };
}
