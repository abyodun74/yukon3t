"use client";

import { useSyncExternalStore } from "react";
import { isCallMediaHoldActive, subscribeCallMediaHold } from "@/lib/video-playback-guard";

/**
 * True while a call is ringing or under way (beginCallMediaHold in video-playback-guard.ts). For a full-screen viewer
 * that drives its own media (the Story viewer): it holds itself while this is true and plays on after, because the
 * call's own pause can't reach a video the viewer's page hold (PageMediaHold) already covers. False on the server.
 */
export function useCallMediaHold(): boolean {
  return useSyncExternalStore(subscribeCallMediaHold, isCallMediaHoldActive, () => false);
}
