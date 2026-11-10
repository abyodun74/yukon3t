-- Birthday sharing becomes on by default (step 1 of 2). New enum values only, in a migration of their own: Postgres
-- can't use an enum value in the same transaction that added it, and the next migration's backfill writes 'NONE'.
-- IF NOT EXISTS so a re-run (or a value added by hand while recovering) is a no-op. Additive only: nothing is dropped.

-- An explicit "Off" for "Share my birthday" (User.birthdayAudience). Before this, null meant off, and it was also what
-- every account that had never chosen had.
ALTER TYPE "BirthdayAudience" ADD VALUE IF NOT EXISTS 'NONE';

-- The one-time bell notice to accounts the next migration switches on.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BIRTHDAY_SHARING_ON';
