"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { LiveStreamPreviewEmbed } from "@/components/live-stream-preview-embed";
import { getLiveStreamViewerCount } from "@/app/actions/live-streams";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { createTrailingThrottle, liveStreamSignalKind } from "@/lib/live-stream-signal";

export type FeedLiveStream = {
  id: string;
  title: string;
  host: { id: string; name: string | null; avatarUrl: string | null };
  viewerCount: number;
};

// Most of the card has to actually be on screen before it counts as "being
// looked at" — same feed convention as use-autoplay-on-view.ts's own
// threshold, just a little higher since joining costs more than play().
const VISIBILITY_THRESHOLD = 0.5;
// Asymmetric on purpose: slow to start (a fast scroll-by must never join
// anything), slower still to stop (a user nudging the card's edge back and
// forth shouldn't thrash join/leave on the same room).
const ENTER_GRACE_MS = 500;
const LEAVE_GRACE_MS = 1500;
// Same cap as the room's own presence-driven count (live-stream-room.tsx):
// a busy stream's join/leave churn re-reads the count at most this often.
const COUNT_REFETCH_INTERVAL_MS = 5000;

/**
 * One public live stream, rendered as a real card in the Home feed itself
 * (see LiveStreamFeedSection) — not just an avatar in the existing "Live
 * now" strip above it (live-stream-strip.tsx, kept as-is: that row's own
 * job is quick-glance + the "Go Live" button, this card's is "here's an
 * ongoing stream, with enough to decide how you want to join it").
 *
 * The card plays the actual ongoing stream (LiveStreamPreviewEmbed): a
 * genuine Daily.co WebRTC viewer connection to the same room /live/[id]
 * joins, not a thumbnail or a polled image. That means a card someone
 * actually looks at IS a real, counted viewer of that stream, with real
 * per-participant cost — deliberate, per an explicit product decision, and
 * the entire point of the feature rather than a bug to design around.
 *
 * What keeps that bounded is the IntersectionObserver below, not the list:
 * being in Home's stream list joins nothing. Only a card that stays at least
 * VISIBILITY_THRESHOLD on screen continuously for ENTER_GRACE_MS joins, and
 * it leaves again LEAVE_GRACE_MS after scrolling back out — so a normal
 * scroll past never joins, while a pause on a card does. Unmounting (the
 * stream ends, or Watch/Guest/Co-host navigates away) always tears the embed
 * down regardless of visibility.
 *
 * Watch/Guest/Co-host each navigate into the real room
 * (src/app/live/[id]/page.tsx) via a `role` query param LiveStreamRoom reads
 * once on mount to skip straight past its own "choosing" screen.
 */
export function LiveStreamFeedCard({ stream }: { stream: FeedLiveStream }) {
  const [viewerCount, setViewerCount] = useState(stream.viewerCount);
  const containerRef = useRef<HTMLDivElement>(null);
  const [embedActive, setEmbedActive] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Restarting the timer on every crossing is what makes this a
        // debounce rather than a delay: a card that scrolls in and straight
        // back out never reaches its own grace period.
        if (timer) clearTimeout(timer);
        const visible = entry.isIntersecting;
        timer = setTimeout(() => setEmbedActive(visible), visible ? ENTER_GRACE_MS : LEAVE_GRACE_MS);
      },
      { threshold: VISIBILITY_THRESHOLD },
    );
    observer.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const streamId = stream.id;
  const countThrottle = useMemo(
    () =>
      createTrailingThrottle(() => {
        getLiveStreamViewerCount(streamId)
          .then((result) => setViewerCount(result.count))
          // Fired from a timer — a transient blip just waits for the next signal.
          .catch(() => {});
      }, COUNT_REFETCH_INTERVAL_MS),
    [streamId],
  );
  useEffect(() => () => countThrottle.cancel(), [countThrottle]);

  // joinLiveStream/leaveLiveStream both publish onto this stream's own
  // channel (see actions/live-streams.ts) — same per-stream realtime
  // signal live-stream-room.tsx itself reacts to, so this card's count
  // stays live without polling, independent of whether anyone has this
  // specific stream's own room page open right now. A "comment" signal
  // can't move the count, so it's skipped outright; everything else
  // (including a signal with no recognizable kind) goes through the
  // throttle.
  useRealtimeEvent(REALTIME_CHANNELS.liveStream(streamId), "changed", (payload) => {
    if (liveStreamSignalKind(payload) === "comment") return;
    countThrottle.trigger();
  });

  function join(role: "VIEWER" | "GUEST" | "COHOST") {
    router.push(`/live/${stream.id}?role=${role}`);
  }

  return (
    <div ref={containerRef} className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[0.6875rem] font-semibold text-white">
          <Radio size={11} />
          LIVE
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground-soft">
          <Eye size={13} />
          {viewerCount} watching
        </span>
      </div>

      <div className="mt-2.5 aspect-video overflow-hidden rounded-lg bg-black">
        <LiveStreamPreviewEmbed liveStreamId={stream.id} hostId={stream.host.id} active={embedActive} />
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
