-- Digital gifts (src/lib/gifts.ts): a received gift can be reported (Report.targetType GIFT, the GiftSend id). The enum
-- value alone, in a migration of its own like 20261112180000_gift_received_type. IF NOT EXISTS: a re-run is a no-op.
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'GIFT';
