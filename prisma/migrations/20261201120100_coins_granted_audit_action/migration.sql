-- Gift marketplace: the AuditLog action an admin's Y3T Coins grant is recorded under (src/app/actions/coins.ts). The
-- value alone, in a migration of its own, before anything writes it. IF NOT EXISTS so a re-run is a no-op. Additive
-- only.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COINS_GRANTED';
