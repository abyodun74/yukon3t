-- Gift Universe Phase B: a challenge can be reported by one of its participants (Report.targetType CHALLENGE, the
-- Challenge id; the accused is its host). The enum value alone, in a migration of its own like
-- 20261115120000_challenge_result_type. IF NOT EXISTS: a re-run is a no-op.
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'CHALLENGE';