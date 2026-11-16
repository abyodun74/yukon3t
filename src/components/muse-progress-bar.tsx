"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useMuseControlsText } from "@/components/muse-controls-text";
import { cn } from "@/lib/utils";
import {
  formatMediaTime,
  keyboardSeekTime,
  progressBarVisible,
  progressFraction,
  progressValueText,
  resolveDuration,
  seekTimeFromPointer,
  type ProgressBarEvent,
  type ProgressBarState,
} from "@/lib/muse-controls";

/**
 * The length / progress bar along the bottom of a Muse card (rules: src/lib/muse-controls.ts). Only for a native
 * <video> (MuseCard never renders it for an embed). It reads the card's video through `videoRef` and never renders or
 * keys the <video> itself, so the element is never remounted (muse-feed-video.test.ts).
 *
 * - Hidden (opacity 0, no pointer events, still focusable) while the video plays; MuseCard's reducer says when it shows.
 * - One requestAnimationFrame loop reads currentTime, and only while the bar is shown and not being dragged.
 * - Dragging: pointer capture on a 44px-tall invisible hit area; the visible line only gets thicker. While dragging
 *   MuseCard holds the video paused (so the playback clock doesn't fight the drag), seeks at most once a frame, and on
 *   release plays again if it was playing before.
 * - `touch-action: pan-y`: a vertical swipe that starts on the bar still scrolls to the next Muse (the browser takes it
 *   and sends pointercancel, which ends the drag where it got to). `data-no-tab-swipe` keeps nav.tsx's swipe between
 *   tabs out of a horizontal drag here.
 * - Always laid out left to right (`dir="ltr"`), also in Arabic: a timeline is not mirrored.
 */
export function MuseProgressBar({
  videoRef,
  mediaKey,
  storedDuration,
  state,
  commentsOpen,
  dispatch,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Changes when the card mounts or unmounts its <video> (MuseCard's isNearby), so the listeners follow it. */
  mediaKey: boolean;
  /** The length saved with the Muse, used until (or instead of when) the element reports a usable one. */
  storedDuration: number | null;
  state: ProgressBarState;
  commentsOpen: boolean;
  dispatch: (event: ProgressBarEvent) => void;
}) {
  const { t } = useMuseControlsText();
  const [elementDuration, setElementDuration] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const scrubPointerRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const seekFrameRef = useRef(0);

  const duration = resolveDuration(elementDuration, storedDuration);
  const visible = progressBarVisible(state, { isEmbed: false, commentsOpen, duration });

  // The element's own length, as soon as its metadata is known (before playback), and again if it changes (an iPhone
  // screen recording reads Infinity until it has been scanned).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const read = () => setElementDuration(Number.isFinite(video.duration) ? video.duration : null);
    read();
    video.addEventListener("loadedmetadata", read);
    video.addEventListener("durationchange", read);
    return () => {
      video.removeEventListener("loadedmetadata", read);
      video.removeEventListener("durationchange", read);
    };
  }, [videoRef, mediaKey]);

  // The position, once a frame, only while the bar is shown and not being dragged.
  useEffect(() => {
    if (!visible || state.scrubbing) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) setCurrent(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [visible, state.scrubbing, videoRef, mediaKey]);

  useEffect(() => () => cancelAnimationFrame(seekFrameRef.current), []);

  function seekSoon(time: number) {
    pendingSeekRef.current = time;
    if (seekFrameRef.current) return;
    seekFrameRef.current = requestAnimationFrame(() => {
      seekFrameRef.current = 0;
      const video = videoRef.current;
      if (video && pendingSeekRef.current !== null) video.currentTime = pendingSeekRef.current;
    });
  }

  function seekNow(time: number) {
    cancelAnimationFrame(seekFrameRef.current);
    seekFrameRef.current = 0;
    pendingSeekRef.current = null;
    const video = videoRef.current;
    if (video) video.currentTime = time;
    setCurrent(time);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    // The card's hold gesture and the feed must not see a press that starts on the bar.
    e.stopPropagation();
    if (duration === null || scrubPointerRef.current !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubPointerRef.current = e.pointerId;
    const time = seekTimeFromPointer(e.clientX, e.currentTarget.getBoundingClientRect(), duration);
    setScrubTime(time);
    seekSoon(time);
    dispatch({ type: "scrub_start" });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (scrubPointerRef.current !== e.pointerId || duration === null) return;
    const time = seekTimeFromPointer(e.clientX, e.currentTarget.getBoundingClientRect(), duration);
    setScrubTime(time);
    seekSoon(time);
  }

  function endScrub(e: PointerEvent<HTMLDivElement>) {
    if (scrubPointerRef.current !== e.pointerId) return;
    scrubPointerRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const time =
      e.type === "pointerup" && duration !== null
        ? seekTimeFromPointer(e.clientX, e.currentTarget.getBoundingClientRect(), duration)
        : (scrubTime ?? current);
    seekNow(time);
    setScrubTime(null);
    dispatch({ type: "scrub_end" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (duration === null) return;
    const time = keyboardSeekTime(e.key, current, duration);
    if (time === null) return;
    // Not the feed's scroll, not the viewer's own keys.
    e.preventDefault();
    e.stopPropagation();
    seekNow(time);
  }

  if (duration === null) return <div aria-hidden className="h-11" />;

  const shown = scrubTime ?? current;
  const fraction = progressFraction(shown, duration);

  return (
    <div
      dir="ltr"
      data-no-tab-swipe
      className={cn(
        "flex h-11 items-center gap-3 px-4 transition-opacity duration-150 ease-out motion-reduce:transition-none",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      // A tap on the bar (or next to it) is not the card's tap-to-pause.
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={t.progressLabel}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={progressValueText(t.progressValue, shown, duration)}
        data-muse-progress
        className="relative flex h-11 min-w-0 flex-1 cursor-pointer items-center rounded-sm"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onKeyDown={onKeyDown}
        // Keyboard focus shows the bar; a tap's focus doesn't (it would keep the bar up after the drag).
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) dispatch({ type: "focus" });
        }}
        onBlur={() => dispatch({ type: "blur" })}
      >
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-full bg-white/30 transition-[height] duration-150 ease-out motion-reduce:transition-none",
            state.scrubbing ? "h-1.5" : "h-0.5",
          )}
        >
          <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${fraction * 100}%` }} />
        </div>
      </div>
      <span aria-hidden className="shrink-0 text-[0.6875rem] tabular-nums text-white">
        {formatMediaTime(shown)} / {formatMediaTime(duration)}
      </span>
    </div>
  );
}
