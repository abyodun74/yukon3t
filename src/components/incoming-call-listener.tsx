"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { getIncomingCall, respondToCall, endCall } from "@/app/actions/calls";
import { CallFrame } from "@/components/call-frame";
import { usePolling } from "@/lib/use-polling";
import { RingtonePlayer, type RingtoneId } from "@/lib/ringtones";

const POLL_INTERVAL_MS = 5000;

type IncomingCall = {
  id: string;
  type: "AUDIO" | "VIDEO";
  caller: { id: string; name: string | null };
};

type ActiveCall = { callId: string; roomUrl: string; token: string; type: "AUDIO" | "VIDEO" };

/** Mounted once, app-wide, for any signed-in user — polls for a ring the same way ChatThread polls for messages. */
export function IncomingCallListener() {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [ringtone, setRingtone] = useState<RingtoneId>("CLASSIC");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  const activeCallRef = useRef(activeCall);
  useEffect(() => {
    activeCallRef.current = activeCall;
  });

  const poll = useCallback(async () => {
    const { call, ringtone: userRingtone } = await getIncomingCall();
    // Ignore a response that arrives after a call has since started.
    if (!activeCallRef.current) {
      setIncoming(call as IncomingCall | null);
      if (userRingtone) setRingtone(userRingtone);
    }
  }, []);

  usePolling(poll, POLL_INTERVAL_MS, !activeCall);

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
    // object comes back every 5s poll tick even when it's the same ringing
    // call, and restarting the loop that often would glitch the audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.id, ringtone]);

  async function accept() {
    if (!incoming) return;
    const result = await respondToCall(incoming.id, true);
    if (result.error || !result.roomUrl || !result.token) {
      setIncoming(null);
      return;
    }
    setActiveCall({ callId: incoming.id, roomUrl: result.roomUrl, token: result.token, type: result.type });
    setIncoming(null);
  }

  async function decline() {
    if (!incoming) return;
    await respondToCall(incoming.id, false);
    setIncoming(null);
  }

  if (activeCall) {
    return (
      <CallFrame
        roomUrl={activeCall.roomUrl}
        token={activeCall.token}
        type={activeCall.type}
        onLeave={() => {
          endCall(activeCall.callId);
          setActiveCall(null);
        }}
      />
    );
  }

  if (!incoming) return null;

  return (
    <div className="fixed inset-x-0 top-4 z-50 mx-auto w-fit rounded-xl border border-line bg-surface p-4 shadow-lg">
      <p className="text-sm">
        <span className="font-semibold">{incoming.caller.name ?? "Someone"}</span> is calling
        {incoming.type === "VIDEO" ? " (video)" : ""}...
      </p>
      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={decline}
          className="flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white"
        >
          <PhoneOff size={14} /> Decline
        </button>
        <button
          type="button"
          onClick={accept}
          className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white"
        >
          {incoming.type === "VIDEO" ? <Video size={14} /> : <Phone size={14} />} Accept
        </button>
      </div>
    </div>
  );
}
