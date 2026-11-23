-- Idempotent chat sends (sendMessage's clientRequestId; the chat composer's auto-sent voice and video recordings use
-- it): a retried or double-fired send with the same key resolves to the message already stored. Additive only: one
-- nullable column and a unique index on (senderId, clientRequestId); Postgres treats NULLs as distinct, so every
-- existing message (all NULL) is unaffected. Nothing existing is altered or dropped; no DROP INDEX for the hand-written
-- HNSW indexes. No backfill.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_senderId_clientRequestId_key" ON "Message"("senderId", "clientRequestId");
