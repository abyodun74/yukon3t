"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { getIncomingCall, getCallStatus, respondToCall, endCall } from "@/app/actions/calls";
import { useCallSession } from "@/lib/call-session";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { RingtonePlayer, type RingtoneId } from "@/lib/ringtones";

type IncomingCall = {
  id: string;
  type: "AUDIO" | "VIDEO";
  caller: { id: string; name: string | null };
};

type ActiveCall = { callId: string; roomUrl: string; token: string; type: "AUDIO" | "VIDEO"; callerName: string };

/** Mounted once, app-wide, for any signed-in user — subscribes for a ring the same way ChatThread subscribes for messages. */
export function IncomingCallListener({ currentUserId }: { currentUserId: string }) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [ringtone, setRingtone] = useState<RingtoneId>("CLASSIC");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const { startSession, endSession } = useCallSession();

  const activeCallRef = useRef(activeCall);
  useEffect(() => {
    activeCallRef.current = activeCall;
  });

  // Read by acceptCall (below) to label the minimized call widget — a plain
  // dependency-array entry would recreate acceptCall on every realtime event.
  const incomingRef = useRef(incoming);
  useEffect(() => {
    incomingRef.current = incoming;
  });

  const checkIncoming = useCallback(async () => {
    const { call, ringtone: userRingtone } = await getIncomingCall();
    // Ignore a response that arrives after a call has since started.
    if (!activeCallRef.current) {
      setIncoming(call as IncomingCall | null);
      if (userRingtone) setRingtone(userRingtone);
    }
  }, []);

  // Fires immediately on mount (in case a call is already ringing by the
  // time this component appears — a cold start from a push notification,
  // or the app just regaining focus) and again whenever a call just ended
  // (there could already be another one waiting) — ref indirection avoids
  // a "setState synchronously within an effect" lint false-positive for
  // what's actually an async fetch-then-setState, same pattern chat-thread's
  // own refetchRef uses.
  const checkIncomingRef = useRef(checkIncoming);
  useEffect(() => {
    checkIncomingRef.current = checkIncoming;
  });
  useEffect(() => {
    if (!activeCall) checkIncomingRef.current();
  }, [activeCall]);

  // Replaces the old 5s ring poll — startCall publishes onto the callee's
  // own call:{userId} channel the instant a call is placed (see
  // REALTIME_CHANNELS.callSignal in actions/calls.ts).
  useRealtimeEvent(!activeCall ? REALTIME_CHANNELS.callSignal(currentUserId) : null, "changed", checkIncoming);

  // Fallback for the caller hanging up mid-call: normally that ejects us
  // from the Daily room, which fires CallFrame's "left-meeting" -> onLeave
  // below. But deleteCallRoom (daily.ts) is best-effort, so if that ejection
  // is delayed or never arrives, this catches the DB's Call.status flipping
  // to ENDED/MISSED independently and tears the call down locally. Replaces
  // the old 5s fallback poll — respondToCall/endCall publish onto this same
  // channel on every status change, so this fires instantly instead.
  const checkActiveCallStatus = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    const result = await getCallStatus(call.callId);
    if (result.error) return;
    if (result.status === "ENDED" || result.status === "MISSED" || result.status === "DECLINED") {
      endSession();
      setActiveCall((current) => (current?.callId === call.callId ? null : current));
    }
  }, [endSession]);
  useRealtimeEvent(
    activeCall ? REALTIME_CHANNELS.callSignal(currentUserId) : null,
    "changed",
    checkActiveCallStatus,
  );

  // Hands the fullscreen/minimizable UI off to the root-mounted
  // GlobalCallFrame the moment the call connects (see call-session.tsx).
  useEffect(() => {
    if (!activeCall) return;
    startSession({
      key: `call:${activeCall.callId}`,
      roomUrl: activeCall.roomUrl,
      token: activeCall.token,
      type: activeCall.type,
      renderer: "direct",
      label: activeCall.callerName,
      onLeave: () => {
        endCall(activeCall.callId);
        setActiveCall(null);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.callId]);

  // Warms the dynamic import CallFrame does on mount as soon as we know a
  // call is ringing, instead of only starting that fetch after Accept is
  // tapped — by the time acceptCall's response comes back, the chunk is
  // already cached and CallFrame's own `import()` resolves instantly.
  useEffect(() => {
    if (!incoming) return;
    import("@daily-co/daily-js");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.id]);

  // Plays the callee's chosen ringtone on loop for as long as a call is
  // actually ringing, and stops the moment it isn't — accepted, declined,
  // hung up by the caller, or this component unmounts.
  const playerRef = useRef<RingtonePlayer | null>(null);
  useEffect(() => {
    if (!incoming) return undefined;
    if (!playerRef.current) playerRef.current = new RingtonePlayer();
    playerRef.current.start(ringtone);
    return () => {
      playerRef.current?.stop();
    };
    // Deliberately keyed on incoming?.id, not incoming itself — a fresh
    // object can come back from a re-check even when it's the same ringing
    // call, and restarting the loop then would glitch the audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.id, ringtone]);

  // Callable by callId directly (not just from `incoming` state) so the
  // notification-tap deep-link handler below can accept/decline a call this
  // component's own subscription hasn't necessarily caught up to yet.
  const acceptCall = useCallback(async (callId: string) => {
    const result = await respondToCall(callId, true);
    if (result.error || !result.roomUrl || !result.token) {
      setIncoming((current) => (current?.id === callId ? null : current));
      return;
    }
    const callerName =
      incomingRef.current?.id === callId ? incomingRef.current.caller.name ?? "Someone" : "Someone";
    setActiveCall({ callId, roomUrl: result.roomUrl, token: result.token, type: result.type, callerName });
    setIncoming((current) => (current?.id === callId ? null : current));
  }, []);

  const declineCall = useCallback(async (callId: string) => {
    await respondToCall(callId, false);
    setIncoming((current) => (current?.id === callId ? null : current));
  }, []);

  async function accept() {
    if (incoming) await acceptCall(incoming.id);
  }

  async function decline() {
    if (incoming) await declineCall(incoming.id);
  }

  // Native Android only: the incoming-call notification (CallMessagingService,
  // native side) opens yukon3t://call?callId=...&action=accept|decline when
  // its Accept/Decline actions are tapped — this is what lets a call raised
  // while the phone was asleep/backgrounded actually be answered/declined,
  // routed through the same respondToCall flow the in-app buttons use.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let cancelled = false;
    let listener: { remove: () => void } | undefined;

    function handleUrl(url: string | undefined) {
      if (!url) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (parsed.protocol !== "yukon3t:" || parsed.hostname !== "call") return;
      const callId = parsed.searchParams.get("callId");
      const action = parsed.searchParams.get("action");
      if (!callId) return;
      if (action === "accept") acceptCall(callId);
      else if (action === "decline") declineCall(callId);
      // No action (notification body tap) — just foregrounding the app is
      // enough; the mount-check above picks up the ringing banner.
    }

    (async () => {
      const { App } = await import("@capacitor/app");
      if (cancelled) return;
      // Cold start: the app was launched by the notification tap, so
      // appUrlOpen (below) never fires for this original launch intent —
      // getLaunchUrl() is what surfaces it instead.
      const launch = await App.getLaunchUrl().catch(() => undefined);
      if (!cancelled) handleUrl(launch?.url);
      // Warm start: app already running, singleTask launch mode routes the
      // tap through onNewIntent, which the plugin surfaces as this event.
      listener = await App.addListener("appUrlOpen", (event) => {
        handleUrl(event.url);
      });
    })();

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, [acceptCall, declineCall]);

  // Once active, the call itself renders via the root-mounted GlobalCallFrame
  // (see the startSession effect above) — nothing left to render here.
  if (activeCall) return null;

  if (!incoming) return null;

  return (
    <div className="fixed inset-x-0 top-4 z-50 mx-auto w-fit rounded-xl border border-line bg-surface p-4 shadow-lg">
      <p className="text-sm">
        <span className="font-semibold">{incoming.caller.name ?? "Someone"}</span> is calling
        {incoming.type === "VIDEO" ? " (video)" : ""}...
      </p>
      <div className="mt-3 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={decline}
          className="flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white"
        >
          <PhoneOff size={16} /> Decline
        </button>
        <button
          type="button"
          onClick={accept}
          className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white"
        >
          {incoming.type === "VIDEO" ? <Video size={16} /> : <Phone size={16} />} Accept
        </button>
      </div>
    </div>
  );
}
