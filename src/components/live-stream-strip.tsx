"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { getActiveLiveStreams, startLiveStream } from "@/app/actions/live-streams";
import { getMyCircles } from "@/app/actions/circles";
import { getMyConnectionsForPicker } from "@/app/actions/connections";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { Sheet } from "@/components/sheet";
import { captureError } from "@/lib/error-tracking";

type Stream = {
  id: string;
  title: string;
  host: { id: string; name: string | null; avatarUrl: string | null };
  viewerCount: number;
};
type Circle = { id: string; name: string; parentName: string | null };
type Connection = { id: string; name: string | null };

// The "who can watch" <select> below encodes its three kinds of value into
// one string (plain HTML <select> only ever has one value) — "" for
// Everyone, these two prefixes for a Circle or a specific person. Parsed
// back out via circleIdFrom/targetUserIdFrom rather than threading two
// separate pieces of state through the same control.
const CIRCLE_PREFIX = "circle:";
const USER_PREFIX = "user:";
function circleIdFrom(audience: string) {
  return audience.startsWith(CIRCLE_PREFIX) ? audience.slice(CIRCLE_PREFIX.length) : "";
}
function targetUserIdFrom(audience: string) {
  return audience.startsWith(USER_PREFIX) ? audience.slice(USER_PREFIX.length) : "";
}

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
    case "not_a_connection":
      return "You're not connected with that person.";
    default:
      return "Couldn't go live — try again.";
  }
}

/** "Live now" strip + Go Live entry point, rendered on Home alongside StoryTray. */
export function LiveStreamStrip() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  // Raw <select> value — "", "circle:<id>", or "user:<id>" — see
  // circleIdFrom/targetUserIdFrom above.
  const [audience, setAudience] = useState("");
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [circlesFailed, setCirclesFailed] = useState(false);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionsFailed, setConnectionsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const refetch = useCallback(async () => {
    const { streams: list } = await getActiveLiveStreams();
    setStreams(list);
  }, []);

  // Fires once on mount (a realtime subscription alone only reports *new*
  // signals, not current state) and again on every "changed" broadcast from
  // here on — startLiveStream/endLiveStream publish onto this global
  // channel (see REALTIME_CHANNELS.liveStreams in actions/live-streams.ts).
  // Ref indirection avoids a "setState synchronously within an effect" lint
  // false-positive, same pattern as every other realtime migration here.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  useEffect(() => {
    refetchRef.current();
  }, []);
  useRealtimeEvent(REALTIME_CHANNELS.liveStreams(), "changed", refetch);

  // No .catch previously — a rejected call (a session hiccup, a transient
  // DB error) left `circles` null forever with nothing surfaced, which
  // looked indistinguishable from "you have no Circles": the "Who can
  // watch" picker silently fell back to just "Everyone". Reported live as
  // exactly that.
  const loadCircles = useCallback(() => {
    getMyCircles()
      .then((r) => setCircles(r.circles))
      .catch((err) => {
        setCirclesFailed(true);
        captureError(err, { component: "live-stream-strip", flow: "getMyCircles" });
      });
  }, []);

  useEffect(() => {
    if (composing && circles === null && !circlesFailed) {
      loadCircles();
    }
  }, [composing, circles, circlesFailed, loadCircles]);

  // The retry button's own click handler, not called from the effect above
  // — flipping circlesFailed back to false here just lets that effect's own
  // existing condition fire loadCircles() again on the next render, rather
  // than this handler calling it directly (same "adjust state, let the
  // effect react to it" shape every other effect-driven retry in this app
  // already uses, avoiding a synchronous setState-in-effect).
  function retryCircles() {
    setCirclesFailed(false);
  }

  // Same shape as the circles loader above, independent state — a failure
  // fetching one doesn't block or get confused with the other.
  const loadConnections = useCallback(() => {
    getMyConnectionsForPicker()
      .then((r) => setConnections(r.connections))
      .catch((err) => {
        setConnectionsFailed(true);
        captureError(err, { component: "live-stream-strip", flow: "getMyConnectionsForPicker" });
      });
  }, []);

  useEffect(() => {
    if (composing && connections === null && !connectionsFailed) {
      loadConnections();
    }
  }, [composing, connections, connectionsFailed, loadConnections]);

  function retryConnections() {
    setConnectionsFailed(false);
  }

  const circleId = circleIdFrom(audience);
  const targetUserId = targetUserIdFrom(audience);
  const targetUserName = targetUserId ? (connections?.find((c) => c.id === targetUserId)?.name ?? "this person") : null;

  function goLive() {
    if (!title.trim() || isPending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("title", title.trim());
      if (circleId) fd.set("circleId", circleId);
      if (targetUserId) fd.set("targetUserId", targetUserId);
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

  // Previously an early return of an entirely different, unwrapped <button>
  // — restructured as a plain conditional INSIDE the same returned tree
  // instead, so the Sheet below (holding the "Go live" dialog) stays
  // mounted regardless of which of these two renders, and so closing the
  // dialog can never instantly unmount it mid-exit-animation the way an
  // early return swapping the whole tree would.
  const hasStreams = streams.length > 0;

  return (
    <div>
      {hasStreams ? (
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
      ) : (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-danger hover:border-danger"
        >
          <Radio size={14} />
          Go Live
        </button>
      )}

      <Sheet open={composing} onClose={() => setComposing(false)} title="Go live">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's happening?"
          maxLength={100}
          autoFocus
          className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
        />

        <label className="mt-3 block text-xs font-medium text-foreground-soft">Who can watch</label>
        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          <option value="">Everyone — shown on Home</option>
          {circles && circles.length > 0 && (
            <optgroup label="A Circle">
              {circles.map((c) => (
                <option key={c.id} value={`${CIRCLE_PREFIX}${c.id}`}>
                  {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
                </option>
              ))}
            </optgroup>
          )}
          {connections && connections.length > 0 && (
            <optgroup label="A specific person">
              {connections.map((c) => (
                <option key={c.id} value={`${USER_PREFIX}${c.id}`}>
                  {c.name ?? "Unknown"}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {circlesFailed && (
          <p className="mt-1 text-xs text-danger">
            Couldn&apos;t load your Circles —{" "}
            <button type="button" onClick={retryCircles} className="underline">
              retry
            </button>
            .
          </p>
        )}

        {connectionsFailed && (
          <p className="mt-1 text-xs text-danger">
            Couldn&apos;t load your connections —{" "}
            <button type="button" onClick={retryConnections} className="underline">
              retry
            </button>
            .
          </p>
        )}

        <p className="mt-1 text-xs text-foreground-soft">
          {targetUserId
            ? `Only ${targetUserName} can see or join it — nobody else, not even your other connections.`
            : circleId
              ? "Only members of this Circle can see or join it. It won't appear on Home or anywhere else."
              : "Visible to everyone on Home."}
        </p>

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <button
          type="button"
          disabled={!title.trim() || isPending}
          onClick={goLive}
          className="mt-3 w-full rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Start streaming
        </button>
      </Sheet>
    </div>
  );
}
