ALTER TABLE "LiveStream" ADD COLUMN "targetUserId" TEXT;

ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "LiveStream_targetUserId_idx" ON "LiveStream"("targetUserId");
