-- Declining a ringing 1:1 call with a quick reply (declineCallWithReply in actions/calls.ts). Additive only: two
-- nullable columns on "Call", nothing dropped, no index.
ALTER TABLE "Call" ADD COLUMN "declineReply" TEXT;
ALTER TABLE "Call" ADD COLUMN "declineReplyMessageId" TEXT;
