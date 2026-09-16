"use client";

import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function isRealtimeConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

let cachedClient: SupabaseClient | null = null;

function client(): SupabaseClient | null {
  if (!isRealtimeConfigured()) return null;
  if (cachedClient) return cachedClient;
  cachedClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return cachedClient;
}

/**
 * Subscribes to one broadcast event on one channel for the lifetime of the
 * calling component — the direct replacement for usePolling across this
 * app (see src/lib/realtime-server.ts's own doc comment for the "signal
 * only, never sensitive payload" design this pairs with). `handler` fires
 * with the broadcast payload whenever the matching server-side
 * publishEvent() call lands; treat that as "something changed" and re-run
 * whatever already-authorized fetch (a Server Action/API route) used to
 * live behind the poll tick — this hook is the trigger, not the data
 * source.
 *
 * Also calls `handler(null)` once whenever the tab regains visibility — a
 * one-shot resync, not a repeating timer — as a safety net against an
 * event missed while the WebSocket was disconnected (backgrounded mobile
 * WebView, a brief network drop). Callers can tell "a real event, with a
 * payload" apart from "just in case, go check" by whether payload is null.
 *
 * `channel` may be null to skip subscribing entirely (e.g. before the
 * relevant id — a conversationId, a liveStreamId — is known yet).
 */
export function useRealtimeEvent<T = unknown>(
  channel: string | null,
  event: string,
  handler: (payload: T | null) => void,
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const supabase = client();
    if (!supabase || !channel) return undefined;

    const sub = supabase
      .channel(channel)
      .on("broadcast", { event }, ({ payload }) => handlerRef.current(payload as T))
      .subscribe();

    function handleVisibility() {
      if (document.visibilityState === "visible") handlerRef.current(null);
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      supabase.removeChannel(sub);
    };
  }, [channel, event]);
}
