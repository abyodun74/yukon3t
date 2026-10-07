"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { getLiveStreamViewerCount } from "@/app/actions/live-streams";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

export type FeedLiveStream = {
  id: string;
  title: string;
  host: { id: string; name: string | null; avatarUrl: string | null };
  viewerCount: number;
};

/**
 * One public live stream, rendered as a real card in the Home feed itself
 * (see LiveStreamFeedSection) — not just an avatar in the existing "Live
 * now" strip above it (live-stream-strip.tsx, kept as-is: that row's own
 * job is quick-glance + the "Go Live" button, this card's is "here's an
 * ongoing stream, with enough to decide how you want to join it").
 *
 * Deliberately NOT a live video preview — autoplaying the actual WebRTC feed
 * for every viewer who merely scrolls past in Home would mean silently
 * joining each of them as a real Daily.co participant in the background,
 * inflating the host's viewer count with people who never chose to watch
 * and multiplying real per-participant cost by "everyone who scrolled past"
 * instead of "everyone who actually tapped in." Watch/Guest/Co-host below
 * each navigate into the real room (src/app/live/[id]/page.tsx) via a
 * `role` query param LiveStreamRoom reads once on mount to skip straight
 * past its own "choosing" screen — nobody is joined to anything just by
 * this card being on screen.
 */
export function LiveStreamFeedCard({ stream }: { stream: FeedLiveStream }) {
  const [viewerCount, setViewerCount] = useState(stream.viewerCount);
  const router = useRouter();

  const refetchCount = async () => {
    const result = await getLiveStreamViewerCount(stream.id);
    setViewerCount(result.count);
  };

  // joinLiveStream/leaveLiveStream both publish onto this stream's own
  // channel (see actions/live-streams.ts) — same per-stream realtime
  // signal live-stream-room.tsx itself reacts to, so this card's count
  // stays live without polling, independent of whether anyone has this
  // specific stream's own room page open right now.
  useRealtimeEvent(REALTIME_CHANNELS.liveStream(stream.id), "changed", refetchCount);

  function join(role: "VIEWER" | "GUEST" | "COHOST") {
    router.push(`/live/${stream.id}?role=${role}`);
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">
          <Radio size={11} />
          LIVE
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground-soft">
          <Eye size={13} />
          {viewerCount} watching
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2.5">
        <UserAvatar avatarUrl={stream.host.avatarUrl} name={stream.host.name} size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{stream.host.name ?? "Someone"} is live</p>
          {stream.title && <p className="truncate text-xs text-foreground-soft">{stream.title}</p>}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => join("VIEWER")}
          className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97]"
        >
          Watch
        </button>
        <button
          type="button"
          onClick={() => join("GUEST")}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-medium transition-transform hover:border-accent hover:text-accent active:scale-[0.97]"
        >
          Join as guest
        </button>
        <button
          type="button"
          onClick={() => join("COHOST")}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-medium transition-transform hover:border-accent hover:text-accent active:scale-[0.97]"
        >
          Join as co-host
        </button>
      </div>
    </div>
  );
}
