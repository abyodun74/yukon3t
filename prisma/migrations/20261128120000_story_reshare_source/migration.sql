-- Story reposts (actions/story-reshare.ts): a durable "made from a post or Muse" marker and a link to the Muse a Story
-- was made from (access checks only, no link is rendered). Additive only: one defaulted column, one nullable column,
-- its index and its SetNull foreign key; nothing existing is altered or dropped. Matches `prisma migrate diff
-- --from-schema <previous schema> --to-schema prisma/schema.prisma --script` for the schema change; it holds no DROP
-- INDEX for the hand-written HNSW indexes. No backfill: existing Stories default to false / NULL and expire within 24h.

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "isReshare" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharedMuseId" TEXT;

-- CreateIndex
CREATE INDEX "Story_sharedMuseId_idx" ON "Story"("sharedMuseId");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_sharedMuseId_fkey" FOREIGN KEY ("sharedMuseId") REFERENCES "Muse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
