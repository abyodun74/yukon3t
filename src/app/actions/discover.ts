"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { intentTagValues } from "@/lib/validations";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { onlineSince } from "@/lib/presence";

const SORT_OPTIONS = ["relevant", "recent", "oldest", "online"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// Matches /discover/page.tsx's own PAGE_SIZE (src/app/discover/page.tsx) —
// same offset pagination there for the same reason (non-unique trustScore
// sort order), just driven by scroll instead of a page-number query param.
const PAGE_SIZE = 30;

/**
 * Auto-load-more for /discover — called from the client via
 * useInfiniteScroll (src/lib/use-infinite-scroll.ts) once the sentinel at
 * the bottom of the grid scrolls into view. `page` is 1-indexed and always
 * the *next* page after what's already loaded (page 1 is the SSR page).
 */
export async function loadMoreDiscoverPeople(
  cursor: string,
  filters: { intent?: string; country?: string; sort?: string },
) {
  const me = await requireUser();
  const page = Math.max(2, Number.parseInt(cursor, 10) || 2);
  const sort: SortOption = SORT_OPTIONS.includes(filters.sort as SortOption)
    ? (filters.sort as SortOption)
    : "recent";
  const intent = filters.intent;
  const country = filters.country;

  const blockedIds = await getBlockedEitherWayIds(me.id);

  const people = await prisma.user.findMany({
    where: {
      id: { notIn: [me.id, ...blockedIds] },
      status: "ACTIVE",
      name: { not: null },
      discoverable: true,
      ...(intent ? { openToIntents: { has: intent as (typeof intentTagValues)[number] } } : {}),
      ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
      ...(sort === "online" ? { lastSeenAt: { gt: onlineSince() } } : {}),
    },
    orderBy:
      sort === "online"
        ? { lastSeenAt: "desc" }
        : sort === "recent"
          ? { createdAt: "desc" }
          : sort === "oldest"
            ? { createdAt: "asc" }
            : { trustScore: "desc" },
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  const peopleIds = people.map((p) => p.id);
  const connections = peopleIds.length
    ? await prisma.connection.findMany({
        where: {
          OR: [
            { requesterId: me.id, targetId: { in: peopleIds } },
            { targetId: me.id, requesterId: { in: peopleIds } },
          ],
        },
      })
    : [];
  const connectionByOtherId = new Map(
    connections.map((c) => [c.requesterId === me.id ? c.targetId : c.requesterId, c]),
  );

  const acceptedOtherIds = connections
    .filter((c) => c.status === "ACCEPTED")
    .map((c) => (c.requesterId === me.id ? c.targetId : c.requesterId));
  const conversations = acceptedOtherIds.length
    ? await prisma.conversation.findMany({
        where: {
          AND: [
            { members: { some: { userId: me.id } } },
            { members: { some: { userId: { in: acceptedOtherIds } } } },
          ],
        },
        include: { members: { select: { userId: true } } },
      })
    : [];
  const conversationIdByOtherId = new Map<string, string>();
  for (const conv of conversations) {
    const other = conv.members.find((m) => m.userId !== me.id);
    if (other) conversationIdByOtherId.set(other.userId, conv.id);
  }

  const items = people.map((person) => {
    const connection = connectionByOtherId.get(person.id);
    return {
      person,
      connectionStatus: connection?.status ?? null,
      isRequester: connection?.requesterId === me.id,
      conversationId: conversationIdByOtherId.get(person.id) ?? null,
    };
  });

  return { items, hasMore: people.length === PAGE_SIZE };
}
