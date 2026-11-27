"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { postBackgroundStyle } from "@/lib/post-backgrounds";

/**
 * A video post's colored frame (src/lib/post-backgrounds.ts): the whole video, uncropped at its own aspect ratio, inset
 * on the preset's background. Drawn by the app; the video file is never changed.
 *
 * No layout jump: the frame is a fixed 4:5 box (the same box an unframed feed video takes), capped in height so a tall
 * portrait video never towers over the feed. The picture area inside starts as the whole inset (the video is
 * object-contain, so a frame shows around it from the first paint) and, once the video's or its poster's real ratio is
 * known, shrinks to exactly the picture (container query units), so the rounded corners and the controls sit on the
 * video itself. Where container query units aren't supported the inline size is dropped and the picture area simply
 * stays the whole inset (still uncropped, still framed).
 */
export function VideoFrame({
  backgroundKey,
  ratio,
  children,
  className,
}: {
  backgroundKey: string;
  /** width / height of the video, once known. */
  ratio: number | null;
  /** The <video> (h-full w-full object-contain) and its overlay controls. */
  children: ReactNode;
  className?: string;
}) {
  const style = postBackgroundStyle(backgroundKey);
  return (
    <div
      data-post-background={backgroundKey}
      className={cn(
        "animate-styled-post-in relative mt-3 aspect-[4/5] max-h-[min(34rem,78vh)] w-full overflow-hidden rounded-xl p-3 sm:p-5",
        className,
      )}
      style={style ? { background: style.background } : undefined}
    >
      <div className="flex h-full w-full items-center justify-center [container-type:size]">
        <div
          className={cn(
            "relative h-full w-full overflow-hidden rounded-lg",
            ratio && "bg-black shadow-[0_8px_28px_rgba(0,0,0,0.3)]",
          )}
          style={
            ratio
              ? { width: `min(100cqw, calc(100cqh * ${ratio}))`, height: `min(100cqh, calc(100cqw / ${ratio}))` }
              : undefined
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** The video's width/height ratio: from its poster as soon as that loads, then from the video's own metadata. */
export function useVideoRatio(posterUrl: string | null | undefined, enabled: boolean) {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !posterUrl || typeof Image === "undefined") return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setRatio((current) => current ?? img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = posterUrl;
    return () => {
      img.onload = null;
    };
  }, [posterUrl, enabled]);
  function fromVideo(el: HTMLVideoElement) {
    if (el.videoWidth > 0 && el.videoHeight > 0) setRatio(el.videoWidth / el.videoHeight);
  }
  return { ratio, fromVideo };
}
