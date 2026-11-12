-- Additive only: two new SecurityChallengePurpose values for re-authenticating before deleting an account or
-- exporting its data with an emailed code (accounts without a password). On its own, like every enum-value
-- migration here, so nothing in the same transaction uses the new values.
ALTER TYPE "SecurityChallengePurpose" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE';
ALTER TYPE "SecurityChallengePurpose" ADD VALUE IF NOT EXISTS 'DATA_EXPORT';
