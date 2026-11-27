"use client";

import { useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useFeedText } from "@/components/feed-text";
import { useFeedVideoMuted } from "@/lib/feed-video-mute";
import { unlockPostMusic, useVideoMusic } from "@/lib/post-music-player";
import type { PostMusicKey } from "@/lib/post-music";

/**
 * The full-screen viewer's player for a video whose sound is its post's music (src/lib/post-music.ts): the video is
 * always muted and the music follows it. Its own play / seek / sound controls replace the browser's native ones,
 * because the native volume button would turn the file's original sound back on, and the native menu offers a
 * download of the file with that sound. Sound follows the feed's shared setting (useFeedVideoMuted).
 */
export function MusicVideoPlayer({ src, music, label }: { src: string; music: PostMusicKey; label: string }) {
  const { t } = useFeedText();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useFeedVideoMuted();
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useVideoMusic(videoRef, music, muted);

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    unlockPostMusic();
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }

  return (
    <div className="flex max-h-[90vh] max-w-full flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <video
        ref={videoRef}
        src={src}
        muted
        autoPlay
        loop
        playsInline
        controlsList="nodownload"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        aria-label={label}
        className="max-h-[calc(90vh-3.5rem)] max-w-full rounded-lg bg-black"
      />
      <div className="flex w-full max-w-xl items-center gap-2 text-white">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? t.post.pauseVideo : t.post.playVideo}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          disabled={!duration}
          onChange={(e) => {
            const el = videoRef.current;
            if (el) el.currentTime = Number(e.target.value);
          }}
          aria-label={t.post.musicSeek}
          className="h-11 min-w-0 flex-1 accent-white"
        />
        <button
          type="button"
          onClick={() => {
            unlockPostMusic();
            setMuted(!muted);
          }}
          aria-label={muted ? t.post.unmute : t.post.mute}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          {muted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
