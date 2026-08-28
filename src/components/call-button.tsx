"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { startCall, getCallStatus, endCall } from "@/app/actions/calls";
import { useCallSession } from "@/lib/call-session";

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
export function CallButton({ calleeId, calleeName }: { calleeId: string; calleeName: string }) {
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
      label: calleeName,
      onLeave: () => {
        endCall(state.callId);
        setState({ phase: "idle" });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "ringing" && state.phase !== "in-call") return undefined;
    const callId = state.callId;
    // Ringing needs a snappy interval so "Calling" -> "Ringing" -> accepted
    // feels responsive; once in-call this is purely a fallback for the
    // other party hanging up (see the "in-call" branch below), so a lighter
    // interval is enough and avoids hammering the server for the whole
    // call's duration.
    const intervalMs = state.phase === "ringing" ? 2000 : 5000;
    const interval = setInterval(async () => {
      const result = await getCallStatus(callId);
      if (result.error) return;
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
        // Normally the callee hanging up ejects us from the Daily room,
        // which fires the session's onLeave (registered above) via
        // GlobalCallFrame. This is the fallback for when that ejection is
        // delayed or never arrives (deleteCallRoom in daily.ts is best-
        // effort) — the DB status is the source of truth either way, so
        // just tear down locally without calling endCall() again (it's
        // already ENDED/MISSED server-side). Also closes the global call
        // widget directly, in case this fires before Daily's own
        // "left-meeting" event does — safe to check `state` (not `s`) here
        // since this closure is re-created fresh each time `state` changes
        // (see the effect's dependency array below).
        if (state.phase === "in-call") endSession();
        setState((s) => (s.phase === "in-call" || s.phase === "ringing" ? { phase: "ended", message: "Call ended." } : s));
      }
    }, intervalMs);
    return () => clearInterval(interval);
  }, [state, calleeName, endSession]);

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
          className="rounded-lg border border-line p-2 hover:border-accent hover:text-accent"
        >
          <Phone size={16} />
        </button>
        <button
          type="button"
          onClick={() => call("VIDEO")}
          title={`Video call ${calleeName}`}
          className="rounded-lg border border-line p-2 hover:border-accent hover:text-accent"
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
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white"
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
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white"
              >
                <PhoneOff size={16} /> Cancel it &amp; call again
              </button>
              <button
                type="button"
                onClick={() => setState({ phase: "idle" })}
                className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
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
