"use client";

import { useEffect } from "react";
import { onVolumeUp } from "@/lib/volume-button";
import { useFeedVideoMuted } from "@/lib/feed-video-mute";

/** Turning the hardware volume up unmutes every feed video (see feed-video-mute.ts) — matches mainstream apps' behavior. No-ops off Android (onVolumeUp never fires there). */
export function FeedVideoVolumeSync() {
  const [, setMuted] = useFeedVideoMuted();

  useEffect(() => onVolumeUp(() => setMuted(false)), [setMuted]);

  return null;
}
