-- Gift Universe Phase B (Challenges, src/lib/challenges.ts): the CHALLENGE_RESULT bell notification type alone, in a
-- migration of its own: Postgres can't use an enum value in the same transaction that added it. IF NOT EXISTS so a
-- re-run is a no-op. Additive only: nothing is dropped.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CHALLENGE_RESULT';