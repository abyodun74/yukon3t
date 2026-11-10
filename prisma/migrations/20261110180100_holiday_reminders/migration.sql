-- Public-holiday reminders (src/lib/holidays.ts, the holiday-reminders cron), step 2 of 2. Additive and idempotent:
-- a new column with a default (on for everyone, the opt-out lives in Settings -> Notifications), a new table and its
-- unique key. Nothing to backfill: the cron reads User.country and User.timeZone, which already exist.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "holidayReminders" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE IF NOT EXISTS "HolidayReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "holidayKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "holidayDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HolidayReminder_userId_holidayKey_year_key" ON "HolidayReminder"("userId", "holidayKey", "year");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HolidayReminder_userId_fkey') THEN
    ALTER TABLE "HolidayReminder" ADD CONSTRAINT "HolidayReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
