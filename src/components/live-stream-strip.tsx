"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Radio, X } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { getActiveLiveStreams, startLiveStream } from "@/app/actions/live-streams";
import { getMyCircles } from "@/app/actions/circles";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 15000;

type Stream = {
  id: string;
  title: string;
  host: { id: string; name: string | null; avatarUrl: string | null };
  viewerCount: number;
};
type Circle = { id: string; name: string };

function startErrorMessage(code?: string) {
  switch (code) {
    case "not_configured":
      return "Live streaming isn't set up yet.";
    case "already_live":
      return "You're already live.";
    case "rate_limited":
      return "Slow down a little and try again.";
    case "not_a_member":
      return "You're not a member of that Circle.";
    default:
      return "Couldn't go live — try again.";
  }
}

/** "Live now" strip + Go Live entry point, rendered on Home alongside StoryTray. */
export function LiveStreamStrip() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [circleId, setCircleId] = useState("");
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const poll = useCallback(async () => {
    const { streams: list } = await getActiveLiveStreams();
    setStreams(list);
  }, []);

  usePolling(poll, POLL_INTERVAL_MS);

  useEffect(() => {
    if (composing && circles === null) {
      getMyCircles().then((r) => setCircles(r.circles));
    }
  }, [composing, circles]);

  function goLive() {
    if (!title.trim() || isPending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("title", title.trim());
      if (circleId) fd.set("circleId", circleId);
      const result = await startLiveStream(fd);
      if (result.error || !result.liveStreamId) {
        setError(startErrorMessage(result.error ?? undefined));
        if (result.error === "already_live" && result.liveStreamId) {
          router.push(`/live/${result.liveStreamId}`);
        }
        return;
      }
      router.push(`/live/${result.liveStreamId}`);
    });
  }

  if (streams.length === 0 && !composing) {
    return (
      <button
        type="button"
        onClick={() => setComposing(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-danger hover:border-danger"
      >
        <Radio size={14} />
        Go Live
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-danger hover:border-danger"
        >
          <Radio size={14} />
          Go Live
        </button>
        {streams.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => router.push(`/live/${s.id}`)}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <div className="relative">
              <UserAvatar avatarUrl={s.host.avatarUrl} name={s.host.name} size={48} className="border-2 border-danger" />
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-danger px-1 text-[9px] font-semibold text-white">
                LIVE
              </span>
            </div>
            <span className="max-w-16 truncate text-xs text-foreground-soft">{s.host.name ?? "Unknown"}</span>
          </button>
        ))}
      </div>

      {composing && (
        <div
          className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setComposing(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Go live</h2>
              <button
                type="button"
                onClick={() => setComposing(false)}
                aria-label="Close"
                className="text-foreground-soft hover:text-danger"
              >
                <X size={18} />
              </button>
            </div>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's happening?"
              maxLength={100}
              autoFocus
              className="mt-3 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
            />

            <label className="mt-3 block text-xs font-medium text-foreground-soft">
              Circle (optional — leave blank to go live to everyone)
            </label>
            <select
              value={circleId}
              onChange={(e) => setCircleId(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="">Everyone</option>
              {circles?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {error && <p className="mt-2 text-xs text-danger">{error}</p>}

            <button
              type="button"
              disabled={!title.trim() || isPending}
              onClick={goLive}
              className="mt-3 w-full rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Start streaming
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
