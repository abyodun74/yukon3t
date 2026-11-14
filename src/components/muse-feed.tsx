"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
// The small `m` components: animation code is loaded lazily by MotionProvider (root layout).
import * as m from "motion/react-m";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, MessageCircle, Volume2, VolumeX, Share2, Repeat2, Trash2, Eye, Pause, Play } from "lucide-react";
import {
  getMuseFeed,
  getMuseForPost,
  getMuseReactionSummary,
  toggleMuseReaction,
  deleteMuse,
  toggleMuseRepost,
  recordMuseView,
} from "@/app/actions/muse";
import { MuseShareModal } from "@/components/muse-share-modal";
import { MuseCommentsSheet } from "@/components/muse-comments-sheet";
import { UserLink } from "@/components/user-link";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { ReactionBar } from "@/components/reaction-bar";
import { SubscribeButton } from "@/components/subscribe-button";
import { QUICK_REACTIONS } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import type { ReactionSummary } from "@/lib/reactions";
import { embedSrc, type EmbedProvider } from "@/lib/video-embed";
import { useStopEmbedOnScrollOut } from "@/lib/use-stop-embed-on-scroll-out";
import { useMuseText } from "@/components/muse-text";
import { useGuestPreview } from "@/components/guest-preview";
import { useShellText, useUiText } from "@/components/ui-text";
import { useNetworkQuality } from "@/lib/network-quality-client";
import { format, intlLocale, plural, type Locale } from "@/lib/i18n/locales";
import { appendMuseItems, museSeedItem, type MuseSeedPost } from "@/lib/muse-from-feed";
import { announceLikeGroup, useLikeGroupSync } from "@/lib/like-group-sync";
import {
  FULL_FRAME,
  MUSE_COMMENTS_INSTANT,
  MUSE_COMMENTS_TRANSITION,
  museCommentsFrame,
  type MuseCommentsFrame,
} from "@/lib/muse-comments-layout";

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
  mediaType: "VIDEO" | "EMBED";
  // Nullable only for EMBED — see Muse.mediaType's own doc comment
  // (prisma/schema.prisma) for why an embed has no file/duration of ours.
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  videoDurationSeconds: number | null;
  embedProvider: EmbedProvider | null;
  embedId: string | null;
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
  /** Set when this Muse shares one like count with the feed post(s) of the same video (src/lib/like-groups.ts). */
  likeGroupId?: string | null;
  /** Client only: bumped when another card of the group changed the like, so this card re-reads its emoji summary. */
  likeSyncVersion?: number;
  // Only on the card a Home feed video opened the viewer on (museSeedItem): that post, not a Muse.
  seedPostId?: string;
};

/** "1,204 views": the plural form for `count`, with the number grouped the reader's way. */
function countLabel(locale: Locale, forms: string, count: number) {
  return plural(locale, forms, count).replace(String(count), count.toLocaleString(intlLocale(locale) ?? []));
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
  seedPost,
  onClose,
  focusCommentId = null,
}: {
  initialItems: MuseItem[];
  initialCursor: string | null;
  currentUserId: string;
  /** Opened from a Home feed video (MuseViewerOverlay): start on that post, then the Muse feed from the top. */
  seedPost?: MuseSeedPost;
  /** Set when shown as an overlay over another page rather than as /muse: the cards get a close button. */
  onClose?: () => void;
  /** /muse/<id>?comment=<commentId> (a comment or reply notification): open the first Muse's comments on that thread. */
  focusCommentId?: string | null;
}) {
  const router = useRouter();
  const { t } = useMuseText();
  // A guest preview session (src/lib/guest-preview.ts) can watch, not react, repost, comment or count as a view.
  const { isGuest, promptSignUp } = useGuestPreview();
  const [items, setItems] = useState<MuseItem[]>(() => (seedPost ? [museSeedItem(seedPost)] : initialItems));
  const [cursor, setCursor] = useState(initialCursor);
  // The first card keeps one React key when the post it opened on turns out to be a Muse reshare and is swapped for
  // that Muse, so its <video> (the same file) carries on playing instead of starting over.
  const [seedItemId, setSeedItemId] = useState(seedPost?.id ?? null);
  const seedVideoUrl = seedPost?.videoUrl ?? null;
  // Muse opens playing WITH sound; the speaker button mutes it. `muted` is the viewer's own choice, shared by every
  // card (the same "one sound setting for the whole feed" convention Home's videos use).
  const [muted, setMuted] = useState(false);
  // Some browsers/WebViews refuse to autoplay with sound until the person has interacted with the page (most likely
  // when /muse is the very first thing opened). When a card's play-with-sound is refused it plays muted instead and
  // this flips on: a "Tap for sound" pill shows and the next tap anywhere turns sound on — that tap is the gesture
  // the browser was waiting for. Distinct from `muted` so it never overrides a deliberate mute.
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [shareMuseId, setShareMuseId] = useState<string | null>(null);
  // MuseShareModal now needs to stay mounted through its own close
  // animation (Sheet's AnimatePresence — see that file), but the `shareMuse`
  // lookup below goes undefined the instant shareMuseId is cleared, which
  // would otherwise yank its content out from under the still-playing
  // exit. Remembers the last real item so the modal has something to
  // render while closing — the hook itself has to live up here,
  // unconditionally, ahead of this component's own early return below;
  // the actual "remember it" adjustment happens where shareMuse is
  // computed, after that return.
  const [rememberedShareMuse, setRememberedShareMuse] = useState<MuseItem | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  // Comments open: that card's video shrinks into a rounded card at the top (MuseCard's media frame) and the sheet
  // takes the rest of the screen. The feed can't be swiped meanwhile, and back / Escape / the handle close the comments
  // first, through a history entry of their own (same pattern as MuseViewerOverlay's).
  const [commentsOpenForId, setCommentsOpenForId] = useState<string | null>(null);
  const [commentsFocusId, setCommentsFocusId] = useState<string | null>(null);
  const [commentsFrame, setCommentsFrame] = useState<MuseCommentsFrame | null>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const feedRef = useRef<HTMLDivElement>(null);
  // Measures the status bar (and, on /muse, the header) the card must stay below: the same inset the cards' own top
  // controls clear, read from CSS because env(safe-area-inset-top) has no JS API.
  const topInsetProbeRef = useRef<HTMLDivElement>(null);
  const commentsHistoryRef = useRef(false);

  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [likeSyncSource] = useState(() => Symbol("muse-feed-like"));

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const result = await getMuseFeed({ cursor });
    setItems((prev) => appendMuseItems(prev, result.items, seedVideoUrl));
    setCursor(result.nextCursor);
    loadingMoreRef.current = false;
  }, [cursor, seedVideoUrl]);

  // Opened on a feed post: ask whether that post is a Muse reshare (then the card becomes that Muse, with its
  // reactions and comments) and load the Muse feed's first page after it, together. Either failing just leaves less
  // to show (an unverified account can't open Muse, so it only sees the post).
  useEffect(() => {
    if (!seedPost) return;
    let cancelled = false;
    void Promise.all([getMuseForPost(seedPost.id).catch(() => null), getMuseFeed().catch(() => null)]).then(
      ([seed, page]) => {
        if (cancelled) return;
        const muse = seed?.item ?? null;
        if (muse) setSeedItemId(muse.id);
        setItems((prev) => {
          const head = muse ? prev.map((it) => (it.seedPostId === seedPost.id ? muse : it)) : prev;
          return page ? appendMuseItems(head, page.items, seedVideoUrl) : head;
        });
        if (page) setCursor(page.nextCursor);
      },
    );
    return () => {
      cancelled = true;
    };
    // Once per opening: seedPost is fixed for the overlay's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (isGuest) {
      promptSignUp();
      return undefined;
    }
    const result = await toggleMuseReaction(museId, emoji);
    if (result.reactions) {
      // The server's count: for a Muse sharing its likes with Home (likeGroupId) it is the group's, not this Muse's
      // own reaction total.
      const likeCount = result.likeCount;
      const myReaction = result.reactions.find((r) => r.reactedByMe)?.emoji ?? null;
      const liked = myReaction !== null;
      const likeGroupId = items.find((it) => it.id === museId)?.likeGroupId ?? null;
      setItems((prev) => prev.map((it) => (it.id === museId ? { ...it, likeCount, myReaction } : it)));
      if (likeGroupId) {
        const change = { likeGroupId, liked, likeCount };
        applyGroupLike(change, museId);
        // A post card of the same video (Home under this viewer) takes the same answer.
        announceLikeGroup({ ...change, source: likeSyncSource });
      }
    }
    return result.reactions;
  }

  /** Another card of the group changed the like: same count everywhere, and the cards re-read their emoji summary. */
  function applyGroupLike(change: { likeGroupId: string; liked: boolean; likeCount: number }, exceptId: string | null) {
    setItems((prev) =>
      prev.map((it) =>
        it.likeGroupId === change.likeGroupId && it.id !== exceptId
          ? {
              ...it,
              likeCount: change.likeCount,
              myReaction: change.liked ? (it.myReaction ?? "❤️") : null,
              likeSyncVersion: (it.likeSyncVersion ?? 0) + 1,
            }
          : it,
      ),
    );
  }
  // A like on a post card of the same video (Home stays mounted under this viewer) updates this feed's cards too.
  useLikeGroupSync("any", likeSyncSource, (change) => applyGroupLike(change, null));

  const measureCommentsFrame = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return null;
    return museCommentsFrame({
      width: feed.clientWidth,
      height: feed.clientHeight,
      topInset: topInsetProbeRef.current?.offsetHeight ?? 0,
    });
  }, []);

  function openComments(museId: string, focusId: string | null = null) {
    if (commentsOpenForId) return;
    setCommentsFrame(measureCommentsFrame());
    setCommentsFocusId(focusId);
    setCommentsOpenForId(museId);
    if (!commentsHistoryRef.current) {
      commentsHistoryRef.current = true;
      // Same URL (Next.js doesn't navigate); the state keeps whatever the entry had (MuseViewerOverlay's marker).
      window.history.pushState({ ...(window.history.state ?? {}), museComments: true }, "");
    }
  }

  /** Close button, Escape, a drag down, a tap on the video: back through the comments' own history entry. */
  const requestCloseComments = useCallback(() => {
    // One back per opening: a double tap on Close must not also leave the viewer or the page.
    if (commentsHistoryRef.current) {
      commentsHistoryRef.current = false;
      window.history.back();
    } else {
      setCommentsOpenForId(null);
      setCommentsFocusId(null);
    }
  }, []);

  // The back button (browser, Android) closes the comments before anything else.
  useEffect(() => {
    if (!commentsOpenForId) return;
    const onPopState = () => {
      if ((window.history.state as { museComments?: boolean } | null)?.museComments) return;
      commentsHistoryRef.current = false;
      setCommentsOpenForId(null);
      setCommentsFocusId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [commentsOpenForId]);

  // Rotation, a resized window, an Android keyboard resizing the WebView: the card and sheet follow the new screen.
  useEffect(() => {
    if (!commentsOpenForId) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCommentsFrame(measureCommentsFrame()));
    };
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [commentsOpenForId, measureCommentsFrame]);

  // A comment / reply notification: open that Muse's comments on its thread once the card is on screen.
  const focusOpenedRef = useRef(false);
  useEffect(() => {
    if (focusOpenedRef.current || !focusCommentId || !items[0] || items[0].seedPostId) return;
    focusOpenedRef.current = true;
    openComments(items[0].id, focusCommentId);
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Author-only — removes the Muse outright (see deleteMuse's own doc comment). Optimistic: the card disappears immediately, no confirm-then-wait round trip. */
  async function removeMuse(museId: string) {
    setItems((prev) => prev.filter((it) => it.id !== museId));
    await deleteMuse(museId);
  }

  /** Optimistic toggle-with-revert, same shape as toggleReaction/SubscribeButton's own toggle. */
  async function toggleRepost(museId: string) {
    if (isGuest) {
      promptSignUp();
      return;
    }
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
    if (!result.error) {
      setToast(nextReposted ? t.feed.sharedToHome : t.feed.removedFromHome);
      setTimeout(() => setToast(null), 2500);
    }
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

  // When the first tap is what turned sound on, the card that receives that same tap must not also treat it as
  // "pause": React re-renders between this window listener and the card's own click handler, so the card can't tell
  // from props alone. It asks here instead.
  const lastUnblockAtRef = useRef(0);
  const consumeUnblockTap = useCallback(() => {
    const justUnblocked = Date.now() - lastUnblockAtRef.current < 400;
    lastUnblockAtRef.current = 0;
    return justUnblocked;
  }, []);

  useEffect(() => {
    if (!soundBlocked) return;
    const enable = () => {
      lastUnblockAtRef.current = Date.now();
      setSoundBlocked(false);
    };
    // Capture, so it still fires when a control below stops propagation; once, so it is just the first tap.
    window.addEventListener("click", enable, { capture: true, once: true });
    window.addEventListener("keydown", enable, { capture: true, once: true });
    return () => {
      window.removeEventListener("click", enable, { capture: true });
      window.removeEventListener("keydown", enable, { capture: true });
    };
  }, [soundBlocked]);

  const viewedRef = useRef(new Set<string>());
  function recordView(museId: string) {
    if (isGuest || viewedRef.current.has(museId)) return;
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
        <p className="text-sm text-white/70">{t.feed.empty}</p>
        <button
          type="button"
          onClick={() => router.push(`/u/${currentUserId}`)}
          className="mt-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          {t.feed.goToProfile}
        </button>
      </div>
    );
  }

  const commentsMuse = commentsOpenForId ? items.find((it) => it.id === commentsOpenForId) : undefined;
  const shareMuse = shareMuseId ? items.find((it) => it.id === shareMuseId) : undefined;
  // The actual "remember it" adjustment for rememberedShareMuse (declared
  // up with this component's other hooks, above its early return) —
  // during render (React's documented pattern for this) rather than a
  // useEffect.
  if (shareMuse && shareMuse !== rememberedShareMuse) setRememberedShareMuse(shareMuse);
  const displayedShareMuse = shareMuse ?? rememberedShareMuse;

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
        // As an overlay, overscroll-contain keeps a fling past either end from scrolling the page underneath.
        // While comments are open the feed can't be scrolled to another Muse (overflow hidden keeps the position).
        ref={feedRef}
        className={cn("fixed inset-0 z-10 select-none bg-black", onClose && "overscroll-contain")}
        style={{ scrollSnapType: "y mandatory", overflowY: commentsOpenForId ? "hidden" : "scroll" }}
      >
        {items.map((item) => (
          <MuseCard
            key={item.id === seedItemId ? "seed" : item.id}
            item={item}
            commentsOpen={commentsOpenForId === item.id}
            commentsFrame={commentsOpenForId === item.id ? commentsFrame : null}
            reducedMotion={reducedMotion}
            onCloseComments={requestCloseComments}
            onClose={onClose}
            muted={muted}
            soundBlocked={soundBlocked}
            onSoundBlocked={() => setSoundBlocked(true)}
            consumeUnblockTap={consumeUnblockTap}
            currentUserId={currentUserId}
            onToggleMute={() => setMuted((m) => !m)}
            onToggleReaction={(emoji) => toggleReaction(item.id, emoji)}
            onOpenComments={() => openComments(item.id)}
            onDelete={() => removeMuse(item.id)}
            onToggleRepost={() => toggleRepost(item.id)}
            onShare={() => setShareMuseId(item.id)}
            onView={() => recordView(item.id)}
          />
        ))}
        <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      </div>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-24 z-[55] flex justify-center px-4"
        >
          <p className="rounded-full bg-black/75 px-4 py-2 text-sm text-white">{toast}</p>
        </div>
      )}

      {displayedShareMuse &&
        displayedShareMuse.mediaType === "VIDEO" &&
        displayedShareMuse.videoUrl &&
        displayedShareMuse.videoDurationSeconds != null && (
          <MuseShareModal
            museId={displayedShareMuse.id}
            caption={displayedShareMuse.caption}
            videoUrl={displayedShareMuse.videoUrl}
            videoDurationSeconds={displayedShareMuse.videoDurationSeconds}
            reshared={displayedShareMuse.isReposted}
            onToggleReshare={() => toggleRepost(displayedShareMuse.id)}
            onShareCountChange={(count) =>
              setItems((prev) => prev.map((it) => (it.id === displayedShareMuse.id ? { ...it, shareCount: count } : it)))
            }
            open={shareMuse !== undefined}
            onClose={() => setShareMuseId(null)}
          />
        )}

      {/*
       * A true sibling of the scrollable feed above, not nested inside it: an element positioned+z-indexed inside that
       * container would be confined to ITS stacking context, so it could never paint above nav.tsx's bottom tab bar
       * (z-30) or header (z-40). The sheet covers the tab bar while open, like StoryViewer's own modal.
       */}
      <MuseCommentsSheet
        open={commentsMuse !== undefined}
        museId={commentsMuse?.id ?? ""}
        museAuthorName={commentsMuse?.author.name ?? null}
        commentCount={commentsMuse?.commentCount ?? 0}
        currentUserId={currentUserId}
        isMuseOwner={commentsMuse?.author.id === currentUserId}
        focusCommentId={commentsFocusId}
        sheetHeight={commentsFrame?.sheetHeight ?? 0}
        reducedMotion={reducedMotion}
        onClose={requestCloseComments}
        onCountChange={(count) =>
          setItems((prev) => prev.map((it) => (it.id === commentsOpenForId ? { ...it, commentCount: count } : it)))
        }
      />
      <div
        ref={topInsetProbeRef}
        aria-hidden
        className="pointer-events-none invisible fixed start-0 top-0 w-px"
        style={{
          height: onClose
            ? "max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px))"
            : "calc(var(--top-bar-height) + max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px)))",
        }}
      />
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
  commentsOpen,
  commentsFrame,
  reducedMotion,
  onCloseComments,
  onClose,
  muted,
  soundBlocked,
  onSoundBlocked,
  consumeUnblockTap,
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
  /** This card's comments are open: its video sits in a rounded card at the top and its controls step aside. */
  commentsOpen: boolean;
  /** Where the video goes while comments are open (museCommentsFrame); null when they're closed. */
  commentsFrame: MuseCommentsFrame | null;
  reducedMotion: boolean;
  onCloseComments: () => void;
  /** Shown as an overlay (MuseViewerOverlay): a close button, and no header or tab bar to clear. */
  onClose?: () => void;
  muted: boolean;
  /** Autoplay-with-sound was refused somewhere in the feed: play muted for now, and a tap turns sound on. */
  soundBlocked: boolean;
  onSoundBlocked: () => void;
  /** True (once) when the tap being handled is the one that just turned sound on. */
  consumeUnblockTap: () => boolean;
  currentUserId: string;
  onToggleMute: () => void;
  onToggleReaction: (emoji: string) => Promise<ReactionSummary[] | undefined>;
  onOpenComments: () => void;
  onDelete: () => void;
  onToggleRepost: () => void;
  onShare: () => void;
  onView: () => void;
}) {
  const { locale, t: muse } = useMuseText();
  const t = muse.feed;
  const { t: ui } = useUiText();
  const { t: shell } = useShellText();
  const [paused, setPaused] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  // Wider than isVisible on purpose — isVisible means "this is the active,
  // playing card" (0.6 threshold, tight); isNearby means "close enough to
  // the active card to be worth keeping a real <video> mounted at all."
  // Every loaded card is simultaneously mounted here (a real scrollable
  // list, not index-virtualized the way Feed's is — see this file's own
  // notes on why: absolute-positioning virtualization and this feed's CSS
  // scroll-snap don't mix reliably), so without this, a video 20 cards away
  // from what you're watching stays fully decoded and buffered in memory
  // for the rest of the session. Starts true so the very first paint (before
  // the observer below has fired even once) doesn't flash a placeholder for
  // whichever card starts on screen.
  const [isNearby, setIsNearby] = useState(true);
  // On a slow connection or with Data saver on, the cards around the one
  // playing keep their poster but don't start buffering their own video
  // until they become the active card — the active one keeps all the
  // bandwidth there is.
  const lowData = useNetworkQuality() === "slow";
  const [reactions, setReactions] = useState<ReactionSummary[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // will-change only while the frame is actually moving, so the video layer isn't kept promoted the rest of the time.
  const [frameMoving, setFrameMoving] = useState(false);
  const isOwner = item.author.id === currentUserId;
  // The feed post the viewer opened on (not a Muse): only its video, author and caption are shown.
  const isSeedPost = Boolean(item.seedPostId);

  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Same visibility-gated src management Feed's own EMBED cards already use
  // (post-card.tsx) — every loaded card is simultaneously mounted here too
  // (a real scrollable list, not virtualized), so an off-screen embed would
  // otherwise autoplay and keep playing indefinitely, same waste that hook
  // was built to stop. Empty string when there's no embed is a harmless
  // no-op (observes a null ref).
  const embedIframeSrc =
    item.mediaType === "EMBED" && item.embedProvider && item.embedId
      ? embedSrc({ provider: item.embedProvider, id: item.embedId })
      : "";
  const embedRef = useStopEmbedOnScrollOut<HTMLIFrameElement>(embedIframeSrc);

  // Fetches this card's full per-emoji breakdown once, on mount — the feed
  // list itself only carries likeCount (a cheap denormalized total) and
  // myReaction, not every item's full breakdown, since that would mean a
  // groupBy per item on every page load. With real scrolling, every loaded
  // card is simultaneously mounted (not just one "current" item), so this
  // now fires once per page of items rather than once per swipe — the same
  // tradeoff Home's own post feed already makes for its reaction data.
  useEffect(() => {
    if (isSeedPost) return;
    let cancelled = false;
    getMuseReactionSummary(item.id).then((result) => {
      if (!cancelled) setReactions(result.reactions);
    });
    return () => {
      cancelled = true;
    };
    // likeSyncVersion: the like changed on another card of the same video (like-group-sync.ts).
  }, [item.id, isSeedPost, item.likeSyncVersion]);

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

  // Deliberately a separate observer/threshold from isVisible above, not a
  // second read of the same one — see isNearby's own doc comment. A ±100%
  // viewport rootMargin keeps the card you'd swipe to next already primed
  // (no pop-in the moment it becomes active) while still tearing down
  // anything genuinely scrolled away.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsNearby(Boolean(entry?.isIntersecting)),
      { rootMargin: "100% 0px" },
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
  // item.id: the opening card can turn from a feed post into its Muse while already on screen (see MuseFeed).
  useEffect(() => {
    if (isVisible && !isSeedPost) onView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, item.id]);


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

    // Plays with sound. If the browser refuses (no user gesture yet), plays muted instead and tells the feed, which
    // shows "Tap for sound" — never a silent failure, never a card that just sits there.
    async function start(el: HTMLMediaElement) {
      try {
        await el.play();
      } catch {
        if (!el.muted) {
          onSoundBlocked();
          el.muted = true;
          el.play().catch(() => {});
        }
      }
    }
    if (video) {
      if (shouldPlay) void start(video);
      else video.pause();
    }
    if (audio) {
      if (shouldPlay) void start(audio);
      else audio.pause();
    }
    // item.audioUrl: a separate audio track can appear when the opening card turns into its Muse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, paused, item.audioUrl]);

  async function handleToggleReaction(emoji: string) {
    const next = await onToggleReaction(emoji);
    if (next) setReactions(next);
  }

  const isEmbed = item.mediaType === "EMBED";

  // While comments are open the feed can't scroll, but a resize (rotation, an Android keyboard shrinking the WebView,
  // which shortens every h-dvh card) could leave it between two cards: keep this one exactly in view.
  useEffect(() => {
    const section = sectionRef.current;
    const feed = section?.parentElement;
    // The feed itself only (it is the section's offsetParent: fixed); scrollIntoView would move outer scrollers too.
    if (commentsFrame && section && feed && feed.scrollTop !== section.offsetTop) {
      feed.scrollTo({ top: section.offsetTop, behavior: "instant" });
    }
  }, [commentsFrame]);

  // The media frame's target: full screen, or the rounded card at the top while comments are open. Only transform and
  // clip-path change (never the box's size), so the <video> inside is not re-laid out, remounted or restarted.
  const frameTarget = commentsOpen && commentsFrame ? commentsFrame : FULL_FRAME;

  return (
    <section
      ref={sectionRef}
      style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}
      className="relative flex h-dvh w-screen flex-col overflow-hidden bg-black"
      onClick={() => {
        // With comments open, a tap on the video (or around it) closes them, like the handle does.
        if (commentsOpen) {
          onCloseComments();
          return;
        }
        // An embed's play/pause lives inside the source platform's own
        // iframe player, entirely outside this app's control (no shared JS
        // control API across Instagram/TikTok/etc.) — this tap-to-pause
        // gesture only makes sense for a real <video> this app drives.
        if (isEmbed) return;
        // While sound is blocked the first tap is the "turn sound on" gesture (the feed handles it) — it shouldn't also pause.
        if (soundBlocked || consumeUnblockTap()) return;
        setPaused((p) => !p);
      }}
    >
      {/* The media frame: always rendered, around whichever of iframe / video / poster this card shows, so opening
          or closing comments moves this wrapper and never the media element itself (muse-feed-video.test.ts). */}
      <m.div
        className="absolute inset-0 overflow-hidden bg-black"
        style={{ originX: 0.5, originY: 0.5, willChange: frameMoving ? "transform, clip-path" : undefined }}
        initial={false}
        animate={{ y: frameTarget.y, scale: frameTarget.scale, clipPath: frameTarget.clipPath }}
        transition={reducedMotion ? MUSE_COMMENTS_INSTANT : MUSE_COMMENTS_TRANSITION}
        onAnimationStart={() => setFrameMoving(true)}
        onAnimationComplete={() => setFrameMoving(false)}
      >
        {isEmbed && item.embedProvider && item.embedId ? (
          // Instagram/TikTok/etc.'s own player, complete with their own
          // branding/controls — this app doesn't control its playback (see
          // Muse.mediaType's own doc comment on the trust boundary this
          // implies). Autoplay (muted) is requested via embedSrc's own query
          // params for providers that document one — best-effort, not a
          // guarantee, same as any other cross-origin embed.
          <iframe
            ref={embedRef}
            src={embedIframeSrc}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title={item.author.name ? format(t.embedTitle, { name: item.author.name }) : t.embedTitleUnnamed}
          />
        ) : isNearby ? (
          <video
            ref={videoRef}
            aria-label={item.author.name ? format(t.videoLabel, { name: item.author.name }) : t.videoLabelUnnamed}
            src={item.videoUrl ?? undefined}
            poster={item.videoThumbnailUrl ?? undefined}
            preload={lowData && !isVisible ? "none" : undefined}
            // Always muted when a separate audioUrl is replacing the video's
            // own sound (playing both would double up), otherwise follows the
            // shared mute toggle — same source either way, never both at once.
            muted={Boolean(item.audioUrl) || muted || soundBlocked}
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : item.videoThumbnailUrl ? (
          // Scrolled far enough away that the real <video> (and whatever it
          // was still buffering/decoding) has been torn down entirely — see
          // isNearby's own doc comment. Its poster frame in a plain <img>
          // costs essentially nothing to keep mounted by comparison, and
          // means scrolling back doesn't first show a blank black card before
          // the real video re-mounts and starts loading again.
          // eslint-disable-next-line @next/next/no-img-element -- a poster frame, not something next/image needs to optimize
          <img
            src={item.videoThumbnailUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 bg-black" />
        )}

        {!isEmbed && paused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <div className="rounded-full bg-black/40 p-4 text-white">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </m.div>
      {item.audioUrl && isNearby && (
        <audio
          ref={audioRef}
          src={item.audioUrl}
          preload={lowData && !isVisible ? "none" : undefined}
          muted={muted || soundBlocked}
          loop
        />
      )}

      {!isEmbed && soundBlocked && !commentsOpen && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--top-bar-height)+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))] z-10 flex justify-center px-4 pt-12">
          <p role="status" className="rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-white">{t.tapForSound}</p>
        </div>
      )}

      {/* The card's own controls step aside (a plain fade) while its comments are open, and can't be reached. */}
      <div
        className={cn(
          "relative flex flex-1 flex-col justify-between transition-opacity duration-300 ease-out motion-reduce:transition-none",
          commentsOpen && "pointer-events-none opacity-0",
        )}
        aria-hidden={commentsOpen || undefined}
        inert={commentsOpen}
      >
        <div
          // This card sits at z-10, deliberately below nav.tsx's sticky
          // header — so a plain safe-area spacer isn't enough here, the
          // header's own real content height needs clearing too, or an
          // interactive control placed right under it renders hidden
          // behind the opaque header instead (confirmed live: the mute
          // button sat entirely underneath it). --top-bar-height (~4rem at
          // the default text size, see globals.css) is the header's
          // measured height with no safe-area-inset-top; --tab-bar-height
          // is the same idea for the bottom nav's clearance below. Both are
          // variables rather than a literal 4rem because those two bars stop
          // growing with the iOS text size setting while rem does not.
          className={cn(
            "flex items-center justify-end gap-2 bg-gradient-to-b from-black/50 to-transparent px-4 pb-6",
            onClose
              ? "pt-[calc(0.75rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))]"
              : "pt-[calc(var(--top-bar-height)+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))]",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={shell.common.close}
              className="me-auto rounded-full bg-black/40 p-2 text-white"
            >
              <X size={18} />
            </button>
          )}
          {isOwner && !isSeedPost && (
            <button
              type="button"
              onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
              aria-label={confirmingDelete ? t.deleteConfirmLabel : t.delete}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-2 text-white",
                confirmingDelete ? "bg-danger" : "bg-black/40",
              )}
            >
              <Trash2 size={18} />
              {confirmingDelete && <span className="pe-1 text-xs font-medium">{t.deleteConfirm}</span>}
            </button>
          )}
          {/* The same toggle as tapping anywhere on the video (the
              section's own onClick), as a real named button: a tap on bare
              video isn't something VoiceOver or Voice Control can target. */}
          {!isEmbed && (
            <button
              type="button"
              onClick={() => {
                if (soundBlocked || consumeUnblockTap()) return;
                setPaused((p) => !p);
              }}
              aria-label={paused ? t.play : t.pause}
              className="rounded-full bg-black/40 p-2 text-white"
            >
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? t.unmute : t.mute}
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
                {!isOwner && !isSeedPost && (
                  <SubscribeButton
                    targetId={item.author.id}
                    initiallySubscribed={item.isFollowingAuthor}
                    variant="pill"
                  />
                )}
              </div>
              {item.caption && <p dir="auto" className="mt-1 break-words text-sm text-white">{item.caption}</p>}
              {!isSeedPost && (
                <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-white/70">
                  <Eye size={12} /> {countLabel(locale, t.views, item.viewCount)}
                </p>
              )}
              {item.sharedPostId && (
                <Link
                  href={`/post/${item.sharedPostId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 inline-block text-[0.6875rem] text-white/70 underline"
                >
                  {t.viewOriginal}
                </Link>
              )}
            </div>

            {!isSeedPost && (
              <div className="flex shrink-0 flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={onOpenComments}
                  className="flex flex-col items-center gap-0.5 text-white"
                  aria-label={format(t.commentsCount, { count: item.commentCount })}
                >
                  <span className="rounded-full bg-black/40 p-2">
                    <MessageCircle size={20} />
                  </span>
                  <span className="text-[0.6875rem]">{item.commentCount}</span>
                </button>
                <div className="flex shrink-0 flex-col items-center gap-0.5 text-white">
                  <EmojiPickerButton
                    onSelect={handleToggleReaction}
                    quickReactions={QUICK_REACTIONS}
                    // The overlay sits at z-[70]; the picker is portaled to <body>.
                    popupZClass={onClose ? "z-[80]" : undefined}
                  />
                  <span className="text-[0.6875rem]" aria-label={plural(locale, ui.reactions.count, item.likeCount)} role="img">
                    {item.likeCount}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onToggleRepost}
                  aria-label={format(t.reshareCount, { count: item.repostCount })}
                  aria-pressed={item.isReposted}
                  className="flex flex-col items-center gap-0.5 text-white"
                >
                  <span className={cn("rounded-full p-2", item.isReposted ? "bg-accent text-accent-ink" : "bg-black/40")}>
                    <Repeat2 size={20} />
                  </span>
                  <span className="text-[0.6875rem]">{item.repostCount}</span>
                </button>
                {/* "Share via device" brands/downloads the actual video file
                    (see resolveBrandedVideoUrl) — nothing to brand or
                    download for an EMBED item, which has no file of ours at
                    all. Reshare-to-Home/Story above already cover it. */}
                {!isEmbed && (
                  <button data-guest-block
                    type="button"
                    onClick={onShare}
                    aria-label={format(t.shareCount, { count: item.shareCount })}
                    className="flex flex-col items-center gap-0.5 text-white"
                  >
                    <span className="rounded-full bg-black/40 p-2">
                      <Share2 size={20} />
                    </span>
                    <span className="text-[0.6875rem]">{item.shareCount}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {reactions.length > 0 && (
            <div className="px-4 pt-2" onClick={(e) => e.stopPropagation()}>
              <ReactionBar reactions={reactions} onToggle={handleToggleReaction} />
            </div>
          )}

          {/* Same bottom-nav clearance layout.tsx's <body> reserves in
              normal flow (pb-[calc(var(--tab-bar-height)+safe-area)] md:pb-0) — this card
              sits inside a `fixed` ancestor, so it doesn't inherit that
              padding and would otherwise render behind the (higher
              z-index) nav bar. */}
          <div className="h-4" />
          {onClose ? (
            <SafeAreaBottomSpacer />
          ) : (
            <div className="h-[calc(var(--tab-bar-height)+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] md:h-0" />
          )}
        </div>
      </div>
    </section>
  );
}
