"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Music2, Pause, Play } from "lucide-react";
import { useFeedText } from "@/components/feed-text";
import { format } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";
import type { PostMusicKey } from "@/lib/post-music";
import {
  pausePostMusic,
  startPostMusic,
  stopPostMusic,
  unlockPostMusic,
  usePostMusicState,
} from "@/lib/post-music-player";

/**
 * Play / pause for a photo or text post's music (a video's music follows the video instead). Never plays on its own:
 * only a tap starts it, so the feed's sound setting is never overridden behind the reader's back. One post plays at a
 * time (src/lib/post-music-playback.ts). It stops when the post's media (the closest [data-post-music-scope], else the
 * chip) scrolls fully out of view, when the card goes away (navigation), and on everything that interrupts music
 * (call, a full-screen viewer, the app going to the background, another audible video).
 */
export function PostMusicChip({ trackKey, className }: { trackKey: PostMusicKey; className?: string }) {
  const { t } = useFeedText();
  const [owner] = useState(() => Symbol("post-music-chip"));
  const state = usePostMusicState();
  const mine = state.owner === owner;
  const playing = mine && state.status === "playing";
  const loading = mine && state.status === "loading";
  const ref = useRef<HTMLButtonElement>(null);
  const name = t.composer.music.names[trackKey];

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const scope = el.closest("[data-post-music-scope]") ?? el;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) pausePostMusic(owner);
    });
    observer.observe(scope);
    return () => observer.disconnect();
  }, [owner]);

  useEffect(() => () => stopPostMusic(owner), [owner]);

  function toggle() {
    if (playing || loading) {
      pausePostMusic(owner);
      return;
    }
    // In the tap itself: lets iOS play the track once it is ready.
    unlockPostMusic();
    void startPostMusic(owner, trackKey);
  }

  const label = format(playing ? t.post.musicPause : loading ? t.post.musicLoading : t.post.musicPlay, { name });
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      aria-label={label}
      aria-pressed={playing}
      title={label}
      data-post-music-chip={trackKey}
      className={cn(
        "mt-2 inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150",
        playing ? "border-accent bg-accent/10 text-accent" : "border-line text-foreground-soft hover:border-accent hover:text-accent",
        className,
      )}
    >
      <Music2 size={14} aria-hidden className="shrink-0" />
      <span dir="auto" className="truncate">
        {name}
      </span>
      {loading ? (
        <Loader2 size={14} aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none" />
      ) : playing ? (
        <Pause size={14} aria-hidden className="shrink-0" />
      ) : (
        <Play size={14} aria-hidden className="shrink-0" />
      )}
    </button>
  );
}
