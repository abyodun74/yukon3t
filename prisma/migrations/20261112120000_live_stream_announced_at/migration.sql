-- Additive: when a live stream's "X is live" notifications were claimed for sending (see LiveStream.announcedAt).
ALTER TABLE "LiveStream" ADD COLUMN "announcedAt" TIMESTAMP(3);

-- Every stream that already exists was announced inline by the old startLiveStream; mark it so the
-- end-inactive-streams cron's retry sweep never announces it a second time.
UPDATE "LiveStream" SET "announcedAt" = "startedAt" WHERE "announcedAt" IS NULL;
