"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { DailyCall } from "@daily-co/daily-js";
import {
  startActiveCallForeground,
  stopActiveCallForeground,
  requestIgnoreBatteryOptimizationsOnce,
} from "@/lib/call-foreground-native";

export type StartSessionInput = {
  /** Dedupe key — e.g. `call:${callId}` or `live:${liveStreamId}`. Starting a
   * session with a key that's already active just re-expands it instead of
   * tearing down and rejoining the Daily room. */
  key: string;
  roomUrl: string;
  token: string;
  type: "AUDIO" | "VIDEO";
  activeSpeakerMode?: boolean;
  /** Shown in the minimized widget. */
  label: string;
  /** Caller's own cleanup (endCall()/setState/router.push, etc.) — invoked
   * once when the call actually ends, regardless of whether the component
   * that started it is still mounted. */
  onLeave: () => void;
  /** Set only for a Collab session — lets GlobalCallFrame offer the
   * "Upload material" control and shared-material overlay while fullscreen
   * (see collab-material.ts), which needs to work regardless of whether
   * CollabSessionRoom's own page is even still mounted underneath. */
  collab?: { collabId: string; conversationId: string };
};

type CallSessionContextValue = {
  session: StartSessionInput | null;
  minimized: boolean;
  dailyCall: DailyCall | null;
  setDailyCall: (call: DailyCall | null) => void;
  startSession: (session: StartSessionInput) => void;
  endSession: () => void;
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
};

const CallSessionContext = createContext<CallSessionContextValue | null>(null);

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
  const reconnectingRef = useRef(false);

  const startSession = useCallback((next: StartSessionInput) => {
    if (sessionRef.current?.key === next.key) {
      setMinimized(false);
      return;
    }
    setSession(next);
    setMinimized(false);
    startActiveCallForeground(next.key, next.label, next.type === "VIDEO");
    requestIgnoreBatteryOptimizationsOnce();
  }, []);

  const endSession = useCallback(() => {
    setSession(null);
    setMinimized(false);
    setDailyCall(null);
    stopActiveCallForeground();
  }, []);

  const minimize = useCallback(() => setMinimized(true), []);
  const expand = useCallback(() => setMinimized(false), []);

  return (
    <CallSessionContext.Provider
      value={{ session, minimized, dailyCall, setDailyCall, startSession, endSession, minimize, expand, reconnectingRef }}
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
