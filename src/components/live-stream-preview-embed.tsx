"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import { joinLiveStream, leaveLiveStream } from "@/app/actions/live-streams";
import { useFeedText } from "@/components/feed-text";
import { useGuestPreview } from "@/components/guest-preview";
import { readyForNewDailyInstance, trackDailyDestroy } from "@/lib/call-prewarm";
import { livePreviewSlot } from "@/lib/live-preview-slot";

/**
 * The actual ongoing stream, playing inside a Home-feed card
 * (LiveStreamFeedCard) — a real Daily.co WebRTC connection to the same room
 * the full /live/[id] page joins, not a thumbnail or a polled image.
 *
 * Deliberately NOT a call "session": it never goes through
 * CallSessionProvider/useCallSession (see call-session.tsx), so it can't
 * minimize, can't appear in the global call widget, and can't survive
 * navigating away — it's a disposable, read-only viewer tied entirely to
 * `active`, the debounced on-screen flag the feed card computes with its own
 * IntersectionObserver. `active` false (or unmount) tears down both halves:
 * the Daily call object and our own server-side LiveStreamViewer row.
 *
 * This participant sends nothing, by construction. join() is passed
 * `startVideoOff`/`startAudioOff` (start muted) *and* `videoSource: false`/
 * `audioSource: false` (daily-js maps a boolean source to its internal
 * allowLocalVideo/allowLocalAudio preload-cache flag, which is forwarded to
 * the call machine on join-meeting) — so no camera/mic device is ever
 * initialized and getUserMedia is never called, meaning nobody scrolling
 * Home is ever prompted for camera/microphone access. Same reasoning
 * call-prewarm.ts already relies on for a callee's pre-accept join. Nothing
 * here ever calls setLocalVideo/setLocalAudio: there is no local media to
 * toggle.
 *
 * Only one preview plays at a time (livePreviewSlot): with several people
 * live, several cards can be on screen at once, and daily-js allows a single
 * call instance per page. The newest card on screen owns the slot; the others
 * show "Connecting…" until it is theirs. A preview also never starts while
 * anything else holds Daily's instance (a call, the full live room), and asks
 * the server for nothing in that case.
 */
export function LiveStreamPreviewEmbed({
  liveStreamId,
  hostId,
  active,
}: {
  liveStreamId: string;
  /** Our own User.id for the stream's host (stream.host.id) — matched against each Daily participant's `user_id`, which createMeetingToken (lib/daily.ts) sets to exactly that. NOT `.owner`: that's true for an approved guest/co-host too (see joinLiveStream's doc comment), so it can't single out the host this card names. */
  hostId: string;
  active: boolean;
}) {
  const { t } = useFeedText();
  // Members only (joining makes a viewer token): a guest preview session (src/lib/guest-preview.ts) sees no live picture.
  const { isGuest } = useGuestPreview();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hostTrack, setHostTrack] = useState<MediaStreamTrack | null>(null);
  const slotId = useId();
  const ownsSlot = useSyncExternalStore(
    livePreviewSlot.subscribe,
    () => livePreviewSlot.owner() === slotId,
    () => false,
  );

  useEffect(() => {
    if (!active || isGuest) return undefined;
    livePreviewSlot.claim(slotId);
    return () => livePreviewSlot.release(slotId);
  }, [active, isGuest, slotId]);

  useEffect(() => {
    if (!active || isGuest || !ownsSlot) return;

    let cancelled = false;
    let call: DailyCall | null = null;
    let joinedAsViewer = false;

    function refreshHostTrack() {
      if (cancelled || !call) return;
      const host = Object.values(call.participants()).find((p) => p.user_id === hostId);
      const video = host?.tracks.video;
      setHostTrack(video?.state === "playable" ? video.persistentTrack ?? null : null);
    }

    function teardown() {
      if (call) {
        call.off("participant-joined", refreshHostTrack);
        call.off("participant-updated", refreshHostTrack);
        call.off("participant-left", refreshHostTrack);
        void trackDailyDestroy(call.destroy());
        call = null;
      }
      if (joinedAsViewer) {
        joinedAsViewer = false;
        // Best-effort and never awaited — same shape as every other cleanup
        // in this codebase (see cancelPrewarm in call-prewarm.ts): a failed
        // leave just leaves a stale LiveStreamViewer row the
        // end-inactive-streams cron already cleans up with the stream.
        leaveLiveStream(liveStreamId).catch(() => {});
      }
      setHostTrack(null);
    }

    // Every failure path below (not configured, rate limited, stream already
    // ended, a network blip, a Daily join rejection) falls back to the
    // "Connecting…" placeholder and nothing else. Someone idly scrolling
    // Home must never be shown an error for a preview they didn't ask for.
    (async () => {
      // Dynamic import, not static — same reasoning as LiveVideoFrame/
      // DirectCallFrame: this package touches browser globals at module
      // load, so it must never be evaluated during SSR of a "use client"
      // component's initial server-rendered pass.
      let DailyIframe: typeof import("@daily-co/daily-js").default;
      try {
        ({ default: DailyIframe } = await import("@daily-co/daily-js"));
        // Let the previous preview's teardown finish (the slot just moved), and never evict anything: if Daily's
        // one instance is still held (a call, the live room), this preview simply doesn't start — before asking
        // the server for a viewer token it couldn't use.
        await readyForNewDailyInstance(DailyIframe, { evictStray: false });
        if (cancelled || DailyIframe.getCallInstance()) return;
      } catch {
        return;
      }

      let roomUrl: string;
      let token: string;
      try {
        const result = await joinLiveStream(liveStreamId);
        if (result.error || !result.roomUrl || !result.token) return;
        joinedAsViewer = true;
        roomUrl = result.roomUrl;
        token = result.token;
      } catch {
        return;
      }
      if (cancelled) {
        teardown();
        return;
      }

      try {
        // createCallObject(), not createFrame() — this renders its own
        // <video> below, exactly like LiveVideoFrame does. avoidEval: true
        // loads the call-machine bundle via a <script> tag instead of a
        // Function()-based eval, which this app's CSP (src/proxy.ts) never
        // allows in production.
        call = DailyIframe.createCallObject({ dailyConfig: { avoidEval: true } });
        call.on("participant-joined", refreshHostTrack);
        call.on("participant-updated", refreshHostTrack);
        call.on("participant-left", refreshHostTrack);

        await call.join({
          url: roomUrl,
          token,
          startVideoOff: true,
          startAudioOff: true,
          videoSource: false,
          audioSource: false,
        });
        if (cancelled) {
          teardown();
          return;
        }
        refreshHostTrack();
      } catch {
        teardown();
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [active, ownsSlot, liveStreamId, hostId, isGuest]);

  // Manual MediaStreamTrack attachment — createCallObject() mode renders
  // nothing of its own, same pattern as LiveVideoFrame's ParticipantTile.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = hostTrack ? new MediaStream([hostTrack]) : null;
  }, [hostTrack]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-cover ${hostTrack ? "" : "hidden"}`}
      />
      {!hostTrack && <span className="text-xs text-white/60">{t.live.connecting}</span>}
    </div>
  );
}
