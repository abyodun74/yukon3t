-- CollabType goes from a fixed enum to free text (like Circle.category),
-- so new collaboration types can be added without a migration. Preserves
-- existing data: casts the enum column to text (keeping each row's current
-- value as plain text), then remaps the 4 old enum keys to their
-- human-readable labels — the same labels COLLAB_TYPES / collab-labels.ts
-- already displayed for them, so this is invisible to existing collabs.

-- AlterTable: cast enum column to text, preserving every row's value
ALTER TABLE "CollabBoardPost" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

-- Remap old enum keys to their human-readable labels
UPDATE "CollabBoardPost" SET "type" = 'Skill Exchange' WHERE "type" = 'SKILL_EXCHANGE';
UPDATE "CollabBoardPost" SET "type" = 'Volunteer' WHERE "type" = 'VOLUNTEER';
UPDATE "CollabBoardPost" SET "type" = 'Study Group' WHERE "type" = 'STUDY_GROUP';
UPDATE "CollabBoardPost" SET "type" = 'Project' WHERE "type" = 'PROJECT';

-- DropEnum: no longer referenced by any column
DROP TYPE "CollabType";
