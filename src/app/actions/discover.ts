"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { intentTagValues } from "@/lib/validations";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { getConnectedOrPendingIds } from "@/lib/connections";
import { onlineSince } from "@/lib/presence";

const SORT_OPTIONS = ["relevant", "recent", "oldest", "online"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// Matches /discover/page.tsx's own PAGE_SIZE (src/app/discover/page.tsx) —
// same offset pagination there for the same reason (non-unique trustScore
// sort order), just driven by scroll instead of a page-number query param.
const PAGE_SIZE = 30;

const PEOPLE_YOU_MAY_KNOW_LIMIT = 12;

/**
 * "People you may know" — ranks candidates by mutual-connection count
 * (friend-of-a-friend), the standard social-network suggestion shape.
 * Deliberately a suggestion surface only: it never sends a notification of
 * its own, and doesn't grant any of the Subscribe fan-out a real Connection
 * gets (see respondToConnection's auto-subscribe) — someone shows up here
 * purely because you have people in common, not because you've interacted
 * with them at all.
 */
export async function getPeopleYouMayKnow(userId: string) {
  const myConnections = await prisma.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { targetId: userId }] },
    select: { requesterId: true, targetId: true },
  });
  const friendIds = new Set(
    myConnections.map((c) => (c.requesterId === userId ? c.targetId : c.requesterId)),
  );
  if (friendIds.size === 0) return [];

  const friendsOfFriends = await prisma.connection.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: { in: [...friendIds] } }, { targetId: { in: [...friendIds] } }],
    },
    select: { requesterId: true, targetId: true },
  });

  // Every row here has at least one side in friendIds (the query's own OR
  // clause guarantees that). A row where *both* sides are already my
  // friends is just an edge within my existing network, not a suggestion —
  // skip it. Otherwise the non-friend side is a 2nd-degree candidate,
  // credited with one mutual connection per such row it appears in.
  const mutualCountByCandidateId = new Map<string, number>();
  for (const { requesterId, targetId } of friendsOfFriends) {
    const requesterIsFriend = friendIds.has(requesterId);
    const targetIsFriend = friendIds.has(targetId);
    if (requesterIsFriend === targetIsFriend) continue;
    const candidateId = requesterIsFriend ? targetId : requesterId;
    if (candidateId === userId) continue;
    mutualCountByCandidateId.set(candidateId, (mutualCountByCandidateId.get(candidateId) ?? 0) + 1);
  }
  if (mutualCountByCandidateId.size === 0) return [];

  const [blockedIds, connectedOrPendingIds] = await Promise.all([
    getBlockedEitherWayIds(userId),
    getConnectedOrPendingIds(userId),
  ]);
  const excluded = new Set([...blockedIds, ...connectedOrPendingIds]);
  const rankedCandidateIds = [...mutualCountByCandidateId.entries()]
    .filter(([id]) => !excluded.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, PEOPLE_YOU_MAY_KNOW_LIMIT)
    .map(([id]) => id);
  if (rankedCandidateIds.length === 0) return [];

  const people = await prisma.user.findMany({
    where: {
      id: { in: rankedCandidateIds },
      status: "ACTIVE",
      name: { not: null },
      discoverable: true,
      // Site admins are invisible platform-wide — see /discover/page.tsx.
      isAdmin: false,
    },
    select: {
      id: true,
      name: true,
      username: true,
      avatarUrl: true,
      trustBand: true,
      openToIntents: true,
    },
  });
  const peopleById = new Map(people.map((p) => [p.id, p]));

  // findMany's `in` filter doesn't preserve rankedCandidateIds' order.
  return rankedCandidateIds
    .map((id) => peopleById.get(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((person) => ({ person, mutualCount: mutualCountByCandidateId.get(person.id)! }));
}

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

  const [blockedIds, connectedIds] = await Promise.all([
    getBlockedEitherWayIds(me.id),
    getConnectedOrPendingIds(me.id),
  ]);

  const people = await prisma.user.findMany({
    where: {
      id: { notIn: [me.id, ...blockedIds, ...connectedIds] },
      status: "ACTIVE",
      name: { not: null },
      discoverable: true,
      // Site admins are invisible platform-wide — see /discover/page.tsx.
      isAdmin: false,
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
