-- Gift Universe Phase B: the AuditLog actions every challenge result is recorded under (declared, winners changed,
-- cancelled). The values alone, in a migration of their own (one enum type), before anything writes them. IF NOT
-- EXISTS so a re-run is a no-op. Additive only.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CHALLENGE_DECIDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CHALLENGE_RESULT_EDITED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CHALLENGE_CANCELLED';