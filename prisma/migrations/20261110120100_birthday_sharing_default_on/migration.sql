-- Birthday sharing becomes on by default (step 2 of 2; the enum values were added by 20261110120000_birthday_audience_none).
-- Owner decision 2026-11-10: "Share my birthday" (User.birthdayAudience) is on for everyone, with connections and
-- Circles (BOTH), unless the person turned it off, which is now recorded as NONE instead of null. Generated with
-- `prisma migrate diff` from the previous schema (no DROP INDEX lines: the HNSW indexes are untouched), with the
-- backfill written by hand between the column changes. Every statement is idempotent: a re-run finds no nulls left,
-- and the column/default/NOT NULL changes are no-ops the second time.

-- Which accounts the backfill switched on and haven't had the notice yet (the birthday-reminders cron sends it, once
-- the account is an adult, and clears this).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "birthdaySharingNoticePending" BOOLEAN NOT NULL DEFAULT false;

-- 1. Keep an explicit "Off" off. The old Settings form stored "Off" as null, the same value as "never chose", so the
--    only recorded trace of someone having turned it off is that it was on at some point: someone whose birthday
--    reminded anyone (a BirthdayReminder or BirthdayWish row about them) and whose choice is null now turned it off
--    afterwards. Someone who switched it on and off again before any reminder about them went out left no trace and
--    can't be told apart from someone who never chose (see the report / CLAUDE.md).
UPDATE "User" u
SET "birthdayAudience" = 'NONE'
WHERE u."birthdayAudience" IS NULL
  AND (
    EXISTS (SELECT 1 FROM "BirthdayReminder" r WHERE r."celebrantId" = u."id")
    OR EXISTS (SELECT 1 FROM "BirthdayWish" w WHERE w."celebrantId" = u."id")
  );

-- 2. The shared guest-preview identity never shares a birthday (it has none, but say so explicitly).
UPDATE "User"
SET "birthdayAudience" = 'NONE'
WHERE "birthdayAudience" IS NULL
  AND "isGuestPreview" = true;

-- 3. Everyone else who never chose: on, with connections and Circles, and owed the one-time notice. Site admins are
--    never celebrants (birthdays-data.ts), so they are switched like everyone else but not told their birthday is shared.
--    Under-18s are switched too (sharing only takes effect from BIRTHDAY_MIN_AGE); their notice waits until then.
UPDATE "User"
SET "birthdayAudience" = 'BOTH',
    "birthdaySharingNoticePending" = NOT "isAdmin"
WHERE "birthdayAudience" IS NULL;

-- 4. New accounts start on (every sign-up path relies on this default), and null no longer exists.
ALTER TABLE "User" ALTER COLUMN "birthdayAudience" SET DEFAULT 'BOTH';
ALTER TABLE "User" ALTER COLUMN "birthdayAudience" SET NOT NULL;
