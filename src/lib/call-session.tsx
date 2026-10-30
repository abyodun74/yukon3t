"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { DailyCall } from "@daily-co/daily-js";
import {
  startActiveCallForeground,
  stopActiveCallForeground,
  requestIgnoreBatteryOptimizationsOnce,
} from "@/lib/call-foreground-native";
import { startScreenCaptureWatch, stopScreenCaptureWatch } from "@/lib/screen-capture-guard";
import { pauseAllPlayingVideos, resumePausedVideos } from "@/lib/video-playback-guard";
import { useReloadHold } from "@/lib/stale-build-client";
import { sessionNeedsWakeLock } from "@/lib/call-resilience";

type StartSessionInput = {
  /** Dedupe key — e.g. `call:${callId}` or `live:${liveStreamId}`. Starting a
   * session with a key that's already active just re-expands it instead of
   * tearing down and rejoining the Daily room. */
  key: string;
  roomUrl: string;
  token: string;
  type: "AUDIO" | "VIDEO";
  activeSpeakerMode?: boolean;
  /** "custom" renders LiveVideoFrame's own hand-rolled video grid instead
   * of CallFrame's Daily Prebuilt iframe — used by live streams, see
   * live-stream-room.tsx and src/components/live-video-frame.tsx for why.
   * "direct" renders DirectCallFrame — the same hand-rolled approach, but
   * for a regular 1:1 call instead of a broadcaster grid, chosen so its
   * draggable self-view has a real local MediaStreamTrack to attach to
   * (Prebuilt's local track isn't actually playable from the parent page —
   * see call-frame.tsx and direct-call-frame.tsx). Used by call-button.tsx
   * and incoming-call-listener.tsx. Omitted (Prebuilt) for Collab. */
  renderer?: "prebuilt" | "custom" | "direct";
  /** Shown in the minimized widget. */
  label: string;
  /** Caller's own cleanup (endCall()/setState/router.push, etc.) — invoked
   * once when the call actually ends, regardless of whether the component
   * that started it is still mounted. */
  onLeave: () => void;
  /** Set only for a 1:1 call (renderer: "direct") — whether the call row
   * has already ended server-side. DirectCallFrame asks this before
   * retrying a dropped connection and while waiting on a vanished peer, so
   * a call the other side ended is torn down instead of rejoined (see
   * call-resilience.ts). Like onLeave, it has to work with whichever
   * component started the call long since unmounted. */
  isOver?: () => Promise<boolean>;
  /** Set only for a 1:1 call (renderer: "direct") — lets GlobalCallFrame
   * offer "Add person" and follow who is in the call (see useCallRoster),
   * again without relying on whichever component started it. */
  call?: { callId: string; currentUserId: string };
  /** Set only for a Collab session — lets GlobalCallFrame offer the
   * "Upload material" control and shared-material overlay while fullscreen
   * (see collab-material.ts), which needs to work regardless of whether
   * CollabSessionRoom's own page is even still mounted underneath. */
  collab?: { collabId: string; conversationId: string };
  /** Set only for a live stream (renderer: "custom") — lets LiveVideoFrame
   * show each other broadcaster's own mute/unmute control only to the
   * actual stream host, never to an approved guest/co-host (who also holds
   * an owner-level Daily token — see daily.ts's createMeetingToken comment
   * — but isn't the host this feature is scoped to). */
  isHost?: boolean;
};

type CallSessionContextValue = {
  session: StartSessionInput | null;
  minimized: boolean;
  dailyCall: DailyCall | null;
  setDailyCall: (call: DailyCall | null) => void;
  startSession: (session: StartSessionInput) => void;
  endSession: () => void;
  /**
   * The user's own hang-up — the in-call Leave/Hang up buttons come
   * through here (iOS's system End button deliberately doesn't yet, see
   * incoming-call-listener.tsx's callDeclined handler). A 1:1 call (renderer:
   * "direct") is ended directly rather than by calling leave() and waiting
   * for "left-meeting": DirectCallFrame treats every "left-meeting" it sees
   * as an involuntary drop to reconnect from, and leave() doesn't even fire
   * one when the call is already out of the room mid-reconnect (confirmed
   * in daily-js: it resolves immediately from the "left-meeting"/"error"
   * states). Everything else still hangs up via leave(), as before.
   */
  hangUp: () => void;
  minimize: () => void;
  expand: () => void;
  /**
   * Daily's own documented pattern for picking up a new permission/token
   * mid-call is leave() then join() again on the same call instance — not a
   * bare join() while already joined (confirmed unsupported: it silently
   * no-ops rather than reconnecting). But that leave() fires "left-meeting",
   * which GlobalCallFrame's onLeave wires straight to endSession() — meant
   * for a real hangup, not an internal reconnect (see live-stream-room.tsx's
   * canSend-token-refresh flow). Setting this ref true around that
   * leave()+join() pair tells GlobalCallFrame to skip endSession() for that
   * one "left-meeting" event.
   */
  reconnectingRef: MutableRefObject<boolean>;
  /**
   * True while a CallButton has an outgoing call ringing — there's no
   * session yet at that point, but the native app's reset-to-Home on resume
   * (capacitor-bridge.tsx) has to leave it alone just the same: navigating
   * unmounts the CallButton that owns the ring.
   */
  outgoingRingRef: MutableRefObject<boolean>;
};

const CallSessionContext = createContext<CallSessionContextValue | null>(null);

// Everything that can change whether this side's camera is on, including a
// rejoin (the local participant is emptied on leaving the room).
const LOCAL_VIDEO_EVENTS = ["participant-updated", "joined-meeting", "left-meeting"] as const;

/** Whether this side's camera is on in `call`, or null when there's no local participant to tell from yet. */
function localVideoOn(call: DailyCall | null): boolean | null {
  const state = call?.participants().local?.tracks.video.state;
  if (state === undefined) return null;
  return state !== "off" && state !== "blocked";
}

/**
 * Root-mounted so a call/live-stream session survives navigating away from
 * whichever page started it (see src/components/global-call-frame.tsx, the
 * one place <CallFrame> actually gets rendered) — CallButton/
 * IncomingCallListener/LiveStreamRoom all register here instead of mounting
 * their own <CallFrame>, keeping their own ringing/duplicate-call/stage UI
 * exactly as before.
 */
export function CallSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StartSessionInput | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [dailyCall, setDailyCall] = useState<DailyCall | null>(null);

  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  const dailyCallRef = useRef(dailyCall);
  useEffect(() => {
    dailyCallRef.current = dailyCall;
  });
  const reconnectingRef = useRef(false);
  const outgoingRingRef = useRef(false);
  // A stale-build reload would hang up the call or drop the live stream.
  useReloadHold("call", session !== null);

  const startSession = useCallback((next: StartSessionInput) => {
    if (sessionRef.current?.key === next.key) {
      setMinimized(false);
      return;
    }
    setSession(next);
    setMinimized(false);
    startActiveCallForeground(next.key, next.label, next.type === "VIDEO");
    requestIgnoreBatteryOptimizationsOnce();
    startScreenCaptureWatch();
    // Fires for both sides of a call — the callee (via
    // IncomingCallListener, which already separately pauses from the
    // moment it starts ringing, before this even runs) and the caller
    // (via CallButton, which has no "ringing" state of its own and only
    // ever reaches this point) — confirmed live that pausing only from
    // the ringing side left a playing video fighting the call's own
    // audio for whoever placed the call.
    pauseAllPlayingVideos();
  }, []);

  const endSession = useCallback(() => {
    setSession(null);
    setMinimized(false);
    setDailyCall(null);
    stopActiveCallForeground();
    stopScreenCaptureWatch();
    resumePausedVideos();
  }, []);

  const hangUp = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    if (current.renderer === "direct") {
      current.onLeave();
      endSession();
      return;
    }
    dailyCallRef.current?.leave();
  }, [endSession]);

  // Only a 1:1 call needs this (see sessionNeedsWakeLock) — the other
  // renderers hand their call object over too, but it's never read for them.
  const directCall = session?.renderer === "direct" ? dailyCall : null;
  const subscribeLocalVideo = useCallback(
    (onChange: () => void) => {
      if (!directCall) return () => {};
      LOCAL_VIDEO_EVENTS.forEach((event) => directCall.on(event, onChange));
      return () => LOCAL_VIDEO_EVENTS.forEach((event) => directCall.off(event, onChange));
    },
    [directCall],
  );
  const directLocalVideoOn = useSyncExternalStore(
    subscribeLocalVideo,
    () => localVideoOn(directCall),
    () => null,
  );

  // Keeps the screen from dimming and locking by itself while there's
  // something on it to watch — an auto-lock mid-call is what backgrounds the
  // page in the first place. Not for a 1:1 audio call, where a lit screen
  // against the user's ear is the bigger problem (see sessionNeedsWakeLock).
  // The browser drops the lock whenever the page is hidden, so it's
  // re-requested each time the page comes back. Best-effort: not every
  // WebView has the API, and a request can be refused (battery saver, page
  // not visible yet) — neither is worth surfacing.
  const wantsWakeLock =
    session !== null &&
    sessionNeedsWakeLock({ renderer: session.renderer, type: session.type, localVideoOn: directLocalVideoOn });
  useEffect(() => {
    if (!wantsWakeLock || !("wakeLock" in navigator)) return;
    let released = false;
    let sentinel: WakeLockSentinel | null = null;

    function acquire() {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (released) {
            lock.release().catch(() => {});
            return;
          }
          sentinel = lock;
        })
        .catch(() => {});
    }

    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", acquire);
      sentinel?.release().catch(() => {});
    };
  }, [wantsWakeLock]);

  const minimize = useCallback(() => setMinimized(true), []);
  const expand = useCallback(() => setMinimized(false), []);

  return (
    <CallSessionContext.Provider
      value={{
        session,
        minimized,
        dailyCall,
        setDailyCall,
        startSession,
        endSession,
        hangUp,
        minimize,
        expand,
        reconnectingRef,
        outgoingRingRef,
      }}
    >
      {children}
    </CallSessionContext.Provider>
  );
}

export function useCallSession() {
  const ctx = useContext(CallSessionContext);
  if (!ctx) throw new Error("useCallSession must be used within a CallSessionProvider");
  return ctx;
}
