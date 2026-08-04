-- CreateEnum
CREATE TYPE "Ringtone" AS ENUM ('CLASSIC', 'CHIME', 'DIGITAL', 'MARIMBA', 'PULSE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ringtone" "Ringtone" NOT NULL DEFAULT 'CLASSIC';
