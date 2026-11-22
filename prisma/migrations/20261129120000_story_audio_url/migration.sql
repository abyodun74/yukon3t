-- A Story made from a Muse keeps the Muse's separate sound track (shareMuseToStory copies Muse.audioUrl; the Story
-- viewer plays it in step with the muted video). Additive only: one nullable column and its index, used by the media
-- reference check (findReferencedUrls) so a sound track a Story shares with its Muse is never deleted while in use.
-- Nothing existing is altered or dropped. Matches `prisma migrate diff --from-schema <previous schema> --to-schema
-- prisma/schema.prisma --script`; it holds no DROP INDEX for the hand-written HNSW indexes. No backfill: existing
-- Stories read NULL (the video's own sound, as before) and expire within 24h.

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "audioUrl" TEXT;

-- CreateIndex
CREATE INDEX "Story_audioUrl_idx" ON "Story"("audioUrl");
