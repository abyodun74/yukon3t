-- AlterTable
ALTER TABLE "User" ADD COLUMN     "interestsLower" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill existing rows — interestsLower is a lowercased mirror of
-- interests, kept in sync going forward at write time (see
-- completeOnboarding/updateProfile in src/app/actions/profile.ts).
UPDATE "User"
SET "interestsLower" = COALESCE(
  (SELECT array_agg(lower(interest)) FROM unnest("interests") AS interest),
  ARRAY[]::TEXT[]
);
