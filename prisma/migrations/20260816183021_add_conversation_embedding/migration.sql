-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "embedding" vector(1536);

-- HNSW index for approximate cosine-similarity search — see the same
-- pattern for User/Circle/CollabBoardPost/Post in
-- 20260807235225_add_search_embeddings.
CREATE INDEX "Conversation_embedding_hnsw_idx" ON "Conversation" USING hnsw ("embedding" vector_cosine_ops);
