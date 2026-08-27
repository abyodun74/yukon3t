// One-off backfill: computes embeddings for every existing User/Circle/
// CollabBoardPost/group Conversation/Post row that doesn't have one yet
// (new rows get theirs at creation time via the Server Actions in
// src/app/actions — see src/lib/embeddings.ts). Run with:
//   npx tsx scripts/backfill-embeddings.ts
//
// Safe to re-run: it only ever selects rows where "embedding" IS NULL.

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  updateUserEmbedding,
  updateCircleEmbedding,
  updateCollabEmbedding,
  updatePostEmbedding,
  updateConversationEmbedding,
} from "@/lib/embeddings";

// OpenAI's embeddings endpoint accepts many requests/min, but there's no
// reason to hammer it during a one-off backfill — small batches with a
// short pause keep this polite without making the script noticeably slower.
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 200;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillUsers() {
  let total = 0;
  while (true) {
    const rows = await prisma.$queryRaw<
      { id: string; name: string | null; username: string | null; bio: string | null; interests: string[] }[]
    >`SELECT "id", "name", "username", "bio", "interests" FROM "User" WHERE "embedding" IS NULL LIMIT ${BATCH_SIZE}`;
    if (rows.length === 0) break;
    for (const row of rows) {
      await updateUserEmbedding(row.id, row);
    }
    total += rows.length;
    console.log(`Users: backfilled ${total}`);
    await sleep(BATCH_DELAY_MS);
  }
}

async function backfillCircles() {
  let total = 0;
  while (true) {
    const rows = await prisma.$queryRaw<
      { id: string; name: string; description: string; category: string[] }[]
    >`SELECT "id", "name", "description", "category" FROM "Circle" WHERE "embedding" IS NULL LIMIT ${BATCH_SIZE}`;
    if (rows.length === 0) break;
    for (const row of rows) {
      await updateCircleEmbedding(row.id, row);
    }
    total += rows.length;
    console.log(`Circles: backfilled ${total}`);
    await sleep(BATCH_DELAY_MS);
  }
}

async function backfillCollabs() {
  let total = 0;
  while (true) {
    const rows = await prisma.$queryRaw<
      { id: string; title: string; description: string }[]
    >`SELECT "id", "title", "description" FROM "CollabBoardPost" WHERE "embedding" IS NULL LIMIT ${BATCH_SIZE}`;
    if (rows.length === 0) break;
    for (const row of rows) {
      await updateCollabEmbedding(row.id, row);
    }
    total += rows.length;
    console.log(`Collabs: backfilled ${total}`);
    await sleep(BATCH_DELAY_MS);
  }
}

async function backfillConversations() {
  let total = 0;
  while (true) {
    const rows = await prisma.$queryRaw<
      { id: string; name: string }[]
    >`SELECT "id", "name" FROM "Conversation" WHERE "isGroup" = true AND "name" IS NOT NULL AND "embedding" IS NULL LIMIT ${BATCH_SIZE}`;
    if (rows.length === 0) break;
    for (const row of rows) {
      await updateConversationEmbedding(row.id, row);
    }
    total += rows.length;
    console.log(`Group chats: backfilled ${total}`);
    await sleep(BATCH_DELAY_MS);
  }
}

async function backfillPosts() {
  let total = 0;
  while (true) {
    const rows = await prisma.$queryRaw<
      { id: string; content: string }[]
    >`SELECT "id", "content" FROM "Post" WHERE "embedding" IS NULL LIMIT ${BATCH_SIZE}`;
    if (rows.length === 0) break;
    for (const row of rows) {
      await updatePostEmbedding(row.id, row.content);
    }
    total += rows.length;
    console.log(`Posts: backfilled ${total}`);
    await sleep(BATCH_DELAY_MS);
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set — aborting backfill.");
    process.exit(1);
  }
  await backfillUsers();
  await backfillCircles();
  await backfillCollabs();
  await backfillConversations();
  await backfillPosts();
  console.log("Backfill complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
