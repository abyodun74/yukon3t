// Client heartbeat cadence (see presence-heartbeat.tsx) — kept here too so
// the "online" window below can be derived from it instead of duplicating
// the number.
export const HEARTBEAT_INTERVAL_MS = 45_000;

// A bit over 2x the heartbeat interval: tolerates one missed ping (a slow
// network, a backgrounded tab briefly regaining focus) without either field
// flapping between online/offline on every request.
export const ONLINE_WINDOW_MS = HEARTBEAT_INTERVAL_MS * 2 + 30_000;

export function isOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

/** Cutoff for a `lastSeenAt: { gt: onlineSince() }` query — the "online now" filter. */
export function onlineSince(): Date {
  return new Date(Date.now() - ONLINE_WINDOW_MS);
}
