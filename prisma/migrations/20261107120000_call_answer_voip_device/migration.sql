-- Which iPhone answered a call (src/lib/voip-ring-targets.ts): the answer clears the callee's other iPhones' CallKit
-- rings with a VoIP cancel, so at hang-up only the answering iPhone is sent one. Existing rows keep the old behaviour
-- (voipOthersCleared false: every iPhone gets the hang-up cancel). Hand-written: adds columns only, no index changes.
-- AlterTable
ALTER TABLE "Call" ADD COLUMN "voipOthersCleared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "answerVoipTokenId" TEXT;

-- AlterTable
ALTER TABLE "CallParticipant" ADD COLUMN "voipOthersCleared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "answerVoipTokenId" TEXT;
