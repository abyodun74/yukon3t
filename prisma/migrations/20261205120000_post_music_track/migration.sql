-- Optional music on posts (src/lib/post-music.ts): a built-in track key, allow-listed in the app. Additive and
-- nullable, so every existing post stays without music (NULL). No index: the column is only read with the row.
ALTER TABLE "Post" ADD COLUMN "musicTrack" TEXT;
