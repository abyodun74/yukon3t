-- Renames the IntentTag enum value DATING -> TRAVEL_TIPS. A true rename
-- (not drop+add) so any existing rows using the old value are preserved
-- automatically rather than requiring a data backfill.
ALTER TYPE "IntentTag" RENAME VALUE 'DATING' TO 'TRAVEL_TIPS';
