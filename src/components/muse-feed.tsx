"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, MessageCircle, Volume2, VolumeX, Share2, Repeat2, Trash2, Eye } from "lucide-react";
import {
  getMuseFeed,
  getMuseReactionSummary,
  toggleMuseReaction,
  getMuseComments,
  createMuseComment,
  deleteMuseComment,
  deleteMuse,
  toggleMuseRepost,
  recordMuseShare,
  recordMuseView,
} from "@/app/actions/muse";
import { UserLink, UserAvatar } from "@/components/user-link";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { ReactionBar } from "@/components/reaction-bar";
import { SubscribeButton } from "@/components/subscribe-button";
import { canShareNatively, shareNative } from "@/lib/native-share";
import { QUICK_REACTIONS } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import type { ReactionSummary } from "@/lib/reactions";

// How far before the actual end of the loaded list to start fetching more —
// expressed as a fraction of one full-screen card's height (rootMargin),
// not an item count, since each card is a real scrollable snap section now
// rather than a single manually-tracked "current index." Large enough that
// a fast scroller doesn't hit a dead end while the network request for
// more is still in flight.
const LOAD_MORE_ROOT_MARGIN = "200% 0px";
// Matches use-autoplay-on-view.ts's own threshold — a card counts as
// "active" (worth autoplaying, worth showing as the one whose mute state
// etc. applies) once it's mostly, not just barely, scrolled into view.
const ACTIVE_VISIBILITY_THRESHOLD = 0.6;

type MuseItem = {
  id: string;
  caption: string | null;
  videoUrl: string;
  videoThumbnailUrl: string | null;
  audioUrl: string | null;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  repostCount: number;
  viewCount: number;
  author: { id: string; name: string | null; avatarUrl: string | null };
  myReaction: string | null;
  isReposted: boolean;
  isFollowingAuthor: boolean;
  sharedPostId: string | null;
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
  // Starts muted — a guaranteed-to-autoplay baseline (unlike story-viewer.tsx,
  // which can lean on the tap that opened it as a prior user gesture, /muse
  // can be the very first interaction on page load, where several browsers/
  // WebViews block autoplay-with-sound outright). The speaker button on
  // each card is how sound actually gets heard; shared globally across
  // every card, same "one sound setting for the whole feed" convention the
  // Home feed's own videos already use.
  const [muted, setMuted] = useState(true);
  const [commentsOpenForId, setCommentsOpenForId] = useState<string | null>(null);
  const [comments, setComments] = useState<MuseCommentData[] | null>(null);

  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const result = await getMuseFeed({ cursor });
    setItems((prev) => [...prev, ...result.items]);
    setCursor(result.nextCursor);
    loadingMoreRef.current = false;
  }, [cursor]);

  // Infinite-scroll sentinel — a real scrollable list (this is now one,
  // not a single manually-swiped item) needs its own "getting close to the
  // end" signal, distinct from each card's own visibility observer below.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: LOAD_MORE_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  async function toggleReaction(museId: string, emoji: string) {
    const result = await toggleMuseReaction(museId, emoji);
    if (result.reactions) {
      const total = result.reactions.reduce((sum, r) => sum + r.count, 0);
      setItems((prev) => prev.map((it) => (it.id === museId ? { ...it, likeCount: total } : it)));
    }
    return result.reactions;
  }

  async function openComments(museId: string) {
    setCommentsOpenForId(museId);
    setComments(null);
    const result = await getMuseComments(museId);
    setComments(result.comments);
  }

  async function postComment(museId: string, content: string): Promise<boolean> {
    const fd = new FormData();
    fd.set("content", content);
    const result = await createMuseComment(museId, fd);
    if (result.error || !result.comment) return false;
    setComments((prev) => [...(prev ?? []), result.comment]);
    setItems((prev) => prev.map((it) => (it.id === museId ? { ...it, commentCount: it.commentCount + 1 } : it)));
    return true;
  }

  async function removeComment(museId: string, commentId: string) {
    await deleteMuseComment(commentId);
    setComments((prev) => (prev ? prev.filter((c) => c.id !== commentId) : prev));
    setItems((prev) =>
      prev.map((it) => (it.id === museId ? { ...it, commentCount: Math.max(0, it.commentCount - 1) } : it)),
    );
  }

  /** Author-only — removes the Muse outright (see deleteMuse's own doc comment). Optimistic: the card disappears immediately, no confirm-then-wait round trip. */
  async function removeMuse(museId: string) {
    setItems((prev) => prev.filter((it) => it.id !== museId));
    await deleteMuse(museId);
  }

  /** Optimistic toggle-with-revert, same shape as toggleReaction/SubscribeButton's own toggle. */
  async function toggleRepost(museId: string) {
    const current = items.find((it) => it.id === museId);
    if (!current) return;
    const nextReposted = !current.isReposted;
    setItems((prev) =>
      prev.map((it) =>
        it.id === museId
          ? { ...it, isReposted: nextReposted, repostCount: it.repostCount + (nextReposted ? 1 : -1) }
          : it,
      ),
    );
    const result = await toggleMuseRepost(museId);
    if (result.error) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === museId
            ? { ...it, isReposted: current.isReposted, repostCount: current.repostCount }
            : it,
        ),
      );
    }
  }

  async function shareMuse(item: MuseItem) {
    const url = `${window.location.origin}/muse/${item.id}`;
    if (canShareNatively()) {
      await shareNative({ url, text: item.caption ?? undefined });
    } else if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, text: item.caption ?? undefined });
      } catch {
        return; // Cancelled — don't count it as a share.
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        return;
      }
    }
    const result = await recordMuseShare(item.id);
    if (!result.error) {
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, shareCount: it.shareCount + 1 } : it)));
    }
  }

  const viewedRef = useRef(new Set<string>());
  function recordView(museId: string) {
    if (viewedRef.current.has(museId)) return;
    viewedRef.current.add(museId);
    recordMuseView(museId).then((result) => {
      if (!result.error) {
        setItems((prev) => prev.map((it) => (it.id === museId ? { ...it, viewCount: it.viewCount + 1 } : it)));
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex h-dvh w-screen flex-col items-center justify-center gap-2 bg-black text-white">
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

  const commentsMuse = commentsOpenForId ? items.find((it) => it.id === commentsOpenForId) : undefined;

  return (
    <>
      <div
        // Deliberately BELOW nav.tsx's bottom tab bar (z-30) and header
        // (z-40) rather than covering them the way StoryViewer/live-stream-
        // room do at z-[70] — those are modals a user explicitly opened and
        // closes back to whatever's underneath, but /muse is itself one of
        // the 6 primary nav destinations, so the tab bar must stay
        // reachable to switch to another tab. Real vertical scroll with
        // snap, not a single manually-swiped item — each card is its own
        // full-viewport snap section, so scrolling behaves like an
        // ordinary feed (mouse wheel, trackpad, natural touch drag) instead
        // of requiring a deliberate swipe gesture past a fixed threshold.
        className="fixed inset-0 z-10 select-none overflow-y-scroll bg-black"
        style={{ scrollSnapType: "y mandatory" }}
      >
        {items.map((item) => (
          <MuseCard
            key={item.id}
            item={item}
            muted={muted}
            currentUserId={currentUserId}
            onToggleMute={() => setMuted((m) => !m)}
            onToggleReaction={(emoji) => toggleReaction(item.id, emoji)}
            onOpenComments={() => openComments(item.id)}
            onDelete={() => removeMuse(item.id)}
            onToggleRepost={() => toggleRepost(item.id)}
            onShare={() => shareMuse(item)}
            onView={() => recordView(item.id)}
          />
        ))}
        <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      </div>

      {/*
       * A true sibling of the scrollable feed above, not nested inside it —
       * an element positioned+z-indexed inside that container would be
       * confined to ITS stacking context (any positioned element creates
       * one), so no z-index on a descendant could ever paint above
       * nav.tsx's bottom tab bar (z-30) or header (z-40) regardless of the
       * value used. This sheet is a deliberate temporary takeover (same as
       * StoryViewer's own modal), so it's fine — expected, even — for it to
       * cover the tab bar while open.
       */}
      {commentsMuse && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setCommentsOpenForId(null)}
        >
          <div className="w-full" onClick={(e) => e.stopPropagation()}>
            <MuseCommentsPanel
              comments={comments}
              currentUserId={currentUserId}
              isMuseOwner={commentsMuse.author.id === currentUserId}
              onClose={() => setCommentsOpenForId(null)}
              onPost={(content) => postComment(commentsMuse.id, content)}
              onDelete={(commentId) => removeComment(commentsMuse.id, commentId)}
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One full-viewport, scroll-snapped video — self-contained like a Home
 * feed post-card (its own author/caption/reaction/comment controls scroll
 * together with its video, rather than one shared overlay bar swapping
 * content to match whatever's currently scrolled to). Autoplay/pause is
 * driven by this card's own IntersectionObserver, the same
 * mostly-in-view-or-not convention use-autoplay-on-view.ts already
 * established for the Home feed — every loaded card observes independently,
 * there's no centralized "active index" to keep in sync with real scroll
 * position.
 */
function MuseCard({
  item,
  muted,
  currentUserId,
  onToggleMute,
  onToggleReaction,
  onOpenComments,
  onDelete,
  onToggleRepost,
  onShare,
  onView,
}: {
  item: MuseItem;
  muted: boolean;
  currentUserId: string;
  onToggleMute: () => void;
  onToggleReaction: (emoji: string) => Promise<ReactionSummary[] | undefined>;
  onOpenComments: () => void;
  onDelete: () => void;
  onToggleRepost: () => void;
  onShare: () => void;
  onView: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [reactions, setReactions] = useState<ReactionSummary[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isOwner = item.author.id === currentUserId;

  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Fetches this card's full per-emoji breakdown once, on mount — the feed
  // list itself only carries likeCount (a cheap denormalized total) and
  // myReaction, not every item's full breakdown, since that would mean a
  // groupBy per item on every page load. With real scrolling, every loaded
  // card is simultaneously mounted (not just one "current" item), so this
  // now fires once per page of items rather than once per swipe — the same
  // tradeoff Home's own post feed already makes for its reaction data.
  useEffect(() => {
    let cancelled = false;
    getMuseReactionSummary(item.id).then((result) => {
      if (!cancelled) setReactions(result.reactions);
    });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(Boolean(entry?.isIntersecting)),
      { threshold: ACTIVE_VISIBILITY_THRESHOLD },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Counts a view the first time this card becomes the active one — onView
  // itself (recordView in MuseFeed) is a no-op past the first call per
  // museId (see its viewedRef Set), so this doesn't need its own dedup
  // beyond "only when isVisible flips true," and can safely skip onView in
  // the dependency array (a fresh closure every render, same as any other
  // inline callback prop here).
  useEffect(() => {
    if (isVisible) onView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);


  // Drives both the video and (when present) the separate audio track
  // together — a Muse with a custom audio track always plays the video
  // muted and this audio element instead (see MuseComposer/Muse.audioUrl's
  // own comments). Not synchronized beyond both starting/stopping
  // together; a real seek-sync (e.g. correcting drift over a long clip)
  // isn't attempted — acceptable for a <=60s clip.
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    const shouldPlay = isVisible && !paused;
    if (video) {
      if (shouldPlay) video.play().catch(() => {});
      else video.pause();
    }
    if (audio) {
      if (shouldPlay) audio.play().catch(() => {});
      else audio.pause();
    }
  }, [isVisible, paused]);

  async function handleToggleReaction(emoji: string) {
    const next = await onToggleReaction(emoji);
    if (next) setReactions(next);
  }

  return (
    <section
      ref={sectionRef}
      style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}
      className="relative flex h-dvh w-screen flex-col overflow-hidden bg-black"
      onClick={() => setPaused((p) => !p)}
    >
      <video
        ref={videoRef}
        src={item.videoUrl}
        poster={item.videoThumbnailUrl ?? undefined}
        // Always muted when a separate audioUrl is replacing the video's
        // own sound (playing both would double up), otherwise follows the
        // shared mute toggle — same source either way, never both at once.
        muted={Boolean(item.audioUrl) || muted}
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-contain"
      />
      {item.audioUrl && <audio ref={audioRef} src={item.audioUrl} muted={muted} loop />}

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
          // This card sits at z-10, deliberately below nav.tsx's sticky
          // header — so a plain safe-area spacer isn't enough here, the
          // header's own real content height needs clearing too, or an
          // interactive control placed right under it renders hidden
          // behind the opaque header instead (confirmed live: the mute
          // button sat entirely underneath it). ~4rem is the header's
          // measured height with no safe-area-inset-top; same
          // approximation/rounding used for the bottom nav's clearance
          // below.
          className="flex items-center justify-end gap-2 bg-gradient-to-b from-black/50 to-transparent px-4 pb-6 pt-[calc(4rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))]"
          onClick={(e) => e.stopPropagation()}
        >
          {isOwner && (
            <button
              type="button"
              onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
              aria-label={confirmingDelete ? "Confirm delete" : "Delete Muse"}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-2 text-white",
                confirmingDelete ? "bg-danger" : "bg-black/40",
              )}
            >
              <Trash2 size={18} />
              {confirmingDelete && <span className="pr-1 text-xs font-medium">Delete?</span>}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="rounded-full bg-black/40 p-2 text-white"
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>

        {/* One grouped block, not separate flex children of the
            justify-between parent above — three-plus siblings there would
            spread evenly across the whole height instead of clustering at
            the bottom. */}
        <div className="bg-gradient-to-t from-black/60 to-transparent pt-10">
          <div className="flex items-end justify-between gap-3 px-4" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <UserLink
                  userId={item.author.id}
                  name={item.author.name}
                  avatarUrl={item.author.avatarUrl}
                  className="text-sm font-medium text-white hover:text-white/80"
                />
                {!isOwner && (
                  <SubscribeButton
                    targetId={item.author.id}
                    initiallySubscribed={item.isFollowingAuthor}
                    variant="pill"
                  />
                )}
              </div>
              {item.caption && <p className="mt-1 break-words text-sm text-white">{item.caption}</p>}
              <p className="mt-1 flex items-center gap-1 text-[11px] text-white/70">
                <Eye size={12} /> {item.viewCount.toLocaleString()} views
              </p>
              {item.sharedPostId && (
                <Link
                  href={`/post/${item.sharedPostId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 inline-block text-[11px] text-white/70 underline"
                >
                  View original post
                </Link>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-center gap-3">
              <button
                type="button"
                onClick={onOpenComments}
                className="flex flex-col items-center gap-0.5 text-white"
                aria-label="Comments"
              >
                <span className="rounded-full bg-black/40 p-2">
                  <MessageCircle size={20} />
                </span>
                <span className="text-[11px]">{item.commentCount}</span>
              </button>
              <div className="flex shrink-0 flex-col items-center gap-0.5 text-white">
                <EmojiPickerButton onSelect={handleToggleReaction} quickReactions={QUICK_REACTIONS} />
                <span className="text-[11px]">{item.likeCount}</span>
              </div>
              <button
                type="button"
                onClick={onToggleRepost}
                aria-label={item.isReposted ? "Undo reshare" : "Reshare"}
                aria-pressed={item.isReposted}
                className="flex flex-col items-center gap-0.5 text-white"
              >
                <span className={cn("rounded-full p-2", item.isReposted ? "bg-accent text-accent-ink" : "bg-black/40")}>
                  <Repeat2 size={20} />
                </span>
                <span className="text-[11px]">{item.repostCount}</span>
              </button>
              <button
                type="button"
                onClick={onShare}
                aria-label="Share"
                className="flex flex-col items-center gap-0.5 text-white"
              >
                <span className="rounded-full bg-black/40 p-2">
                  <Share2 size={20} />
                </span>
                <span className="text-[11px]">{item.shareCount}</span>
              </button>
            </div>
          </div>

          {reactions.length > 0 && (
            <div className="px-4 pt-2" onClick={(e) => e.stopPropagation()}>
              <ReactionBar reactions={reactions} onToggle={handleToggleReaction} />
            </div>
          )}

          {/* Same bottom-nav clearance layout.tsx's <body> reserves in
              normal flow (pb-[calc(4rem+safe-area)] md:pb-0) — this card
              sits inside a `fixed` ancestor, so it doesn't inherit that
              padding and would otherwise render behind the (higher
              z-index) nav bar. */}
          <div className="h-4" />
          <div className="h-[calc(4rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] md:h-0" />
        </div>
      </div>
    </section>
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
