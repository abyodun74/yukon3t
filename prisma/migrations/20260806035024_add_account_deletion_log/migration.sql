-- CreateTable
CREATE TABLE "AccountDeletionLog" (
    "id" TEXT NOT NULL,
    "deletedUserId" TEXT NOT NULL,
    "deletedEmail" TEXT NOT NULL,
    "deletedUsername" TEXT,
    "reason" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionLog_pkey" PRIMARY KEY ("id")
);
