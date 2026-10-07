"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveLiveStreams } from "@/app/actions/live-streams";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { LiveStreamFeedCard, type FeedLiveStream } from "@/components/live-stream-feed-card";

/**
 * Pinned above the post list on Home (src/app/home/page.tsx) — a real card
 * per ongoing public live stream (see LiveStreamFeedCard), appearing the
 * moment one starts and disappearing the moment it ends, with no refresh
 * needed. Reuses getActiveLiveStreams exactly as-is (the same "Everyone" +
 * PUBLIC-Circle scope live-stream-strip.tsx's own avatar row already uses)
 * and the same REALTIME_CHANNELS.liveStreams() signal that row subscribes
 * to (startLiveStream/endLiveStream both publish onto it) — this section
 * is purely additive, it doesn't change or replace that row.
 */
export function LiveStreamFeedSection() {
  const [streams, setStreams] = useState<FeedLiveStream[]>([]);

  const refetch = useCallback(async () => {
    const { streams: list } = await getActiveLiveStreams();
    setStreams(list);
  }, []);

  // Ref indirection avoids a "setState synchronously within an effect" lint
  // false-positive for what's actually an async fetch-then-setState — same
  // pattern live-stream-strip.tsx's own refetchRef already uses for the
  // identical reason.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  useEffect(() => {
    refetchRef.current();
  }, []);
  useRealtimeEvent(REALTIME_CHANNELS.liveStreams(), "changed", refetch);

  if (streams.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {streams.map((stream) => (
        <LiveStreamFeedCard key={stream.id} stream={stream} />
      ))}
    </div>
  );
}
