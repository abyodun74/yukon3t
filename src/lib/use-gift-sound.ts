"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  armGiftSound,
  hasGiftSoundSession,
  isSilentSwitchPlatform,
  setGiftSoundMuted,
  startGiftSound,
  stopGiftSound,
} from "@/lib/gift-sound";
import { claimSilentSwitchNote, useGiftSoundMuted } from "@/lib/gift-sound-pref";
import type { GiftSoundAccent, GiftSoundCueName } from "@/lib/gift-sound-plan";
import type { GiftTierName } from "@/lib/gifts-data";

/**
 * The gift reveal's sound (gift-sound.ts): starts when the reveal mounts, but only if the tap that opened it armed it;
 * stops on unmount and whenever `stop` is called (the reveal calls it the moment it starts closing). `toggleMuted` and
 * `replay` are tap handlers, so they may (re)create audio. `climaxCount` counts climax cues, for the reveal's glow.
 */
export function useGiftSound({
  tier,
  lowEnd,
  hitMs,
  accent = null,
}: {
  tier: GiftTierName;
  lowEnd: boolean;
  hitMs: number;
  /** The gift's own sound (the Playful Kitten's meow), or null. */
  accent?: GiftSoundAccent | null;
}) {
  const muted = useGiftSoundMuted();
  const [climaxCount, setClimaxCount] = useState(0);
  const [silentNote, setSilentNote] = useState(false);
  const mountedAt = useRef(0);
  const ended = useRef(false);
  const pendingStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef({ tier, lowEnd, hitMs, accent });
  useEffect(() => {
    request.current = { tier, lowEnd, hitMs, accent };
  });

  const begin = useCallback((sinceOpenMs: number) => {
    const { tier: t, lowEnd: low, hitMs: hit, accent: sound } = request.current;
    const started = startGiftSound({
      tier: t,
      lowEnd: low,
      hitMs: Math.max(0, hit - sinceOpenMs),
      accent: sound,
      onCue: (cue: GiftSoundCueName) => {
        if (cue === "climax") setClimaxCount((n) => n + 1);
      },
      onEnded: () => {
        ended.current = true;
      },
    });
    if (started) {
      ended.current = false;
      if (isSilentSwitchPlatform() && claimSilentSwitchNote()) setSilentNote(true);
    }
    return started;
  }, []);

  useEffect(() => {
    // A stop scheduled by an immediate unmount/remount (React's development double effects) is cancelled; a real
    // unmount lets it run on the next task.
    if (pendingStop.current) {
      clearTimeout(pendingStop.current);
      pendingStop.current = null;
    } else {
      mountedAt.current = Date.now();
      begin(0);
    }
    return () => {
      pendingStop.current = setTimeout(() => {
        pendingStop.current = null;
        stopGiftSound();
      }, 0);
    };
  }, [begin]);

  const stop = useCallback(() => stopGiftSound(), []);

  const replay = useCallback(() => {
    stopGiftSound();
    setClimaxCount(0);
    armGiftSound();
    // The words and art restart with this tap too, so the hit is timed from now.
    mountedAt.current = Date.now();
    begin(0);
  }, [begin]);

  const toggleMuted = useCallback(() => {
    if (!muted) {
      setGiftSoundMuted(true);
      return;
    }
    setGiftSoundMuted(false);
    // Muted since the reveal opened: this tap starts the score (never again once it has played to its end).
    if (!hasGiftSoundSession() && !ended.current) {
      armGiftSound();
      begin(Date.now() - mountedAt.current);
    }
  }, [muted, begin]);

  return { muted, toggleMuted, replay, stop, climaxCount, silentNote };
}
