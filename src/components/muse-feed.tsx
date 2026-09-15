"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { X, MessageCircle, Volume2, VolumeX } from "lucide-react";
import {
  getMuseFeed,
  getMuseReactionSummary,
  toggleMuseReaction,
  getMuseComments,
  createMuseComment,
  deleteMuseComment,
} from "@/app/actions/muse";
import { UserLink, UserAvatar } from "@/components/user-link";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { ReactionBar } from "@/components/reaction-bar";
import { QUICK_REACTIONS } from "@/lib/emoji";
import type { ReactionSummary } from "@/lib/reactions";

// Same threshold/shape as story-viewer.tsx's own swipe gesture — vertical
// here instead of horizontal, since there's no "previous story in this
// author's ring" concept: every advance (up or down) just moves through the
// flat, cross-author feed array by one.
const SWIPE_THRESHOLD_PX = 60;
// How close to the end of the loaded buffer triggers fetching the next page
// — early enough that a fast swiper doesn't hit a dead end while the network
// request for more is still in flight.
const PREFETCH_WITHIN = 3;

type MuseItem = {
  id: string;
  caption: string | null;
  videoUrl: string;
  videoThumbnailUrl: string | null;
  audioUrl: string | null;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  author: { id: string; name: string | null; avatarUrl: string | null };
  myReaction: string | null;
};

type MuseCommentData = {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string | null; avatarUrl: string | null };
};

function timeAgo(date: Date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Same reasoning as story-viewer.tsx's SafeAreaBottomSpacer/its top-inset
// equivalent used in nav.tsx — this is a fixed inset-0 edge-to-edge overlay,
// so real elements must reserve space for the status bar / gesture nav
// rather than rendering flush against either true edge.
function SafeAreaTopSpacer() {
  return (
    <div
      aria-hidden
      style={{ height: "max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px))" }}
    />
  );
}
function SafeAreaBottomSpacer() {
  return (
    <div
      aria-hidden
      style={{ height: "max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px))" }}
    />
  );
}

export function MuseFeed({
  initialItems,
  initialCursor,
  currentUserId,
}: {
  initialItems: MuseItem[];
  initialCursor: string | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Starts muted — a guaranteed-to-autoplay baseline (unlike story-viewer.tsx,
  // which can lean on the tap that opened it as a prior user gesture, /muse
  // can be the very first interaction on page load, where several browsers/
  // WebViews block autoplay-with-sound outright). The speaker button below
  // is how sound actually gets heard.
  const [muted, setMuted] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reactions, setReactions] = useState<ReactionSummary[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<MuseCommentData[] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pointerStartYRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const current = items[index] as MuseItem | undefined;

  // Fetches the current item's full per-emoji breakdown lazily — the feed
  // list itself only carries likeCount (a cheap denormalized total) and
  // myReaction (this viewer's own pick), not every item's full breakdown,
  // since that would mean a groupBy per item on every page load.
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    getMuseReactionSummary(currentId).then((result) => {
      if (!cancelled) setReactions(result.reactions);
    });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  // Drives both the video and (when present) the separate audio track
  // together — same play/pause/index dependencies for both, since a Muse
  // with a custom audio track always plays the video muted and this audio
  // element instead (see MuseComposer/Muse.audioUrl's own comments). Not
  // synchronized beyond both starting together on the same index/pause
  // change; a real seek-sync (e.g. correcting drift over a long clip)
  // isn't attempted — same tradeoff as any two independently-buffered
  // media elements meant to start together, acceptable for a <=60s clip.
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) {
      if (paused || commentsOpen) video.pause();
      else video.play().catch(() => {});
    }
    if (audio) {
      if (paused || commentsOpen) audio.pause();
      else audio.play().catch(() => {});
    }
  }, [paused, commentsOpen, index]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const result = await getMuseFeed({ cursor });
    setItems((prev) => [...prev, ...result.items]);
    setCursor(result.nextCursor);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [cursor]);

  useEffect(() => {
    if (items.length - index <= PREFETCH_WITHIN) loadMore();
  }, [index, items.length, loadMore]);

  function goTo(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setIndex(nextIndex);
    setPaused(false);
    setCommentsOpen(false);
    setComments(null);
  }

  // The comments sheet is a child of this same container (an absolutely
  // positioned overlay, not a portal), so a pointerdown/up inside it would
  // otherwise still bubble up to these handlers and toggle pause or swipe
  // the feed out from under someone mid-comment — pointer events bubble by
  // DOM ancestry regardless of stacking/z-index. Skip the gesture entirely
  // while it's open. The bottom control cluster (author/comment/reaction
  // buttons) also stops propagation on its own pointer events for the same
  // reason even when the sheet is closed — see its wrapper below.
  function onPointerDown(e: PointerEvent) {
    if (commentsOpen) return;
    pointerStartYRef.current = e.clientY;
  }
  function onPointerUp(e: PointerEvent) {
    if (commentsOpen) return;
    const deltaY = e.clientY - pointerStartYRef.current;
    if (Math.abs(deltaY) < SWIPE_THRESHOLD_PX) {
      // Not a swipe — a tap toggles play/pause instead.
      setPaused((p) => !p);
      return;
    }
    if (deltaY < 0) goTo(index + 1);
    else goTo(index - 1);
  }

  async function toggleReaction(emoji: string) {
    if (!current) return;
    const result = await toggleMuseReaction(current.id, emoji);
    if (result.reactions) {
      setReactions(result.reactions);
      const total = result.reactions.reduce((sum, r) => sum + r.count, 0);
      setItems((prev) => prev.map((it) => (it.id === current.id ? { ...it, likeCount: total } : it)));
    }
  }

  async function openComments() {
    if (!current) return;
    setCommentsOpen(true);
    setComments(null);
    const result = await getMuseComments(current.id);
    setComments(result.comments);
  }

  async function postComment(content: string): Promise<boolean> {
    if (!current) return false;
    const fd = new FormData();
    fd.set("content", content);
    const result = await createMuseComment(current.id, fd);
    if (result.error || !result.comment) return false;
    setComments((prev) => [...(prev ?? []), result.comment]);
    setItems((prev) =>
      prev.map((it) => (it.id === current.id ? { ...it, commentCount: it.commentCount + 1 } : it)),
    );
    return true;
  }

  async function removeComment(commentId: string) {
    await deleteMuseComment(commentId);
    setComments((prev) => (prev ? prev.filter((c) => c.id !== commentId) : prev));
    if (current) {
      setItems((prev) =>
        prev.map((it) => (it.id === current.id ? { ...it, commentCount: Math.max(0, it.commentCount - 1) } : it)),
      );
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-black text-white">
        <SafeAreaTopSpacer />
        <p className="text-sm text-white/70">No Muses yet — be the first to post one.</p>
        <button
          type="button"
          onClick={() => router.push(`/u/${currentUserId}`)}
          className="mt-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          Go to your profile
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white/70">
        <p className="text-sm">{loadingMore ? "Loading more…" : "You're all caught up."}</p>
      </div>
    );
  }

  return (
    <>
    <div
      // Deliberately BELOW nav.tsx's bottom tab bar (z-30) and header
      // (z-40) rather than covering them the way StoryViewer/live-stream-room
      // do at z-[70] — those are modals a user explicitly opened and closes
      // back to whatever's underneath, but /muse is itself one of the 6
      // primary nav destinations, so the tab bar must stay reachable to
      // switch to another tab, not just via a back gesture. The video still
      // renders full-viewport (inset-0); nav's own opaque background simply
      // paints over its bottom ~4rem, matching the same clearance
      // layout.tsx's <body> already reserves there for every other page.
      className="fixed inset-0 z-10 flex select-none flex-col overflow-hidden bg-black"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <video
        key={current.id}
        ref={videoRef}
        src={current.videoUrl}
        poster={current.videoThumbnailUrl ?? undefined}
        autoPlay
        // Always muted when a separate audioUrl is replacing the video's
        // own sound (playing both would double up), otherwise follows the
        // shared mute toggle — same source either way, never both at once.
        muted={Boolean(current.audioUrl) || muted}
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-contain"
      />
      {current.audioUrl && (
        <audio key={`${current.id}-audio`} ref={audioRef} src={current.audioUrl} autoPlay muted={muted} loop />
      )}

      {paused && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/40 p-4 text-white">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}

      <div className="relative flex flex-1 flex-col justify-between">
        <div
          // Unlike StoryViewer/live-stream-room (both z-[70], above the
          // header), this container sits at z-10, deliberately below
          // nav.tsx's sticky header — so a plain safe-area spacer isn't
          // enough here, the header's own real content height needs
          // clearing too, or an interactive control placed right under it
          // renders hidden behind the opaque header instead (confirmed
          // live: the mute button sat entirely underneath it). ~4rem is the
          // header's measured height with no safe-area-inset-top; same
          // approximation/rounding this component already uses for the
          // bottom nav's clearance.
          className="flex items-center justify-end bg-gradient-to-b from-black/50 to-transparent px-4 pb-6 pt-[calc(4rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))]"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute" : "Mute"}
            className="rounded-full bg-black/40 p-2 text-white"
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>

        {/* One grouped block, not separate flex children of the
            justify-between parent above — three-plus siblings there would
            spread evenly across the whole height instead of clustering at
            the bottom (confirmed live: the author/caption/buttons rendered
            vertically centered, not bottom-anchored, before this fix). */}
        <div className="bg-gradient-to-t from-black/60 to-transparent pt-10">
          <div
            className="flex items-end justify-between gap-3 px-4"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <div className="min-w-0 flex-1">
              <UserLink
                userId={current.author.id}
                name={current.author.name}
                avatarUrl={current.author.avatarUrl}
                className="text-sm font-medium text-white hover:text-white/80"
              />
              {current.caption && (
                <p className="mt-1 break-words text-sm text-white">{current.caption}</p>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-center gap-3">
              <button
                type="button"
                onClick={openComments}
                className="flex flex-col items-center gap-0.5 text-white"
                aria-label="Comments"
              >
                <span className="rounded-full bg-black/40 p-2">
                  <MessageCircle size={20} />
                </span>
                <span className="text-[11px]">{current.commentCount}</span>
              </button>
              <div className="flex flex-col items-center gap-0.5 text-white">
                <EmojiPickerButton onSelect={toggleReaction} quickReactions={QUICK_REACTIONS} />
                <span className="text-[11px]">{current.likeCount}</span>
              </div>
            </div>
          </div>

          {reactions.length > 0 && (
            <div
              className="px-4 pt-2"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <ReactionBar reactions={reactions} onToggle={toggleReaction} />
            </div>
          )}

          {/* Same bottom-nav clearance layout.tsx's <body> reserves in
              normal flow (pb-[calc(4rem+safe-area)] md:pb-0) — this whole
              block sits inside a `fixed` ancestor, so it doesn't inherit
              that padding and would otherwise render behind the now-visible
              (higher z-index) nav bar. */}
          <div className="h-4 md:h-4" />
          <div className="h-[calc(4rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] md:h-0" />
        </div>
      </div>
    </div>

    {/*
     * A true sibling of the z-10 video container above, not nested inside
     * it — an element positioned+z-indexed inside that `fixed` container
     * would be confined to ITS stacking context (any positioned element
     * creates one), so no z-index on a descendant could ever paint above
     * nav.tsx's bottom tab bar (z-30) or header (z-40) regardless of the
     * value used. This sheet is a deliberate temporary takeover (same as
     * StoryViewer's own modal), so it's fine — expected, even — for it to
     * cover the tab bar while open.
     */}
    {commentsOpen && current && (
      <div
        className="fixed inset-0 z-50 flex items-end bg-black/40"
        onClick={() => setCommentsOpen(false)}
      >
        <div className="w-full" onClick={(e) => e.stopPropagation()}>
          <MuseCommentsPanel
            comments={comments}
            currentUserId={currentUserId}
            isMuseOwner={current.author.id === currentUserId}
            onClose={() => setCommentsOpen(false)}
            onPost={postComment}
            onDelete={removeComment}
          />
        </div>
      </div>
    )}
    </>
  );
}

/** Bottom-sheet comment thread — same shape as story-viewer.tsx's StoryCommentsPanel, adapted for Muse's getMuseComments/createMuseComment/deleteMuseComment. */
function MuseCommentsPanel({
  comments,
  currentUserId,
  isMuseOwner,
  onClose,
  onPost,
  onDelete,
}: {
  comments: MuseCommentData[] | null;
  currentUserId: string;
  isMuseOwner: boolean;
  onClose: () => void;
  onPost: (content: string) => Promise<boolean>;
  onDelete: (commentId: string) => void;
}) {
  const [text, setText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState(false);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || isPosting) return;
    setIsPosting(true);
    setError(false);
    const ok = await onPost(trimmed);
    setIsPosting(false);
    if (ok) setText("");
    else setError(true);
  }

  return (
    <div className="flex max-h-[70vh] flex-col rounded-t-2xl bg-surface p-4">
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
          Comments{comments ? ` (${comments.length})` : ""}
        </p>
        <button type="button" onClick={onClose} aria-label="Close comments" className="text-foreground-soft">
          <X size={16} />
        </button>
      </div>
      <ul className="mt-2 flex-1 space-y-3 overflow-y-auto">
        {comments === null && <li className="text-sm text-foreground-soft">Loading…</li>}
        {comments?.length === 0 && <li className="text-sm text-foreground-soft">No comments yet.</li>}
        {comments?.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <UserAvatar avatarUrl={c.author.avatarUrl} name={c.author.name} size={28} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm">
                <span className="font-medium">{c.author.name ?? "Someone"}</span> {c.content}
              </p>
              <p className="text-[11px] text-foreground-soft">{timeAgo(c.createdAt)}</p>
            </div>
            {(c.author.id === currentUserId || isMuseOwner) && (
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label="Delete comment"
                className="shrink-0 p-1 text-foreground-soft hover:text-danger"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex shrink-0 items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          maxLength={1000}
          placeholder="Add a comment..."
          className="flex-1 rounded-full border border-line bg-background px-4 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={!text.trim() || isPosting}
          onClick={send}
          aria-label="Post comment"
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          Post
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">Couldn&apos;t post that comment.</p>}
      <SafeAreaBottomSpacer />
    </div>
  );
}
