-- Guest preview (/try, src/lib/guest-preview.ts): marks the one shared, read-only identity guest sessions use, and
-- an analytics event type for each guest session started.
-- AlterEnum
ALTER TYPE "AnalyticsEventType" ADD VALUE 'GUEST_PREVIEW_STARTED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isGuestPreview" BOOLEAN NOT NULL DEFAULT false;
