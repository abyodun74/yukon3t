"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Eye, Trash2 } from "lucide-react";
import { viewStory, deleteStory, getStoryViewers } from "@/app/actions/stories";

const IMAGE_DURATION_MS = 5000;
const TAP_MAX_HOLD_MS = 250;

export type StoryData = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  mediaThumbnailUrl: string | null;
  caption: string | null;
  createdAt: Date;
  viewCount: number;
};

function timeAgo(date: Date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`;
  return `${hours}h`;
}

/**
 * Full-screen Instagram-style story viewer: one segmented progress bar per
 * story, images auto-advance on a timer, videos advance on `ended`, and
 * holding anywhere pauses without navigating (a genuine tap — released
 * within TAP_MAX_HOLD_MS — is what advances/rewinds).
 */
export function StoryViewer({
  stories,
  startIndex,
  authorName,
  authorAvatarUrl,
  isOwner,
  onClose,
}: {
  stories: StoryData[];
  startIndex: number;
  authorName: string;
  authorAvatarUrl: string | null;
  isOwner: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  // Keyed by story id rather than plain booleans — switching stories then
  // naturally "resets" these (the id no longer matches) without needing an
  // effect to synchronously reset state on every story change.
  const [deleteConfirmForId, setDeleteConfirmForId] = useState<string | null>(null);
  const [viewersOpenForId, setViewersOpenForId] = useState<string | null>(null);
  const [viewers, setViewers] = useState<{ id: string; name: string }[] | null>(null);
  const [isPending, setIsPending] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const elapsedRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());
  const pointerDownAtRef = useRef(0);
  const router = useRouter();

  const story = stories[index];
  const showViewers = story ? viewersOpenForId === story.id : false;
  const confirmingDelete = story ? deleteConfirmForId === story.id : false;

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= stories.length) {
        onClose();
        return i;
      }
      return i + 1;
    });
  }, [stories.length, onClose]);

  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Records a view once per story — the timer effect below is what actually
  // (re)starts progress from 0 for the new story, via its own rAF/video
  // callbacks rather than a synchronous setState here.
  useEffect(() => {
    if (!story) return;
    elapsedRef.current = 0;
    if (!seenRef.current.has(story.id)) {
      seenRef.current.add(story.id);
      viewStory(story.id);
    }
  }, [story]);

  // Image auto-advance timer — videos drive their own progress via onTimeUpdate/onEnded below.
  useEffect(() => {
    if (!story || story.mediaType !== "IMAGE" || paused || showViewers) return undefined;

    let raf: number;
    let lastTs = performance.now();
    const tick = (ts: number) => {
      elapsedRef.current += ts - lastTs;
      lastTs = ts;
      const pct = Math.min(1, elapsedRef.current / IMAGE_DURATION_MS);
      setProgress(pct);
      if (pct >= 1) {
        next();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story, paused, showViewers, next]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || story?.mediaType !== "VIDEO") return;
    if (paused || showViewers) video.pause();
    else video.play().catch(() => {});
  }, [paused, showViewers, story]);

  function handlePointerDown() {
    pointerDownAtRef.current = Date.now();
    setPaused(true);
  }

  function handlePointerUp(direction: "prev" | "next") {
    const held = Date.now() - pointerDownAtRef.current;
    setPaused(false);
    if (held < TAP_MAX_HOLD_MS) {
      if (direction === "prev") prev();
      else next();
    }
  }

  async function loadViewers() {
    if (!story) return;
    setPaused(true);
    setViewersOpenForId(story.id);
    const result = await getStoryViewers(story.id);
    setViewers(result.viewers);
  }

  async function handleDelete() {
    if (!story || isPending) return;
    setIsPending(true);
    await deleteStory(story.id);
    setIsPending(false);
    router.refresh();
    if (stories.length <= 1) {
      onClose();
    } else {
      next();
    }
  }

  if (!story) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      <div className="absolute inset-0 flex items-center justify-center">
        {story.mediaType === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.mediaUrl} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            ref={videoRef}
            src={story.mediaUrl}
            poster={story.mediaThumbnailUrl ?? undefined}
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain"
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.duration) setProgress(el.currentTime / el.duration);
            }}
            onEnded={next}
          />
        )}
      </div>

      {/* Tap zones — sit above the media, below the header/caption chrome. */}
      <div className="absolute inset-0 z-10 flex">
        <button
          type="button"
          aria-label="Previous story"
          className="h-full w-1/3"
          onPointerDown={handlePointerDown}
          onPointerUp={() => handlePointerUp("prev")}
          onPointerLeave={() => setPaused(false)}
        />
        <button
          type="button"
          aria-label="Next story"
          className="h-full w-2/3"
          onPointerDown={handlePointerDown}
          onPointerUp={() => handlePointerUp("next")}
          onPointerLeave={() => setPaused(false)}
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-20 p-3">
        <div className="flex gap-1">
          {stories.map((s, i) => (
            <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white"
                style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full border border-white/40 bg-white/10">
              {authorAvatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={authorAvatarUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <span className="text-sm font-medium text-white">{authorName}</span>
            <span className="text-xs text-white/70">{timeAgo(story.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1">
            {isOwner && (
              <button
                type="button"
                onClick={() => setDeleteConfirmForId((id) => (id === story.id ? null : story.id))}
                aria-label="Delete story"
                className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      {confirmingDelete && (
        <div className="absolute inset-x-0 top-16 z-30 mx-3 flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
          <span>Delete this story?</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setDeleteConfirmForId(null)}
              className="rounded-md border border-line px-2 py-1 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleDelete}
              className="rounded-md bg-danger px-2 py-1 font-medium text-white disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {story.caption && !showViewers && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
          <p className="text-sm text-white">{story.caption}</p>
        </div>
      )}

      {isOwner && (
        <div className="absolute inset-x-0 bottom-0 z-20">
          {showViewers ? (
            <div className="max-h-64 overflow-y-auto rounded-t-2xl bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                  Seen by {viewers?.length ?? 0}
                </p>
                <button type="button" onClick={() => setViewersOpenForId(null)} className="text-foreground-soft">
                  <X size={16} />
                </button>
              </div>
              <ul className="mt-2 space-y-1.5">
                {(viewers ?? []).map((v) => (
                  <li key={v.id} className="text-sm">
                    {v.name}
                  </li>
                ))}
                {viewers?.length === 0 && (
                  <li className="text-sm text-foreground-soft">No views yet.</li>
                )}
              </ul>
            </div>
          ) : (
            <button
              type="button"
              onClick={loadViewers}
              className="mb-4 ml-4 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white"
            >
              <Eye size={14} />
              {story.viewCount}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
