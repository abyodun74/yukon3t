"use client";

import { OverlayPortal, useOverlayZ } from "@/components/overlay-root";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Eye, Trash2, Send, MessageCircle, Pause, Play, Heart, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserLink, UserAvatar } from "@/components/user-link";
import {
  viewStory,
  deleteStory,
  getStoryViewers,
  getStoryReactionSummary,
  toggleStoryReaction,
  replyToStory,
  getStoryComments,
  createStoryComment,
  deleteStoryComment,
} from "@/app/actions/stories";
import { toggleStoryLike } from "@/app/actions/story-likes";
import { optimisticStoryLike, settleStoryLike } from "@/lib/story-likes";
import { hapticImpact } from "@/lib/haptics";
import { HeartBurstLayer } from "@/components/heart-burst-layer";
import { useHeartBurst } from "@/lib/use-heart-burst";
import { likeRolledBack } from "@/lib/heart-burst";
import { StoryShareButton } from "@/components/story-share-button";
import { StoryCaption } from "@/components/story-caption";
import { formatDateTime, formatShortAge } from "@/lib/format-date";
import { useScreenshotContext } from "@/lib/screenshot-context";
import { QUICK_REACTIONS } from "@/lib/emoji";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { embedSrc, type EmbedProvider } from "@/lib/video-embed";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import {
  STORY_DISMISS_DURATION_MS,
  STORY_DISMISS_EASING,
  canStartStoryDismiss,
  decideStoryDismiss,
  dismissOffset,
  dismissVisual,
  lockGestureAxis,
  releaseIntent,
  releaseVelocity,
  startsOnControl,
  velocityBetween,
  type GestureAxis,
} from "@/lib/story-dismiss-gesture";
import { internalNavigationFromClick } from "@/lib/viewer-history";
import { CommentDeleteDialog, useConfirmAction } from "@/components/confirm-dialog";
import { useFeedText } from "@/components/feed-text";
import { useGuestPreview } from "@/components/guest-preview";
import { useShellText } from "@/components/ui-text";
import { format, plural, byCode } from "@/lib/i18n/locales";
import { clearDeliveredPushesFor } from "@/lib/delivered-push-clear";
import { storyHref } from "@/lib/notification-href";
import {
  STORY_VIDEO_WATCHDOG_INTERVAL_MS,
  playFailureAction,
  shouldResumeAfterPause,
  soundTrackOutOfStep,
  soundTrackPosition,
  stallAction,
  type StoryVideoIssue,
} from "@/lib/story-video-playback";
import { useCallMediaHold } from "@/lib/use-call-media-hold";

type StoryComment = {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string | null; avatarUrl: string | null };
};

const IMAGE_DURATION_MS = 5000;
// An embedded player is a cross-origin iframe — no onTimeUpdate/onEnded to
// drive advance off of the way a real <video> gets (see the auto-advance
// effect below), so this behaves like a timed image, just longer: enough to
// actually watch some of whatever's playing before it moves on.
const EMBED_DURATION_MS = 15000;
const TAP_MAX_HOLD_MS = 250;
// A pointer that moved at least this far horizontally before release is a
// swipe (move to the next/previous person's stack), not a tap (move within
// this person's own stories) — checked before the hold-duration tap check
// below, so a slow drag doesn't get misread as a hold-to-pause release.
const SWIPE_THRESHOLD_PX = 60;
// When a tap zone last saw a real pointerup — module-level, not a ref,
// because the click that trails that pointerup can land on a DIFFERENT
// StoryViewer instance: the tray remounts the viewer per person (keyed by
// authorId, see story-tray-viewer.tsx), so a tap that crosses to the next or
// previous person has already swapped instances by the time the browser
// dispatches its click, onto the new instance's zone button under the same
// finger. A per-instance guard starts at 0 there and let that click advance
// a second time (skipping the new person's first story, or the person).
let lastZonePointerUpAt = 0;

export type StoryData = {
  id: string;
  mediaType: "IMAGE" | "VIDEO" | "EMBED";
  // Nullable only for EMBED — see StoryMediaType's own doc comment
  // (prisma/schema.prisma) for why an embed has no file of ours.
  mediaUrl: string | null;
  mediaThumbnailUrl: string | null;
  // VIDEO only: a Muse's sound track this Story was made with (Story.audioUrl, shareMuseToStory). Replaces the
  // video's own sound: the video plays muted and this plays in step with it.
  audioUrl: string | null;
  embedProvider: EmbedProvider | null;
  embedId: string | null;
  caption: string | null;
  createdAt: Date;
  viewCount: number;
  // Set when this story is a "share to your story" of an existing post
  // (actions/shares.ts's shareToStory) — renders a "View post" link back to
  // it, the same attribution repost/shareToCircle already give a quoted post.
  sharedPostId: string | null;
};


/**
 * Reserves real space below whatever's the bottom-most interactive element
 * in this viewer (the comment icon, reply bar, "Seen by" list, ...) for
 * Android's on-screen navigation bar/gesture pill. This viewer is a fixed
 * inset-0 overlay with edge-to-edge WebView content, so without this the
 * system nav can sit directly on top of — and swallow taps on — anything
 * rendered flush against the true bottom edge of the screen; confirmed
 * live, the new comment icon was invisible/untappable behind it. Same fix
 * shape as nav.tsx's own bottom tab bar, including its fallback: plain
 * env(safe-area-inset-bottom) alone has a known Android reliability gap,
 * so this also falls back to --safe-area-inset-bottom, which Capacitor
 * core's SystemBars plugin injects straight from Android's real
 * WindowInsets. No-op (0px) anywhere neither is set, including iOS/web.
 */
function SafeAreaBottomSpacer() {
  return <div aria-hidden style={{ height: "max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px))" }} />;
}

/** The top inset the header keeps clear of: the iPhone notch / Dynamic Island, or Android's status bar. */
const SAFE_AREA_TOP = "max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px))";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
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
  authorId,
  authorName,
  authorAvatarUrl,
  isOwner,
  currentUserId,
  onClose,
  direction,
  onNextAuthor,
  onPrevAuthor,
  onNavigate,
}: {
  stories: StoryData[];
  startIndex: number;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  isOwner: boolean;
  /** Used only to decide whether to show a delete button on a comment (a UX nicety) — deleteStoryComment re-checks authorship server-side regardless. */
  currentUserId: string;
  onClose: () => void;
  /** Which way this mount should glide in from — set by the tray wrapper alongside onNextAuthor/onPrevAuthor. Omitted (e.g. a single-author profile viewer) means no entrance glide. */
  direction?: "next" | "prev";
  /** A swipe (see SWIPE_THRESHOLD_PX), or naturally reaching the end of `stories`, calls this instead of onClose when provided — the tray wrapper uses it to move to the next person's stack rather than exiting. */
  onNextAuthor?: () => void;
  /** A rightward swipe calls this when provided — the tray wrapper uses it to move to the previous person's stack. No-op (not undefined-guarded to onClose) if there's nobody before this one. */
  onPrevAuthor?: () => void;
  /**
   * An in-app link inside the viewer (the author's name, "View post") is handed here instead of navigating itself:
   * StoryTrayViewer leaves the viewer's history entries first, so no orphan same-URL entry stays behind the destination.
   */
  onNavigate?: (href: string) => void;
}) {
  const { t, locale, dir } = useFeedText();
  const { t: shell } = useShellText();
  // A guest preview session (src/lib/guest-preview.ts) can look, not react, comment, reply or count as a viewer.
  const { isGuest, promptSignUp } = useGuestPreview();
  const [index, setIndex] = useState(startIndex);
  // Keyed by story id like the state below, so a story never starts out showing the previous one's bar (a video
  // only reports progress once it is playing).
  const [progressState, setProgressState] = useState<{ storyId: string; value: number } | null>(null);
  // One flag per reason the story can be paused, with the real paused state
  // derived from all of them (isPaused below) — not one shared boolean each
  // source sets and clears. They overlap: with the reply field focused,
  // opening the Share sheet moves focus into the sheet, which blurs the
  // field; on a shared boolean that blur cleared the pause the sheet had
  // just set, and the story ran on (and could auto-advance or close) behind
  // the open sheet.
  //
  // `paused` itself is the pointer hold: set on pointerdown, cleared by
  // every pointer release — including the release of a tap on "Next story".
  // The viewers/comments panels don't touch it: showViewers/showComments
  // hold the story themselves while one is open, and it plays on at close.
  const [paused, setPaused] = useState(false);
  // The explicit Pause button — keyed by story id like the state below, so
  // the pause belongs to the story it was pressed on and tapping on to the
  // next story always plays it.
  const [userPausedForId, setUserPausedForId] = useState<string | null>(null);
  const [replyFocused, setReplyFocused] = useState(false);
  // "Show more" on a long caption: keyed by story id (resets on the next story) and holds the story while it is read.
  const [captionExpandedForId, setCaptionExpandedForId] = useState<string | null>(null);
  // On its way out (X, Escape, a drag down): holds the story still while the close animation / history pop runs.
  const [closing, setClosing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Bumped to close the emoji picker from here (back, Escape): EmojiPickerButton owns its open state, and a remount is
  // its close (its unmount reports onOpenChange(false), which resumes the story).
  const [emojiPickerKey, setEmojiPickerKey] = useState(0);
  // Keyed by story id rather than plain booleans — switching stories then
  // naturally "resets" these (the id no longer matches) without needing an
  // effect to synchronously reset state on every story change.
  const [deleteConfirmForId, setDeleteConfirmForId] = useState<string | null>(null);
  const [viewersOpenForId, setViewersOpenForId] = useState<string | null>(null);
  const [viewers, setViewers] = useState<
    { id: string; name: string; viewedAt: Date; reaction: string | null; liked: boolean }[] | null
  >(null);
  const [isPending, setIsPending] = useState(false);
  const [reactionCounts, setReactionCounts] = useState<{ emoji: string; count: number }[]>([]);
  const [myReaction, setMyReaction] = useState<string | null>(null);
  // The heart (src/lib/story-likes.ts), keyed by story id like the state above so a story change never shows the
  // previous story's heart. `likeCount` is only ever set for the author (the server sends null to everyone else).
  const [likeState, setLikeState] = useState<{ storyId: string; liked: boolean; likeCount: number | null } | null>(
    null,
  );
  // A tap on the heart while the previous one is still on its way is ignored, so two quick taps can't race.
  const likePendingRef = useRef(false);
  const [commentsOpenForId, setCommentsOpenForId] = useState<string | null>(null);
  const [comments, setComments] = useState<StoryComment[] | null>(null);
  // Why the current video story isn't playing when it should be (src/lib/story-video-playback.ts): "Tap to play"
  // for blocked/stalled, a note and a timed advance for a file this device can't play. Keyed by story id.
  const [videoIssue, setVideoIssue] = useState<{ storyId: string; kind: StoryVideoIssue } | null>(null);
  // Set when the browser only allowed the video muted: shows "Tap for sound". Keyed by story id.
  const [autoMutedForId, setAutoMutedForId] = useState<string | null>(null);
  // A Muse's sound track (story.audioUrl) that can't be played here (a missing file, a format this device can't
  // decode): the story falls back to the video's own sound. Keyed by story id.
  const [soundTrackFailedForId, setSoundTrackFailedForId] = useState<string | null>(null);
  // A call ringing or under way (beginCallMediaHold): the story holds still like for any other pause, and plays on
  // after. Its video and sound track are marked data-media-hold="self", so the page-wide call hold leaves them to this.
  const callHold = useCallMediaHold();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Playback bookkeeping for the current video story: when it last moved forward, and how many automatic restarts
  // it has had (the watchdog's one, and those after something else paused it). Reset per story / per (re)start.
  const lastVideoProgressAtRef = useRef(0);
  const lastVideoTimeRef = useRef(0);
  const stallRetriesRef = useRef(0);
  const autoResumesRef = useRef(0);
  const elapsedRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());
  const pointerDownAtRef = useRef(0);
  const pointerStartXRef = useRef(0);
  // The pointer on the tap zones, for drag-down-to-close (src/lib/story-dismiss-gesture.ts). Null between touches.
  const gestureRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    axis: GestureAxis | null;
    allowDismiss: boolean;
    lastY: number;
    lastT: number;
    velocityY: number;
  } | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  // Escape closes an open panel first (comments, "Seen by", the delete confirmation), then the viewer. A sheet opened
  // from here (Share, a confirmation) is its own dialog on top and answers Escape itself.
  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => {
    if (emojiOpenRef.current) closeEmojiPicker();
    else if (panelOpenRef.current) closePanels();
    else handleClose();
  });
  // A full-screen viewer (src/lib/overlay-layers.ts), portaled to the root overlay host: it opens from the Home story
  // tray's horizontal scroller and from a profile's avatar, and must not be positioned or clipped by either.
  const viewerZ = useOverlayZ("viewer");

  const story = stories[index];
  useScreenshotContext(story ? { type: "story", id: story.id } : null);
  // The rising heart of a like (src/lib/heart-burst.ts, the same one Home and Muse use): purely local feedback to the
  // person who liked, never sent anywhere. Keyed to the story on screen, so moving to another story (a tap, a swipe,
  // the timer) takes it away at once and clears its timer; unmount (another person, close) disposes it.
  const heart = useHeartBurst(story?.id);
  const showViewers = story ? viewersOpenForId === story.id : false;
  const showComments = story ? commentsOpenForId === story.id : false;
  const confirmingDelete = story ? deleteConfirmForId === story.id : false;
  const userPaused = story ? userPausedForId === story.id : false;
  const captionExpanded = story ? captionExpandedForId === story.id : false;
  const liked = story && likeState?.storyId === story.id ? likeState.liked : false;
  const likeCount = story && likeState?.storyId === story.id ? likeState.likeCount : null;
  const isPaused =
    paused || userPaused || replyFocused || shareOpen || emojiOpen || closing || captionExpanded || callHold;
  const progress = story && progressState?.storyId === story.id ? progressState.value : 0;
  const currentVideoIssue = story && videoIssue?.storyId === story.id ? videoIssue.kind : null;
  const autoMuted = story ? autoMutedForId === story.id : false;
  // The Muse sound track this video story plays instead of the video's own sound, unless it can't play here.
  const soundTrackUrl =
    story?.mediaType === "VIDEO" && story.audioUrl && soundTrackFailedForId !== story.id ? story.audioUrl : null;
  // A panel shown inside the viewer. Back closes it before the viewer (its own same-URL history entry, on top of the
  // viewer's: src/lib/viewer-history.ts).
  const panelOpen = showComments || showViewers || confirmingDelete;
  const panelOpenRef = useRef(panelOpen);
  useEffect(() => {
    panelOpenRef.current = panelOpen;
  });
  // Anything over the story that owns the touch: no drag-down-to-close starts while one is open.
  const layerOpen = panelOpen || shareOpen || emojiOpen;

  function closePanels() {
    setCommentsOpenForId(null);
    setViewersOpenForId(null);
    setDeleteConfirmForId(null);
  }
  useBackDismiss(panelOpen, closePanels);

  // The emoji picker popover gets its own back entry too: back (and Escape, above) closes it before the viewer.
  const emojiOpenRef = useRef(emojiOpen);
  useEffect(() => {
    emojiOpenRef.current = emojiOpen;
  });
  function closeEmojiPicker() {
    setEmojiPickerKey((k) => k + 1);
  }
  useBackDismiss(emojiOpen, closeEmojiPicker);

  // Links inside the viewer (its own and those in sheets portaled from it, which React bubbles here) go through
  // onNavigate: the viewer leaves its history entries, then the destination is pushed from the page's own entry.
  function handleLinkClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (!onNavigate) return;
    const href = internalNavigationFromClick(e);
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    const active = document.activeElement;
    if (active instanceof HTMLElement && dialogRef.current?.contains(active)) active.blur();
    setClosing(true);
    onNavigate(href);
  }

  // Every deliberate exit (the X, Escape, a drag down) comes through here. A focused reply field is blurred first so
  // the soft keyboard goes down with the viewer (useDialogFocus then hands focus back to the story ring). onClose is
  // the history-backed close (StoryTrayViewer), so back, the X and a drag down all leave history the same.
  function handleClose() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && dialogRef.current?.contains(active)) active.blur();
    setClosing(true);
    onClose();
  }

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  /** Moves the whole viewer `offset` px down with its fade, or back to rest at 0. */
  function applyDismissVisual(offset: number, animate: boolean) {
    const node = dialogRef.current;
    if (!node) return;
    const v = dismissVisual(offset);
    node.style.transition = animate
      ? `transform ${STORY_DISMISS_DURATION_MS}ms ${STORY_DISMISS_EASING}, opacity ${STORY_DISMISS_DURATION_MS}ms ${STORY_DISMISS_EASING}`
      : "none";
    node.style.transform = offset > 0 ? `translateY(${v.translateY}px) scale(${v.scale})` : "";
    node.style.opacity = offset > 0 ? String(v.opacity) : "";
  }

  function dismissByDrag() {
    if (prefersReducedMotion()) {
      handleClose();
      return;
    }
    setClosing(true);
    const node = dialogRef.current;
    if (node) {
      const end = dismissVisual(window.innerHeight);
      node.style.transition = `transform ${STORY_DISMISS_DURATION_MS}ms ${STORY_DISMISS_EASING}, opacity ${STORY_DISMISS_DURATION_MS}ms ${STORY_DISMISS_EASING}`;
      node.style.transform = `translateY(${end.translateY}px) scale(${end.scale})`;
      node.style.opacity = "0";
    }
    closeTimerRef.current = setTimeout(handleClose, STORY_DISMISS_DURATION_MS);
  }

  function snapBack() {
    applyDismissVisual(0, !prefersReducedMotion());
  }

  // Checks the boundary against `index` directly and calls onClose as a
  // plain function call, rather than from inside setIndex's updater — the
  // updater can run synchronously as part of applying this component's own
  // state update, and calling a different component's setState from within
  // it (onClose ultimately updates StoryTrayViewer/StoryTray's state) is
  // exactly what React's "Cannot update a component while rendering a
  // different component" warning flags.
  const next = useCallback(() => {
    if (index + 1 >= stories.length) {
      if (onNextAuthor) onNextAuthor();
      else onClose();
      return;
    }
    setUserPausedForId(null);
    setIndex(index + 1);
  }, [index, stories.length, onClose, onNextAuthor]);

  const prev = useCallback(() => {
    setUserPausedForId(null);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // The page's own media (feed videos behind the viewer) is held by PageMediaHold, mounted beside this viewer by
  // whoever opens it, never here: this component remounts per person, and taking and releasing that hold on every
  // remount is what froze the next person's video story (see page-media-hold.tsx).

  // Records a view once per story — the timer effect below is what actually
  // (re)starts progress from 0 for the new story, via its own rAF/video
  // callbacks rather than a synchronous setState here.
  useEffect(() => {
    if (!story) return;
    elapsedRef.current = 0;
    if (!isGuest && !seenRef.current.has(story.id)) {
      seenRef.current.add(story.id);
      viewStory(story.id);
      // Its pushes (a like / screenshot notice to the author) still in the drawer go too; matched to this story only.
      void clearDeliveredPushesFor(storyHref(authorId, story.id));
    }
  }, [story, isGuest, authorId]);

  // Loads this story's reaction counts fresh each time it becomes current —
  // an async fetch resolved in a .then(), not a synchronous reset, so it
  // doesn't hit the same "setState directly in an effect body" issue the
  // viewers/delete-confirm state avoids via id-keying above.
  useEffect(() => {
    if (!story) return;
    let cancelled = false;
    getStoryReactionSummary(story.id).then((result) => {
      if (cancelled || result.error) return;
      setReactionCounts(result.summary);
      setMyReaction(result.mine);
      setLikeState({ storyId: story.id, liked: result.liked, likeCount: result.likeCount });
    });
    return () => {
      cancelled = true;
    };
  }, [story]);

  // Image/embed auto-advance timer — a real video drives its own progress
  // via onTimeUpdate/onEnded below; an embed can't (see EMBED_DURATION_MS's
  // own comment), so it times out the same way an image does, just longer.
  // A video this device can't play at all (currentVideoIssue "error") is timed
  // like an image too, so it moves on instead of sitting there.
  const timedStory = Boolean(
    story && (story.mediaType === "IMAGE" || story.mediaType === "EMBED" || currentVideoIssue === "error"),
  );
  useEffect(() => {
    if (!story || !timedStory || isPaused || showViewers || showComments) return undefined;
    const storyId = story.id;
    const durationMs = story.mediaType === "EMBED" ? EMBED_DURATION_MS : IMAGE_DURATION_MS;

    let raf: number;
    let lastTs = performance.now();
    const tick = (ts: number) => {
      elapsedRef.current += ts - lastTs;
      lastTs = ts;
      const pct = Math.min(1, elapsedRef.current / durationMs);
      setProgressState({ storyId, value: pct });
      if (pct >= 1) {
        next();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story, timedStory, isPaused, showViewers, showComments, next]);

  // A video story plays whenever nothing holds it, and is never left frozen: every play() rejection is handled
  // (retried muted, or "Tap to play"), a pause nobody here asked for is undone (onPause below), and a watchdog
  // restarts a video that stops moving, then offers "Tap to play" (src/lib/story-video-playback.ts).
  const wantVideoPlaying = !isPaused && !showViewers && !showComments;
  const wantVideoPlayingRef = useRef(wantVideoPlaying);
  const videoIssueShownRef = useRef(false);
  useEffect(() => {
    wantVideoPlayingRef.current = wantVideoPlaying;
    videoIssueShownRef.current = currentVideoIssue !== null;
  });

  const playStoryVideo = useCallback((video: HTMLVideoElement, storyId: string) => {
    video.play().catch((error: unknown) => {
      if (!video.isConnected) return;
      const action = playFailureAction(error, video.muted);
      if (action === "retry-muted") {
        video.muted = true;
        setAutoMutedForId(storyId);
        video.play().catch((mutedError: unknown) => {
          if (!video.isConnected) return;
          const mutedAction = playFailureAction(mutedError, true);
          if (mutedAction === "blocked" || mutedAction === "error") setVideoIssue({ storyId, kind: mutedAction });
        });
      } else if (action === "blocked" || action === "error") {
        setVideoIssue({ storyId, kind: action });
      }
    });
  }, []);

  // A Muse's sound track (story.audioUrl), played like the video: with sound when allowed, else muted with "Tap for
  // sound" (the same note); a track this device can't play at all falls back to the video's own sound.
  const playSoundTrack = useCallback((audio: HTMLAudioElement, storyId: string) => {
    audio.play().catch((error: unknown) => {
      if (!audio.isConnected) return;
      const action = playFailureAction(error, audio.muted);
      if (action === "retry-muted") {
        audio.muted = true;
        setAutoMutedForId(storyId);
        audio.play().catch((mutedError: unknown) => {
          if (audio.isConnected && playFailureAction(mutedError, true) === "error") setSoundTrackFailedForId(storyId);
        });
      } else if (action === "error") {
        setSoundTrackFailedForId(storyId);
      }
    });
  }, []);

  // Keeps the sound track with the video, the clock (src/lib/story-video-playback.ts): playing only while the video
  // is actually moving and the story should play (its pause, a buffering wait and its end silence the track), and
  // moved back into step whenever it has drifted. Called from the video's own events.
  const syncSoundTrack = useCallback(
    (video: HTMLVideoElement, storyId: string) => {
      const audio = audioRef.current;
      if (!audio) return;
      const moving =
        !video.paused &&
        !video.ended &&
        video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
        wantVideoPlayingRef.current;
      if (!moving) {
        if (!audio.paused) audio.pause();
        return;
      }
      const target = soundTrackPosition(video.currentTime, audio.duration);
      if (target !== null && soundTrackOutOfStep(audio.currentTime, target, audio.duration)) audio.currentTime = target;
      if (audio.paused) playSoundTrack(audio, storyId);
    },
    [playSoundTrack],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !story || story.mediaType !== "VIDEO") return undefined;
    if (!wantVideoPlaying || currentVideoIssue === "blocked" || currentVideoIssue === "error") {
      video.pause();
      // An already-paused video fires no pause event: the sound track is silenced here too.
      audioRef.current?.pause();
      return undefined;
    }
    const storyId = story.id;
    lastVideoProgressAtRef.current = performance.now();
    lastVideoTimeRef.current = video.currentTime;
    stallRetriesRef.current = 0;
    playStoryVideo(video, storyId);
    // "Tap to play" is up for a stall: the video keeps trying underneath, and onPlaying takes the note away.
    if (currentVideoIssue === "stalled") return undefined;
    const watchdog = setInterval(() => {
      if (!video.isConnected) return;
      if (document.visibilityState !== "visible") {
        // Backgrounded: nothing is expected to move. Count from when the page is back.
        lastVideoProgressAtRef.current = performance.now();
        return;
      }
      const action = stallAction(performance.now() - lastVideoProgressAtRef.current, stallRetriesRef.current);
      if (action === "retry") {
        stallRetriesRef.current += 1;
        lastVideoProgressAtRef.current = performance.now();
        // Never got a frame to play from: fetch it again. Otherwise just start it again from where it is.
        if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && video.currentTime === 0) video.load();
        playStoryVideo(video, storyId);
      } else if (action === "give-up") {
        setVideoIssue({ storyId, kind: "stalled" });
      }
    }, STORY_VIDEO_WATCHDOG_INTERVAL_MS);
    return () => clearInterval(watchdog);
  }, [wantVideoPlaying, currentVideoIssue, story, playStoryVideo]);

  // Each story starts with a fresh budget of automatic restarts.
  useEffect(() => {
    autoResumesRef.current = 0;
  }, [story]);

  // React 19 ref cleanup: a story video leaving the screen gives up its media player at once instead of whenever
  // it is garbage-collected. Android WebView has only a few hardware decoders, and a run of video stories would
  // otherwise hold one each.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return undefined;
    return () => {
      if (videoRef.current === el) videoRef.current = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, []);
  // The sound track's element, released the same way when its story leaves the screen (or the viewer closes).
  const attachAudio = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    if (!el) return undefined;
    return () => {
      if (audioRef.current === el) audioRef.current = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, []);

  function handleVideoPause(video: HTMLVideoElement) {
    if (!story) return;
    // The track never plays on over a paused video; it starts again with the video (onPlaying).
    audioRef.current?.pause();
    if (
      !shouldResumeAfterPause({
        wantPlaying: wantVideoPlayingRef.current,
        ended: video.ended,
        connected: video.isConnected,
        pageVisible: document.visibilityState === "visible",
        issueShown: videoIssueShownRef.current,
        autoResumes: autoResumesRef.current,
      })
    ) {
      return;
    }
    autoResumesRef.current += 1;
    playStoryVideo(video, story.id);
  }

  // "Tap to play": a real tap, so the browser lets it play with sound.
  function handleTapToPlay() {
    const video = videoRef.current;
    if (!video || !story) return;
    autoResumesRef.current = 0;
    // With a sound track the video stays muted: the track is the sound.
    video.muted = Boolean(soundTrackUrl);
    setAutoMutedForId(null);
    setVideoIssue(null);
    playStoryVideo(video, story.id);
    const audio = audioRef.current;
    if (audio) {
      // Started inside the tap, so the browser allows its sound; syncSoundTrack moves it into step once the video runs.
      audio.muted = false;
      playSoundTrack(audio, story.id);
    }
  }

  function handleUnmute() {
    const video = videoRef.current;
    if (!video || !story) return;
    setAutoMutedForId(null);
    const audio = audioRef.current;
    if (soundTrackUrl && audio) {
      audio.muted = false;
      if (!video.paused) playSoundTrack(audio, story.id);
      return;
    }
    video.muted = false;
  }

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    pointerDownAtRef.current = Date.now();
    pointerStartXRef.current = e.clientX;
    gestureRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      axis: null,
      allowDismiss: !closing && canStartStoryDismiss({ onControl: startsOnControl(e.target as Element), layerOpen }),
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocityY: 0,
    };
    // Keeps the moves and the release on this zone even when a mouse drag leaves it (touch is captured already).
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that's already gone can't be captured; the release then just doesn't arrive here.
    }
    setPaused(true);
  }

  function handlePointerMove(e: PointerEvent<HTMLButtonElement>) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.axis === null) g.axis = lockGestureAxis(dx, dy);
    if (g.axis !== "vertical" || !g.allowDismiss) return;
    if (e.timeStamp > g.lastT) {
      g.velocityY = velocityBetween(g.lastY, g.lastT, e.clientY, e.timeStamp);
      g.lastY = e.clientY;
      g.lastT = e.timeStamp;
    }
    // Reduced motion: no following movement; the release alone decides.
    if (!prefersReducedMotion()) applyDismissVisual(dismissOffset(dy), false);
  }

  function handlePointerCancel(e: PointerEvent<HTMLButtonElement>) {
    const g = gestureRef.current;
    if (g && g.pointerId === e.pointerId && g.axis === "vertical") snapBack();
    gestureRef.current = null;
    setPaused(false);
  }

  function handlePointerUp(e: PointerEvent<HTMLButtonElement>, tapDirection: "prev" | "next") {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g && g.pointerId === e.pointerId && releaseIntent(g.axis) === "dismiss-gesture") {
      // A vertical drag never also taps or swipes: it closes or snaps back. The click that trails it is ignored too.
      lastZonePointerUpAt = Date.now();
      setPaused(false);
      if (!g.allowDismiss) return;
      const offset = dismissOffset(e.clientY - g.y);
      const velocity = releaseVelocity(g.velocityY, e.timeStamp - g.lastT);
      if (decideStoryDismiss(offset, velocity) === "dismiss") dismissByDrag();
      else snapBack();
      return;
    }

    const held = Date.now() - pointerDownAtRef.current;
    const deltaX = e.clientX - pointerStartXRef.current;
    lastZonePointerUpAt = Date.now();
    setPaused(false);

    // A real horizontal swipe always means "move between people", regardless
    // of which tap zone (left third vs right two-thirds) it started or ended
    // in and regardless of which story is currently showing — this is what
    // makes it read as distinct from a tap, which only steps through this
    // same person's own stories.
    if (Math.abs(deltaX) >= SWIPE_THRESHOLD_PX) {
      if (deltaX < 0) onNextAuthor?.();
      else onPrevAuthor?.();
      return;
    }

    if (held < TAP_MAX_HOLD_MS) {
      // On the first story, "previous" steps back to the previous
      // person's stack (a no-op for the first person in the tray) rather
      // than doing nothing — same as handleZoneClick below, so a tap, a
      // Voice Control "tap Previous story" and a VoiceOver activation all
      // behave alike, and swiping isn't the only way back.
      if (tapDirection === "prev") {
        if (index === 0) onPrevAuthor?.();
        else prev();
      }
      else next();
    }
  }

  // The tap zones navigate from pointerdown/pointerup (that's what lets a
  // hold pause and a drag swipe), but an activation that arrives as a bare
  // click — VoiceOver's double-tap, a keyboard's Enter/Space, Switch
  // Control — never produces that pointer pair at all, so without this the
  // zones were announced as buttons that then did nothing. A click that
  // directly follows a real pointerup is the tail of a touch/mouse tap
  // handlePointerUp already dealt with, and is ignored here.
  //
  // Stepping back from the first story moves to the previous person's
  // stack, same as handlePointerUp's own tap path — otherwise swiping would
  // be the only way back, and a swipe is exactly what these users can't
  // perform. (Forward already rolls over into the next person via next().)
  function handleZoneClick(tapDirection: "prev" | "next") {
    if (Date.now() - lastZonePointerUpAt < 700) return;
    if (tapDirection === "next") next();
    else if (index === 0) onPrevAuthor?.();
    else prev();
  }

  async function handleReact(emoji: string) {
    if (!story) return;
    if (isGuest) {
      promptSignUp();
      return;
    }
    const result = await toggleStoryReaction(story.id, emoji);
    if (!result.error) {
      setReactionCounts(result.summary);
      setMyReaction(result.mine);
    }
  }

  /**
   * The heart: like or unlike, shown at once (with a light haptic and the rising heart on a like), then set to the
   * server's answer, or put back on any failure (the rising heart goes with it). Never on the author's own story (they
   * get the count instead). Sends the state it wants, so a retry or a doubled request can't flip it twice
   * (toggleStoryLike). No double tap to like: the tap zones navigate on the first tap.
   */
  async function handleToggleLike() {
    if (!story || isOwner) return;
    if (isGuest) {
      promptSignUp();
      return;
    }
    if (likePendingRef.current) return;
    likePendingRef.current = true;
    const storyId = story.id;
    const before = { liked };
    const wanted = optimisticStoryLike(before);
    setLikeState({ storyId, liked: wanted.liked, likeCount: null });
    if (wanted.liked) {
      hapticImpact("light");
      heart.show(dialogRef.current?.clientHeight);
    }
    let result: Awaited<ReturnType<typeof toggleStoryLike>> | { error: "failed" };
    try {
      result = await toggleStoryLike(storyId, wanted.liked);
    } catch {
      result = { error: "failed" };
    } finally {
      likePendingRef.current = false;
    }
    const settled = settleStoryLike(before, result);
    setLikeState((prev) => (prev?.storyId === storyId ? { storyId, liked: settled.liked, likeCount: null } : prev));
    // Only this story's heart: one still rising over a later story is left alone.
    if (likeRolledBack(wanted.liked, settled.liked)) heart.cancel(storyId);
  }

  async function loadViewers() {
    if (!story) return;
    const storyId = story.id;
    setCommentsOpenForId(null);
    setViewersOpenForId(storyId);
    const result = await getStoryViewers(storyId);
    setViewers(result.viewers);
    // The author's count, as fresh as the list it opens.
    setLikeState({ storyId, liked: false, likeCount: result.likeCount });
  }

  async function loadComments() {
    if (!story) return;
    setViewersOpenForId(null);
    setCommentsOpenForId(story.id);
    const result = await getStoryComments(story.id);
    setComments(result.comments);
  }

  async function handlePostComment(content: string) {
    if (!story) return false;
    if (isGuest) {
      promptSignUp();
      return false;
    }
    const fd = new FormData();
    fd.set("content", content);
    const result = await createStoryComment(story.id, fd);
    if (result.error || !result.comment) return false;
    setComments((prev) => [...(prev ?? []), result.comment as StoryComment]);
    return true;
  }

  // The x on a comment opens "Delete this comment?" (CommentDeleteDialog below); nothing is deleted on that tap.
  const confirmDeleteComment = useConfirmAction<string>(async (commentId) => {
    const result = await deleteStoryComment(commentId);
    // not_found: already gone (deleted elsewhere at the same moment); drop it from the list either way.
    if (result.error && result.error !== "not_found") return false;
    setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
  });
  function handleDeleteComment(commentId: string) {
    confirmDeleteComment.request(commentId);
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
    <OverlayPortal z={viewerZ}>
    <div
      ref={dialogRef}
      role="dialog"
      // The media, its tap zones and the progress bars keep one physical layout in every language (left is back,
      // right is forward); the panels of text over them (caption, viewers, comments, reply) follow the reader.
      dir="ltr"
      aria-modal="true"
      data-story-viewer
      onClickCapture={handleLinkClickCapture}
      aria-label={format(t.stories.viewer.label, { index: index + 1, total: stories.length, name: authorName })}
      tabIndex={-1}
      style={{ zIndex: viewerZ }}
      className={cn(
        "fixed inset-0 overflow-hidden bg-black outline-none",
        direction === "next" && "story-glide-next",
        direction === "prev" && "story-glide-prev",
      )}
    >
      <CommentDeleteDialog flow={confirmDeleteComment} isReply={() => false} replyCount={() => 0} />
      <div key={story.id} className="story-media-in absolute inset-0 flex items-center justify-center">
        {story.mediaType === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.mediaUrl ?? undefined} alt={story.caption ? format(t.stories.viewer.byWithCaption, { name: authorName, caption: story.caption }) : format(t.stories.viewer.by, { name: authorName })} className="max-h-full max-w-full object-contain" />
        ) : story.mediaType === "EMBED" && story.embedProvider && story.embedId ? (
          // Instagram/TikTok/etc.'s own player — see StoryMediaType's own
          // doc comment for the trust boundary this implies (not moderated
          // by this app). pointer-events-none: tap zones below drive
          // pause/advance the same as any other story, not the iframe's own
          // controls, which this app has no way to keep in sync anyway.
          <iframe
            src={embedSrc({ provider: story.embedProvider, id: story.embedId })}
            className="pointer-events-none h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            title={format(t.stories.viewer.by, { name: authorName })}
          />
        ) : (
          <video
            ref={attachVideo}
            // Holds itself during a call (callHold below), so the page-wide call hold leaves it alone.
            data-media-hold="self"
            src={story.mediaUrl ?? undefined}
            poster={story.mediaThumbnailUrl ?? undefined}
            autoPlay
            playsInline
            // A Muse's sound track replaces the video's own sound (never both at once), like the Muse viewer.
            muted={Boolean(soundTrackUrl)}
            aria-label={format(t.stories.viewer.videoBy, { name: authorName })}
            className="max-h-full max-w-full object-contain"
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.currentTime !== lastVideoTimeRef.current) {
                lastVideoTimeRef.current = el.currentTime;
                lastVideoProgressAtRef.current = performance.now();
              }
              // An iPhone screen recording can report Infinity until it has played through: no progress then
              // (onEnded still advances), rather than a bar stuck at 0 or NaN.
              if (Number.isFinite(el.duration) && el.duration > 0) {
                setProgressState({ storyId: story.id, value: el.currentTime / el.duration });
              }
              syncSoundTrack(el, story.id);
            }}
            onPlaying={(e) => {
              setVideoIssue((v) => (v?.storyId === story.id && v.kind === "stalled" ? null : v));
              syncSoundTrack(e.currentTarget, story.id);
            }}
            onWaiting={() => audioRef.current?.pause()}
            onSeeked={(e) => syncSoundTrack(e.currentTarget, story.id)}
            onPause={(e) => handleVideoPause(e.currentTarget)}
            onError={() => setVideoIssue({ storyId: story.id, kind: "error" })}
            onEnded={() => {
              audioRef.current?.pause();
              next();
            }}
          />
        )}
        {soundTrackUrl && (
          // The Muse's sound track: looped over its own length, started, stopped and kept in step by the video's
          // events above. Never shown; a track that can't play falls back to the video's own sound.
          <audio
            ref={attachAudio}
            data-media-hold="self"
            src={soundTrackUrl}
            preload="auto"
            loop
            onError={() => setSoundTrackFailedForId(story.id)}
          />
        )}
      </div>

      {/* Tap zones — sit above the media, below the header/caption chrome. Also where a drag down to close
          starts: touch-none so the browser hands every move to the gesture instead of scrolling or cancelling it. */}
      <div className="absolute inset-0 z-10 flex">
        <button
          type="button"
          data-story-zone
          aria-label={t.stories.viewer.previous}
          className="h-full w-1/3 touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => handlePointerUp(e, "prev")}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={() => setPaused(false)}
          onClick={() => handleZoneClick("prev")}
        />
        <button
          type="button"
          data-story-zone
          aria-label={t.stories.viewer.next}
          className="h-full w-2/3 touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => handlePointerUp(e, "next")}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={() => setPaused(false)}
          onClick={() => handleZoneClick("next")}
        />
      </div>

      {/* A video story that isn't playing when it should: "Tap to play" (blocked / stalled) or a note while it moves
          on (a file this device can't play). Only the button catches taps; the tap zones around it keep working. */}
      {story.mediaType === "VIDEO" && currentVideoIssue && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
          {currentVideoIssue === "error" ? (
            <p role="status" className="rounded-full bg-black/60 px-4 py-2 text-center text-sm text-white">
              {t.stories.viewer.videoCantPlay}
            </p>
          ) : (
            <button
              type="button"
              data-story-tap-to-play
              onClick={handleTapToPlay}
              className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-full bg-black/60 px-5 py-3 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur-sm hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Play size={20} aria-hidden />
              {t.stories.viewer.tapToPlay}
            </button>
          )}
        </div>
      )}
      {story.mediaType === "VIDEO" && autoMuted && !currentVideoIssue && (
        // Under the header, out of the way of the picture.
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
          style={{ top: `calc(${SAFE_AREA_TOP} + 4.5rem)` }}
        >
          <button
            type="button"
            onClick={handleUnmute}
            className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white ring-1 ring-white/25 backdrop-blur-sm hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Volume2 size={18} aria-hidden />
            {t.stories.viewer.tapForSound}
          </button>
        </div>
      )}

      {/* The rising hearts of a like: over the media, under the header and the reply bar (z-20), clipped to the
          viewer, never hit-testable (the tap zones under them keep working) and hidden from assistive tech. A single
          fading heart under reduced motion, fewer hearts on a low-end phone (useHeartBurst / globals.css). */}
      <HeartBurstLayer burst={heart} className="z-10" />

      {/* Clear of the notch / Dynamic Island / status bar: the header (and its Close button) starts below it. */}
      <div className="absolute inset-x-0 top-0 z-20 px-3 pb-3" style={{ paddingTop: `calc(${SAFE_AREA_TOP} + 0.75rem)` }}>
        {/* Decorative — the dialog's own name already says "Story 2 of 5". */}
        <div className="flex gap-1" aria-hidden>
          {stories.map((s, i) => (
            <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white"
                style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
              />
            </div>
          ))}
        </div>
        {/* gap + min-w-0/shrink-0: the name truncates before it can push
            Pause/Close off the right edge at a large text size. */}
        {/* dir follows the reader (the root is ltr for the media and progress bars): Close sits at the end corner,
            top-right, or top-left in Arabic. */}
        <div dir={dir} className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <UserLink
              userId={authorId}
              name={authorName}
              avatarUrl={authorAvatarUrl}
              avatarSize={28}
              showUsername={false}
              className="text-sm font-medium text-white hover:text-white/80"
            />
            <span className="shrink-0 text-xs text-white/70" title={formatDateTime(story.createdAt)}>
              {formatShortAge(story.createdAt, locale)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Tap alternative to hold-to-pause, which Voice Control and
                VoiceOver users can't perform — and without which a 5s
                auto-advancing image is gone before a screen reader has
                finished reading its caption. */}
            <button
              type="button"
              onClick={() => setUserPausedForId(userPaused ? null : story.id)}
              aria-label={userPaused ? t.stories.viewer.play : t.stories.viewer.pause}
              className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
            >
              {userPaused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            {isOwner && (
              <button
                type="button"
                aria-expanded={confirmingDelete}
                onClick={() => setDeleteConfirmForId((id) => (id === story.id ? null : story.id))}
                aria-label={t.stories.viewer.delete}
                className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
              >
                <Trash2 size={18} />
              </button>
            )}
            {/* Close: always there, on every story. A translucent disc so it reads over any photo or video, a 44px
                target, above the media and tap zones (this header is z-20). */}
            <button
              type="button"
              data-story-close
              onClick={handleClose}
              aria-label={shell.common.close}
              className="flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/25 backdrop-blur-sm hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X size={22} strokeWidth={2.25} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {confirmingDelete && (
        <div dir={dir} role="group" aria-label={t.stories.viewer.deleteConfirm} className="absolute inset-x-0 top-16 z-30 mx-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
          <span>{t.stories.viewer.deleteConfirm}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setDeleteConfirmForId(null)}
              className="rounded-md border border-line px-2 py-1 disabled:opacity-50"
            >
              {shell.common.cancel}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleDelete}
              className="rounded-md bg-danger px-2 py-1 font-medium text-white disabled:opacity-50"
            >
              {shell.common.delete}
            </button>
          </div>
        </div>
      )}

      {/*
        Everything below is one flowing bottom stack per branch (owner vs
        viewer), not several independently `absolute bottom-0` siblings —
        that used to make the caption, reaction badges, and reply bar all
        anchor to the exact same spot and render on top of each other
        instead of pushing one another apart.
      */}
      {isOwner ? (
        <div dir={dir} className="absolute inset-x-0 bottom-0 z-20">
          {showViewers ? (
            <div className="max-h-64 overflow-y-auto rounded-t-2xl bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                  {format(t.stories.viewer.seenBy, { count: viewers?.length ?? 0 })}
                  {likeCount !== null && likeCount > 0 && (
                    <>
                      {" · "}
                      {format(t.stories.viewer.likedBy, { count: likeCount })}
                    </>
                  )}
                </p>
                <button type="button" onClick={() => setViewersOpenForId(null)} aria-label={t.stories.viewer.closeViewers} className="text-foreground-soft">
                  <X size={16} />
                </button>
              </div>
              <ul className="mt-2 space-y-1.5">
                {(viewers ?? []).map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{v.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {v.liked && (
                        <span role="img" aria-label={t.stories.viewer.liked} title={t.stories.viewer.liked}>
                          <Heart size={14} aria-hidden className="fill-danger text-danger" />
                        </span>
                      )}
                      {v.reaction && <span>{v.reaction}</span>}
                    </span>
                  </li>
                ))}
                {viewers?.length === 0 && (
                  <li className="text-sm text-foreground-soft">{t.stories.viewer.noViews}</li>
                )}
              </ul>
              <SafeAreaBottomSpacer />
            </div>
          ) : showComments ? (
            <StoryCommentsPanel
              comments={comments}
              currentUserId={currentUserId}
              isStoryOwner
              onClose={() => setCommentsOpenForId(null)}
              onPost={handlePostComment}
              onDelete={handleDeleteComment}
            />
          ) : (
            <div className="bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
              {story.caption && (
                <StoryCaption
                  key={story.id}
                  text={story.caption}
                  expanded={captionExpanded}
                  onToggle={() => setCaptionExpandedForId((id) => (id === story.id ? null : story.id))}
                />
              )}
              {story.sharedPostId && (
                <Link
                  href={`/post/${story.sharedPostId}`}
                  className="mt-1 inline-block text-xs font-medium text-white underline underline-offset-2"
                >
                  {t.stories.viewer.viewPost}
                </Link>
              )}
              {reactionCounts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {reactionCounts.map((r) => (
                    <span
                      key={r.emoji}
                      className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white"
                    >
                      {r.emoji} {r.count}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={loadViewers}
                  aria-label={plural(locale, t.stories.viewer.views, story.viewCount)}
                  className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white"
                >
                  <Eye size={14} />
                  {story.viewCount}
                </button>
                {/* Own story: no heart to tap, the count instead (only the author ever sees it). Opens "Seen by",
                    where everyone who liked carries a heart. */}
                {likeCount !== null && (
                  <button
                    type="button"
                    data-story-like-count
                    onClick={loadViewers}
                    aria-label={plural(locale, t.stories.viewer.likes, likeCount)}
                    className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white"
                  >
                    <Heart size={14} aria-hidden />
                    {likeCount}
                  </button>
                )}
                <button
                  type="button"
                  onClick={loadComments}
                  className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white"
                >
                  <MessageCircle size={14} />
                  {t.stories.viewer.comments}
                </button>
                <StoryShareButton storyId={story.id} onOpenChange={setShareOpen} />
              </div>
              <SafeAreaBottomSpacer />
            </div>
          )}
        </div>
      ) : showComments ? (
        <div dir={dir} className="absolute inset-x-0 bottom-0 z-20">
          <StoryCommentsPanel
            comments={comments}
            currentUserId={currentUserId}
            isStoryOwner={false}
            onClose={() => setCommentsOpenForId(null)}
            onPost={handlePostComment}
            onDelete={handleDeleteComment}
          />
        </div>
      ) : (
        <div dir={dir} className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 to-transparent p-3 pt-10">
          {story.caption && (
            <StoryCaption
              key={story.id}
              className="mb-2"
              text={story.caption}
              expanded={captionExpanded}
              onToggle={() => setCaptionExpandedForId((id) => (id === story.id ? null : story.id))}
            />
          )}
          {story.sharedPostId && (
            <Link
              href={`/post/${story.sharedPostId}`}
              className="mb-2 inline-block text-xs font-medium text-white underline underline-offset-2"
            >
              {t.stories.viewer.viewPost}
            </Link>
          )}
          {reactionCounts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {reactionCounts.map((r) => (
                <span
                  key={r.emoji}
                  className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white"
                >
                  {r.emoji} {r.count}
                </span>
              ))}
            </div>
          )}
          {/* Tight gap/padding so six reactions plus + / comments / share fit on
              one line at ~390px; flex-wrap stays as a fallback for narrower
              screens or larger text so Comments and Share never leave it. */}
          <div className="flex flex-wrap items-center gap-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleReact(emoji)}
                aria-pressed={myReaction === emoji}
                className={`rounded-full px-1.5 py-1 text-lg ${
                  myReaction === emoji ? "bg-white/30" : "bg-black/30 hover:bg-white/20"
                }`}
              >
                {emoji}
              </button>
            ))}
            {/* + opens the full emoji picker for anything beyond the six quick reactions; the story pauses while it's open. */}
            <EmojiPickerButton
              key={emojiPickerKey}
              triggerVariant="plus"
              triggerClassName="rounded-full bg-black/30 p-2 text-white hover:bg-white/20"
              onOpenChange={setEmojiOpen}
              onSelect={handleReact}
            />
            <button
              type="button"
              onClick={loadComments}
              aria-label={t.stories.viewer.comments}
              className="rounded-full bg-black/30 p-2 text-white hover:bg-white/20"
            >
              <MessageCircle size={16} />
            </button>
            <StoryShareButton storyId={story.id} onOpenChange={setShareOpen} />
          </div>
          <div className="mt-2">
            <StoryReplyBar
              key={story.id}
              storyId={story.id}
              authorName={authorName}
              onFocusChange={setReplyFocused}
              trailing={
                // The heart: beside the reply, a 44px target above the tap zones (this bar is z-20), so it never
                // advances or pauses the story. Filled red once liked; colour and fill tween, no pop.
                <button
                  type="button"
                  data-story-like
                  onClick={handleToggleLike}
                  aria-label={liked ? t.stories.viewer.unlike : t.stories.viewer.like}
                  className="flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <Heart
                    size={24}
                    aria-hidden
                    className={cn(
                      "transition-[color,fill] duration-150 ease-out motion-reduce:transition-none",
                      liked ? "fill-danger text-danger" : "fill-transparent",
                    )}
                  />
                </button>
              }
            />
          </div>
          <SafeAreaBottomSpacer />
        </div>
      )}
    </div>
    </OverlayPortal>
  );
}

/**
 * Public comment thread — distinct from StoryReplyBar below, which sends a
 * private DM. Shown as a bottom sheet for both the story's owner and any
 * viewer, same shape as the owner-only "Seen by" panel above it in the JSX.
 */
function StoryCommentsPanel({
  comments,
  currentUserId,
  isStoryOwner,
  onClose,
  onPost,
  onDelete,
}: {
  comments: StoryComment[] | null;
  currentUserId: string;
  isStoryOwner: boolean;
  onClose: () => void;
  onPost: (content: string) => Promise<boolean>;
  onDelete: (commentId: string) => void;
}) {
  const { t, locale } = useFeedText();
  const { t: shell } = useShellText();
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
    if (ok) {
      setText("");
      // Closes the whole sheet right after a successful post instead of
      // leaving it open for a manual X tap — this panel is a transient
      // overlay on top of the story itself (not a persistent thread like
      // Feed's own comment section), so "post your reaction and get back
      // to watching" is the expected flow here.
      onClose();
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex max-h-[70vh] flex-col rounded-t-2xl bg-surface p-4">
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
          {t.stories.viewer.comments}{comments ? ` (${comments.length})` : ""}
        </p>
        <button type="button" onClick={onClose} aria-label={t.stories.viewer.closeComments} className="text-foreground-soft">
          <X size={16} />
        </button>
      </div>
      <ul className="mt-2 flex-1 space-y-3 overflow-y-auto">
        {comments === null && <li className="text-sm text-foreground-soft">{shell.common.loading}</li>}
        {comments?.length === 0 && <li className="text-sm text-foreground-soft">{t.stories.viewer.noComments}</li>}
        {comments?.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <UserAvatar avatarUrl={c.author.avatarUrl} name={c.author.name} size={28} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm">
                <span className="font-medium">{c.author.name ?? shell.common.someone}</span>{" "}
                <span dir="auto">{c.content}</span>
              </p>
              <p className="text-[0.6875rem] text-foreground-soft">{formatShortAge(c.createdAt, locale)}</p>
            </div>
            {(c.author.id === currentUserId || isStoryOwner) && (
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label={t.stories.viewer.deleteComment}
                className="shrink-0 p-1 text-foreground-soft hover:text-danger"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex shrink-0 items-center gap-2">
        <input dir="auto"
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
          placeholder={t.stories.viewer.commentPlaceholder}
          aria-label={t.stories.viewer.commentLabel}
          className="flex-1 rounded-full border border-line bg-background px-4 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={!text.trim() || isPosting}
          onClick={send}
          aria-label={t.stories.viewer.postComment}
          className="shrink-0 rounded-full bg-accent p-2 text-accent-ink disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{t.stories.viewer.commentFailed}</p>}
      <SafeAreaBottomSpacer />
    </div>
  );
}


/**
 * Owns its own draft/status state, keyed by story id from the parent — so
 * switching stories naturally clears any in-progress draft via remount
 * instead of an effect resetting it (see the id-keyed viewer/delete state
 * above for the same reasoning).
 */
function StoryReplyBar({
  storyId,
  authorName,
  onFocusChange,
  trailing,
}: {
  storyId: string;
  authorName: string;
  onFocusChange: (focused: boolean) => void;
  /** Shown at the end of the reply row (the heart). */
  trailing?: ReactNode;
}) {
  const { t } = useFeedText();
  const { isGuest, promptSignUp } = useGuestPreview();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // The parent keys this bar by story id, so a story change destroys the
  // focused input without React ever delivering its blur — clearing on
  // unmount is what keeps the viewer from staying paused on every later story.
  const onFocusChangeRef = useRef(onFocusChange);
  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  });
  useEffect(() => () => onFocusChangeRef.current(false), []);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || status === "sending") return;
    if (isGuest) {
      promptSignUp();
      return;
    }
    setStatus("sending");
    setErrorMsg(null);
    const fd = new FormData();
    fd.set("content", trimmed);
    const result = await replyToStory(storyId, fd);
    if (result.error) {
      setStatus("error");
      setErrorMsg(byCode(t.stories.viewer.replyErrors, result.error));
      return;
    }
    setText("");
    setStatus("sent");
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input dir="auto"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          maxLength={1000}
          placeholder={format(t.stories.viewer.replyPlaceholder, { name: authorName })}
          aria-label={format(t.stories.viewer.replyLabel, { name: authorName })}
          className="flex-1 rounded-full border border-white/30 bg-black/30 px-4 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-white"
        />
        <button
          type="button"
          disabled={!text.trim() || status === "sending"}
          onClick={send}
          aria-label={t.stories.viewer.sendReply}
          className="shrink-0 rounded-full bg-accent p-2 text-accent-ink disabled:opacity-50"
        >
          <Send size={16} />
        </button>
        {trailing}
      </div>
      {status === "sent" && <p role="status" className="mt-1 text-xs text-white/80">{t.stories.viewer.replySent}</p>}
      {errorMsg && <p role="alert" className="mt-1 text-xs text-danger">{errorMsg}</p>}
    </div>
  );
}
