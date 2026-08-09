// Shared between the moderation queue (src/app/admin/moderation/page.tsx)
// and the resolution paths in actions/password-auth.ts, so both sides agree
// on what counts as "stuck" and how long a resolved issue stays visible.

// Signed up but never clicked the confirmation link — until they do,
// loginWithPassword blocks them out entirely. An account only counts as
// "stuck" (and only gets a loginIssueResolvedAt timestamp when it later
// verifies) once it's been unverified longer than this, so brand-new
// signups who just haven't checked their inbox yet aren't flagged.
export const STUCK_UNVERIFIED_AFTER_MS = 60 * 60 * 1000;

// How long a resolved login issue stays under "recently resolved" before
// disappearing from the moderation queue entirely.
export const RESOLVED_LOGIN_ISSUE_VISIBLE_MS = 24 * 60 * 60 * 1000;
