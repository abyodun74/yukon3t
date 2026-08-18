-- CreateEnum
CREATE TYPE "LiveStreamRole" AS ENUM ('VIEWER', 'GUEST', 'COHOST');

-- AlterTable
ALTER TABLE "LiveStreamViewer" ADD COLUMN     "role" "LiveStreamRole" NOT NULL DEFAULT 'VIEWER';
