-- Public-holiday reminders (src/lib/holidays.ts), step 1 of 2. The new notification type only, in a migration of its
-- own: Postgres can't use an enum value in the same transaction that added it. IF NOT EXISTS so a re-run (or a value
-- added by hand while recovering) is a no-op. Additive only: nothing is dropped.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HOLIDAY_TODAY';
