"use client";

import { useEffect } from "react";
import { pauseAllPlayingVideos, resumePausedVideos } from "@/lib/video-playback-guard";
import { suspendAutoplayOnView } from "@/lib/use-autoplay-on-view";

/**
 * Holds the page's own media still while a full-screen Story viewer is open over it: pauses whatever was playing
 * behind it (a feed video, another Muse upload) and stops feed videos from starting on their own, then resumes on
 * close. Renders nothing.
 *
 * Mount it ONCE for the viewer's whole life, beside the viewer, never inside the StoryViewer that remounts per
 * person (StoryTrayViewer keys it by authorId). It used to live there, and every move to the next person released
 * and re-took the hold in one commit: the release played the feed videos again, the re-take paused them, but their
 * queued `play` events still reached the one-video-at-a-time rule (installVideoCoordinator) after the next person's
 * story video had started, which paused that video, and nothing ever played it again (2026-11-22, a video Story
 * frozen on its first frame after earlier Stories had played).
 */
export function PageMediaHold() {
  useEffect(() => {
    pauseAllPlayingVideos();
    const releaseAutoplay = suspendAutoplayOnView();
    return () => {
      releaseAutoplay();
      resumePausedVideos();
    };
  }, []);
  return null;
}
