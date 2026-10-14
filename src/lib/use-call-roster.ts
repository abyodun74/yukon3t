"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCallRoster } from "@/app/actions/calls";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

export type CallRosterEntry = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  status: "RINGING" | "JOINED" | "DECLINED" | "MISSED" | "LEFT";
};

export type CallRoster = {
  /** People have been added to this call — false for a plain 1:1 one. */
  group: boolean;
  /** The call has ended, or this user is no longer part of it. */
  over: boolean;
  participants: CallRosterEntry[];
};

/** While someone is being rung, the roster is also re-read on a timer: a missed signal would otherwise leave "Calling…" up after the ring is over. */
const RINGING_REFRESH_MS = 10_000;

/**
 * Who is in the call a session is showing (see getCallRoster), kept current
 * off the same call:{userId} signal everything else about a call rides on.
 * Null until the first answer arrives, and for a session that isn't a call.
 */
export function useCallRoster(call: { callId: string; currentUserId: string } | undefined) {
  const callId = call?.callId;
  const [loaded, setLoaded] = useState<{ callId: string; roster: CallRoster } | null>(null);

  const refresh = useCallback(async () => {
    if (!callId) return;
    const result = await getCallRoster(callId).catch(() => null);
    if (!result || result.error !== null) return;
    setLoaded({ callId, roster: { group: result.group, over: result.over, participants: result.participants } });
  }, [callId]);

  // Ref indirection for the same reason as incoming-call-listener.tsx's
  // checkIncomingRef: an async fetch-then-setState, not a synchronous one.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    refreshRef.current();
  }, [callId]);

  useRealtimeEvent(call ? REALTIME_CHANNELS.callSignal(call.currentUserId) : null, "changed", refresh);

  const roster = loaded && loaded.callId === callId ? loaded.roster : null;
  const someoneRinging = Boolean(roster?.group && roster.participants.some((p) => p.status === "RINGING"));
  useEffect(() => {
    if (!someoneRinging) return undefined;
    const timer = setInterval(() => refreshRef.current(), RINGING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [someoneRinging]);

  return { roster, refresh };
}

/**
 * What to call a call that has had people added to it, from one person's
 * side: the only other person's name, or "<first> + N". Null for a plain 1:1
 * call, or when nobody else is in it, where the session's own label stands.
 * `someone` is the reader's word for a person the roster has no name for.
 */
export function groupCallLabel(roster: CallRoster | null, selfUserId: string | undefined, someone = "Someone") {
  if (!roster?.group) return null;
  const others = roster.participants.filter((p) => p.status === "JOINED" && p.userId !== selfUserId);
  if (others.length === 0) return null;
  const first = others[0].name ?? someone;
  return others.length === 1 ? first : `${first} + ${others.length - 1}`;
}
