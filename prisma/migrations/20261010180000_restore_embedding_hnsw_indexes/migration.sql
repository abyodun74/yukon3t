-- HAND-WRITTEN. Restores the pgvector HNSW indexes that Prisma-generated
-- migrations dropped by accident.
--
-- History: 20260807235225_add_search_embeddings created HNSW indexes on
-- Circle/CollabBoardPost/Post/User.embedding, and
-- 20260816183021_add_conversation_embedding on Conversation.embedding.
-- schema.prisma cannot express them (embedding is Unsupported("vector(1536)")
-- and Prisma has no Hnsw index type), so `prisma migrate dev` sees them as
-- drift and writes a "DROP INDEX" for each into whatever migration it
-- generates next. That is how 20260809133145 (Circle/CollabBoardPost/Post/
-- User) and 20260817213557 (Conversation) removed them.
--
-- THE NEXT `prisma migrate dev` WILL GENERATE THOSE DROP INDEX LINES AGAIN.
-- Delete them from the generated migration before committing (generate with
-- `prisma migrate dev --create-only`, edit, then apply).
-- scripts/check-migrations-no-hnsw-drop.mjs fails `npm test` and every build
-- if one slips through.
--
-- User.embedding is deliberately NOT indexed here: the presence heartbeat
-- updates User.lastSeenAt (an indexed column, so never a HOT update) every
-- 45s per online user, and each such update would insert a new 1536-dim
-- entry into an HNSW index on that table. User semantic search stays on an
-- exact scan — see src/lib/search-embeddings.ts, which also sets
-- hnsw.ef_search for the queries that do use these indexes.
--
-- vector_cosine_ops matches the `<=>` (cosine distance) operator those
-- queries order by, and the original migrations. Requires pgvector >= 0.5.0.

CREATE INDEX IF NOT EXISTS "Circle_embedding_hnsw_idx" ON "Circle" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "CollabBoardPost_embedding_hnsw_idx" ON "CollabBoardPost" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "Post_embedding_hnsw_idx" ON "Post" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "Conversation_embedding_hnsw_idx" ON "Conversation" USING hnsw ("embedding" vector_cosine_ops);
