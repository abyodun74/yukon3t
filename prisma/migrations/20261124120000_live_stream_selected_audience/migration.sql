-- Live audience "Only the people I selected" (src/lib/live-audience.ts): one new column, default false, so every
-- existing stream keeps its audience (Everyone / a Circle / one person). Additive only: nothing is altered or dropped.
-- Hand-written to match what `prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma`
-- produces; it holds no DROP INDEX for the hand-written HNSW indexes. The allow-list itself is the existing
-- LiveStreamInvite table (rows not CANCELLED), so no new table.

-- AlterTable
ALTER TABLE "LiveStream" ADD COLUMN     "selectedOnly" BOOLEAN NOT NULL DEFAULT false;
