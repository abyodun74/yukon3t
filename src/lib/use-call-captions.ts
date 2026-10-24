"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import {
  getCallCaptionsState,
  heartbeatCallCaptionSession,
  setCallCaptionsConsent,
  startCallCaptionSession,
  stopCallCaptionSession,
  translateCallCaption,
  type CallCaptionsState,
  type CaptionStopReason,
} from "@/app/actions/call-captions";
import {
  CALL_CAPTION_STATE_POLL_MS,
  captionFromAppMessage,
  captionMessage,
  captionSignal,
  captionSignalFromAppMessage,
  errorCodeFromRealtimeEvent,
  transcriptFromRealtimeEvent,
  type CaptionPhase,
} from "@/lib/call-captions";
import {
  addCaption,
  nextExpiryAt,
  setCaptionTranslation,
  visibleCaptions,
  type CaptionItem,
} from "@/lib/call-caption-queue";
import { detectLanguage, isTranslatable } from "@/lib/translation";
import type { Locale } from "@/lib/i18n/locales";

// The browser half of live translated captions in a 1:1 call (the full picture: src/lib/call-captions.ts).
// - Reads the caption state from the server (on mount, every CALL_CAPTION_STATE_POLL_MS, and whenever the other
//   phone signals a change or rejoins); the server alone decides whether captions are on.
// - While they are on, transcribes THIS phone's microphone only: a copy of the call's own mic track goes to OpenAI
//   over WebRTC (the SDP exchange runs through our server action), finished sentences come back on the data channel
//   and are sent as text to the other phone over Daily. The copy is stopped while the mic is muted or the call is
//   on hold, so nothing is sent then.
// - Shows the other person's sentences, translated into this reader's language by the server.
// Transcript text is only ever held in React state; it is never logged, stored or reported.

export type CaptionNotice =
  | "turned_off"
  | "cap_reached"
  | "peer_cap_reached"
  | "max_duration"
  | "unavailable"
  | "device"
  | "rate_limited";

const NOTICE_MS = 6000;
const MAX_TRANSLATIONS_IN_FLIGHT = 4;
const RESTART_ATTEMPTS = 2;
const RESTART_DELAY_MS = 3000;

function newCaptionId() {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
  return (uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** Whether this browser/WebView can run a transcription connection at all. */
export function captionsSupported(): boolean {
  return typeof window !== "undefined" && typeof window.RTCPeerConnection === "function";
}

type Transcriber = {
  /** Points the connection at the current mic (or at nothing while muted/on hold). */
  setSource: (track: MediaStreamTrack | null) => void;
  stop: () => void;
};

/**
 * One transcription connection to OpenAI for this phone's microphone. `start` is the server action that exchanges
 * the SDP; `onTranscript` gets each finished sentence; `onEnd` is called once if the connection fails or the server
 * stops it (never after `stop()`).
 */
async function openTranscriber({
  callId,
  source,
  onTranscript,
  onEnd,
}: {
  callId: string;
  source: MediaStreamTrack | null;
  onTranscript: (text: string) => void;
  onEnd: (reason: CaptionStopReason | "connection_failed" | "rate_limited") => void;
}): Promise<Transcriber | null> {
  const pc = new RTCPeerConnection();
  let stopped = false;
  let ended = false;
  let sessionId: string | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let currentSource = source;
  let copy: MediaStreamTrack | null = source ? source.clone() : null;

  // The audio transceiver exists from the start (an SDP offer needs one); its track is swapped as the mic changes.
  // Nothing ever comes back on it: a transcription session has no audio output.
  const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
  if (copy) await transceiver.sender.replaceTrack(copy);
  const channel = pc.createDataChannel("oai-events");

  function cleanup() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    channel.onmessage = null;
    pc.onconnectionstatechange = null;
    copy?.stop();
    copy = null;
    try {
      pc.close();
    } catch {
      // already closed
    }
  }

  function end(reason: Parameters<typeof onEnd>[0]) {
    if (stopped || ended) return;
    ended = true;
    cleanup();
    if (sessionId) void stopCallCaptionSession({ sessionId }).catch(() => {});
    onEnd(reason);
  }

  channel.onmessage = (ev) => {
    const text = transcriptFromRealtimeEvent(ev.data);
    if (text) {
      onTranscript(text);
      return;
    }
    const code = errorCodeFromRealtimeEvent(ev.data);
    // The code only: an error's message can quote what was said.
    if (code) console.warn("[call-captions] transcription error", code);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") end("connection_failed");
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const result = await startCallCaptionSession({ callId, sdp: offer.sdp ?? "" });
    if (stopped) {
      if (result.session) void stopCallCaptionSession({ sessionId: result.session.id }).catch(() => {});
      cleanup();
      return null;
    }
    if (result.error !== null) {
      ended = true;
      cleanup();
      onEnd(result.error === "invalid" ? "unavailable" : result.error);
      return null;
    }
    sessionId = result.session.id;
    await pc.setRemoteDescription({ type: "answer", sdp: result.session.sdp });
    heartbeat = setInterval(() => {
      if (!sessionId) return;
      heartbeatCallCaptionSession({ sessionId })
        .then((beat) => {
          if (beat.stop) end(beat.stop);
        })
        // Offline for a moment: the lease covers a missed beat or two; the cron ends it after that.
        .catch(() => {});
    }, result.session.heartbeatMs);
  } catch {
    if (!stopped) end("connection_failed");
    else cleanup();
    return null;
  }

  return {
    setSource(track) {
      if (stopped || ended || track === currentSource) return;
      currentSource = track;
      const next = track ? track.clone() : null;
      const previous = copy;
      copy = next;
      transceiver.sender.replaceTrack(next).catch(() => {});
      previous?.stop();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const id = sessionId;
      cleanup();
      if (id) void stopCallCaptionSession({ sessionId: id }).catch(() => {});
    },
  };
}

export type CallCaptions = {
  /** Null until the first answer; `available: false` hides the button. */
  state: CallCaptionsState | null;
  phase: CaptionPhase;
  captions: CaptionItem[];
  notice: CaptionNotice | null;
  busy: boolean;
  /** Ask for captions (my agreement), or allow the other person's request: both are the same server call. */
  agree: () => void;
  /** Off for both people, at once. Also "Not now". */
  turnOff: () => void;
};

export function useCallCaptions({
  callId,
  call,
  enabled,
  micTrack,
  micLive,
  locale,
}: {
  callId: string | undefined;
  call: DailyCall | null;
  /** False in a call people were added to, or before the call id is known: everything stops and hides. */
  enabled: boolean;
  /** The call's own local mic track (Daily's persistentTrack), if any. */
  micTrack: MediaStreamTrack | null;
  /** The mic is on and the call isn't on hold: only then does audio go to transcription. */
  micLive: boolean;
  locale: Locale;
}): CallCaptions {
  const [state, setState] = useState<CallCaptionsState | null>(null);
  const [captions, setCaptions] = useState<CaptionItem[]>([]);
  const [notice, setNotice] = useState<CaptionNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const active = enabled && Boolean(callId);
  const phase: CaptionPhase = active && state?.available ? state.phase : "off";

  const phaseRef = useRef(phase);
  const callRef = useRef(call);
  const localeRef = useRef(locale);
  const micRef = useRef<MediaStreamTrack | null>(micLive ? micTrack : null);
  useEffect(() => {
    phaseRef.current = phase;
    callRef.current = call;
    localeRef.current = locale;
    micRef.current = micLive ? micTrack : null;
  });

  // A notice shows for NOTICE_MS; `seq` restarts that time when the same notice comes again.
  const [noticeSeq, setNoticeSeq] = useState(0);
  const showNotice = useCallback((next: CaptionNotice) => {
    setNotice(next);
    setNoticeSeq((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, noticeSeq]);

  const signalPeer = useCallback((signal: Parameters<typeof captionSignal>[0]) => {
    const c = callRef.current;
    if (c && c.meetingState() === "joined-meeting") c.sendAppMessage(captionSignal(signal), "*");
  }, []);

  // ---------- State from the server ----------

  const refresh = useCallback(async () => {
    if (!active || !callId) return;
    try {
      const res = await getCallCaptionsState({ callId });
      if (res.state) setState(res.state);
    } catch {
      // Offline: keep what we have; the next poll or signal tries again.
    }
  }, [active, callId]);

  // Polled only while captions can exist in this call: "not configured", a group call or an ended call won't change.
  const stopPolling = state !== null && !state.available;
  useEffect(() => {
    if (!active || stopPolling) return undefined;
    const poll = setInterval(() => void refresh(), CALL_CAPTION_STATE_POLL_MS);
    return () => clearInterval(poll);
  }, [active, stopPolling, refresh]);
  useEffect(() => {
    if (!active || !callId) return undefined;
    let cancelled = false;
    getCallCaptionsState({ callId })
      .then((res) => {
        if (!cancelled && res.state) setState(res.state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, callId]);

  // Captions stopping, whoever stopped them: whatever is on screen goes with them, and the other person stopping
  // them (or saying "Not now") is said. Adjusted during render (React's pattern for state derived from a change).
  const [seenPhase, setSeenPhase] = useState<CaptionPhase>(phase);
  const [selfTurnedOff, setSelfTurnedOff] = useState(false);
  if (seenPhase !== phase) {
    setSeenPhase(phase);
    if (phase !== "on") setCaptions([]);
    if (phase === "off" && (seenPhase === "on" || seenPhase === "waiting") && !selfTurnedOff) {
      setNotice("turned_off");
      setNoticeSeq((n) => n + 1);
    }
    setSelfTurnedOff(false);
  }

  // ---------- Agreeing and turning off ----------

  const agree = useCallback(() => {
    if (!callId || busy) return;
    setBusy(true);
    setCallCaptionsConsent({ callId, on: true })
      .then((res) => {
        if (res.state) setState(res.state);
        if (res.error === "cap_reached") showNotice("cap_reached");
        else if (res.error === "rate_limited") showNotice("rate_limited");
        else if (res.error) showNotice("unavailable");
        else signalPeer("changed");
      })
      .catch(() => showNotice("unavailable"))
      .finally(() => setBusy(false));
  }, [callId, busy, showNotice, signalPeer]);

  const turnOff = useCallback(() => {
    if (!callId) return;
    setSelfTurnedOff(true);
    // Off here at once, before the server answers: transcription stops and captions clear immediately.
    setState((prev) => (prev?.available ? { ...prev, phase: "off" } : prev));
    setBusy(true);
    setCallCaptionsConsent({ callId, on: false })
      .then((res) => {
        if (res.state) setState(res.state);
        signalPeer("changed");
      })
      .catch(() => showNotice("unavailable"))
      .finally(() => setBusy(false));
  }, [callId, showNotice, signalPeer]);

  // ---------- Receiving: the other person's sentences ----------

  const inFlight = useRef(0);
  const receive = useCallback(
    (id: string, text: string) => {
      if (!callId || phaseRef.current !== "on") return;
      const target = localeRef.current;
      const skip = !isTranslatable(text) || detectLanguage(text) === target || inFlight.current >= MAX_TRANSLATIONS_IN_FLIGHT;
      const now = Date.now();
      setCaptions((prev) => addCaption(prev, { id, text, translation: { status: skip ? "same" : "pending" } }, now));
      if (skip) return;
      inFlight.current += 1;
      translateCallCaption({ callId, text })
        .then((res) => {
          const translation =
            res.status === "translated"
              ? ({ status: "translated", text: res.text } as const)
              : res.status === "same_language"
                ? ({ status: "same" } as const)
                : ({ status: "failed" } as const);
          setCaptions((prev) => setCaptionTranslation(prev, id, translation, Date.now()));
        })
        .catch(() => setCaptions((prev) => setCaptionTranslation(prev, id, { status: "failed" }, Date.now())))
        .finally(() => {
          inFlight.current -= 1;
        });
    },
    [callId],
  );

  useEffect(() => {
    if (!call || !active) return undefined;
    const onAppMessage = (ev: { data: unknown; fromId: string }) => {
      const signal = captionSignalFromAppMessage(ev.data);
      if (signal === "changed") void refresh();
      else if (signal === "cap_reached") showNotice("peer_cap_reached");
      const caption = captionFromAppMessage(ev.data);
      if (caption) receive(caption.id, caption.text);
    };
    // The other phone back in the room (after a drop) may have missed a change, and so may this one.
    const onJoined = () => void refresh();
    call.on("app-message", onAppMessage);
    call.on("participant-joined", onJoined);
    call.on("joined-meeting", onJoined);
    return () => {
      call.off("app-message", onAppMessage);
      call.off("participant-joined", onJoined);
      call.off("joined-meeting", onJoined);
    };
  }, [call, active, refresh, receive, showNotice]);

  // The fade: re-render when the next caption on screen is due to go.
  useEffect(() => {
    const at = nextExpiryAt(captions);
    if (at === null) return undefined;
    const timer = setTimeout(() => setCaptions((prev) => visibleCaptions(prev, Date.now())), Math.max(0, at - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [captions]);

  // ---------- Sending: this phone's own microphone ----------

  const transcriberRef = useRef<Transcriber | null>(null);
  const running = phase === "on" && Boolean(call);
  useEffect(() => {
    if (!running || !callId || !captionsSupported()) return undefined;
    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const sendTranscript = (text: string) => {
      const c = callRef.current;
      if (phaseRef.current !== "on" || !c || c.meetingState() !== "joined-meeting") return;
      c.sendAppMessage(captionMessage(newCaptionId(), text), "*");
    };

    const start = () => {
      if (cancelled) return;
      void openTranscriber({
        callId,
        source: micRef.current,
        onTranscript: sendTranscript,
        onEnd: (reason) => {
          transcriberRef.current = null;
          if (cancelled) return;
          if (reason === "connection_failed" && attempts < RESTART_ATTEMPTS) {
            attempts += 1;
            retryTimer = setTimeout(start, RESTART_DELAY_MS * attempts);
            return;
          }
          if (reason === "cap_reached") {
            showNotice("cap_reached");
            signalPeer("cap_reached");
          } else if (reason === "max_duration") {
            showNotice("max_duration");
            signalPeer("changed");
            void refresh();
          } else if (reason === "consent_required" || reason === "ended") {
            void refresh();
          } else if (reason === "rate_limited") {
            showNotice("rate_limited");
          } else {
            showNotice("unavailable");
          }
        },
      }).then((t) => {
        if (cancelled) {
          t?.stop();
          return;
        }
        transcriberRef.current = t;
        // The mic may have been muted or switched while the connection was being set up.
        t?.setSource(micRef.current);
      });
    };
    start();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      transcriberRef.current?.stop();
      transcriberRef.current = null;
    };
  }, [running, callId, refresh, showNotice, signalPeer]);

  // Muting, hold and a new mic device: the copy follows (or is dropped, so nothing at all is captured for captions).
  const liveTrack = micLive ? micTrack : null;
  useEffect(() => {
    transcriberRef.current?.setSource(liveTrack);
  }, [liveTrack]);

  // A WebView without WebRTC can't transcribe: said for as long as captions are on (the other direction still works).
  const deviceNotice = running && !captionsSupported() ? "device" : null;
  return { state: active ? state : null, phase, captions, notice: notice ?? deviceNotice, busy, agree, turnOff };
}

