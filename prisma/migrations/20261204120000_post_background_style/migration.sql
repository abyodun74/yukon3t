-- Colored-background text posts (src/lib/post-backgrounds.ts): a preset key, allow-listed in the app. Additive and
-- nullable, so every existing post stays an ordinary post (NULL).
ALTER TABLE "Post" ADD COLUMN "backgroundStyle" TEXT;
