// Embeddings for semantic/smart search (see src/lib/search-embeddings.ts).
// Same raw-fetch, fail-open-without-key, fail-open-on-error shape as
// src/lib/moderation.ts — a broken/unconfigured embeddings call should
// degrade search back to exact substring matching, never break the page.

import { prisma } from "@/lib/prisma";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_TIMEOUT_MS = 8000;

/** Returns null if no API key is configured or the call fails/times out. */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const input = text.trim();
  if (!apiKey || !input) {
    return null;
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Truncate defensively — the embeddings endpoint has an input token
      // limit and a search query or profile bio should never approach it.
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: input.slice(0, 8000) }),
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const embedding = data.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Formats an embedding as a pgvector literal for use in $queryRaw/$executeRaw. */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// Embedding.embedding is Unsupported() in schema.prisma (Prisma Client has no
// vector type), so every read/write of it goes through $queryRaw/$executeRaw
// rather than the typed API — these four helpers are the only place that
// composes the searchable text per entity, called both from the create/
// update Server Actions and from scripts/backfill-embeddings.ts.

export async function updateUserEmbedding(userId: string, fields: {
  name?: string | null;
  username?: string | null;
  bio?: string | null;
  interests?: string[];
}) {
  const text = [fields.name, fields.username, fields.bio, ...(fields.interests ?? [])]
    .filter(Boolean)
    .join("\n");
  const embedding = await getEmbedding(text);
  if (!embedding) return;
  await prisma.$executeRaw`UPDATE "User" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${userId}`;
}

export async function updateCircleEmbedding(circleId: string, fields: {
  name: string;
  description: string;
  category: string;
}) {
  const text = [fields.name, fields.category, fields.description].filter(Boolean).join("\n");
  const embedding = await getEmbedding(text);
  if (!embedding) return;
  await prisma.$executeRaw`UPDATE "Circle" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${circleId}`;
}

export async function updateCollabEmbedding(collabId: string, fields: {
  title: string;
  description: string;
}) {
  const text = [fields.title, fields.description].filter(Boolean).join("\n");
  const embedding = await getEmbedding(text);
  if (!embedding) return;
  await prisma.$executeRaw`UPDATE "CollabBoardPost" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${collabId}`;
}

export async function updateConversationEmbedding(conversationId: string, fields: { name: string }) {
  const embedding = await getEmbedding(fields.name);
  if (!embedding) return;
  await prisma.$executeRaw`UPDATE "Conversation" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${conversationId}`;
}

export async function updatePostEmbedding(postId: string, content: string) {
  const embedding = await getEmbedding(content);
  if (!embedding) return;
  await prisma.$executeRaw`UPDATE "Post" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${postId}`;
}
