-- Muse comments and replies can be a GIF (with or without text): actions/muse-comments.ts accepts a Giphy URL
-- (https, *.giphy.com only, the same isGiphyUrl check as post comments and chat GIFs) and stores it here.
-- Hand-written from `prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script`.
-- Additive only: one nullable column and one CHECK constraint. Nothing is dropped, no pgvector HNSW index is touched.

-- AlterTable
ALTER TABLE "MuseComment" ADD COLUMN "gifUrl" TEXT;

-- A comment is text, a GIF, or both; never neither. NOT VALID: checked for every new or updated row from now on
-- without scanning the existing rows (all of which were posted with non-empty text). Prisma doesn't model CHECK
-- constraints and leaves them alone.
ALTER TABLE "MuseComment" ADD CONSTRAINT "MuseComment_text_or_gif_check"
  CHECK ("content" <> '' OR "gifUrl" IS NOT NULL) NOT VALID;
