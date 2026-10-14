"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { startCall, getCallStatus, endCall } from "@/app/actions/calls";
import { useCallSession } from "@/lib/call-session";
import { prewarmCall, cancelPrewarm } from "@/lib/call-prewarm";
import { startRingback, stopRingback } from "@/lib/ringback";
import { Sheet } from "@/components/sheet";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { isCallOverStatus } from "@/lib/call-resilience";
import { endCallDurably } from "@/lib/end-call-durably";
import { useCallsText } from "@/components/calls-text";
import { byCode, format } from "@/lib/i18n/locales";

type CallType = "AUDIO" | "VIDEO";

type OutgoingState =
  | { phase: "idle" }
  | { phase: "ringing"; callId: string; roomUrl: string; token: string; type: CallType; calleeRinging: boolean }
  | { phase: "in-call"; callId: string; roomUrl: string; token: string; type: CallType }
  // Why it ended, not the sentence: the toast below words it in the reader's language when it shows.
  | { phase: "ended"; reason: "declined" | "ended" | "already_ringing"; name: string | null }
  | { phase: "ended"; reason: "error"; code: string | undefined }
  | { phase: "duplicate"; existingCallId: string; type: CallType };

/** Voice/video call buttons for a connection — used on their profile and in the DM thread header. */
export function CallButton({
  calleeId,
  calleeName,
  currentUserId,
}: {
  calleeId: string;
  /** Null for a connection the data has no name for. */
  calleeName: string | null;
  currentUserId: string;
}) {
  const { t: calls } = useCallsText();
  const t = calls.button;
  const [state, setState] = useState<OutgoingState>({ phase: "idle" });
  const { startSession, endSession, outgoingRingRef } = useCallSession();

  // The "ringing"/"duplicate" dialogs below now stay mounted through their
  // own close animation (Sheet's AnimatePresence — see that file), but
  // `state` itself flips to "idle"/"in-call" in the very same tick the
  // dialog starts closing (cancel()/cancelExistingAndRetry() both change
  // phase and trigger the close together) — without this, the dialog
  // would visibly animate out showing blank content instead of the
  // "Calling.../Cancel" (or "You already have a call...") text it was
  // just showing. Remembers the last ringing/duplicate state so the still-
  // closing dialog has real content to fade out with; adjusted during
  // render (React's documented pattern for this) rather than a useEffect.
  const [displayState, setDisplayState] = useState(state);
  if ((state.phase === "ringing" || state.phase === "duplicate") && state !== displayState) {
    setDisplayState(state);
  }

  // Tracks the prewarm.ts key for a call this side has started joining
  // early (see call()) but the callee hasn't accepted yet — cleared without
  // cancelling once DirectCallFrame adopts it (the "in-call" effect below),
  // or cleared WITH cancelPrewarm wherever this component itself gives up
  // on the call first (cancel()/checkStatus()'s DECLINED/ENDED branches, or
  // this component unmounting mid-ring).
  const pendingPrewarmKeyRef = useRef<string | null>(null);

  // Ref mirror so checkStatus (below) always reads the current phase/callId
  // without needing to be recreated every time state changes — it's used
  // both as a realtime handler (which only takes a payload argument) and
  // called directly on phase-entry. Also what the unmount cleanup below
  // reads, for the same reason.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // This component owns an outgoing ring outright — the "Calling" sheet, the
  // status subscription and the hand-off to the call session all live here —
  // so one that's still ringing when it unmounts (navigating away mid-ring)
  // has nobody left to connect it: the callee's phone would keep ringing,
  // and accepting would leave them alone in a call stuck at ACCEPTED.
  // Unmounting therefore cancels the call, exactly like tapping Cancel.
  // endCall's own RINGING guard covers the callee answering at that same
  // moment (it becomes a normal hang-up instead). Nothing is left to notice
  // a failed request once this has unmounted, hence endCallDurably.
  useEffect(() => {
    return () => {
      if (pendingPrewarmKeyRef.current) cancelPrewarm(pendingPrewarmKeyRef.current);
      const last = stateRef.current;
      if (last.phase === "ringing") endCallDurably(last.callId);
    };
  }, []);

  // Tells the native app's reset-to-Home on resume (capacitor-bridge.tsx)
  // to stand down while this is ringing — that navigation is the most
  // common way this component would get unmounted mid-ring in the first
  // place (switching apps for a moment while waiting for an answer).
  const isRinging = state.phase === "ringing";
  useEffect(() => {
    if (!isRinging) return undefined;
    outgoingRingRef.current = true;
    return () => {
      outgoingRingRef.current = false;
    };
  }, [isRinging, outgoingRingRef]);

  // Hands the fullscreen/minimizable UI off to the root-mounted
  // GlobalCallFrame the moment the call connects, so navigating away doesn't
  // hang up (see src/lib/call-session.tsx).
  useEffect(() => {
    if (state.phase !== "in-call") return;
    // Ownership of any prewarmed join for this call transfers to
    // DirectCallFrame now (it looks itself up by the same key) — this
    // component no longer owns tearing it down.
    pendingPrewarmKeyRef.current = null;
    startSession({
      key: `call:${state.callId}`,
      roomUrl: state.roomUrl,
      token: state.token,
      type: state.type,
      renderer: "direct",
      label: calleeName ?? calls.someone,
      onLeave: () => {
        // Can now be reached with the network still down (a reconnect that
        // ran out of retries), so this keeps retrying after the call UI is
        // gone — see endCallDurably. If it never gets through, the other
        // side's own grace period, or failing that the stale-ACCEPTED sweep,
        // closes the row.
        endCallDurably(state.callId);
        setState({ phase: "idle" });
      },
      isOver: async () => {
        const result = await getCallStatus(state.callId);
        return result.error ? true : isCallOverStatus(result.status);
      },
      call: { callId: state.callId, currentUserId },
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
      // Declined before ever being adopted by DirectCallFrame — this
      // component still owns the prewarmed join (if any) and has to tear
      // it down itself, or it'd sit connected to an empty room forever.
      if (pendingPrewarmKeyRef.current) {
        cancelPrewarm(pendingPrewarmKeyRef.current);
        pendingPrewarmKeyRef.current = null;
      }
      setState({ phase: "ended", reason: "declined", name: calleeName });
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
      // Same as the DECLINED branch above — only matters if this is firing
      // for a call that was still ringing (never adopted), but harmless to
      // check unconditionally since the ref is already null once adopted.
      if (pendingPrewarmKeyRef.current) {
        cancelPrewarm(pendingPrewarmKeyRef.current);
        pendingPrewarmKeyRef.current = null;
      }
      setState((s) => (s.phase === "in-call" || s.phase === "ringing" ? { phase: "ended", reason: "ended", name: null } : s));
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
    { resync: "immediate" },
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
        setState({ phase: "ended", reason: "already_ringing", name: null });
      }
      return;
    }
    if (result.error || !result.callId || !result.roomUrl || !result.token) {
      setState({ phase: "ended", reason: "error", code: result.error ?? undefined });
      return;
    }
    const resolvedType = (result.type as CallType) ?? type;
    // Starts joining the Daily room right now, while the callee's phone is
    // still ringing, instead of waiting for them to accept — see
    // call-prewarm.ts for why only the caller's side can do this safely.
    // DirectCallFrame adopts this same-keyed join once (if) the call
    // actually connects; cancelled/declined/unmounted-while-ringing paths
    // elsewhere in this component tear it down if it's never adopted.
    const prewarmKey = `call:${result.callId}`;
    prewarmCall(prewarmKey, { roomUrl: result.roomUrl, token: result.token, type: resolvedType });
    pendingPrewarmKeyRef.current = prewarmKey;
    setState({
      phase: "ringing",
      callId: result.callId,
      roomUrl: result.roomUrl,
      token: result.token,
      type: resolvedType,
      calleeRinging: false,
    });
  }

  // Only reachable from the "ringing" dialog's Cancel button below — once
  // in-call, hanging up goes through GlobalCallFrame (Daily's "left-meeting"
  // -> the onLeave passed to startSession above), not this function.
  function cancel() {
    if (state.phase === "ringing") {
      endCall(state.callId);
      if (pendingPrewarmKeyRef.current) {
        cancelPrewarm(pendingPrewarmKeyRef.current);
        pendingPrewarmKeyRef.current = null;
      }
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

  const voiceCallLabel = calleeName ? format(t.voiceCall, { name: calleeName }) : t.voiceCallUnnamed;
  const videoCallLabel = calleeName ? format(t.videoCall, { name: calleeName }) : t.videoCallUnnamed;
  const endedMessage =
    state.phase !== "ended"
      ? null
      : state.reason === "error"
        ? byCode(t.errors, state.code)
        : state.reason === "declined"
          ? state.name
            ? format(t.declined, { name: state.name })
            : t.declinedUnnamed
          : state.reason === "already_ringing"
            ? t.alreadyRinging
            : t.ended;

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => call("AUDIO")}
          title={voiceCallLabel}
          aria-label={voiceCallLabel}
          className="rounded-lg border border-line p-2.5 -m-0.5 transition-transform hover:border-accent hover:text-accent active:scale-[0.92]"
        >
          <Phone size={16} />
        </button>
        <button
          type="button"
          onClick={() => call("VIDEO")}
          title={videoCallLabel}
          aria-label={videoCallLabel}
          className="rounded-lg border border-line p-2.5 -m-0.5 transition-transform hover:border-accent hover:text-accent active:scale-[0.92]"
        >
          <Video size={16} />
        </button>
      </div>

      <Sheet
        open={state.phase === "ringing"}
        onClose={cancel}
        panelClassName="max-w-xs text-center"
        ariaLabel={calleeName ? format(t.callingLabel, { name: calleeName }) : t.callingLabelUnnamed}
      >
        {displayState.phase === "ringing" && (
          <>
            <p role="status" className="text-sm text-foreground-soft">{displayState.calleeRinging ? t.ringing : t.calling}</p>
            {calleeName && <p dir="auto" className="mt-1 break-words text-lg font-semibold">{calleeName}</p>}
            <button
              type="button"
              onClick={cancel}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-transform active:scale-[0.97]"
            >
              <PhoneOff size={16} /> {t.cancel}
            </button>
          </>
        )}
      </Sheet>

      <Sheet
        open={state.phase === "duplicate"}
        onClose={() => setState({ phase: "idle" })}
        panelClassName="max-w-xs text-center"
        ariaLabel={t.duplicateLabel}
      >
        {displayState.phase === "duplicate" && (
          <>
            <p className="text-sm font-medium">
              {calleeName ? format(t.duplicateTitle, { name: calleeName }) : t.duplicateTitleUnnamed}
            </p>
            <p className="mt-1 text-sm text-foreground-soft">{t.duplicateBody}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={cancelExistingAndRetry}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-transform active:scale-[0.97]"
              >
                <PhoneOff size={16} /> {t.cancelAndRetry}
              </button>
              <button
                type="button"
                onClick={() => setState({ phase: "idle" })}
                className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium transition-transform hover:border-accent hover:text-accent active:scale-[0.97]"
              >
                {t.neverMind}
              </button>
            </div>
          </>
        )}
      </Sheet>

      {state.phase === "ended" && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit rounded-lg border border-line bg-surface px-4 py-2 text-sm shadow-lg">
          {endedMessage}
        </div>
      )}
    </>
  );
}
