-- Forwarded chat messages (forwardMessage in src/app/actions/messages.ts): a flag only, no source reference.
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "forwarded" BOOLEAN NOT NULL DEFAULT false;
