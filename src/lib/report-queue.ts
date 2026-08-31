// Shared between the Reports queue (src/app/admin/moderation/page.tsx) and
// the resolve-stale-reports cron (src/app/api/cron/resolve-stale-reports) so
// both sides agree on how long a report can sit unresolved.

// How long a report can sit OPEN/REVIEWING with no admin action before the
// resolve-stale-reports cron auto-dismisses it. This never takes an
// enforcement action against the reported user (no warn/suspend/ban, no
// content removal) — same restraint resolve-login-issues uses for
// stuck-unverified accounts, it only stops an unworked backlog from sitting
// in the queue forever.
export const UNRESOLVED_REPORT_CLEAR_AFTER_MS = 72 * 60 * 60 * 1000;
