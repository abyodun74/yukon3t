-- CreateEnum
CREATE TYPE "PostsVisibility" AS ENUM ('PUBLIC', 'CONNECTIONS_ONLY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "discoverable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "postsVisibility" "PostsVisibility" NOT NULL DEFAULT 'PUBLIC';
