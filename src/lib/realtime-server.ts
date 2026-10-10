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

function isRealtimeConfigured() {
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
      // Awaited inside nearly every mutation — a hung Supabase call must not hang the write.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      console.error(`[realtime] broadcast ${event} on ${channel} failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[realtime] broadcast ${event} on ${channel} failed`, err);
  }
}

export type RealtimeEvent = { channel: string; event: string; payload?: Record<string, unknown> };

// No documented per-request cap on the broadcast endpoint's `messages`
// array was found, so this is a deliberately conservative guess rather than
// a known limit — every payload here is a tiny "go refetch" signal, so 100
// of them stay far below any request-size limit.
export const PUBLISH_EVENTS_CHUNK_SIZE = 100;

/**
 * Batched publishEvent — one POST per PUBLISH_EVENTS_CHUNK_SIZE events
 * instead of one per event, for a fan-out whose size grows with a group's
 * member count (see afterMessageSent in actions/messages.ts). Same contract
 * as publishEvent: best-effort, never throws, no-op until configured; one
 * failed chunk doesn't stop the others.
 */
export async function publishEvents(events: RealtimeEvent[]): Promise<void> {
  if (!isRealtimeConfigured() || events.length === 0) return;

  const chunks: RealtimeEvent[][] = [];
  for (let i = 0; i < events.length; i += PUBLISH_EVENTS_CHUNK_SIZE) {
    chunks.push(events.slice(i, i + PUBLISH_EVENTS_CHUNK_SIZE));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SECRET_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
          },
          body: JSON.stringify({
            messages: chunk.map((e) => ({ topic: e.channel, event: e.event, payload: e.payload ?? {} })),
          }),
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) {
          console.error(`[realtime] batched broadcast of ${chunk.length} events failed: ${res.status} ${await res.text()}`);
        }
      } catch (err) {
        console.error(`[realtime] batched broadcast of ${chunk.length} events failed`, err);
      }
    }),
  );
}
