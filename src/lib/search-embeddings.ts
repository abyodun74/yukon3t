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
import { getListablePostsWhere } from "@/lib/post-visibility";
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

const CONVERSATION_TABLE = Prisma.sql`"Conversation"`;

// Circle/CollabBoardPost/Post/Conversation.embedding carry a pgvector HNSW
// index (prisma/migrations/20261010180000_restore_embedding_hnsw_indexes).
// An HNSW index scan is approximate and yields at most `hnsw.ef_search` rows
// (default 40, max 1000) no matter what the query's LIMIT says, so every
// query here picks one of two shapes on purpose:
//
//   - approximateNearest: lets the index be used, with hnsw.ef_search raised
//     well past the LIMIT so the top-N matches an exact scan's in practice.
//   - exactNearest: guaranteed exact, identical to a table with no index.
//
// Never add a plain `ORDER BY "embedding" <=> ... LIMIT n` outside these two.
const HNSW_EF_SEARCH_MIN = 100;
const HNSW_EF_SEARCH_MAX = 1000;

/**
 * hnsw.ef_search to use for an index-backed top-`limit` query, or null when
 * the limit is too large for HNSW to return it reliably (the candidate list
 * can't be at least twice the limit) and the query must run exact instead.
 */
export function hnswEfSearch(limit: number): number | null {
  if (limit * 2 > HNSW_EF_SEARCH_MAX) return null;
  return Math.min(HNSW_EF_SEARCH_MAX, Math.max(HNSW_EF_SEARCH_MIN, limit * 8));
}

// `+ 0` makes the sort key something other than the bare `"embedding" <=> x`
// expression an HNSW index can serve, so Postgres has to rank every row —
// same plan and same rows as before the index existed, on any pgvector
// version, in one statement (no session setting to leak through a pooler).
function exactNearest(table: Prisma.Sql, vector: string, limit: number): Promise<Candidate[]> {
  return prisma.$queryRaw<Candidate[]>`
    SELECT "id", distance
    FROM (
      SELECT "id", "embedding" <=> ${vector}::vector AS distance
      FROM ${table}
      WHERE "embedding" IS NOT NULL
    ) AS candidates
    ORDER BY distance + 0 ASC
    LIMIT ${limit}
  `;
}

// SET LOCAL only lasts until COMMIT and the array form of $transaction runs
// both statements on one connection inside one BEGIN/COMMIT, so the setting
// reaches this SELECT and nothing else — also true behind a transaction-mode
// pooler (Neon's "-pooler" endpoint), which pins a server connection for the
// length of a transaction. SET can't take a bind parameter; efSearch is a
// number computed by hnswEfSearch, never caller input.
async function approximateNearest(table: Prisma.Sql, vector: string, limit: number): Promise<Candidate[]> {
  const efSearch = hnswEfSearch(limit);
  if (efSearch === null) return exactNearest(table, vector, limit);
  const [, rows] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${efSearch}`),
    prisma.$queryRaw<Candidate[]>`
      SELECT "id", "embedding" <=> ${vector}::vector AS distance
      FROM ${table}
      WHERE "embedding" IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${limit}
    `,
  ]);
  return rows;
}

async function nearestIds(table: keyof typeof TABLES, vector: string): Promise<Candidate[]> {
  // User.embedding has no HNSW index (see the migration above for why), and
  // stays exact even if one is ever added.
  const rows =
    table === "user"
      ? await exactNearest(TABLES[table], vector, CANDIDATE_LIMIT)
      : await approximateNearest(TABLES[table], vector, CANDIDATE_LIMIT);
  return rows.filter((r) => r.distance <= MAX_DISTANCE);
}

/**
 * Standalone nearest-neighbor lookup against Post.embedding, parametrized by
 * limit/distance rather than search's fixed CANDIDATE_LIMIT/MAX_DISTANCE —
 * used by src/lib/feed-category.ts for the Home feed's smart category
 * filter, which wants a much larger candidate pool than a search fallback
 * does (it's filtering the primary feed, not suggesting extra results).
 *
 * Always an exact scan: the result is used as a membership set for a feed
 * tab, so an approximate index scan dropping a few of the 500 would make
 * posts vanish from the tab.
 */
export async function nearestPostIds(
  vector: string,
  { limit = 500, maxDistance = MAX_DISTANCE }: { limit?: number; maxDistance?: number } = {},
): Promise<string[]> {
  const rows = await exactNearest(TABLES.post, vector, limit);
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
  const rows = await approximateNearest(CONVERSATION_TABLE, vector, limit);
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

  const [postsWhere] = await Promise.all([getListablePostsWhere(viewerId)]);

  const [people, circles, collabs, rawPosts] = await Promise.all([
    userCandidates.length
      ? prisma.user.findMany({
          where: {
            id: { in: userCandidates.map((c) => c.id), notIn: opts.excludeUserIds },
            status: "ACTIVE",
            // Site admins are invisible platform-wide — see the same
            // exclusion in search/page.tsx's exact-match query.
            isAdmin: false,
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
          where: {
            id: { in: collabCandidates.map((c) => c.id) },
            status: "OPEN",
            visibility: "PUBLIC",
            // Same admin exclusion as search/page.tsx's exact-match collab query.
            author: { isAdmin: false },
          },
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
