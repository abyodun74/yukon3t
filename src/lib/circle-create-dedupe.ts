/**
 * Double-submit guard for `createCircle`. The wizard's form could be submitted
 * twice (double-tap, retry) before the redirect landed, creating two Circles
 * (the second with slug `name-1`). A creator making a Circle with the same
 * name (case-insensitive, trimmed) under the same parent within this window is
 * treated as the same submission and resolved to the Circle already made.
 */
export const CIRCLE_CREATE_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

export function normalizeCircleName(name: string): string {
  return name.trim().toLowerCase();
}

/** Text hashed into the per-(creator, name, parent) advisory lock. */
export function circleCreateLockKey(userId: string, name: string, parentId: string | null): string {
  return `${userId}:${normalizeCircleName(name)}:${parentId ?? ""}`;
}

/** Earliest `createdAt` that still counts as a duplicate of a submit made at `now`. */
export function circleDedupeCutoff(now: Date): Date {
  return new Date(now.getTime() - CIRCLE_CREATE_DEDUPE_WINDOW_MS);
}

export type DedupeCandidate = {
  createdById: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
};

/** True when `existing` is the same creator's same-named, same-parent Circle made within the window. */
export function isRecentDuplicateCircle(
  existing: DedupeCandidate,
  input: { userId: string; name: string; parentId: string | null },
  now: Date,
): boolean {
  return (
    existing.createdById === input.userId &&
    normalizeCircleName(existing.name) === normalizeCircleName(input.name) &&
    existing.parentId === input.parentId &&
    existing.createdAt.getTime() >= circleDedupeCutoff(now).getTime() &&
    existing.createdAt.getTime() <= now.getTime() + 1000
  );
}
