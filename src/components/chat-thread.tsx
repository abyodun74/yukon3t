"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent, type PointerEvent } from "react";
import { Camera, Check, CheckCheck, Circle, Clock, ImagePlus, Mic, MoreHorizontal, Reply, Send, Upload, Video, X } from "lucide-react";
import {
  sendMessage,
  getConversationMessages,
  deleteMessageForMe,
  deleteMessageForEveryone,
  editMessage,
  toggleMessageReaction,
  suggestCorrection,
  removeCorrection,
} from "@/app/actions/messages";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { GifPickerButton } from "@/components/gif-picker-button";
import { EmojiTypeSuggestions } from "@/components/emoji-type-suggestions";
import { ReactionBar } from "@/components/reaction-bar";
import { summarizeReactionRows } from "@/lib/reactions";
import { AudioRecorderModal } from "@/components/audio-recorder-modal";
import { VideoRecorderModal } from "@/components/video-recorder-modal";
import { MediaPickerButton } from "@/components/media-picker-button";
import { DictationRecorder } from "@/components/dictation-recorder";
import { UserLink } from "@/components/user-link";
import { Lightbox } from "@/components/lightbox";
import { StoryViewer, type StoryData } from "@/components/story-viewer";
import { getStory } from "@/app/actions/stories";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile } from "@/lib/upload-client";
import { consumePendingShareMedia, subscribePendingShareMedia } from "@/lib/share-target-store";
import { isEmojiOnly, QUICK_REACTIONS } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { useSecretChat } from "@/lib/e2ee/use-secret-chat";
import { SecretChatBar } from "@/components/secret-chat-bar";
import { ReportModal } from "@/components/report-form";
import { E2EE_MAX_PLAINTEXT_BYTES, isEncryptedContent } from "@/lib/e2ee/constants";
import { utf8ByteLength } from "@/lib/e2ee/crypto";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { formatDateTime, formatDaySeparator } from "@/lib/format-date";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";

// Kept in sync with storage.ts's MAX_AUDIO_NOTE_SECONDS/MAX_VIDEO_NOTE_SECONDS
// and MEDIA_LIMITS — duplicated locally rather than imported, since
// storage.ts pulls in the server-only @aws-sdk/client-s3 SDK and can't be
// bundled into a "use client" component (same pattern post-composer.tsx
// already uses for its own MAX_VIDEO_SECONDS).
const MAX_AUDIO_NOTE_SECONDS = 60;
const MAX_VIDEO_NOTE_SECONDS = 30;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Kept in sync with storage.ts's MAX_VIDEO_BYTES — duplicated locally for the
// same reason as post-composer.tsx's MAX_VIDEO_BYTES.
const MAX_VIDEO_UPLOAD_BYTES = 2048 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

function dictationErrorMessage(code: string) {
  switch (code) {
    case "not_configured":
      return "Dictation isn't set up yet.";
    case "too_large":
      return "That clip is too large.";
    case "rate_limited":
      return "You're dictating too fast — slow down a little.";
    case "unavailable":
      return "Couldn't transcribe that clip — try again.";
    case "invalid":
      return "Couldn't transcribe that clip — try again.";
    default:
      return "Couldn't reach the server — check your connection and try again.";
  }
}

type MessageMediaType = "NONE" | "AUDIO" | "VIDEO" | "IMAGE" | "GIF";

type MessageData = {
  id: string;
  senderId: string;
  content: string;
  mediaType: MessageMediaType;
  mediaUrl: string | null;
  mediaThumbnailUrl: string | null;
  moderationStatus: "PUBLISHED" | "FLAGGED" | "REMOVED";
  deliveredAt: Date | null;
  readAt: Date | null;
  deletedForEveryoneAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  reactions: { emoji: string; userId: string }[];
  corrections: CorrectionData[];
  // Only set for a message referencing a story — either a reply
  // (replyToStory) or a forward (shareStoryToConversation), distinguished
  // by isForwardedStory below — null once the story itself has expired and
  // been swept by the cron.
  story: {
    id: string;
    mediaType: "IMAGE" | "VIDEO";
    mediaUrl: string;
    mediaThumbnailUrl: string | null;
    caption: string | null;
  } | null;
  isForwardedStory: boolean;
  // View-only (never from the server): set by ChatThread's viewOf() on a message whose stored body was
  // ciphertext, so the bubble can hide corrections and attach the decrypted text to a report.
  wasEncrypted?: boolean;
  // Set when this message is a swipe-to-reply quote of an earlier message
  // in the same thread — null once that message ages out or the reply
  // reference itself was never set.
  replyTo: {
    id: string;
    content: string;
    mediaType: MessageMediaType;
    deletedForEveryoneAt: Date | null;
    sender: { id: string; name: string | null };
  } | null;
};

type CorrectionData = {
  id: string;
  authorId: string;
  correctedText: string;
  author: { name: string | null };
};

type MemberData = {
  userId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  lastReadAt: Date | null;
};

const SEEN_BY_NAME_LIMIT = 3;

function seenByLabel(names: string[]) {
  if (names.length === 0) return "Sent";
  const shown = names.slice(0, SEEN_BY_NAME_LIMIT).join(", ");
  const rest = names.length - SEEN_BY_NAME_LIMIT;
  return `Seen by ${shown}${rest > 0 ? ` +${rest} more` : ""}`;
}

// Client-generated ids for a message optimistically appended before the
// server confirms it (see buildOptimisticMessage/handleSend below) — never
// collide with a real cuid, so `.startsWith` alone reliably tells the two
// apart everywhere a bubble needs to render differently while "sending".
const OPTIMISTIC_ID_PREFIX = "optimistic-";

function isSendingMessage(message: MessageData): boolean {
  return message.id.startsWith(OPTIMISTIC_ID_PREFIX);
}

function ReceiptIcon({ message }: { message: MessageData }) {
  if (isSendingMessage(message)) {
    return <Clock size={12} className="text-accent-ink/70" />;
  }
  if (message.readAt) {
    return <CheckCheck size={13} className="text-sky-400" />;
  }
  if (message.deliveredAt) {
    return <CheckCheck size={13} className="text-accent-ink/70" />;
  }
  return <Check size={13} className="text-accent-ink/70" />;
}

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** One-line summary of a quoted message for the reply preview — shared by the composer bar and the in-bubble quote. */
function replyPreviewText(target: {
  content: string;
  mediaType: MessageMediaType;
  deletedForEveryoneAt: Date | null;
}) {
  if (target.deletedForEveryoneAt) return "Original message was deleted";
  if (target.mediaType === "IMAGE") return "Photo";
  if (target.mediaType === "VIDEO") return "Video";
  if (target.mediaType === "AUDIO") return "Voice note";
  if (target.mediaType === "GIF") return "GIF";
  return target.content;
}

// How far right a bubble must be dragged before releasing counts as
// "reply" rather than an aborted swipe — matches the common WhatsApp/
// Telegram threshold closely enough to feel familiar.
const SWIPE_REPLY_THRESHOLD_PX = 56;
// Drag is clamped past the threshold so the bubble can't be flung
// arbitrarily far off its row while the finger/pointer is still down.
const SWIPE_MAX_DRAG_PX = 80;
// Matches the menu's own w-40 — used to check available viewport space
// before deciding which side it should open on.
const MESSAGE_MENU_WIDTH_PX = 160;

function CorrectionList({
  corrections,
  currentUserId,
  mine,
  onRemove,
}: {
  corrections: CorrectionData[];
  currentUserId: string;
  mine: boolean;
  onRemove: (correctionId: string) => void;
}) {
  if (corrections.length === 0) return null;

  return (
    <div className={cn("mt-1 flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      {corrections.map((c) => (
        <div
          key={c.id}
          className="max-w-[min(calc(100vw-7.5rem),26rem)] rounded-lg border border-line bg-surface px-2 py-1 text-xs"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground-soft">{c.author.name ?? "Someone"} suggests</span>
            {c.authorId === currentUserId && (
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                aria-label="Remove correction"
                className="ml-auto text-foreground-soft hover:text-danger"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{c.correctedText}</p>
        </div>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  currentUserId,
  sender,
  seenByNames,
  onDeleted,
  onEdited,
  onReacted,
  onCorrected,
  onReply,
  secretActive,
  encryptForEdit,
}: {
  message: MessageData;
  mine: boolean;
  currentUserId: string;
  /** Group chats only: the sender, shown above the bubble for non-own messages not grouped with the previous one. */
  sender?: MemberData;
  /** Group chats only: passed for the sender's own most recent message, to render "Seen by ..." in place of the DM checkmark. */
  seenByNames?: string[];
  onDeleted: (messageId: string, mode: "me" | "everyone") => void;
  onEdited: (message: MessageData) => void;
  onReacted: (messageId: string, reactions: { emoji: string; userId: string }[]) => void;
  onCorrected: (messageId: string, corrections: CorrectionData[]) => void;
  onReply: (message: MessageData) => void;
  /** This is a secret (end-to-end encrypted) chat: edits must be encrypted, and corrections aren't offered. */
  secretActive: boolean;
  encryptForEdit: (text: string) => Promise<string>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Which side the dropdown's own edge pins to (it opens toward the
  // opposite side). Defaults to the old mine-based guess so the first
  // paint before any click is reasonable, but the real decision happens in
  // toggleMenu, which measures actual space against the viewport — the
  // menu's anchor (the "..." button) can end up near either screen edge
  // regardless of whose message it is, e.g. next to a wide incoming bubble.
  const [menuAlign, setMenuAlign] = useState<"left" | "right">(mine ? "right" : "left");
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [editError, setEditError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [storyViewer, setStoryViewer] = useState<{
    stories: StoryData[];
    authorId: string;
    authorName: string;
    authorAvatarUrl: string | null;
    isOwner: boolean;
  } | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState(false);

  async function openStory() {
    if (!message.story || storyLoading) return;
    setStoryLoading(true);
    setStoryError(false);
    const result = await getStory(message.story.id);
    setStoryLoading(false);
    if (result.error || !result.story) {
      setStoryError(true);
      return;
    }
    setStoryViewer({
      stories: [result.story],
      authorId: result.authorId,
      authorName: result.authorName,
      authorAvatarUrl: result.authorAvatarUrl,
      isOwner: result.isOwner,
    });
  }
  const [isPending, startTransition] = useTransition();
  const deleted = Boolean(message.deletedForEveryoneAt);
  // Still in flight (see buildOptimisticMessage/handleSend) — has no real
  // id yet, so nothing that acts on the message by id (reply-swipe, the
  // options menu, reactions, edit) is usable on it until it's replaced by
  // the server's real one.
  const sending = isSendingMessage(message);
  const bigEmoji = !deleted && !editing && message.moderationStatus === "PUBLISHED" && isEmojiOnly(message.content);
  const myCorrection = message.corrections.find((c) => c.authorId === currentUserId);

  // Swipe-right-to-reply: a plain pointer-drag on the bubble itself, not a
  // library — the gesture is one axis, one direction, and needs to coexist
  // with normal text selection/scrolling, which a general-purpose gesture
  // lib would add more ceremony to configure than it'd save here.
  const [dragX, setDragX] = useState(0);
  // Drives the CSS transition (off while actively dragging, on for the
  // snap-back) — plain state rather than reading dragStateRef.current
  // during render, which React's rules of hooks disallows.
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; active: boolean } | null>(null);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (deleted || editing || sending) return;
    // Only primary touch/mouse input — ignore secondary buttons/multi-touch.
    if (e.button !== 0) return;
    dragStateRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.active) {
      // Require a clearly-horizontal, rightward gesture before capturing the
      // pointer — otherwise a normal vertical scroll on mobile would get
      // hijacked the instant a touch has any horizontal component at all.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
        dragStateRef.current = null;
        return;
      }
      drag.active = true;
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      // The few pixels of movement in the dead zone above can start a text
      // selection (mouse) before preventDefault below ever gets a chance to
      // run — clear it now that this has been claimed as a swipe, so a
      // completed reply swipe never leaves a stray highlighted word behind.
      window.getSelection()?.removeAllRanges();
    }

    e.preventDefault();
    setDragX(Math.min(dx, SWIPE_MAX_DRAG_PX));
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (dragX >= SWIPE_REPLY_THRESHOLD_PX) onReply(message);
    }
    dragStateRef.current = null;
    setIsDragging(false);
    setDragX(0);
  }

  function toggleReaction(emoji: string) {
    startTransition(async () => {
      const result = await toggleMessageReaction(message.id, emoji);
      if (!result.error) onReacted(message.id, result.reactions);
    });
  }

  function toggleMenu() {
    if (!menuOpen) {
      const rect = menuAnchorRef.current?.getBoundingClientRect();
      if (rect) {
        const spaceRight = window.innerWidth - rect.left;
        const spaceLeft = rect.right;
        // Open toward whichever side actually has room; fall back to the
        // side with more (rather than less) space if neither fully fits,
        // so an extremely narrow viewport still clips the smaller amount.
        setMenuAlign(spaceRight >= MESSAGE_MENU_WIDTH_PX || spaceRight >= spaceLeft ? "left" : "right");
      }
    }
    setMenuOpen((v) => !v);
  }

  function openCorrection() {
    setCorrectionDraft(myCorrection?.correctedText ?? message.content);
    setCorrectionError(null);
    setCorrecting(true);
  }

  function cancelCorrection() {
    setCorrecting(false);
    setCorrectionError(null);
  }

  function saveCorrection() {
    const text = correctionDraft.trim();
    if (!text || isPending) return;
    setCorrectionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("correctedText", text);
      const result = await suggestCorrection(message.id, fd);
      if (result.error || !result.corrections) {
        setCorrectionError("Couldn't save that suggestion.");
        return;
      }
      onCorrected(message.id, result.corrections);
      setCorrecting(false);
    });
  }

  function handleRemoveCorrection(correctionId: string) {
    startTransition(async () => {
      const result = await removeCorrection(correctionId);
      if (!result.error && result.corrections) {
        onCorrected(message.id, result.corrections);
      }
    });
  }

  function saveEdit() {
    const text = draft.trim();
    if (!text || isPending) return;
    setEditError(null);
    if (secretActive && utf8ByteLength(text) > E2EE_MAX_PLAINTEXT_BYTES) {
      setEditError("That's too long for a secret chat - please shorten it.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      // In a secret chat the edit is encrypted here, in the browser - it is never sent as readable text.
      let wire = text;
      if (secretActive) {
        try {
          wire = await encryptForEdit(text);
        } catch {
          setEditError("Couldn't encrypt that edit.");
          return;
        }
      }
      fd.set("content", wire);
      const result = await editMessage(message.id, fd);
      if (result.error || !result.message) {
        setEditError("Couldn't save that edit.");
        return;
      }
      onEdited(result.message as MessageData);
      setEditing(false);
    });
  }

  return (
    <div className={cn("flex items-end gap-1", mine ? "flex-row-reverse" : "flex-row")}>
      <div className="relative min-w-0">
        {dragX > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-7 flex items-center text-accent"
            style={{ opacity: Math.min(dragX / SWIPE_REPLY_THRESHOLD_PX, 1) }}
          >
            <Reply size={16} />
          </div>
        )}
        {sender && (
          <div className="mb-0.5 px-1">
            <UserLink
              userId={sender.userId}
              name={sender.name}
              username={sender.username}
              avatarUrl={sender.avatarUrl}
              avatarSize={16}
              className="text-xs font-medium text-foreground-soft hover:text-accent"
            />
          </div>
        )}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            transform: dragX ? `translateX(${dragX}px)` : undefined,
            transition: isDragging ? "none" : "transform 150ms ease",
            touchAction: "pan-y",
          }}
          className={cn(
            // The bubble sits alongside a fixed-width reaction/menu button
            // pair (~3.5rem, see the shrink-0 row below) inside a padded
            // scroll container — a plain 75vw cap ignores both, so a
            // near-max-width bubble (e.g. one with a reply-quote preview)
            // pushed those buttons half off the left edge of the screen on
            // narrow phones. Reserving that space in the cap keeps the
            // whole row (buttons + gap + bubble) inside the viewport.
            "max-w-[min(calc(100vw-7.5rem),26rem)] rounded-2xl px-3 py-2 text-sm transition-opacity",
            mine ? "bg-accent text-accent-ink" : "bg-surface",
            sending && "opacity-60",
          )}
        >
          {message.replyTo && (
            <div
              className={cn(
                "mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs",
                mine ? "border-accent-ink/40 bg-black/10" : "border-accent bg-black/5",
              )}
            >
              <p className={cn("font-medium", mine ? "text-accent-ink/80" : "text-accent")}>
                {message.replyTo.sender.id === currentUserId ? "You" : message.replyTo.sender.name ?? "Someone"}
              </p>
              <p className={cn("truncate", mine ? "text-accent-ink/70" : "text-foreground-soft")}>
                {replyPreviewText(message.replyTo)}
              </p>
            </div>
          )}
          {deleted ? (
            <p className={cn("italic", mine ? "text-accent-ink/70" : "text-foreground-soft")}>
              This message was deleted
            </p>
          ) : editing ? (
            <div className="space-y-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                  } else if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(message.content);
                    setEditError(null);
                  }
                }}
                maxLength={4000}
                rows={2}
                autoFocus
                className={cn(
                  "w-full resize-none rounded-lg bg-black/10 px-2 py-1 text-sm outline-none",
                  mine ? "text-accent-ink" : "text-foreground",
                )}
              />
              <div className="flex items-center justify-end gap-2 text-[11px]">
                {editError && <span className="mr-auto text-danger">{editError}</span>}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.content);
                    setEditError(null);
                  }}
                  className="rounded px-2 py-0.5 hover:bg-black/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending || !draft.trim()}
                  onClick={saveEdit}
                  className="rounded bg-black/10 px-2 py-0.5 font-medium disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          ) : message.moderationStatus !== "PUBLISHED" ? (
            <p className="italic">This message is under review.</p>
          ) : (
            <>
              {message.story && (
                <button
                  type="button"
                  onClick={openStory}
                  disabled={storyLoading}
                  className={cn(
                    "mb-1.5 flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-xs disabled:opacity-70",
                    mine ? "bg-black/10 hover:bg-black/15" : "bg-black/5 hover:bg-black/10",
                  )}
                >
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-black">
                    {(message.story.mediaType === "IMAGE" ? message.story.mediaUrl : message.story.mediaThumbnailUrl) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={message.story.mediaType === "IMAGE" ? message.story.mediaUrl : message.story.mediaThumbnailUrl!}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <span className={cn(mine ? "text-accent-ink/70" : "text-foreground-soft")}>
                    {storyError
                      ? "This story is no longer available."
                      : storyLoading
                        ? "Opening…"
                        : message.isForwardedStory
                          ? mine
                            ? "You shared a story — tap to view"
                            : "Shared a story — tap to view"
                          : mine
                            ? "You replied to their story — tap to view"
                            : "Replied to your story — tap to view"}
                  </span>
                </button>
              )}
              {storyViewer && (
                <StoryViewer
                  stories={storyViewer.stories}
                  startIndex={0}
                  authorId={storyViewer.authorId}
                  authorName={storyViewer.authorName}
                  authorAvatarUrl={storyViewer.authorAvatarUrl}
                  isOwner={storyViewer.isOwner}
                  currentUserId={currentUserId}
                  onClose={() => setStoryViewer(null)}
                />
              )}
              {message.mediaType === "AUDIO" && message.mediaUrl && (
                <audio controls preload="metadata" className="h-10 w-56 max-w-full" src={message.mediaUrl} />
              )}
              {message.mediaType === "VIDEO" && message.mediaUrl && (
                <video
                  controls
                  preload="metadata"
                  poster={message.mediaThumbnailUrl ?? undefined}
                  className="max-h-72 w-full rounded-lg bg-black"
                >
                  <source src={message.mediaUrl} />
                </video>
              )}
              {message.mediaType === "IMAGE" && message.mediaUrl && (
                <button
                  type="button"
                  onClick={() => setImageOpen(true)}
                  className="block w-full cursor-zoom-in"
                  aria-label="View image full-screen"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- R2-hosted user upload, not a local/optimizable asset */}
                  <img
                    src={message.mediaUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="max-h-72 w-full rounded-lg object-contain"
                  />
                </button>
              )}
              {message.mediaType === "GIF" && message.mediaUrl && (
                <button
                  type="button"
                  onClick={() => setImageOpen(true)}
                  className="block w-full cursor-zoom-in"
                  aria-label="View GIF full-screen"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted GIF, not a local/optimizable asset */}
                  <img
                    src={message.mediaUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="max-h-72 w-full rounded-lg object-contain"
                  />
                </button>
              )}
              {imageOpen && message.mediaUrl && (
                <Lightbox
                  images={[message.mediaUrl]}
                  index={0}
                  onIndexChange={() => {}}
                  onClose={() => setImageOpen(false)}
                  alt={message.mediaType === "GIF" ? "GIF shared in chat" : "Photo shared in chat"}
                />
              )}
              {message.content && (
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    message.mediaType !== "NONE" && "mt-1.5",
                    bigEmoji && "text-3xl leading-none",
                  )}
                >
                  {message.content}
                </p>
              )}
            </>
          )}
          <div
            className={cn(
              "mt-1 flex items-center justify-end gap-1 text-[10px]",
              mine ? "text-accent-ink/70" : "text-foreground-soft",
            )}
          >
            {!deleted && message.editedAt && <span>Edited</span>}
            {/* toLocaleTimeString depends on the runtime's timezone, which
                differs between the server (render) and the browser
                (hydration) — suppressHydrationWarning tells React that's
                expected here rather than a real mismatch to warn about;
                the browser's own local time is what should win anyway. */}
            <span suppressHydrationWarning title={formatDateTime(message.createdAt)}>
              {formatTime(message.createdAt)}
            </span>
            {mine && seenByNames === undefined && <ReceiptIcon message={message} />}
          </div>
          {mine && seenByNames !== undefined && (
            <p className="mt-0.5 text-right text-[10px] text-accent-ink/70">
              {seenByLabel(seenByNames)}
            </p>
          )}
        </div>

        <CorrectionList
          corrections={message.corrections}
          currentUserId={currentUserId}
          mine={mine}
          onRemove={handleRemoveCorrection}
        />

        {correcting && (
          <div className="mt-1 max-w-[min(calc(100vw-7.5rem),26rem)] rounded-lg border border-line bg-surface p-2">
            <textarea
              value={correctionDraft}
              onChange={(e) => setCorrectionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveCorrection();
                } else if (e.key === "Escape") {
                  cancelCorrection();
                }
              }}
              maxLength={4000}
              rows={2}
              autoFocus
              className="w-full resize-none rounded-lg border border-line bg-background px-2 py-1 text-xs outline-none focus:border-accent"
            />
            <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
              {correctionError && <span className="mr-auto text-danger">{correctionError}</span>}
              <button
                type="button"
                disabled={isPending}
                onClick={cancelCorrection}
                className="rounded px-2 py-0.5 hover:bg-line"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending || !correctionDraft.trim()}
                onClick={saveCorrection}
                className="rounded bg-accent px-2 py-0.5 font-medium text-accent-ink disabled:opacity-50"
              >
                Suggest
              </button>
            </div>
          </div>
        )}

        <ReactionBar
          reactions={summarizeReactionRows(message.reactions, currentUserId)}
          mine={mine}
          onToggle={toggleReaction}
        />
      </div>

      {!deleted && !editing && !sending && (
        <div ref={menuAnchorRef} className="relative flex shrink-0 items-center pb-1">
          <EmojiPickerButton onSelect={toggleReaction} quickReactions={QUICK_REACTIONS} />
          <button
            type="button"
            onClick={toggleMenu}
            aria-label="Message options"
            className="rounded-full p-1 text-foreground-soft hover:bg-line"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              className={cn(
                "absolute top-full z-20 mt-1 w-40 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-lg",
                menuAlign === "right" ? "right-0" : "left-0",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onReply(message);
                }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-line"
              >
                Reply
              </button>
              {!mine && !secretActive && !message.wasEncrypted && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setMenuOpen(false);
                    openCorrection();
                  }}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-line"
                >
                  {myCorrection ? "Edit your correction" : "Suggest a correction"}
                </button>
              )}
              {!mine && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setReporting(true);
                  }}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-line"
                >
                  Report
                </button>
              )}
              {mine && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(message.content);
                    setEditError(null);
                    setEditing(true);
                  }}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-line"
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setMenuOpen(false);
                  startTransition(async () => {
                    const result = await deleteMessageForMe(message.id);
                    if (!result.error) onDeleted(message.id, "me");
                  });
                }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-line"
              >
                Delete for me
              </button>
              {mine && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setMenuOpen(false);
                    startTransition(async () => {
                      const result = await deleteMessageForEveryone(message.id);
                      if (!result.error) onDeleted(message.id, "everyone");
                    });
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-danger hover:bg-line"
                >
                  Delete for everyone
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {reporting && (
        <ReportModal
          targetType="MESSAGE"
          targetId={message.id}
          reportedUserId={message.senderId}
          // From a secret chat the server can't read the message, so the decrypted text rides along with the report.
          evidenceText={message.wasEncrypted ? message.content : undefined}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}

export function ChatThread({
  conversationId,
  initialMessages,
  currentUserId,
  isGroup,
  conversationLabel,
  members: initialMembers,
}: {
  conversationId: string;
  initialMessages: MessageData[];
  currentUserId: string;
  isGroup: boolean;
  conversationLabel: string;
  members: MemberData[];
}) {
  const [messages, setMessages] = useState<MessageData[]>(initialMessages);
  const [members, setMembers] = useState<MemberData[]>(initialMembers);
  const [content, setContent] = useState("");
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  // A picked Giphy GIF URL, not a File — never uploaded, so it skips
  // uploadPendingMedia's File-handling branches entirely.
  const [pendingGif, setPendingGif] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<MessageData | null>(null);
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Secret chats (end-to-end encrypted text) - 1:1 only; inert for groups. See src/lib/e2ee/.
  const secret = useSecretChat({ conversationId, currentUserId, enabled: !isGroup });
  const prepareSecret = secret.prepare;
  // Decrypt whatever ciphertext is in the list (and in reply quotes) into the hook's cache.
  useEffect(() => {
    const items: { content: string; senderId: string }[] = [];
    for (const m of messages) {
      items.push({ content: m.content, senderId: m.senderId });
      if (m.replyTo) items.push({ content: m.replyTo.content, senderId: m.replyTo.sender.id });
    }
    void prepareSecret(items);
  }, [messages, prepareSecret]);
  /** A message as it should be SHOWN: ciphertext decrypted (or a clear placeholder), everything else untouched. */
  function viewOf(m: MessageData): MessageData {
    if (!isEncryptedContent(m.content) && !(m.replyTo && isEncryptedContent(m.replyTo.content))) return m;
    return {
      ...m,
      content: secret.display(m.content),
      wasEncrypted: isEncryptedContent(m.content),
      replyTo: m.replyTo ? { ...m.replyTo, content: secret.display(m.replyTo.content) } : null,
    };
  }

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  // Object URL is created once per pendingImage (memoized), not inline in
  // JSX — that would leak a new blob URL on every re-render. The paired
  // effect below only handles revocation.
  const pendingImagePreviewUrl = useMemo(
    () => (pendingImage ? URL.createObjectURL(pendingImage) : null),
    [pendingImage],
  );
  useEffect(() => {
    return () => {
      if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
    };
  }, [pendingImagePreviewUrl]);

  // Picks up media handed off by ShareTargetGate ("Send to a friend" picked
  // this conversation from another app's Share sheet) — see
  // share-target-store.ts. Checked both on mount and via
  // subscribePendingShareMedia — the latter matters if the user was
  // already viewing this exact conversation when the share landed, same
  // "already-mounted, router.push() to the same route doesn't remount"
  // gap confirmed live on PostComposer's own copy of this effect. Only the
  // first shared image is used — pendingImage is already a
  // single-attachment slot here, same as every other path that sets it
  // (the picker/camera buttons below). Deferred a microtask, not read
  // synchronously in the effect body — see the matching comment in
  // post-composer.tsx's own copy of this effect.
  useEffect(() => {
    function applyShare() {
      Promise.resolve().then(() => {
        const shared = consumePendingShareMedia();
        if (!shared) return;
        // Through the same pickImage/pickVideoFile validation (type/size/
        // resize) as any other attach path, not straight into state — a
        // share-sheet hand-off is no more trustworthy than a raw file
        // picker/paste.
        if (shared.video) {
          pickVideoFile(shared.video);
        } else if (shared.images[0]) {
          pickImage(shared.images[0]);
        }
        if (shared.text) setContent((prev) => (prev ? `${prev} ${shared.text}` : shared.text!));
      });
    }
    applyShare();
    return subscribePendingShareMedia(applyShare);
  }, []);

  // The very first fetch of a newly-opened/switched-to thread is the real
  // "mark as read" signal (getConversationMessages marks delivered/read as
  // a side effect just by being called) — not just a bonus of however
  // refetches get triggered.
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  });

  // A refetch can return the exact same data as last time (e.g. the other
  // side's own read-receipt refetch bouncing this one) — without this,
  // setMessages would still hand React a brand-new array of brand-new
  // objects regardless, forcing a full re-render of every message bubble/
  // reaction/timestamp in the thread even when nothing changed. A cheap
  // content comparison skips that no-op render — real CPU/battery cost on
  // a phone during a long-open conversation.
  const lastSignatureRef = useRef<string | null>(null);

  const refetch = useCallback(async () => {
    const forId = conversationIdRef.current;
    const result = await getConversationMessages(forId);
    // Ignore a response that arrives after the user has switched threads.
    if (conversationIdRef.current !== forId || result.error !== null) return;

    const signature = JSON.stringify(result);
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    setMessages(result.messages as MessageData[]);
    if (result.conversation) {
      setMembers(
        result.conversation.members.map((m) => ({
          userId: m.userId,
          name: m.user.name ?? "Unknown",
          lastReadAt: m.lastReadAt,
        })),
      );
    }
  }, []);

  // Ref indirection so the mount/conversation-switch effect below reads as
  // a plain property access to React's own static analysis — same pattern
  // use-nav-badges.ts uses for its own refetchRef, avoiding a "setState
  // synchronously within an effect" lint false-positive for what is
  // actually an async fetch-then-setState.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  // Fires immediately on mount and on every conversation switch (this is
  // the "mark as read" moment, see above) — separate from the realtime
  // subscription below, which only fires on a *new* signal from here on.
  useEffect(() => {
    refetchRef.current();
  }, [conversationId]);

  // Replaces the old 2s poll: sendMessage/editMessage/toggleMessageReaction/
  // suggestCorrection/removeCorrection/deleteMessageForEveryone, and
  // getConversationMessages itself (when it actually marks something
  // delivered/read), all publish onto this same conversationId's channel —
  // see actions/messages.ts. Also refetches once on tab-focus-regain as a
  // safety net (see useRealtimeEvent's own doc comment).
  useRealtimeEvent(REALTIME_CHANNELS.conversation(conversationId), "changed", () => {
    refetch();
    // Someone may have just turned secret chat on or off, or reset their keys.
    void secret.refresh();
  });

  // Message ids that should ease in on this render — tracked separately
  // from messages.length because a refetch can also replace the whole array
  // (an edit or reaction landing elsewhere in the thread) without actually
  // adding anything, and that shouldn't replay the entrance animation on
  // every bubble.
  const knownMessageIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());

  // True whenever the *next* messages update should jump straight to the
  // bottom instead of animating there — the first-ever mount, and every
  // conversation switch below. False the rest of the time, so a genuinely
  // new incoming message in an already-open thread still animates in.
  const pendingScrollJumpRef = useRef(true);

  // ChatThread is NOT remounted when navigating from one conversation to
  // another (see conversationIdRef above and refetch()'s own "ignore a
  // response that arrives after the user has switched threads" comment) —
  // React just updates this same instance's props in place. Every piece of
  // per-conversation local state below has to be reset here explicitly, or
  // it leaks from whatever conversation was open right before: a stale
  // draft/pending attachment/reply-quote carried into the new thread, the
  // old thread's messages left on screen until the mount/conversation-switch
  // effect's refetch above overwrites them, every message in the new thread
  // wrongly replaying the "just added" entrance animation, and the view
  // landing wherever the old thread's scroll position happened to be
  // instead of this thread's newest message.
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      // The initial useState()/useRef() calls above already seeded
      // everything from this same conversationId's props — running this
      // again here would just be redundant (not incorrect), so skip it.
      isFirstRenderRef.current = false;
      return;
    }
    setMessages(initialMessages);
    setMembers(initialMembers);
    setContent("");
    setPendingAudio(null);
    setPendingVideo(null);
    setPendingImage(null);
    setPendingGif(null);
    setReplyTarget(null);
    setError(null);
    knownMessageIdsRef.current = new Set(initialMessages.map((m) => m.id));
    setJustAddedIds(new Set());
    lastSignatureRef.current = null;
    pendingScrollJumpRef.current = true;
    // Deliberately keyed on conversationId alone, not initialMessages/
    // initialMembers too — those can get new array references on every
    // server round-trip for the *same* conversation (e.g. a revalidatePath
    // elsewhere), and re-running this on every such render would wipe out
    // an in-progress draft/attachment for no reason. Only an actual
    // conversation switch should reset anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Opens the conversation already scrolled to the newest message, not the
  // top of history — instant (not smooth) on the first mount and on every
  // conversation switch (pendingScrollJumpRef, set above), smooth for a new
  // message arriving in an already-open thread. useLayoutEffect so the
  // instant case happens before the browser paints — no visible flash of
  // the wrong scroll position first. This previously used
  // bottomRef.scrollIntoView({ behavior: "smooth" }) unconditionally on
  // mount, which animated the whole *page* (not just this panel) down to
  // the bottom, burying the header/Call button off-screen mid-animation
  // before the user saw it. Writing scrollTop directly on this panel's own
  // scroll container avoids that: it's instant (nothing to visually "bury"
  // anything with) and scoped to this element, so it can't propagate up to
  // page-level scroll the way scrollIntoView can.
  useLayoutEffect(() => {
    if (pendingScrollJumpRef.current) {
      pendingScrollJumpRef.current = false;
      const el = messagesContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const prevIds = knownMessageIdsRef.current;
    const added = messages.filter((m) => !prevIds.has(m.id)).map((m) => m.id);
    knownMessageIdsRef.current = new Set(messages.map((m) => m.id));
    if (added.length === 0) return;
    setJustAddedIds(new Set(added));
    const timer = setTimeout(() => setJustAddedIds(new Set()), 400);
    return () => clearTimeout(timer);
  }, [messages]);

  async function uploadPendingMedia(): Promise<
    | { error: string }
    | { mediaType: "NONE" }
    | { mediaType: "AUDIO"; mediaUrl: string }
    | { mediaType: "VIDEO"; mediaUrl: string; mediaThumbnailUrl?: string }
    | { mediaType: "IMAGE"; mediaUrl: string }
    | { mediaType: "GIF"; mediaUrl: string }
  > {
    if (pendingGif) {
      return { mediaType: "GIF", mediaUrl: pendingGif };
    }
    if (pendingAudio) {
      const result = await uploadFileDirect(pendingAudio, "message-audio");
      if (!result.ok) return { error: result.error };
      return { mediaType: "AUDIO", mediaUrl: result.publicUrl };
    }
    if (pendingImage) {
      const result = await uploadFileDirect(pendingImage, "message-image");
      if (!result.ok) return { error: result.error };
      return { mediaType: "IMAGE", mediaUrl: result.publicUrl };
    }
    if (pendingVideo) {
      // Same reasoning as the post composer: frame capture reads the local
      // file directly, so it can run concurrently with the video upload
      // instead of waiting on it first.
      const [videoResult, thumbnailResult] = await Promise.all([
        uploadFileDirect(pendingVideo, "message-video"),
        captureVideoFrameFromFile(pendingVideo).then((frame) =>
          frame ? uploadFileDirect(frame, "video-thumb") : null,
        ),
      ]);
      if (!videoResult.ok) return { error: videoResult.error };
      return {
        mediaType: "VIDEO",
        mediaUrl: videoResult.publicUrl,
        mediaThumbnailUrl: thumbnailResult?.ok ? thumbnailResult.publicUrl : undefined,
      };
    }
    return { mediaType: "NONE" };
  }

  /** A full-shaped MessageData for the not-yet-confirmed bubble appended by handleSend below — see OPTIMISTIC_ID_PREFIX/isSendingMessage for how it's told apart from a real one. */
  function buildOptimisticMessage(params: {
    id: string;
    content: string;
    mediaType: MessageMediaType;
    mediaUrl: string | null;
    replyTo: MessageData | null;
  }): MessageData {
    return {
      id: params.id,
      senderId: currentUserId,
      content: params.content,
      mediaType: params.mediaType,
      mediaUrl: params.mediaUrl,
      mediaThumbnailUrl: null,
      moderationStatus: "PUBLISHED",
      deliveredAt: null,
      readAt: null,
      deletedForEveryoneAt: null,
      editedAt: null,
      createdAt: new Date(),
      reactions: [],
      corrections: [],
      story: null,
      isForwardedStory: false,
      replyTo: params.replyTo
        ? {
            id: params.replyTo.id,
            content: params.replyTo.content,
            mediaType: params.replyTo.mediaType,
            deletedForEveryoneAt: params.replyTo.deletedForEveryoneAt,
            sender: {
              id: params.replyTo.senderId,
              name: members.find((m) => m.userId === params.replyTo!.senderId)?.name ?? null,
            },
          }
        : null,
    };
  }

  function handleSend() {
    const text = content.trim();
    if (!text && !pendingAudio && !pendingVideo && !pendingImage && !pendingGif) return;
    if (isPending) return;
    // In a secret chat the text is encrypted before it leaves this device. If that can't happen, say so and stop -
    // never send it as readable text.
    if (text && secret.active) {
      if (utf8ByteLength(text) > E2EE_MAX_PLAINTEXT_BYTES) {
        setError("That message is too long for a secret chat - please shorten it.");
        return;
      }
      if (!secret.canEncrypt) {
        setError("This device can't encrypt yet - unlock your secret chat keys first.");
        return;
      }
    }
    const audio = pendingAudio;
    const video = pendingVideo;
    const image = pendingImage;
    const gif = pendingGif;
    const replyTo = replyTarget;
    setContent("");
    setPendingAudio(null);
    setPendingVideo(null);
    setPendingImage(null);
    setPendingGif(null);
    setReplyTarget(null);
    setError(null);

    // A fresh, independently-owned object URL for the optimistic bubble's
    // own preview — deliberately not the composer's pendingImagePreviewUrl
    // memo, which gets revoked the instant pendingImage is cleared above
    // (see that memo's paired cleanup effect); this one's lifecycle
    // belongs to this send attempt alone, revoked once the optimistic
    // bubble below is replaced or removed. Audio/video/GIF don't get an
    // instant preview the same way (no cheap blob URL already at hand for
    // those) — that bubble briefly shows as text-only (or a bare "sending"
    // bubble for a caption-less attachment) until the real message swaps
    // in, rather than blocking the optimistic append entirely.
    const optimisticImageUrl = image ? URL.createObjectURL(image) : null;
    const optimisticId = `${OPTIMISTIC_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((prev) => [
      ...prev,
      buildOptimisticMessage({
        id: optimisticId,
        content: text,
        mediaType: image ? "IMAGE" : "NONE",
        mediaUrl: optimisticImageUrl,
        replyTo,
      }),
    ]);

    function settleOptimistic(replacement: MessageData | null) {
      setMessages((prev) =>
        replacement
          ? prev.map((m) => (m.id === optimisticId ? replacement : m))
          : prev.filter((m) => m.id !== optimisticId),
      );
      if (optimisticImageUrl) URL.revokeObjectURL(optimisticImageUrl);
    }

    startTransition(async () => {
      let wireContent = text;
      if (text && secret.active) {
        try {
          wireContent = await secret.encrypt(text);
        } catch {
          setError("Couldn't encrypt that message - it was NOT sent.");
          setContent(text);
          setPendingAudio(audio);
          setPendingVideo(video);
          setPendingImage(image);
          setPendingGif(gif);
          setReplyTarget(replyTo);
          settleOptimistic(null);
          return;
        }
      }
      const media = await uploadPendingMedia();
      if ("error" in media) {
        setError("Couldn't send that.");
        setContent(text);
        setPendingAudio(audio);
        setPendingVideo(video);
        setPendingImage(image);
        setPendingGif(gif);
        setReplyTarget(replyTo);
        settleOptimistic(null);
        return;
      }
      const fd = new FormData();
      fd.set("conversationId", conversationId);
      fd.set("content", wireContent);
      fd.set("mediaType", media.mediaType);
      if (media.mediaType !== "NONE") fd.set("mediaUrl", media.mediaUrl);
      if (media.mediaType === "VIDEO" && media.mediaThumbnailUrl) {
        fd.set("mediaThumbnailUrl", media.mediaThumbnailUrl);
      }
      if (replyTo) fd.set("replyToMessageId", replyTo.id);
      let result;
      try {
        result = await sendMessage(fd);
      } catch {
        // A rejected server-action call (e.g. no connectivity) would
        // otherwise be an uncaught exception that crashes the whole page
        // instead of showing a normal composer error.
        setError("Couldn't reach the server — check your connection and try again.");
        setContent(text);
        setPendingAudio(audio);
        setPendingVideo(video);
        setPendingImage(image);
        setPendingGif(gif);
        setReplyTarget(replyTo);
        settleOptimistic(null);
        return;
      }
      if (result.error) {
        const modeChanged = result.error === "plaintext_in_secret_chat" || result.error === "not_a_secret_chat";
        // The other person just turned secret chat on/off: re-read the state so the next send is encrypted (or not) correctly.
        if (modeChanged) void secret.refresh();
        setError(
          result.error === "rate_limited"
            ? "Slow down a little."
            : result.error === "blocked"
              ? "This message couldn't be delivered."
              : modeChanged
                ? "This chat's secret setting just changed - tap send again."
                : "Couldn't send that.",
        );
        setContent(text);
        setPendingAudio(audio);
        setPendingVideo(video);
        setPendingImage(image);
        setPendingGif(gif);
        setReplyTarget(replyTo);
        settleOptimistic(null);
        return;
      }
      settleOptimistic(result.message ? (result.message as MessageData) : null);
    });
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Use a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    // Resize before the size check — see post-composer.tsx's pickImages
    // for why (a raw phone photo routinely exceeds 25MB; the resized
    // version essentially never does).
    const resized = await resizeImageFile(file);
    if (resized.size > MAX_IMAGE_BYTES) {
      setError("Images must be 25MB or smaller.");
      return;
    }
    setPendingAudio(null);
    setPendingVideo(null);
    setPendingGif(null);
    setError(null);
    setPendingImage(resized);
  }

  function pickVideoFile(file: File | undefined) {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) {
      setError("Use an MP4 or WebM video.");
      return;
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError("Video must be 2GB or smaller.");
      return;
    }
    setPendingAudio(null);
    setPendingImage(null);
    setPendingGif(null);
    setError(null);
    setPendingVideo(file);
  }

  function insertEmoji(emoji: string) {
    setContent((prev) => prev + emoji);
    textareaRef.current?.focus();
  }

  // Handles an image pasted straight from the keyboard (Gboard's own
  // suggestion strip, or a plain copy-paste) — same reasoning as
  // post-composer.tsx's own handlePaste, routed through the identical
  // pickImage() the picker/camera buttons already use.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = e.clipboardData.files[0];
    if (!file) return;
    e.preventDefault();
    pickImage(file);
  }

  function appendDictatedText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setContent((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
    textareaRef.current?.focus();
  }

  function handleDeleted(messageId: string, mode: "me" | "everyone") {
    setMessages((prev) =>
      mode === "me"
        ? prev.filter((m) => m.id !== messageId)
        : prev.map((m) => (m.id === messageId ? { ...m, deletedForEveryoneAt: new Date() } : m)),
    );
  }

  function handleEdited(updated: MessageData) {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  function handleReacted(messageId: string, reactions: { emoji: string; userId: string }[]) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
  }

  function handleCorrected(messageId: string, corrections: CorrectionData[]) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, corrections } : m)));
  }

  const memberById = new Map(members.map((m) => [m.userId, m]));
  // "Delete for everyone" used to leave a "This message was deleted"
  // tombstone bubble in place — now it's fully invisible instead, same as
  // "delete for me" already was. The row itself stays in `messages` (the
  // server keeps a blanked-out record, and reply-quotes still point at it
  // via REPLY_TO_SELECT), it's just excluded from what actually renders.
  const visibleMessages = messages.filter((m) => !m.deletedForEveryoneAt);
  const lastMineIndex = isGroup ? visibleMessages.findLastIndex((m) => m.senderId === currentUserId) : -1;

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col">
      {!isGroup && <SecretChatBar secret={secret} peerName={conversationLabel} />}
      <div ref={messagesContainerRef} className="flex-1 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-background p-4">
        {visibleMessages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const prev = visibleMessages[i - 1];
          const showDateSeparator =
            !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped = Boolean(prev && prev.senderId === m.senderId && !showDateSeparator);
          const sender = isGroup && !mine && !grouped ? memberById.get(m.senderId) : undefined;
          const seenByNames =
            i === lastMineIndex
              ? members
                  .filter((mem) => mem.userId !== currentUserId && mem.lastReadAt && mem.lastReadAt >= m.createdAt)
                  .map((mem) => mem.name)
              : undefined;
          return (
            <div key={m.id}>
              {showDateSeparator && (
                <div className="my-4 flex items-center justify-center">
                  <span className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-foreground-soft">
                    {formatDaySeparator(m.createdAt)}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  "flex",
                  mine ? "justify-end" : "justify-start",
                  showDateSeparator ? "mt-1" : grouped ? "mt-0.5" : "mt-3",
                  justAddedIds.has(m.id) && "animate-message-in",
                )}
              >
                <MessageBubble
                  message={viewOf(m)}
                  secretActive={secret.active}
                  encryptForEdit={secret.encrypt}
                  mine={mine}
                  currentUserId={currentUserId}
                  sender={sender}
                  seenByNames={seenByNames}
                  onDeleted={handleDeleted}
                  onEdited={handleEdited}
                  onReacted={handleReacted}
                  onCorrected={handleCorrected}
                  onReply={setReplyTarget}
                />
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {isGroup
              ? "Say hello to the group!"
              : "Say hello — if you're not connected yet, this doubles as a connection request."}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {replyTarget && (
        // relative + z-[60] keeps this above the emoji picker's portaled
        // z-50 overlay, which can open upward far enough to otherwise cover
        // this banner when the composer sits near the bottom of a short
        // viewport (e.g. with the on-screen keyboard open) — losing sight of
        // who you're replying to, or the cancel button, mid-pick.
        <div className="relative z-[60] mt-3 flex items-center gap-2 rounded-lg border border-line border-l-2 border-l-accent bg-background px-3 py-2 text-xs">
          <Reply size={14} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-accent">
              Replying to {replyTarget.senderId === currentUserId ? "yourself" : (memberById.get(replyTarget.senderId)?.name ?? "them")}
            </p>
            <p className="truncate text-foreground-soft">{replyPreviewText(replyTarget)}</p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTarget(null)}
            aria-label="Cancel reply"
            className="p-2 -m-2 text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {pendingAudio && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Mic size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">Voice note ready to send</span>
          <button
            type="button"
            onClick={() => setPendingAudio(null)}
            aria-label="Remove voice note"
            className="p-2 -m-2 text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {pendingVideo && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Video size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">Video ready to send</span>
          <button
            type="button"
            onClick={() => setPendingVideo(null)}
            aria-label="Remove video"
            className="p-2 -m-2 text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {pendingImage && pendingImagePreviewUrl && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not an optimizable remote image */}
          <img src={pendingImagePreviewUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          <span className="flex-1 truncate">Photo ready to send</span>
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            aria-label="Remove photo"
            className="p-2 -m-2 text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {pendingGif && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted preview, not a local/optimizable asset */}
          <img src={pendingGif} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          <span className="flex-1 truncate">GIF ready to send</span>
          <button
            type="button"
            onClick={() => setPendingGif(null)}
            aria-label="Remove GIF"
            className="p-2 -m-2 text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <EmojiTypeSuggestions text={content} onSelect={insertEmoji} />

      {/* WhatsApp/Instagram-style composer: one continuous rounded pill
          holding text entry + emoji + attach, with circular icon-only
          action buttons (mic, send) outside it — not a bordered toolbar of
          equal-weight icon buttons next to a plain text "Send" button, the
          shape this replaced. */}
      <div className="mt-3 flex shrink-0 items-end gap-2">
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
          }}
        />
        {/* accept must include the literal "image/*" — Capacitor's own
            WebView file-chooser handler only routes a capture-enabled
            input to the native camera intent when
            acceptTypes.contains("image/*") is true; see avatar-upload.tsx's
            camera input for the full explanation. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={`${IMAGE_TYPES.join(",")},image/*`}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
          }}
        />
        <input
          ref={videoFileInputRef}
          type="file"
          accept={VIDEO_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickVideoFile(e.target.files?.[0]);
          }}
        />
        <div className="flex min-w-0 flex-1 items-end gap-1 rounded-3xl border border-line bg-background py-1 pl-2 pr-1">
          <EmojiPickerButton onSelect={insertEmoji} />
          <GifPickerButton
            onSelect={(gifUrl) => {
              setPendingAudio(null);
              setPendingVideo(null);
              setPendingImage(null);
              setPendingGif(gifUrl);
            }}
          />
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={handlePaste}
            maxLength={4000}
            rows={1}
            placeholder={
              pendingAudio || pendingVideo || pendingImage || pendingGif
                ? "Add a caption (optional)..."
                : `Message ${conversationLabel}...`
            }
            className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
          />
          <MediaPickerButton
            icon={<ImagePlus size={16} />}
            title="Add a photo"
            options={[
              {
                label: "Upload from device",
                icon: <Upload size={14} />,
                onSelect: () => {
                  if (isNativePickerActive()) return;
                  markNativePickerActive();
                  imageInputRef.current?.click();
                },
              },
              {
                label: "Take a photo",
                icon: <Camera size={14} />,
                onSelect: () => {
                  if (isNativePickerActive()) return;
                  markNativePickerActive();
                  cameraInputRef.current?.click();
                },
              },
            ]}
          />
          <MediaPickerButton
            icon={<Video size={16} />}
            title="Add a video"
            options={[
              {
                label: "Upload from device",
                icon: <Upload size={14} />,
                onSelect: () => {
                  if (isNativePickerActive()) return;
                  markNativePickerActive();
                  videoFileInputRef.current?.click();
                },
              },
              {
                label: "Record live",
                icon: <Circle size={14} className="text-danger" fill="currentColor" />,
                onSelect: () => {
                  setPendingAudio(null);
                  setPendingImage(null);
                  setShowVideoRecorder(true);
                },
              },
            ]}
          />
          <button
            type="button"
            onClick={() => setShowDictation(true)}
            disabled={showDictation}
            title="Dictate text"
            aria-label="Dictate text"
            className="rounded-lg p-1.5 text-foreground-soft hover:bg-line disabled:opacity-40"
          >
            <Mic size={16} />
          </button>
        </div>
        {/* One circular action button that toggles mic ↔ send, like both
            reference apps — not a mic button and a send button sitting
            side by side. Idle (nothing typed, nothing attached) always
            means "record a voice note"; anything typed or attached means
            "send". */}
        {content.trim() || pendingAudio || pendingVideo || pendingImage || pendingGif ? (
          <button
            type="button"
            disabled={isPending}
            onClick={handleSend}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
          >
            <Send size={17} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowAudioRecorder(true)}
            title="Record a voice note"
            aria-label="Record a voice note"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink"
          >
            <Mic size={18} />
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}

      {showDictation && (
        <DictationRecorder
          onTranscribed={appendDictatedText}
          onError={(code) => setError(dictationErrorMessage(code))}
          onDone={() => setShowDictation(false)}
        />
      )}

      {showAudioRecorder && (
        <AudioRecorderModal
          maxSeconds={MAX_AUDIO_NOTE_SECONDS}
          onClose={() => setShowAudioRecorder(false)}
          onRecorded={(file) => {
            setShowAudioRecorder(false);
            setPendingVideo(null);
            setPendingImage(null);
            setPendingGif(null);
            setPendingAudio(file);
          }}
        />
      )}
      {showVideoRecorder && (
        <VideoRecorderModal
          maxSeconds={MAX_VIDEO_NOTE_SECONDS}
          onClose={() => setShowVideoRecorder(false)}
          onRecorded={(file) => {
            setShowVideoRecorder(false);
            setPendingAudio(null);
            setPendingImage(null);
            setPendingGif(null);
            setPendingVideo(file);
          }}
        />
      )}
    </div>
  );
}
