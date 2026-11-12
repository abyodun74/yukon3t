"use client";

import { useActiveLiveStreams } from "@/lib/use-active-live-streams";
import { LiveStreamFeedCard } from "@/components/live-stream-feed-card";

/**
 * Pinned above the post list on Home (src/app/home/page.tsx) — a real card
 * per ongoing public live stream (see LiveStreamFeedCard), appearing shortly
 * after one starts and disappearing shortly after it ends, with no refresh
 * needed. Reads the same list live-stream-strip.tsx's avatar row shows
 * (getActiveLiveStreams: "Everyone" + PUBLIC-Circle streams) through the
 * shared useActiveLiveStreams store, so both make one fetch per change
 * between them, coalesced across bursts of starts/ends — this section is
 * purely additive, it doesn't change or replace that row.
 */
export function LiveStreamFeedSection() {
  const streams = useActiveLiveStreams();

  if (streams.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {streams.map((stream) => (
        <LiveStreamFeedCard key={stream.id} stream={stream} />
      ))}
    </div>
  );
}
