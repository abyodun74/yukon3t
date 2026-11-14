"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, useDragControls, type PanInfo } from "motion/react";
// The small `m` components: animation and drag code is loaded lazily by MotionProvider (root layout).
import * as m from "motion/react-m";
import { Heart, Keyboard, Smile, Sticker, X } from "lucide-react";
import {
  createMuseComment,
  deleteMuseComment,
  getMuseCommentReplies,
  getMuseCommentThread,
  getMuseComments,
  toggleMuseCommentLike,
} from "@/app/actions/muse-comments";
import { UserAvatar } from "@/components/user-link";
import { CommentDeleteDialog, useConfirmAction } from "@/components/confirm-dialog";
import { CommentPickerPanel, useRecentEmoji, type CommentPickerKind } from "@/components/comment-picker-panel";
import { useCommentToolsText } from "@/components/comment-tools-text";
import { useUiText } from "@/components/ui-text";
import { insertAtSelection, type Selection } from "@/lib/emoji-insert";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { useMuseCommentsText } from "@/components/muse-comments-text";
import { useGuestPreview } from "@/components/guest-preview";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { hapticImpact } from "@/lib/haptics";
import { formatShortAge } from "@/lib/format-date";
import { format, intlLocale, plural, type Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";
import { keyboardInset } from "@/lib/gift-picker-nav";
import { MUSE_COMMENTS_INSTANT, MUSE_COMMENTS_TRANSITION } from "@/lib/muse-comments-layout";
import {
  MUSE_COMMENT_MAX_LENGTH,
  MUSE_COMMENT_QUICK_EMOJI,
  addOwnReply,
  appendThreads,
  mentionPrefill,
  mergeReplyPage,
  needsReplyFetch,
  prependThread,
  removeFromThreads,
  setLiked,
  setThreadExpanded,
  threadOf,
  threadToggle,
  withoutMentionPrefill,
  type MuseCommentView,
  type MuseThread,
} from "@/lib/muse-comment-threads";

// Release spring-back after a short drag on the handle: damping ratio 50 / (2 * sqrt(600)) ~ 1.02, so it settles
// without a wobble (the same values as sheet.tsx's SHEET_DRAG_TRANSITION; motion-defaults.test.ts checks it).
const MUSE_SHEET_DRAG_TRANSITION = { bounceStiffness: 600, bounceDamping: 50 };
// Past this downward drag (or a fast enough flick) the sheet closes instead of settling back.
const DISMISS_DISTANCE_PX = 120;
const DISMISS_VELOCITY_PX_PER_S = 800;

type Viewer = { name: string | null; avatarUrl: string | null };
type ReplyTarget = { id: string; label: string; prefill: string };

function displayName(author: MuseCommentView["author"], someone: string) {
  return author.name ?? (author.username ? `@${author.username}` : someone);
}

function countText(locale: Locale, forms: string, count: number) {
  return plural(locale, forms, count).replace(String(count), count.toLocaleString(intlLocale(locale) ?? []));
}

/**
 * A Muse's comments as the lower part of the screen while its video sits above as a rounded card (MuseFeed moves the
 * video; this is only the sheet). Opens and closes along one ease-out tween (no spring, no overshoot), instantly
 * under reduced motion. Only the handle row drags it closed, so the list scrolls freely; the composer stays at the
 * bottom, above the iOS keyboard (visualViewport), while the list scrolls between.
 */
export function MuseCommentsSheet({
  open,
  museId,
  museAuthorName,
  commentCount,
  currentUserId,
  isMuseOwner,
  focusCommentId,
  sheetHeight,
  reducedMotion,
  onClose,
  onCountChange,
}: {
  open: boolean;
  museId: string;
  museAuthorName: string | null;
  commentCount: number;
  currentUserId: string;
  isMuseOwner: boolean;
  /** From a notification's deep link: open with this comment's thread on top. */
  focusCommentId: string | null;
  sheetHeight: number;
  reducedMotion: boolean;
  /** Close by the app's own route (MuseFeed goes back through the history entry it added). */
  onClose: () => void;
  /** The Muse's exact comment count after a post or delete (null when it didn't change). */
  onCountChange: (count: number) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <MuseCommentsPanel
          key={museId}
          museId={museId}
          museAuthorName={museAuthorName}
          commentCount={commentCount}
          currentUserId={currentUserId}
          isMuseOwner={isMuseOwner}
          focusCommentId={focusCommentId}
          sheetHeight={sheetHeight}
          reducedMotion={reducedMotion}
          onClose={onClose}
          onCountChange={onCountChange}
        />
      )}
    </AnimatePresence>
  );
}

function MuseCommentsPanel({
  museId,
  museAuthorName,
  commentCount,
  currentUserId,
  isMuseOwner,
  focusCommentId,
  sheetHeight,
  reducedMotion,
  onClose,
  onCountChange,
}: Omit<Parameters<typeof MuseCommentsSheet>[0], "open">) {
  const { locale, dir, t } = useMuseCommentsText();
  const { isGuest, promptSignUp } = useGuestPreview();
  const { t: tools } = useCommentToolsText();
  const { t: ui } = useUiText();
  // The emoji / GIF panel in place of the keyboard (null: the keyboard, or nothing). Escape and back close it first.
  const [panel, setPanel] = useState<CommentPickerKind | null>(null);
  const closeAfterPanelRef = useRef(false);
  useBackDismiss(panel !== null, () => {
    setPanel(null);
    // The sheet itself was asked to close while the panel was open (Close, a drag down): the panel's own history
    // entry is gone now, so the comments' entry is on top again and MuseFeed's close goes back through it.
    if (closeAfterPanelRef.current) {
      closeAfterPanelRef.current = false;
      onClose();
    }
  });
  /** Close button, drag down: with a panel open, its history entry is popped first, then the sheet closes. */
  function requestClose() {
    if (panel !== null) {
      closeAfterPanelRef.current = true;
      window.history.back();
      return;
    }
    onClose();
  }
  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => (panel !== null ? setPanel(null) : onClose()));
  const dragControls = useDragControls();
  const keyboard = useKeyboardViewport();

  const [threads, setThreads] = useState<MuseThread[] | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(() => new Set());
  const [text, setText] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [gif, setGif] = useState<string | null>(null);
  const [recents, rememberEmoji] = useRecentEmoji();
  // Ids posted in this sheet: they come in with the one-way rise-in (globals.css), nothing else animates in the list.
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where the caret was when the field last had it: the emoji panel inserts there without focusing the field (which
  // would bring the keyboard back over the panel).
  const selectionRef = useRef<Selection | null>(null);
  const loadingPageRef = useRef(false);

  // A just-posted comment (or the deep-linked thread) to bring into view once the list has rendered it.
  const scrollToRef = useRef<string | null>(null);

  const fetchInitial = useCallback(
    () =>
      Promise.all([
        focusCommentId ? getMuseCommentThread(museId, focusCommentId).catch(() => null) : Promise.resolve(null),
        getMuseComments(museId),
      ]),
    [museId, focusCommentId],
  );

  const applyInitial = useCallback(([focus, page]: Awaited<ReturnType<typeof fetchInitial>>) => {
    if (page.error && page.error !== "not_found") {
      setLoadFailed(true);
      setThreads([]);
      return;
    }
    const pinned = focus?.thread ? [threadOf(focus.thread.comment, focus.thread.replies, focus.thread.nextCursor)] : [];
    if (focus?.thread) scrollToRef.current = focus.thread.comment.id;
    setPinnedId(focus?.thread?.comment.id ?? null);
    setThreads(appendThreads(pinned, page.comments));
    setNextCursor(page.nextCursor);
    if (page.viewer) setViewer(page.viewer);
  }, []);

  const failInitial = useCallback(() => {
    setLoadFailed(true);
    setThreads([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchInitial().then(
      (result) => !cancelled && applyInitial(result),
      () => !cancelled && failInitial(),
    );
    return () => {
      cancelled = true;
    };
  }, [fetchInitial, applyInitial, failInitial]);

  function retry() {
    setLoadFailed(false);
    setThreads(null);
    fetchInitial().then(applyInitial, failInitial);
  }

  // The next page of top-level comments when the end of the list comes near.
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingPageRef.current) return;
    loadingPageRef.current = true;
    try {
      const page = await getMuseComments(museId, nextCursor);
      if (!page.error) {
        setThreads((prev) => appendThreads(prev ?? [], page.comments));
        setNextCursor(page.nextCursor);
      }
    } finally {
      loadingPageRef.current = false;
    }
  }, [museId, nextCursor]);

  useEffect(() => {
    const el = sentinelRef.current;
    const root = listRef.current;
    if (!el || !root || !nextCursor) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && void loadMore(), {
      root,
      rootMargin: "0px 0px 200px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  // Brings a just-posted comment (or the deep-linked thread) into view inside the list, once it is rendered.
  useEffect(() => {
    const id = scrollToRef.current;
    if (!id) return;
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(id)}"]`);
    if (!list || !el) return;
    scrollToRef.current = null;
    // Scrolls the list only (scrollIntoView would also move every scrollable ancestor, the Muse feed included).
    const box = list.getBoundingClientRect();
    const item = el.getBoundingClientRect();
    const delta = item.top < box.top ? item.top - box.top - 8 : item.bottom > box.bottom ? item.bottom - box.bottom + 8 : 0;
    if (delta !== 0) list.scrollBy({ top: delta, behavior: reducedMotion ? "auto" : "smooth" });
  }, [threads, reducedMotion]);

  async function toggleReplies(thread: MuseThread) {
    const id = thread.comment.id;
    const toggle = threadToggle(thread);
    if (toggle.kind === "hide") {
      setThreads((prev) => setThreadExpanded(prev ?? [], id, false));
      return;
    }
    if (!needsReplyFetch(thread) || (toggle.kind === "view-all" && thread.repliesFetched)) {
      setThreads((prev) => setThreadExpanded(prev ?? [], id, true));
      return;
    }
    if (loadingReplies.has(id)) return;
    setLoadingReplies((prev) => new Set(prev).add(id));
    try {
      const page = await getMuseCommentReplies(id, thread.repliesFetched ? thread.repliesCursor : null);
      if (!page.error) setThreads((prev) => mergeReplyPage(prev ?? [], id, page.replies, page.nextCursor));
      else if (page.error === "not_found") setNotice(t.notAvailable);
    } finally {
      setLoadingReplies((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function startReply(comment: MuseCommentView) {
    if (isGuest) {
      promptSignUp();
      return;
    }
    const prefill = mentionPrefill(comment.author);
    const label = comment.author.username ? `@${comment.author.username}` : displayName(comment.author, t.someone);
    setText((current) => prefill + withoutMentionPrefill(current, replyTarget?.prefill ?? "").replace(prefill, ""));
    setReplyTarget({ id: comment.id, label, prefill });
    setNotice(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function cancelReply() {
    setText((current) => withoutMentionPrefill(current, replyTarget?.prefill ?? ""));
    setReplyTarget(null);
  }

  async function send() {
    if (isGuest) {
      promptSignUp();
      return;
    }
    const content = text.trim();
    if ((!content && !gif) || posting) return;
    setPosting(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.set("content", content);
      if (gif) fd.set("gifUrl", gif);
      if (replyTarget) fd.set("replyToId", replyTarget.id);
      const result = await createMuseComment(museId, fd);
      if (result.error) {
        setNotice(
          result.error === "rate_limited" ? t.rateLimited : result.error === "not_found" ? t.notAvailable : t.failed,
        );
        return;
      }
      setText("");
      setGif(null);
      selectionRef.current = null;
      setReplyTarget(null);
      setPanel(null);
      inputRef.current?.blur();
      if (result.moderationStatus !== "PUBLISHED") {
        setNotice(t.flagged);
        return;
      }
      const comment = result.comment;
      setFresh((prev) => new Set(prev).add(comment.id));
      setThreads((prev) =>
        comment.parentId ? addOwnReply(prev ?? [], comment) : prependThread(prev ?? [], comment, pinnedId),
      );
      scrollToRef.current = comment.id;
      if (result.commentCount !== null) onCountChange(result.commentCount);
    } catch {
      setNotice(t.failed);
    } finally {
      setPosting(false);
    }
  }

  // Delete asks first ("Delete this comment?" / "Delete this reply?", with how many replies go with a comment); the
  // dialog stays open, its Delete disabled, until the server answers, and shows a retryable error if it fails.
  const confirmDelete = useConfirmAction<MuseCommentView>(async (comment) => {
    const result = await deleteMuseComment(comment.id);
    // not_found: already deleted (by the Muse's owner, another tab): gone either way.
    if (result.error && result.error !== "not_found") return false;
    setThreads((prev) => removeFromThreads(prev ?? [], comment.id));
    if (!result.error && result.commentCount !== null) onCountChange(result.commentCount);
  });

  async function like(comment: MuseCommentView) {
    if (isGuest) {
      promptSignUp();
      return;
    }
    const liked = !comment.likedByMe;
    setThreads((prev) => setLiked(prev ?? [], comment.id, liked, Math.max(0, comment.likeCount + (liked ? 1 : -1))));
    try {
      const result = await toggleMuseCommentLike(comment.id);
      if (result.error) {
        setThreads((prev) => setLiked(prev ?? [], comment.id, comment.likedByMe, comment.likeCount));
        return;
      }
      setThreads((prev) => setLiked(prev ?? [], comment.id, result.liked, result.likeCount));
    } catch {
      setThreads((prev) => setLiked(prev ?? [], comment.id, comment.likedByMe, comment.likeCount));
    }
  }

  function rememberSelection() {
    const input = inputRef.current;
    if (input && input.selectionStart !== null && input.selectionEnd !== null) {
      selectionRef.current = { start: input.selectionStart, end: input.selectionEnd };
    }
  }

  /**
   * An emoji goes in at the caret (replacing a selection), never splitting a character, and only if it fits. From the
   * quick row the field gets focus back with the caret after it; from the emoji panel the field stays unfocused so the
   * keyboard doesn't cover the panel.
   */
  function addEmoji(emoji: string, refocus: boolean) {
    const next = insertAtSelection(text, selectionRef.current, emoji, MUSE_COMMENT_MAX_LENGTH);
    rememberEmoji(emoji);
    if (!next) return;
    setText(next.text);
    selectionRef.current = { start: next.caret, end: next.caret };
    if (!refocus) return;
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    });
  }

  function togglePanel(kind: CommentPickerKind) {
    if (isGuest) {
      promptSignUp();
      return;
    }
    if (panel === kind) {
      // The same button now reads "Show keyboard": back to typing.
      setPanel(null);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    rememberSelection();
    inputRef.current?.blur();
    setPanel(kind);
  }

  function pickGif(url: string) {
    setGif(url);
    setPanel(null);
    setNotice(null);
  }

  // dragFromHandle: only the grabber row starts a drag; a press on its Close button stays a plain tap.
  function startHandleDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as Element | null)?.closest?.("button")) return;
    dragControls.start(e);
  }
  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DISMISS_DISTANCE_PX || info.velocity.y > DISMISS_VELOCITY_PX_PER_S) {
      hapticImpact("light");
      requestClose();
    }
  }

  // iOS keeps the layout viewport under the keyboard: the sheet sits on top of it and never grows past what is still
  // visible. Android WebViews resize instead, and MuseFeed recomputes sheetHeight from the smaller screen.
  const height = keyboard ? Math.max(160, Math.min(sheetHeight, keyboard.height - 40)) : sheetHeight;
  const canDelete = (c: MuseCommentView) => c.author.id === currentUserId || isMuseOwner;
  // In place of the keyboard: about half the sheet, leaving the list a scrollable strip above the composer.
  const panelHeight = Math.max(200, Math.min(320, Math.round(height * 0.5)));
  const canPost = Boolean(text.trim() || gif);
  const placeholder = replyTarget
    ? t.replyPlaceholder
    : museAuthorName
      ? format(t.placeholder, { name: museAuthorName })
      : t.placeholderUnnamed;

  function renderComment(c: MuseCommentView, isReply: boolean) {
    const name = displayName(c.author, t.someone);
    return (
      <div
        data-comment-id={c.id}
        className={cn("flex items-start gap-3", isReply ? "ps-12" : "", fresh.has(c.id) && "animate-rise-in")}
      >
        <UserAvatar avatarUrl={c.author.avatarUrl} name={c.author.name} size={isReply ? 28 : 36} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground-soft">
            <bdi className="font-semibold text-foreground">{name}</bdi>{" "}
            <span>{formatShortAge(c.createdAt, locale)}</span>
          </p>
          {c.content && <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.content}</p>}
          {c.gifUrl && (
            // A fixed box, so a GIF loading in never moves the list. Rendered like a chat GIF (plain lazy <img>).
            <div className="mt-1 h-32 w-44 max-w-full overflow-hidden rounded-lg bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted GIF, not a local/optimizable asset */}
              <img src={c.gifUrl} alt={ui.comments.gifAlt} loading="lazy" decoding="async" className="h-full w-full object-contain" />
            </div>
          )}
          <div className="mt-1 flex items-center gap-4 text-xs font-medium text-foreground-soft">
            <button
              type="button"
              onClick={() => startReply(c)}
              aria-label={format(t.replyTo, { name })}
              className="hover:text-foreground"
            >
              {t.reply}
            </button>
            {canDelete(c) && (
              <button
                type="button"
                onClick={() => confirmDelete.request(c)}
                disabled={confirmDelete.state.pending}
                aria-label={t.deleteLabel}
                className="hover:text-danger disabled:opacity-60"
              >
                {t.delete}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => like(c)}
          aria-pressed={c.likedByMe}
          aria-label={`${c.likedByMe ? t.unlike : t.like}, ${countText(locale, t.likes, c.likeCount)}`}
          className="flex w-10 shrink-0 flex-col items-center gap-0.5 pt-1 text-foreground-soft"
        >
          <Heart size={18} aria-hidden className={cn(c.likedByMe && "fill-danger text-danger")} />
          <span className="text-[0.6875rem] tabular-nums">{c.likeCount > 0 ? c.likeCount.toLocaleString(intlLocale(locale) ?? []) : ""}</span>
        </button>
      </div>
    );
  }

  return (
    <m.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      tabIndex={-1}
      lang={locale}
      dir={dir}
      className="fixed inset-x-0 z-50 mx-auto flex max-w-lg flex-col overflow-hidden rounded-t-3xl border-x border-t border-line bg-surface text-foreground shadow-2xl outline-none"
      style={{ height, bottom: keyboard?.inset ?? 0 }}
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={reducedMotion ? MUSE_COMMENTS_INSTANT : MUSE_COMMENTS_TRANSITION}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragTransition={MUSE_SHEET_DRAG_TRANSITION}
      dragElastic={{ top: 0, bottom: 1 }}
      onDragEnd={handleDragEnd}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative shrink-0 pb-2 pt-2" onPointerDown={startHandleDrag} style={{ touchAction: "none" }}>
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-foreground-soft/40" />
        <p className="mt-2 text-center text-xs font-semibold text-foreground-soft">{countText(locale, t.count, commentCount)}</p>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t.close}
          className="absolute end-3 top-3 rounded-full p-1.5 text-foreground-soft hover:text-foreground"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
        {threads === null && <p className="py-6 text-center text-sm text-foreground-soft">{t.loading}</p>}
        {loadFailed && (
          <div className="py-6 text-center text-sm text-foreground-soft">
            <p>{t.loadFailed}</p>
            <button type="button" onClick={retry} className="mt-2 font-medium text-accent">
              {t.retry}
            </button>
          </div>
        )}
        {threads?.length === 0 && !loadFailed && (
          <p className="py-6 text-center text-sm text-foreground-soft">{t.empty}</p>
        )}
        <ul className="space-y-4">
          {threads?.map((thread) => {
            const toggle = threadToggle(thread);
            const busy = loadingReplies.has(thread.comment.id);
            return (
              <li key={thread.comment.id}>
                {renderComment(thread.comment, false)}
                {thread.expanded && thread.replies.length > 0 && (
                  <ul className="mt-3 space-y-3">
                    {thread.replies.map((reply) => (
                      <li key={reply.id}>{renderComment(reply, true)}</li>
                    ))}
                  </ul>
                )}
                {toggle.kind !== "none" && (
                  <button
                    type="button"
                    onClick={() => void toggleReplies(thread)}
                    disabled={busy}
                    aria-expanded={thread.expanded}
                    className="mt-2 flex items-center gap-3 ps-12 text-xs font-semibold text-foreground-soft disabled:opacity-60"
                  >
                    <span aria-hidden className="h-px w-6 bg-foreground-soft/40" />
                    {busy
                      ? t.loadingReplies
                      : toggle.kind === "hide"
                        ? t.hideReplies
                        : countText(locale, toggle.kind === "view-all" ? t.viewReplies : t.viewMoreReplies, toggle.count)}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {nextCursor && (
          <div ref={sentinelRef} className="py-3 text-center text-xs text-foreground-soft">
            {t.loadingMore}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-surface">
        <div role="group" aria-label={t.quickEmoji} className="flex justify-between px-3 pt-2">
          {MUSE_COMMENT_QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => addEmoji(emoji, panel === null)}
              aria-label={format(t.addEmoji, { emoji })}
              className="rounded-full p-1.5 text-2xl leading-none"
            >
              {emoji}
            </button>
          ))}
        </div>
        {replyTarget && (
          <div className="mx-3 mt-2 flex items-center justify-between gap-2 rounded-full bg-background px-3 py-1 text-xs text-foreground-soft">
            <span className="min-w-0 truncate">{format(t.replyingTo, { name: replyTarget.label })}</span>
            <button type="button" onClick={cancelReply} aria-label={t.cancelReply} className="shrink-0 p-0.5 hover:text-foreground">
              <X size={14} aria-hidden />
            </button>
          </div>
        )}
        {gif && (
          <div className="mx-3 mt-2 flex items-center gap-2 rounded-xl border border-line px-2 py-1.5 text-xs">
            <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted preview, not a local/optimizable asset */}
              <img src={gif} alt="" className="h-full w-full object-cover" />
            </div>
            <span className="min-w-0 flex-1 truncate text-foreground-soft">{ui.comments.composer.gifAttached}</span>
            <button
              type="button"
              onClick={() => setGif(null)}
              aria-label={ui.comments.composer.removeGif}
              className="shrink-0 rounded-full p-1.5 text-foreground-soft hover:text-danger"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 pb-2 pt-2">
          <UserAvatar avatarUrl={viewer?.avatarUrl} name={viewer?.name ?? t.yourAvatar} size={36} className="shrink-0" />
          <div className="flex min-w-0 flex-1 items-center rounded-full border border-line bg-background pe-1 focus-within:border-accent">
            <input
              ref={inputRef}
              aria-label={replyTarget ? t.replyLabel : t.composerLabel}
              dir="auto"
              type="text"
              enterKeyHint="send"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                selectionRef.current = { start: e.target.selectionStart ?? e.target.value.length, end: e.target.selectionEnd ?? e.target.value.length };
              }}
              onSelect={rememberSelection}
              onBlur={rememberSelection}
              // Tapping the field while a panel is open goes back to the keyboard.
              onPointerDown={() => panel !== null && setPanel(null)}
              onFocus={() => panel !== null && setPanel(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
              maxLength={MUSE_COMMENT_MAX_LENGTH}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent py-2.5 ps-4 pe-1 text-base outline-none sm:text-sm"
            />
            <button
              type="button"
              onClick={() => togglePanel("emoji")}
              aria-label={panel === "emoji" ? tools.picker.showKeyboard : ui.reactions.add}
              aria-pressed={panel === "emoji"}
              className="shrink-0 rounded-full p-2 text-foreground-soft hover:text-foreground"
            >
              {panel === "emoji" ? <Keyboard size={20} aria-hidden /> : <Smile size={20} aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => togglePanel("gif")}
              aria-label={panel === "gif" ? tools.picker.showKeyboard : ui.gif.add}
              aria-pressed={panel === "gif"}
              className="shrink-0 rounded-full p-2 text-foreground-soft hover:text-foreground"
            >
              {panel === "gif" ? <Keyboard size={20} aria-hidden /> : <Sticker size={20} aria-hidden />}
            </button>
          </div>
          {canPost && (
            <button
              type="button"
              disabled={posting}
              onClick={() => void send()}
              aria-label={t.postLabel}
              className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              {posting ? t.posting : t.post}
            </button>
          )}
        </div>
        {notice && (
          <p role="alert" className="px-4 pb-1 text-xs text-danger">
            {notice}
          </p>
        )}
        {panel !== null && (
          <CommentPickerPanel
            kind={panel}
            height={panelHeight}
            recents={recents}
            onEmoji={(emoji) => addEmoji(emoji, false)}
            onGif={pickGif}
          />
        )}
        <div aria-hidden style={{ height: keyboard ? 0 : "max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px))" }} />
      </div>
      <CommentDeleteDialog
        flow={confirmDelete}
        isReply={(comment) => comment.parentId !== null}
        replyCount={(comment) => (comment.parentId === null ? comment.replyCount : 0)}
      />    </m.div>
  );
}

/**
 * The visible height and the keyboard's cover from window.visualViewport while the sheet is open (null when no
 * keyboard covers the page). Same measurement as the gift picker's (keyboardInset, gift-picker-nav.ts).
 */
function useKeyboardViewport(): { inset: number; height: number } | null {
  const [state, setState] = useState<{ inset: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const inset = keyboardInset({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop });
        const next = inset ? { inset, height: Math.round(vv.height) } : null;
        setState((prev) => (prev?.inset === next?.inset && prev?.height === next?.height ? prev : next));
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return state;
}
