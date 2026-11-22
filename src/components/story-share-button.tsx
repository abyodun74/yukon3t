"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Clapperboard, Forward, House, Send, Users, X } from "lucide-react";
import { getShareableConversations, shareStoryToConversations } from "@/app/actions/stories";
import {
  getStoryReshareOptions,
  shareStoryToCircle,
  shareStoryToFeed,
  shareStoryToMuse,
} from "@/app/actions/story-reshare";
import { getMyCircles } from "@/app/actions/circles";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { OverlayPortal, useOverlayZ } from "@/components/overlay-root";
import { useFeedText } from "@/components/feed-text";
import { useShellText } from "@/components/ui-text";
import { SendToChatsPicker } from "@/components/send-to-chats-picker";
import { useGuestPreview } from "@/components/guest-preview";
import { announce } from "@/lib/announce";
import { byCode } from "@/lib/i18n/locales";

type View = "root" | "chats" | "circles";
type Options = { feed: boolean; muse: boolean; circle: boolean; reason: "opted_out" | "unsupported_media" | null };
type Circle = { id: string; name: string; parentName: string | null };
/** One destination's state: idle, in flight, done (with its confirmation) or refused (with the reason, worded). */
type RowState = { status: "idle" } | { status: "posting" } | { status: "done"; label: string } | { status: "error"; message: string };

const IDLE: RowState = { status: "idle" };

/**
 * "Share" for a story. The root view offers: Send to chats (up to SHARE_MAX_RECIPIENTS of the caller's own DMs or
 * groups, SendToChatsPicker, unlike StoryReplyBar which always replies to the author), and, where the server allows it
 * (getStoryReshareOptions: the author's opt-out, the media, the author's audience), Post to my feed / Post to Muse
 * (video or embed only) / Post to a Circle. Each of those posts a COPY that stays after the Story disappears (the row
 * says so); actions/story-reshare.ts re-checks everything.
 */
export function StoryShareButton({
  storyId,
  onOpenChange,
}: {
  storyId: string;
  /** Lets the viewer pause its auto-advance timer while this sheet is open, same as its own viewers/comments panels do. */
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useFeedText();
  const { t: shell } = useShellText();
  const text = t.stories.shareSheet;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("root");
  const { isGuest, promptSignUp } = useGuestPreview();
  const [conversations, setConversations] = useState<{ value: string; label: string; username: string | null }[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [feedState, setFeedState] = useState<RowState>(IDLE);
  const [museState, setMuseState] = useState<RowState>(IDLE);
  const [circleStates, setCircleStates] = useState<Record<string, RowState>>({});
  // The viewer may reuse this button for the next Story: what was loaded or posted belongs to the previous one.
  // Adjusted during render (React's documented pattern), like ShareModal's view reset.
  const [forStoryId, setForStoryId] = useState(storyId);
  if (forStoryId !== storyId) {
    setForStoryId(storyId);
    setOptions(null);
    setFeedState(IDLE);
    setMuseState(IDLE);
    setCircleStates({});
  }
  const titleId = useId();
  // Unmounting with the sheet open (the viewer swapping panels or closing)
  // skips close(), which would leave the viewer paused — report it here,
  // only if it was actually open.
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
  });
  useEffect(
    () => () => {
      if (openRef.current) onOpenChangeRef.current?.(false);
    },
    [],
  );

  function close() {
    setOpen(false);
    onOpenChange?.(false);
  }

  async function openSheet() {
    // A guest preview can look, not share (getShareableConversations refuses it): the sign-up prompt, like a reaction.
    if (isGuest) {
      promptSignUp();
      return;
    }
    setView("root");
    setOpen(true);
    onOpenChange?.(true);
    if (options === null) {
      // Which "Post to" rows this Story offers. A failed load just leaves them out: Send to chats still works.
      getStoryReshareOptions(storyId)
        .then((result) => setOptions(result.error ? { feed: false, muse: false, circle: false, reason: null } : result))
        .catch(() => setOptions({ feed: false, muse: false, circle: false, reason: null }));
    }
  }

  async function openChats() {
    setView("chats");
    if (conversations === null) {
      setLoadFailed(false);
      try {
        const result = await getShareableConversations();
        setConversations(result.conversations);
      } catch {
        // A refused or lost load left the sheet on "Loading…" forever; say so instead, and try again on the next open.
        setLoadFailed(true);
      }
    }
  }

  function openCircles() {
    setView("circles");
    if (circles === null) {
      getMyCircles()
        .then((result) => setCircles(result.circles.map(({ id, name, parentName }) => ({ id, name, parentName }))))
        .catch(() => setCircles([]));
    }
  }

  async function send(conversationIds: string[]) {
    const result = await shareStoryToConversations(storyId, conversationIds);
    if (result.error) {
      // An expired story (or one whose author is now blocked) reads as a plain "couldn't share"; the picker words the rest.
      return { error: result.error, message: result.error === "not_found" ? text.failed : undefined };
    }
    return { sent: result.sent, failed: result.failed };
  }

  /** Runs one repost and turns its answer into the row's state (the reason worded, or the confirmation). */
  async function repost(
    run: () => Promise<{ error: string | null; already?: boolean; held?: boolean }>,
    setState: (state: RowState) => void,
  ) {
    setState({ status: "posting" });
    try {
      const result = await run();
      if (result.error) {
        setState({ status: "error", message: byCode(text.repostErrors, result.error) });
        return;
      }
      const label = result.already ? text.alreadyPosted : result.held ? text.museHeld : text.posted;
      setState({ status: "done", label });
      announce(label);
    } catch {
      setState({ status: "error", message: text.repostErrors.other });
    }
  }

  function postToFeed() {
    if (feedState.status === "posting" || feedState.status === "done") return;
    void repost(() => shareStoryToFeed(storyId), setFeedState);
  }

  function postToMuse() {
    if (museState.status === "posting" || museState.status === "done") return;
    void repost(() => shareStoryToMuse(storyId), setMuseState);
  }

  function postToCircle(circleId: string) {
    const current = circleStates[circleId]?.status;
    if (current === "posting" || current === "done") return;
    void repost(
      () => shareStoryToCircle(storyId, circleId),
      (state) => setCircleStates((prev) => ({ ...prev, [circleId]: state })),
    );
  }

  const dialogRef = useDialogFocus<HTMLDivElement>(open, close);
  // Back (Android's button, the iOS back gesture) closes this sheet first, leaving the Story viewer under it open.
  useBackDismiss(open, close);
  // Opened from the Story viewer: the sheet layer, raised one above the viewer (src/lib/overlay-layers.ts), portaled
  // to the root overlay host.
  const sheetZ = useOverlayZ("sheet");

  const rowClass =
    "flex w-full items-start gap-3 rounded-lg px-2 py-2 text-start text-sm hover:bg-line/60 disabled:opacity-60";

  /** A "Post to" row: its label, the "a copy that stays" line, then its outcome. */
  function repostRow(icon: ReactNode, label: string, state: RowState, onClick: () => void) {
    return (
      <div>
        <button
          type="button"
          onClick={onClick}
          disabled={state.status === "posting" || state.status === "done"}
          className={rowClass}
        >
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span className="min-w-0">
            <span className="block">
              {state.status === "posting" ? text.posting : state.status === "done" ? state.label : label}
            </span>
            <span className="block text-xs text-foreground-soft">{text.copyStays}</span>
          </span>
        </button>
        {state.status === "error" && (
          <p role="alert" className="px-2 pb-1 text-xs text-danger">
            {state.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label={text.button}
        className="rounded-full bg-black/40 p-1.5 text-white transition-transform hover:bg-black/60 active:scale-90"
      >
        <Forward size={16} />
      </button>

      {open && (
        <OverlayPortal z={sheetZ}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="fixed inset-0 flex items-end justify-center bg-black/60 outline-none"
          style={{ zIndex: sheetZ }}
          onClick={close}
        >
          <div
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p id={titleId} className="text-sm font-semibold">
                {view === "chats" ? text.sendToChats : view === "circles" ? text.chooseCircle : text.title}
              </p>
              <button
                type="button"
                onClick={close}
                aria-label={shell.common.close}
                className="rounded-lg p-1 text-foreground-soft hover:bg-line"
              >
                <X size={16} />
              </button>
            </div>

            {view === "root" && (
              <div className="mt-3 space-y-1">
                <button type="button" onClick={openChats} className={rowClass}>
                  <Send size={16} className="mt-0.5 shrink-0" />
                  <span>{text.sendToChats}</span>
                </button>
                {options?.feed && repostRow(<House size={16} />, text.toFeed, feedState, postToFeed)}
                {options?.muse && repostRow(<Clapperboard size={16} />, text.toMuse, museState, postToMuse)}
                {options?.circle && (
                  <button type="button" onClick={openCircles} className={rowClass}>
                    <Users size={16} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block">{text.toCircle}</span>
                      <span className="block text-xs text-foreground-soft">{text.copyStays}</span>
                    </span>
                  </button>
                )}
                {options === null && (
                  <p className="px-2 py-1 text-xs text-foreground-soft">{shell.common.loading}</p>
                )}
                {options?.reason === "opted_out" && (
                  <p className="px-2 py-1 text-xs text-foreground-soft">{text.repostOff}</p>
                )}
              </div>
            )}

            {view === "chats" &&
              (loadFailed ? (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {text.failed}
                </p>
              ) : (
                <SendToChatsPicker
                  items={conversations}
                  getKey={(c) => c.value}
                  getName={(c) => c.label}
                  getUsername={(c) => c.username}
                  listClassName="max-h-[45dvh]"
                  loading={<li className="text-sm text-foreground-soft">{shell.common.loading}</li>}
                  texts={{
                    search: text.searchFriends,
                    clear: text.clearSearch,
                    noMatch: text.noFriendMatch,
                    empty: text.empty,
                  }}
                  onSend={send}
                  onSent={({ failed }) => {
                    if (failed === 0) setTimeout(close, 1200);
                  }}
                />
              ))}

            {view === "circles" && (
              <ul className="mt-3 max-h-[45dvh] space-y-1 overflow-y-auto">
                {circles === null && <li className="px-2 py-1 text-sm text-foreground-soft">{shell.common.loading}</li>}
                {circles?.length === 0 && <li className="px-2 py-1 text-sm text-foreground-soft">{t.share.noCircles}</li>}
                {circles?.map((circle) => {
                  const state = circleStates[circle.id] ?? IDLE;
                  return (
                    <li key={circle.id}>
                      <button
                        type="button"
                        disabled={state.status === "posting" || state.status === "done"}
                        onClick={() => postToCircle(circle.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-60"
                      >
                        <span className="truncate">
                          {circle.parentName ? `${circle.parentName} › ${circle.name}` : circle.name}
                        </span>
                        {state.status === "posting" && (
                          <span className="shrink-0 text-xs text-foreground-soft">{text.posting}</span>
                        )}
                        {state.status === "done" && <span className="shrink-0 text-xs text-success">{state.label}</span>}
                      </button>
                      {state.status === "error" && (
                        <p role="alert" className="px-2 pb-1 text-xs text-danger">
                          {state.message}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {view !== "root" && (
              <button
                type="button"
                onClick={() => setView("root")}
                className="mt-3 text-xs text-foreground-soft hover:text-accent"
              >
                <span aria-hidden className="inline-block rtl:-scale-x-100">←</span> {t.share.back}
              </button>
            )}
          </div>
        </div>
        </OverlayPortal>
      )}
    </>
  );
}
