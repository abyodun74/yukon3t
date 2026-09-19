"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { startCall, getCallStatus, endCall } from "@/app/actions/calls";
import { useCallSession } from "@/lib/call-session";
import { startRingback, stopRingback } from "@/lib/ringback";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

type CallType = "AUDIO" | "VIDEO";

type OutgoingState =
  | { phase: "idle" }
  | { phase: "ringing"; callId: string; roomUrl: string; token: string; type: CallType; calleeRinging: boolean }
  | { phase: "in-call"; callId: string; roomUrl: string; token: string; type: CallType }
  | { phase: "ended"; message: string }
  | { phase: "duplicate"; existingCallId: string; type: CallType };

function callErrorMessage(code?: string) {
  switch (code) {
    case "not_configured":
      return "Calling isn't set up yet.";
    case "not_connected":
      return "You can only call your connections.";
    case "rate_limited":
      return "Too many calls — slow down a little.";
    default:
      return "Couldn't start the call — try again.";
  }
}

/** Voice/video call buttons for a connection — used on their profile and in the DM thread header. */
export function CallButton({
  calleeId,
  calleeName,
  currentUserId,
}: {
  calleeId: string;
  calleeName: string;
  currentUserId: string;
}) {
  const [state, setState] = useState<OutgoingState>({ phase: "idle" });
  const { startSession, endSession } = useCallSession();

  // Hands the fullscreen/minimizable UI off to the root-mounted
  // GlobalCallFrame the moment the call connects, so navigating away doesn't
  // hang up (see src/lib/call-session.tsx).
  useEffect(() => {
    if (state.phase !== "in-call") return;
    startSession({
      key: `call:${state.callId}`,
      roomUrl: state.roomUrl,
      token: state.token,
      type: state.type,
      renderer: "direct",
      label: calleeName,
      onLeave: () => {
        endCall(state.callId);
        setState({ phase: "idle" });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Ringback for the caller — the callee already gets a real ringtone
  // natively (CallForegroundService's "incoming_calls" channel); this is
  // the caller's-side equivalent while waiting for an answer, covering both
  // the "Calling"/"Ringing" sub-states below.
  useEffect(() => {
    if (state.phase !== "ringing") return undefined;
    startRingback();
    return stopRingback;
  }, [state.phase]);

  // Ref mirror so checkStatus (below) always reads the current phase/callId
  // without needing to be recreated every time state changes — it's used
  // both as a realtime handler (which only takes a payload argument) and
  // called directly on phase-entry.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Replaces the old 400ms/5s polling interval — this is the ONLY thing
  // that tells the caller's side the callee has accepted (the callee's own
  // tap starts joining immediately, with no polling/realtime wait involved
  // on their end at all) or hung up/declined, so calls.ts's startCall/
  // getIncomingCall/respondToCall/endCall all publish onto this user's own
  // call:{userId} channel (see REALTIME_CHANNELS.callSignal) to trigger
  // this instantly instead of waiting on a timer.
  const checkStatus = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase !== "ringing" && current.phase !== "in-call") return;
    const callId = current.callId;
    const result = await getCallStatus(callId);
    if (result.error) return;
    // Ignore a response for a call this side has already moved on from.
    if (stateRef.current.phase === "idle" || stateRef.current.phase === "ended") return;
    if ("callId" in stateRef.current && stateRef.current.callId !== callId) return;

    if (result.status === "ACCEPTED") {
      setState((s) =>
        s.phase === "ringing"
          ? { phase: "in-call", callId: s.callId, roomUrl: s.roomUrl, token: s.token, type: s.type }
          : s,
      );
    } else if (result.status === "RINGING" && result.ringing) {
      setState((s) => (s.phase === "ringing" && !s.calleeRinging ? { ...s, calleeRinging: true } : s));
    } else if (result.status === "DECLINED") {
      setState({ phase: "ended", message: `${calleeName} declined the call.` });
    } else if (result.status === "ENDED" || result.status === "MISSED") {
      // Normally the callee hanging up ejects us from the Daily room, which
      // fires the session's onLeave (registered above) via GlobalCallFrame.
      // This is the fallback for when that ejection is delayed or never
      // arrives (deleteCallRoom in daily.ts is best-effort) — the DB status
      // is the source of truth either way, so just tear down locally
      // without calling endCall() again (it's already ENDED/MISSED
      // server-side). Also closes the global call widget directly, in case
      // this fires before Daily's own "left-meeting" event does.
      if (current.phase === "in-call") endSession();
      setState((s) => (s.phase === "in-call" || s.phase === "ringing" ? { phase: "ended", message: "Call ended." } : s));
    }
  }, [calleeName, endSession]);

  // Fires immediately on entering "ringing" (a fresh call, or re-checking
  // after this component re-renders for any other reason won't retrigger —
  // keyed on phase alone since callId is always fresh whenever phase
  // becomes "ringing" in this flow).
  const checkStatusRef = useRef(checkStatus);
  useEffect(() => {
    checkStatusRef.current = checkStatus;
  });
  useEffect(() => {
    if (state.phase === "ringing" || state.phase === "in-call") checkStatusRef.current();
  }, [state.phase]);

  useRealtimeEvent(
    state.phase === "ringing" || state.phase === "in-call" ? REALTIME_CHANNELS.callSignal(currentUserId) : null,
    "changed",
    checkStatus,
  );

  useEffect(() => {
    if (state.phase !== "ended") return undefined;
    const timer = setTimeout(() => setState({ phase: "idle" }), 3000);
    return () => clearTimeout(timer);
  }, [state]);

  async function call(type: CallType) {
    const fd = new FormData();
    fd.set("calleeId", calleeId);
    fd.set("type", type);
    const result = await startCall(fd);
    if (result.error === "already_calling") {
      if (result.existingCallId) {
        setState({ phase: "duplicate", existingCallId: result.existingCallId, type });
      } else {
        setState({ phase: "ended", message: "You already have a call ringing to this person." });
      }
      return;
    }
    if (result.error || !result.callId || !result.roomUrl || !result.token) {
      setState({ phase: "ended", message: callErrorMessage(result.error ?? undefined) });
      return;
    }
    setState({
      phase: "ringing",
      callId: result.callId,
      roomUrl: result.roomUrl,
      token: result.token,
      type: (result.type as CallType) ?? type,
      calleeRinging: false,
    });
  }

  // Only reachable from the "ringing" dialog's Cancel button below — once
  // in-call, hanging up goes through GlobalCallFrame (Daily's "left-meeting"
  // -> the onLeave passed to startSession above), not this function.
  function cancel() {
    if (state.phase === "ringing") {
      endCall(state.callId);
    }
    setState({ phase: "idle" });
  }

  async function cancelExistingAndRetry() {
    if (state.phase !== "duplicate") return;
    const { existingCallId, type } = state;
    setState({ phase: "idle" });
    await endCall(existingCallId);
    await call(type);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => call("AUDIO")}
          title={`Voice call ${calleeName}`}
          aria-label={`Voice call ${calleeName}`}
          className="rounded-lg border border-line p-2.5 -m-0.5 transition-transform hover:border-accent hover:text-accent active:scale-[0.92]"
        >
          <Phone size={16} />
        </button>
        <button
          type="button"
          onClick={() => call("VIDEO")}
          title={`Video call ${calleeName}`}
          aria-label={`Video call ${calleeName}`}
          className="rounded-lg border border-line p-2.5 -m-0.5 transition-transform hover:border-accent hover:text-accent active:scale-[0.92]"
        >
          <Video size={16} />
        </button>
      </div>

      {state.phase === "ringing" && (
        <div className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="animate-modal-panel-in w-full max-w-xs rounded-xl bg-surface p-5 text-center">
            <p className="text-sm text-foreground-soft">{state.calleeRinging ? "Ringing" : "Calling"}</p>
            <p className="mt-1 break-words text-lg font-semibold">{calleeName}</p>
            <button
              type="button"
              onClick={cancel}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-transform active:scale-[0.97]"
            >
              <PhoneOff size={16} /> Cancel
            </button>
          </div>
        </div>
      )}

      {state.phase === "duplicate" && (
        <div className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="animate-modal-panel-in w-full max-w-xs rounded-xl bg-surface p-5 text-center">
            <p className="text-sm font-medium">You already have a call with {calleeName}</p>
            <p className="mt-1 text-sm text-foreground-soft">
              A previous call is still ringing or active. Cancel it and start a new one?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={cancelExistingAndRetry}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-transform active:scale-[0.97]"
              >
                <PhoneOff size={16} /> Cancel it &amp; call again
              </button>
              <button
                type="button"
                onClick={() => setState({ phase: "idle" })}
                className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium transition-transform hover:border-accent hover:text-accent active:scale-[0.97]"
              >
                Never mind
              </button>
            </div>
          </div>
        </div>
      )}

      {state.phase === "ended" && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit rounded-lg border border-line bg-surface px-4 py-2 text-sm shadow-lg">
          {state.message}
        </div>
      )}
    </>
  );
}
