/**
 * Server-side half of this app's realtime layer — publishes an event onto a
 * Supabase Realtime Broadcast channel via a plain REST call (no supabase-js
 * import needed here; see src/lib/realtime-client.ts for the browser-side
 * subscriber, which does need the SDK to speak the WebSocket protocol).
 *
 * Design decision — broadcasts are thin SIGNALS, never the sensitive payload
 * itself: this app's authorization model lives entirely in Server Actions/
 * API routes (requireUser/requireVerifiedUser + per-resource checks — see
 * CLAUDE.md's "Server Actions are the primary write path"). Supabase
 * Realtime's own access control (private channels + RLS on
 * realtime.messages) is built around Supabase Auth JWTs, which this app
 * doesn't use (NextAuth v5 + a fully custom password path — see CLAUDE.md's
 * "Auth: dual sign-in methods"). Rather than bridging two separate auth
 * systems, every channel here is a PUBLIC broadcast channel carrying only
 * "something changed, go refetch" (e.g. `{ conversationId }`, never message
 * content) — the client's existing, already-authorized fetch (a Server
 * Action or API route) is what actually returns the real data, exactly as
 * it does today on a poll tick. This means a channel name leaking changes
 * nothing security-wise: at most it tells an eavesdropper "activity
 * happened," never what that activity was.
 */

import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

export function isRealtimeConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/** Convenience wrapper for the single most common broadcast shape in this app: "something changed for this user, go refetch." */
export function notifyBadgeChange(userId: string) {
  return publishEvent(REALTIME_CHANNELS.navBadges(userId), "changed");
}

/**
 * Publishes one event onto a channel. Best-effort and never throws — same
 * "an optional integration degrading shouldn't take the mutation down with
 * it" reasoning as pushActivityNotification (src/lib/notify-push.ts): the
 * caller has already committed the real state change to Postgres by the
 * time this runs, so a failed broadcast just means a listener falls back to
 * finding out on their next natural refetch (page navigation, remount)
 * rather than instantly — never a lost write.
 */
export async function publishEvent(
  channel: string,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!isRealtimeConfigured()) return;

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SECRET_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({ messages: [{ topic: channel, event, payload }] }),
    });
    if (!res.ok) {
      console.error(`[realtime] broadcast ${event} on ${channel} failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[realtime] broadcast ${event} on ${channel} failed`, err);
  }
}
