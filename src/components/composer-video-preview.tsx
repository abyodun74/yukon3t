"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useFeedText } from "@/components/feed-text";
import { VideoFrame, useVideoRatio } from "@/components/video-frame";
import { useFeedVideoMuted } from "@/lib/feed-video-mute";
import { isPostBackgroundKey } from "@/lib/post-backgrounds";
import type { PostMusicKey } from "@/lib/post-music";
import { unlockPostMusic, useVideoMusic } from "@/lib/post-music-player";

/**
 * The composer's live preview of a video with a colored frame and/or music, exactly as the feed will show it: the
 * same VideoFrame, the video muted when it has music and the music following it. Works for a picked file (an object
 * URL of it) and for Android's native picker, whose video is already uploaded (its URL and poster).
 */
export function ComposerVideoPreview({
  file,
  url,
  posterUrl,
  backgroundKey,
  music,
}: {
  file: File | null;
  url: string | null;
  posterUrl: string | null;
  backgroundKey: string | null;
  music: PostMusicKey | null;
}) {
  const { t } = useFeedText();
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);
  const src = objectUrl ?? url;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useFeedVideoMuted();
  const [playing, setPlaying] = useState(false);
  const framed = isPostBackgroundKey(backgroundKey);
  const { ratio, fromVideo } = useVideoRatio(posterUrl, framed);
  useVideoMusic(videoRef, music, muted);
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted || music !== null;
  }, [muted, music]);
  if (!src) return null;

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    unlockPostMusic();
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }

  const player = (
    <>
      <video
        ref={videoRef}
        src={src}
        poster={posterUrl ?? undefined}
        muted
        loop
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => fromVideo(e.currentTarget)}
        onClick={togglePlay}
        className={framed ? "h-full w-full cursor-pointer object-contain" : "max-h-72 w-full cursor-pointer rounded-lg bg-black object-contain"}
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? t.post.pauseVideo : t.post.playVideo}
        className="absolute bottom-2 start-2 rounded-full bg-black/50 p-1.5 text-white/90 hover:text-white"
      >
        {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
      </button>
      <button
        type="button"
        onClick={() => {
          unlockPostMusic();
          setMuted(!muted);
        }}
        aria-label={muted ? t.post.unmute : t.post.mute}
        className="absolute bottom-2 end-2 rounded-full bg-black/50 p-1.5 text-white/90 hover:text-white"
      >
        {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
      </button>
    </>
  );

  return framed && backgroundKey ? (
    <VideoFrame backgroundKey={backgroundKey} ratio={ratio} className="mx-auto max-w-sm">
      {player}
    </VideoFrame>
  ) : (
    <div className="relative mt-3">{player}</div>
  );
}
