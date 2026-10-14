/**
 * Pure decision logic for an error boundary's automatic recovery (lib/error-recovery-client.ts). A page that crashed is
 * first re-fetched in place (Next's `retry()`, which keeps a call in the root layout running), then, if it crashes
 * again straight away, reloaded once. If it still crashes, the error screen stays up: that is the loop guard. Each path
 * has its own record in sessionStorage, and a record only counts for ERROR_RECOVERY_WINDOW_MS, so a page that fails
 * again much later gets a fresh round.
 */

export const ERROR_RECOVERY_KEY = "yukon3t:error-recovery";
export const ERROR_RECOVERY_WINDOW_MS = 30_000;

export type RecoveryStep = "retry" | "reload";
export type RecoveryRecord = { path: string; step: RecoveryStep; at: number };
export type RecoveryAction = RecoveryStep | "show";

export function parseRecoveryRecord(raw: string | null): RecoveryRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RecoveryRecord>;
    return typeof parsed.path === "string" &&
      (parsed.step === "retry" || parsed.step === "reload") &&
      typeof parsed.at === "number"
      ? { path: parsed.path, step: parsed.step, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

/**
 * What to do about a crash on `path`, given the last automatic attempt. `reloadSafe` is false while a reload would
 * destroy something (a call, an upload, a post still sending): then the second step is skipped and the screen shows.
 */
export function nextRecoveryAction({
  path,
  last,
  now,
  online,
  reloadSafe,
}: {
  path: string;
  last: RecoveryRecord | null;
  now: number;
  online: boolean;
  reloadSafe: boolean;
}): RecoveryAction {
  if (!online) return "show";
  const recent = last !== null && last.path === path && now - last.at >= 0 && now - last.at < ERROR_RECOVERY_WINDOW_MS;
  if (!recent) return "retry";
  if (last.step === "retry" && reloadSafe) return "reload";
  return "show";
}
