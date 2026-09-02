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
  RELIGIOUS_SPIRITUAL:
    "Religious and spiritual — Quran recitation, Bible verses, prayer, sermons, faith, worship, scripture, religious teachings, devotionals, spirituality.",
  FINANCIAL_TIPS:
    "Financial tips — personal finance, budgeting, saving money, investing, stocks, side hustles, debt payoff, financial literacy, money management advice.",
  HEALTH_WELLNESS:
    "Health and wellness — fitness, exercise, nutrition, diet, mental health, self-care, sleep, medical advice, wellness routines, healthy living.",
  MOTIVATIONAL:
    "Motivational — inspirational quotes, encouragement, personal growth, mindset, discipline, goal-setting, life advice, overcoming adversity, success stories.",
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

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 1;
  // Matches pgvector's `<=>` operator (1 - cosine similarity), which is
  // what nearestPostIds/buildCategoryFilter below use — computed in JS here
  // rather than round-tripping to Postgres since there are only ~10 anchors
  // to compare against.
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Auto-assigns a post's Home feed category from its own content — this is
 * the "smart AI" behind the composer no longer asking authors to pick a
 * Feed section (see post-composer.tsx/circles.ts's createPost). Embeds
 * `text` once and picks whichever CATEGORY_ANCHORS entry it sits closest
 * to by the same cosine distance buildCategoryFilter uses, so a post
 * auto-tagged e.g. HEALTH_WELLNESS is guaranteed to also be the kind of
 * post that tab's own semantic filter would surface. The embedding is
 * returned alongside the category so the caller can persist it to
 * Post.embedding without paying for a second OpenAI call.
 *
 * Falls back to GENERAL — same as a personal photo/update too sparse or
 * generic to land confidently in any topic — whenever there's no
 * embedding (no OPENAI_API_KEY configured, or the call failed/timed out)
 * or no anchor clears CATEGORY_MAX_DISTANCE.
 */
export async function classifyPostCategory(
  text: string,
): Promise<{ category: FeedCategory; embedding: number[] | null }> {
  const embedding = await getEmbedding(text);
  if (!embedding) return { category: "GENERAL", embedding: null };

  const anchorCategories = Object.keys(CATEGORY_ANCHORS) as FeedCategory[];
  const anchorEmbeddings = await Promise.all(
    anchorCategories.map((cat) => getCategoryAnchorEmbedding(cat)),
  );

  let best: { category: FeedCategory; distance: number } | null = null;
  for (let i = 0; i < anchorCategories.length; i++) {
    const anchor = anchorEmbeddings[i];
    if (!anchor) continue;
    const distance = cosineDistance(embedding, anchor);
    if (!best || distance < best.distance) best = { category: anchorCategories[i], distance };
  }

  if (!best || best.distance > CATEGORY_MAX_DISTANCE) {
    return { category: "GENERAL", embedding };
  }
  return { category: best.category, embedding };
}

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
