import type { Prisma } from "@/generated/prisma/client";

/** First fetch of a live stream's chat: the latest this many comments. */
export const LIVE_CHAT_FIRST_PAGE = 30;
/** Any later fetch (after a cursor): at most this many comments. */
export const LIVE_CHAT_PAGE_MAX = 50;

/**
 * The query getLiveStreamComments (actions/live-streams.ts) runs. Every answer is bounded, cursor or not: without a
 * cursor, the newest LIVE_CHAT_FIRST_PAGE (read newest-first, so the caller reverses them to oldest-first); after a
 * cursor (a comment of this same stream, which the caller has already checked), the next LIVE_CHAT_PAGE_MAX in order,
 * ties on createdAt broken by id so paging never skips or repeats one.
 */
export function liveChatPageQuery(
  liveStreamId: string,
  after: { createdAt: Date; id: string } | null,
): { args: Prisma.LiveStreamCommentFindManyArgs & { take: number }; newestFirst: boolean } {
  if (!after) {
    return {
      args: {
        where: { liveStreamId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIVE_CHAT_FIRST_PAGE,
      },
      newestFirst: true,
    };
  }
  return {
    args: {
      where: {
        liveStreamId,
        OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LIVE_CHAT_PAGE_MAX,
    },
    newestFirst: false,
  };
}
