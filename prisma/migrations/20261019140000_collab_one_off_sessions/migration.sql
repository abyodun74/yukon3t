-- Collab one-off sessions move from two columns on CollabBoardPost (one per collab, so scheduling from a second poll
-- replaced the first) to their own table, several per collab. Generated with `prisma migrate diff --from-schema
-- --to-schema --script`, then reordered by hand so the existing data is copied before the old columns are dropped.

-- CreateTable
CREATE TABLE "CollabOneOffSession" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "reminderSentAt" TIMESTAMP(3),
    "pollId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabOneOffSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollabOneOffSession_pollId_key" ON "CollabOneOffSession"("pollId");

-- CreateIndex
CREATE INDEX "CollabOneOffSession_collabId_startsAt_idx" ON "CollabOneOffSession"("collabId", "startsAt");

-- CreateIndex
CREATE INDEX "CollabOneOffSession_startsAt_idx" ON "CollabOneOffSession"("startsAt");

-- AddForeignKey
ALTER TABLE "CollabOneOffSession" ADD CONSTRAINT "CollabOneOffSession_collabId_fkey" FOREIGN KEY ("collabId") REFERENCES "CollabBoardPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabOneOffSession" ADD CONSTRAINT "CollabOneOffSession_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written data copy: each collab's current one-off session becomes one row, keeping its reminder claim, linked to
-- the poll it was scheduled from when one matches (same collab, scheduledAt equal to the session; newest if several).
-- Earlier one-offs a later schedule had already overwritten are gone from the old columns and can't be recovered.
-- The id only has to be unique (one row per collab here); new rows get Prisma's cuid.
INSERT INTO "CollabOneOffSession" ("id", "collabId", "startsAt", "reminderSentAt", "pollId", "createdAt")
SELECT
    'oneoff_' || c."id",
    c."id",
    c."oneOffSessionAt",
    c."oneOffReminderSentAt",
    (
        SELECT p."id"
        FROM "Poll" p
        WHERE p."collabId" = c."id" AND p."scheduledAt" = c."oneOffSessionAt"
        ORDER BY p."updatedAt" DESC
        LIMIT 1
    ),
    CURRENT_TIMESTAMP
FROM "CollabBoardPost" c
WHERE c."oneOffSessionAt" IS NOT NULL;

-- DropIndex
DROP INDEX "CollabBoardPost_oneOffSessionAt_idx";

-- AlterTable
ALTER TABLE "CollabBoardPost" DROP COLUMN "oneOffReminderSentAt",
DROP COLUMN "oneOffSessionAt";
