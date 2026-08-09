-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VERIFICATION_EMAIL_SENT';

-- DropIndex
DROP INDEX "Circle_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "CollabBoardPost_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "Post_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "User_embedding_hnsw_idx";
