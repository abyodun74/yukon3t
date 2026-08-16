// Semantic ("smart") search fallback — used by src/app/search/page.tsx when
// the exact substring search comes back sparse. Two-phase, deliberately:
//
//   1. A pgvector nearest-neighbor query per entity ranks EVERY row with an
//      embedding by cosine distance to the query and returns candidate ids.
//      This is the only part that touches raw SQL, and it carries no
//      authorization logic — it can't leak anything the phase below
//      wouldn't also allow through.
//   2. Those candidate ids are re-fetched through the exact same typed
//      Prisma queries the exact-match search already uses — blocked-user
//      ids come in pre-merged via `excludeUserIds` (the caller computes
//      them with getBlockedEitherWayIds once and reuses that result for
//      both search paths, see search/page.tsx) and post visibility goes
//      through the same getVisiblePostsWhere helper — so blocking,
//      visibility, and moderation rules can't drift between the two
//      search paths.
//
// Never duplicate a visibility/block rule into the raw SQL in phase 1 to
// "filter earlier" — that's exactly the kind of divergence phase 2 exists
// to prevent.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmbedding, toPgVector } from "@/lib/embeddings";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";

const CANDIDATE_LIMIT = 30;
// Cosine distance is 0 (identical) to 2 (opposite). Above ~0.65 the nearest
// neighbors OpenAI's text-embedding-3-small returns stop reading as "related"
// and start reading as noise — tightened from trial queries like "soccer"
// against unrelated Circles/posts during development.
const MAX_DISTANCE = 0.65;

type Candidate = { id: string; distance: number };

const TABLES = {
  user: Prisma.sql`"User"`,
  circle: Prisma.sql`"Circle"`,
  collab: Prisma.sql`"CollabBoardPost"`,
  post: Prisma.sql`"Post"`,
} as const;

async function nearestIds(table: keyof typeof TABLES, vector: string): Promise<Candidate[]> {
  const rows = await prisma.$queryRaw<Candidate[]>`
    SELECT "id", "embedding" <=> ${vector}::vector AS distance
    FROM ${TABLES[table]}
    WHERE "embedding" IS NOT NULL
    ORDER BY distance ASC
    LIMIT ${CANDIDATE_LIMIT}
  `;
  return rows.filter((r) => r.distance <= MAX_DISTANCE);
}

/**
 * Standalone nearest-neighbor lookup against Post.embedding, parametrized by
 * limit/distance rather than search's fixed CANDIDATE_LIMIT/MAX_DISTANCE —
 * used by src/lib/feed-category.ts for the Home feed's smart category
 * filter, which wants a much larger candidate pool than a search fallback
 * does (it's filtering the primary feed, not suggesting extra results).
 */
export async function nearestPostIds(
  vector: string,
  { limit = 500, maxDistance = MAX_DISTANCE }: { limit?: number; maxDistance?: number } = {},
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Candidate[]>`
    SELECT "id", "embedding" <=> ${vector}::vector AS distance
    FROM "Post"
    WHERE "embedding" IS NOT NULL
    ORDER BY distance ASC
    LIMIT ${limit}
  `;
  return rows.filter((r) => r.distance <= maxDistance).map((r) => r.id);
}

/**
 * Standalone nearest-neighbor lookup against Conversation.embedding, same
 * shape as nearestPostIds above — used by messages/discover/page.tsx as a
 * fallback when an exact substring match on the group name comes back
 * sparse. Returns bare candidate ids; the caller re-fetches them through
 * its own typed query so discoverable/membership/visibility rules live in
 * exactly one place (see this file's top-of-file comment).
 */
export async function nearestGroupIds(
  vector: string,
  { limit = CANDIDATE_LIMIT, maxDistance = MAX_DISTANCE }: { limit?: number; maxDistance?: number } = {},
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Candidate[]>`
    SELECT "id", "embedding" <=> ${vector}::vector AS distance
    FROM "Conversation"
    WHERE "embedding" IS NOT NULL
    ORDER BY distance ASC
    LIMIT ${limit}
  `;
  return rows.filter((r) => r.distance <= maxDistance).map((r) => r.id);
}

function rankMap(candidates: Candidate[]) {
  return new Map(candidates.map((c, index) => [c.id, index]));
}

function byRank<T extends { id: string }>(rows: T[], ranks: Map<string, number>) {
  return [...rows].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
}

export type SemanticSearchResult = {
  people: Awaited<ReturnType<typeof prisma.user.findMany>>;
  circles: Awaited<
    ReturnType<typeof prisma.circle.findMany<{ include: { _count: { select: { members: true } } } }>>
  >;
  collabs: Awaited<
    ReturnType<
      typeof prisma.collabBoardPost.findMany<{
        include: {
          author: { select: { id: true; name: true } };
          _count: { select: { participants: true } };
        };
      }>
    >
  >;
  posts: Awaited<ReturnType<typeof attachViewerState<Parameters<typeof attachViewerState>[0][number]>>>;
};

/** Runs only when the caller decides the exact search was too sparse — see search/page.tsx. */
export async function semanticSearch(
  query: string,
  viewerId: string,
  opts: { excludeUserIds: string[] },
): Promise<SemanticSearchResult> {
  const embedding = await getEmbedding(query);
  if (!embedding) {
    return { people: [], circles: [], collabs: [], posts: [] };
  }
  const vector = toPgVector(embedding);

  const [userCandidates, circleCandidates, collabCandidates, postCandidates] = await Promise.all([
    nearestIds("user", vector),
    nearestIds("circle", vector),
    nearestIds("collab", vector),
    nearestIds("post", vector),
  ]);

  const [postsWhere] = await Promise.all([getVisiblePostsWhere(viewerId)]);

  const [people, circles, collabs, rawPosts] = await Promise.all([
    userCandidates.length
      ? prisma.user.findMany({
          where: {
            id: { in: userCandidates.map((c) => c.id), notIn: opts.excludeUserIds },
            status: "ACTIVE",
          },
          take: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    circleCandidates.length
      ? prisma.circle.findMany({
          where: { id: { in: circleCandidates.map((c) => c.id) } },
          include: { _count: { select: { members: true } } },
          take: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    collabCandidates.length
      ? prisma.collabBoardPost.findMany({
          where: { id: { in: collabCandidates.map((c) => c.id) }, status: "OPEN" },
          include: { author: { select: { id: true, name: true } }, _count: { select: { participants: true } } },
          take: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    postCandidates.length
      ? prisma.post.findMany({
          where: { id: { in: postCandidates.map((c) => c.id) }, ...postsWhere },
          include: postCardInclude,
          take: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  const posts = await attachViewerState(rawPosts, viewerId);

  return {
    people: byRank(people, rankMap(userCandidates)),
    circles: byRank(circles, rankMap(circleCandidates)),
    collabs: byRank(collabs, rankMap(collabCandidates)),
    posts: byRank(posts, rankMap(postCandidates)),
  };
}
