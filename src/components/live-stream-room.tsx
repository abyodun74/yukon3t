"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { CallFrame } from "@/components/call-frame";
import { joinLiveStream, leaveLiveStream, endLiveStream, getLiveStreamViewerCount } from "@/app/actions/live-streams";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;

type ActiveRoom = { roomUrl: string; token: string };

function joinErrorMessage(code?: string) {
  switch (code) {
    case "not_configured":
      return "Live streaming isn't set up yet.";
    case "not_a_member":
      return "Join that Circle first to watch this stream.";
    case "not_found":
      return "This stream has ended.";
    case "rate_limited":
      return "Slow down a little and try again.";
    default:
      return "Couldn't join the stream — try again.";
  }
}

/** Host-broadcasts/viewers-watch live room — reuses CallFrame as-is (see createLiveStreamRoom's owner_only_broadcast). */
export function LiveStreamRoom({
  liveStreamId,
  isHost,
  title,
  initiallyEnded,
}: {
  liveStreamId: string;
  isHost: boolean;
  title: string;
  initiallyEnded: boolean;
}) {
  const [active, setActive] = useState<ActiveRoom | null>(null);
  const [error, setError] = useState<string | null>(initiallyEnded ? "not_found" : null);
  const [viewerCount, setViewerCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (initiallyEnded) return;
    let cancelled = false;
    joinLiveStream(liveStreamId).then((result) => {
      if (cancelled) return;
      if (result.error || !result.roomUrl || !result.token) {
        setError(result.error ?? "unknown");
        return;
      }
      setActive({ roomUrl: result.roomUrl, token: result.token });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStreamId, initiallyEnded]);

  const poll = useCallback(async () => {
    const { count } = await getLiveStreamViewerCount(liveStreamId);
    setViewerCount(count);
  }, [liveStreamId]);

  usePolling(poll, POLL_INTERVAL_MS, Boolean(active));

  async function handleLeave() {
    if (isHost) {
      await endLiveStream(liveStreamId);
    } else {
      await leaveLiveStream(liveStreamId);
    }
    setActive(null);
    router.push("/home");
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-foreground-soft">{joinErrorMessage(error)}</p>
        <button
          type="button"
          onClick={() => router.push("/home")}
          className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
        >
          Back to Home
        </button>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-foreground-soft">
        {isHost ? "Starting your live stream…" : "Joining live stream…"}
      </div>
    );
  }

  return (
    <>
      <CallFrame roomUrl={active.roomUrl} token={active.token} type="VIDEO" onLeave={handleLeave} />
      <div className="fixed left-3 top-3 z-[61] flex items-center gap-3 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white">
        <span className="flex items-center gap-1 font-semibold text-danger">
          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
          LIVE
        </span>
        <span className="max-w-[40vw] truncate">{title}</span>
        <span className="flex items-center gap-1">
          <Eye size={12} />
          {viewerCount}
        </span>
      </div>
    </>
  );
}
