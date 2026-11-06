-- Birthday reminders + wishes (src/lib/birthdays.ts). Generated with `prisma migrate diff` from the previous schema.
-- Nothing to backfill: sharing a birthday is opt-in (birthdayAudience null = off) and timeZone is filled in by the
-- presence heartbeat as people open the app.
-- CreateEnum
CREATE TYPE "BirthdayAudience" AS ENUM ('CONNECTIONS', 'CIRCLES', 'BOTH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BIRTHDAY_TODAY';
ALTER TYPE "NotificationType" ADD VALUE 'BIRTHDAY_WISHES';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthdayAudience" "BirthdayAudience",
ADD COLUMN     "timeZone" TEXT;

-- CreateTable
CREATE TABLE "BirthdayReminder" (
    "id" TEXT NOT NULL,
    "celebrantId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "occasionDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayWish" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "celebrantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayWish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayWishDigest" (
    "id" TEXT NOT NULL,
    "celebrantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "notificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayWishDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BirthdayReminder_recipientId_occasionDate_idx" ON "BirthdayReminder"("recipientId", "occasionDate");

-- CreateIndex
CREATE INDEX "BirthdayReminder_recipientId_createdAt_idx" ON "BirthdayReminder"("recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayReminder_celebrantId_recipientId_year_key" ON "BirthdayReminder"("celebrantId", "recipientId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayWish_messageId_key" ON "BirthdayWish"("messageId");

-- CreateIndex
CREATE INDEX "BirthdayWish_celebrantId_year_idx" ON "BirthdayWish"("celebrantId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayWish_senderId_celebrantId_year_key" ON "BirthdayWish"("senderId", "celebrantId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayWishDigest_notificationId_key" ON "BirthdayWishDigest"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayWishDigest_celebrantId_year_key" ON "BirthdayWishDigest"("celebrantId", "year");

-- CreateIndex
CREATE INDEX "User_birthdayAudience_idx" ON "User"("birthdayAudience");

-- AddForeignKey
ALTER TABLE "BirthdayReminder" ADD CONSTRAINT "BirthdayReminder_celebrantId_fkey" FOREIGN KEY ("celebrantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayReminder" ADD CONSTRAINT "BirthdayReminder_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayWish" ADD CONSTRAINT "BirthdayWish_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayWish" ADD CONSTRAINT "BirthdayWish_celebrantId_fkey" FOREIGN KEY ("celebrantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayWish" ADD CONSTRAINT "BirthdayWish_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayWishDigest" ADD CONSTRAINT "BirthdayWishDigest_celebrantId_fkey" FOREIGN KEY ("celebrantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayWishDigest" ADD CONSTRAINT "BirthdayWishDigest_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

