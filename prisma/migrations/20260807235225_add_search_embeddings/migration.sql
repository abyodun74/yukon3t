-- Enable pgvector for embedding-based semantic search (see
-- src/lib/search-embeddings.ts). Available on Neon and on the local
-- pgvector/pgvector:pg16 dev image (see docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "Circle" ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "CollabBoardPost" ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "embedding" vector(1536);

-- HNSW indexes for approximate cosine-similarity search. Prisma's schema DSL
-- can't express these (embedding is Unsupported()), so they're hand-written
-- here rather than generated from schema.prisma.
CREATE INDEX "Circle_embedding_hnsw_idx" ON "Circle" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "CollabBoardPost_embedding_hnsw_idx" ON "CollabBoardPost" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "Post_embedding_hnsw_idx" ON "Post" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "User_embedding_hnsw_idx" ON "User" USING hnsw ("embedding" vector_cosine_ops);
