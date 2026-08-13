// "Smart" Home feed category filter: a category tab (Sports, Entertainment,
// etc.) matches not just posts the author manually tagged with it, but also
// posts whose content is semantically about that topic — e.g. Sports should
// surface a football video someone posted without bothering to change the
// category dropdown off its GENERAL default. Same embedding/pgvector
// machinery as src/lib/search-embeddings.ts's semantic search fallback,
// just anchored to a fixed per-category description instead of a live
// search query.

import type { Prisma } from "@/generated/prisma/client";
import { getEmbedding, toPgVector } from "@/lib/embeddings";
import { nearestPostIds } from "@/lib/search-embeddings";
import { feedCategoryValues } from "@/lib/validations";

export type FeedCategory = (typeof feedCategoryValues)[number];

// GENERAL is deliberately excluded — it's the catch-all every post starts
// with, so a semantic "match" against it would just pull in everything and
// defeat the point of the other filters. It stays an exact-tag-only filter.
const CATEGORY_ANCHORS: Partial<Record<FeedCategory, string>> = {
  OCCUPATIONAL:
    "Occupational — jobs, careers, work life, hiring, workplace advice, professional development, business, entrepreneurship, freelancing.",
  ENTERTAINMENT:
    "Entertainment — movies, music, TV shows, celebrities, comedy, pop culture, gaming, memes, viral videos.",
  POLITICS:
    "Politics — government, elections, policy, political news, activism, public affairs, political commentary.",
  SPORTS:
    "Sports — football, soccer, basketball, tennis, athletics, matches, teams, players, tournaments, sports highlights and videos, fitness competitions.",
  EDUCATIONAL:
    "Educational — learning, tutorials, courses, academic topics, study tips, science, how-to guides, explainers.",
  NEWS: "Local and international news — current events, breaking news, world affairs, community news, journalism.",
};

// A category's anchor text never changes at runtime, so its embedding is
// computed once per server process and reused — no reason to pay an OpenAI
// call on every page load/poll tick for a fixed string.
const anchorEmbeddingCache = new Map<FeedCategory, Promise<number[] | null>>();

function getCategoryAnchorEmbedding(category: FeedCategory): Promise<number[] | null> {
  const anchor = CATEGORY_ANCHORS[category];
  if (!anchor) return Promise.resolve(null);
  let cached = anchorEmbeddingCache.get(category);
  if (!cached) {
    cached = getEmbedding(anchor);
    anchorEmbeddingCache.set(category, cached);
  }
  return cached;
}

// Broader net than search's tuned MAX_DISTANCE=0.65: a category anchor is a
// wide topic description rather than a specific query, so on-topic posts
// naturally sit a bit further from it than a search query sits from its
// best match. Also has to clear posts whose only real content is an
// embedded video with a sparse/generic caption (the caption text is all
// that gets embedded — see updatePostEmbedding — so e.g. a football
// highlight posted with just "Gunners 4life" as its caption sits further
// out than a fully-described text post would). 0.82 is picked from real
// production data: a real sports-video post with a sparse caption landed at
// 0.788 against the SPORTS anchor, the next-nearest unrelated post at 0.831
// — this sits in between.
const CATEGORY_MAX_DISTANCE = 0.82;

/**
 * Returns the Prisma Post where-fragment for a Home feed category tab, or
 * undefined for the "All" tab (no filter). Combine with other where
 * conditions via `{ AND: [otherWhere, categoryFilter] }` — this fragment may
 * itself contain a top-level OR, so merging it by spreading object keys
 * would silently clobber any OR already on the other side (e.g.
 * getVisiblePostsWhere's visibility OR).
 *
 * Falls back to an exact feedCategory match if no OPENAI_API_KEY is
 * configured or the embedding call fails/times out — same fail-open shape
 * as every other embeddings-backed feature in this codebase.
 */
export async function buildCategoryFilter(
  category: FeedCategory | null,
): Promise<Prisma.PostWhereInput | undefined> {
  if (!category) return undefined;

  const exact: Prisma.PostWhereInput = { feedCategory: category };
  const embedding = await getCategoryAnchorEmbedding(category);
  if (!embedding) return exact;

  const candidateIds = await nearestPostIds(toPgVector(embedding), {
    limit: 500,
    maxDistance: CATEGORY_MAX_DISTANCE,
  });
  if (candidateIds.length === 0) return exact;

  return { OR: [exact, { id: { in: candidateIds } }] };
}
