"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Camera, Check, CheckCheck, Circle, ImagePlus, Mic, MoreHorizontal, Upload, Video, X } from "lucide-react";
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
import { AudioRecorderModal } from "@/components/audio-recorder-modal";
import { VideoRecorderModal } from "@/components/video-recorder-modal";
import { MediaPickerButton } from "@/components/media-picker-button";
import { uploadFileDirect, captureVideoFrameFromFile } from "@/lib/upload-client";
import { isEmojiOnly } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;
// Kept in sync with storage.ts's MAX_AUDIO_NOTE_SECONDS/MAX_VIDEO_NOTE_SECONDS
// and MEDIA_LIMITS — duplicated locally rather than imported, since
// storage.ts pulls in the server-only @aws-sdk/client-s3 SDK and can't be
// bundled into a "use client" component (same pattern post-composer.tsx
// already uses for its own MAX_VIDEO_SECONDS).
const MAX_AUDIO_NOTE_SECONDS = 60;
const MAX_VIDEO_NOTE_SECONDS = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

type MessageMediaType = "NONE" | "AUDIO" | "VIDEO" | "IMAGE";

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
  lastReadAt: Date | null;
};

const SEEN_BY_NAME_LIMIT = 3;

function seenByLabel(names: string[]) {
  if (names.length === 0) return "Sent";
  const shown = names.slice(0, SEEN_BY_NAME_LIMIT).join(", ");
  const rest = names.length - SEEN_BY_NAME_LIMIT;
  return `Seen by ${shown}${rest > 0 ? ` +${rest} more` : ""}`;
}

function ReceiptIcon({ message }: { message: MessageData }) {
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

function ReactionBar({
  reactions,
  currentUserId,
  mine,
  onToggle,
}: {
  reactions: { emoji: string; userId: string }[];
  currentUserId: string;
  mine: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;

  const grouped = new Map<string, string[]>();
  for (const r of reactions) {
    grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId]);
  }

  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
      {[...grouped.entries()].map(([emoji, userIds]) => {
        const mineReacted = userIds.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
              mineReacted ? "border-accent bg-accent/10" : "border-line bg-surface hover:bg-line",
            )}
          >
            <span>{emoji}</span>
            {userIds.length > 1 && <span className="text-[10px] text-foreground-soft">{userIds.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

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
          className="max-w-[min(75vw,26rem)] rounded-lg border border-line bg-surface px-2 py-1 text-xs"
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
  senderName,
  seenByNames,
  onDeleted,
  onEdited,
  onReacted,
  onCorrected,
}: {
  message: MessageData;
  mine: boolean;
  currentUserId: string;
  /** Group chats only: the sender's name, shown above the bubble for non-own messages not grouped with the previous one. */
  senderName?: string;
  /** Group chats only: passed for the sender's own most recent message, to render "Seen by ..." in place of the DM checkmark. */
  seenByNames?: string[];
  onDeleted: (messageId: string, mode: "me" | "everyone") => void;
  onEdited: (message: MessageData) => void;
  onReacted: (messageId: string, reactions: { emoji: string; userId: string }[]) => void;
  onCorrected: (messageId: string, corrections: CorrectionData[]) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [editError, setEditError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deleted = Boolean(message.deletedForEveryoneAt);
  const bigEmoji = !deleted && !editing && message.moderationStatus === "PUBLISHED" && isEmojiOnly(message.content);
  const myCorrection = message.corrections.find((c) => c.authorId === currentUserId);

  function toggleReaction(emoji: string) {
    startTransition(async () => {
      const result = await toggleMessageReaction(message.id, emoji);
      if (!result.error) onReacted(message.id, result.reactions);
    });
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
    startTransition(async () => {
      const fd = new FormData();
      fd.set("content", text);
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
      <div className="min-w-0">
        {senderName && (
          <p className="mb-0.5 px-1 text-xs font-medium text-foreground-soft">{senderName}</p>
        )}
        <div
          className={cn(
            "max-w-[min(75vw,26rem)] rounded-2xl px-3 py-2 text-sm",
            mine ? "bg-accent text-accent-ink" : "bg-surface",
          )}
        >
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
                // eslint-disable-next-line @next/next/no-img-element -- R2-hosted user upload, not a local/optimizable asset
                <img
                  src={message.mediaUrl}
                  alt=""
                  className="max-h-72 w-full rounded-lg object-contain"
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
            <span>{formatTime(message.createdAt)}</span>
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
          <div className="mt-1 max-w-[min(75vw,26rem)] rounded-lg border border-line bg-surface p-2">
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
          reactions={message.reactions}
          currentUserId={currentUserId}
          mine={mine}
          onToggle={toggleReaction}
        />
      </div>

      {!deleted && !editing && (
        <div className="relative flex shrink-0 items-center pb-1">
          <EmojiPickerButton onSelect={toggleReaction} />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Message options"
            className="rounded-full p-1 text-foreground-soft hover:bg-line"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              className={cn(
                "absolute top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-line bg-surface shadow-lg",
                mine ? "right-0" : "left-0",
              )}
            >
              {!mine && (
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
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
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

  // usePolling fires this immediately (mount, and on regaining tab focus)
  // as well as on the recurring interval — that immediate fire is the real
  // "mark as read" signal, not just a bonus of the polling mechanism.
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  });

  const poll = useCallback(async () => {
    const forId = conversationIdRef.current;
    const result = await getConversationMessages(forId);
    // Ignore a response that arrives after the user has switched threads.
    if (conversationIdRef.current !== forId || result.error !== null) return;
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

  usePolling(poll, POLL_INTERVAL_MS);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function uploadPendingMedia(): Promise<
    | { error: string }
    | { mediaType: "NONE" }
    | { mediaType: "AUDIO"; mediaUrl: string }
    | { mediaType: "VIDEO"; mediaUrl: string; mediaThumbnailUrl?: string }
    | { mediaType: "IMAGE"; mediaUrl: string }
  > {
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

  function handleSend() {
    const text = content.trim();
    if (!text && !pendingAudio && !pendingVideo && !pendingImage) return;
    if (isPending) return;
    const audio = pendingAudio;
    const video = pendingVideo;
    const image = pendingImage;
    setContent("");
    setPendingAudio(null);
    setPendingVideo(null);
    setPendingImage(null);
    setError(null);
    startTransition(async () => {
      const media = await uploadPendingMedia();
      if ("error" in media) {
        setError("Couldn't send that.");
        setContent(text);
        setPendingAudio(audio);
        setPendingVideo(video);
        setPendingImage(image);
        return;
      }
      const fd = new FormData();
      fd.set("conversationId", conversationId);
      fd.set("content", text);
      fd.set("mediaType", media.mediaType);
      if (media.mediaType !== "NONE") fd.set("mediaUrl", media.mediaUrl);
      if (media.mediaType === "VIDEO" && media.mediaThumbnailUrl) {
        fd.set("mediaThumbnailUrl", media.mediaThumbnailUrl);
      }
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
        return;
      }
      if (result.error) {
        setError(result.error === "rate_limited" ? "Slow down a little." : "Couldn't send that.");
        setContent(text);
        setPendingAudio(audio);
        setPendingVideo(video);
        setPendingImage(image);
        return;
      }
      if (result.message) {
        setMessages((prev) => [...prev, result.message as MessageData]);
      }
    });
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Images must be 8MB or smaller.");
      return;
    }
    setPendingAudio(null);
    setPendingVideo(null);
    setError(null);
    setPendingImage(file);
  }

  function pickVideoFile(file: File | undefined) {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) {
      setError("Use an MP4 or WebM video.");
      return;
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError("Video must be 15MB or smaller.");
      return;
    }
    setPendingAudio(null);
    setPendingImage(null);
    setError(null);
    setPendingVideo(file);
  }

  function insertEmoji(emoji: string) {
    setContent((prev) => prev + emoji);
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

  const memberNameById = new Map(members.map((m) => [m.userId, m.name]));
  const lastMineIndex = isGroup ? messages.findLastIndex((m) => m.senderId === currentUserId) : -1;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex-1 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-background p-4">
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const prev = messages[i - 1];
          const grouped = Boolean(prev && prev.senderId === m.senderId);
          const senderName =
            isGroup && !mine && !grouped ? (memberNameById.get(m.senderId) ?? "Unknown") : undefined;
          const seenByNames =
            i === lastMineIndex
              ? members
                  .filter((mem) => mem.userId !== currentUserId && mem.lastReadAt && mem.lastReadAt >= m.createdAt)
                  .map((mem) => mem.name)
              : undefined;
          return (
            <div
              key={m.id}
              className={cn("flex", mine ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-3")}
            >
              <MessageBubble
                message={m}
                mine={mine}
                currentUserId={currentUserId}
                senderName={senderName}
                seenByNames={seenByNames}
                onDeleted={handleDeleted}
                onEdited={handleEdited}
                onReacted={handleReacted}
                onCorrected={handleCorrected}
              />
            </div>
          );
        })}
        {messages.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {isGroup
              ? "Say hello to the group!"
              : "Say hello — remember, you can only DM after both of you accepted the connection request."}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {pendingAudio && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Mic size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">Voice note ready to send</span>
          <button type="button" onClick={() => setPendingAudio(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}
      {pendingVideo && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Video size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">Video ready to send</span>
          <button type="button" onClick={() => setPendingVideo(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}
      {pendingImage && pendingImagePreviewUrl && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not an optimizable remote image */}
          <img src={pendingImagePreviewUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          <span className="flex-1 truncate">Photo ready to send</span>
          <button type="button" onClick={() => setPendingImage(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="mt-3 flex items-end gap-2 rounded-xl border border-line p-2">
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          capture="environment"
          className="hidden"
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <input
          ref={videoFileInputRef}
          type="file"
          accept={VIDEO_TYPES.join(",")}
          className="hidden"
          onChange={(e) => pickVideoFile(e.target.files?.[0])}
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
          maxLength={4000}
          rows={1}
          placeholder={
            pendingAudio || pendingVideo || pendingImage
              ? "Add a caption (optional)..."
              : `Message ${conversationLabel}...`
          }
          className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setPendingVideo(null);
            setPendingImage(null);
            setShowAudioRecorder(true);
          }}
          title="Record a voice note"
          className="shrink-0 rounded-lg p-1.5 text-foreground-soft hover:bg-line"
        >
          <Mic size={16} />
        </button>
        <MediaPickerButton
          icon={<ImagePlus size={16} />}
          title="Add a photo"
          options={[
            {
              label: "Upload from device",
              icon: <Upload size={14} />,
              onSelect: () => imageInputRef.current?.click(),
            },
            {
              label: "Take a photo",
              icon: <Camera size={14} />,
              onSelect: () => cameraInputRef.current?.click(),
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
              onSelect: () => videoFileInputRef.current?.click(),
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
        <EmojiPickerButton onSelect={insertEmoji} />
        <button
          type="button"
          disabled={isPending || (!content.trim() && !pendingAudio && !pendingVideo && !pendingImage)}
          onClick={handleSend}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}

      {showAudioRecorder && (
        <AudioRecorderModal
          maxSeconds={MAX_AUDIO_NOTE_SECONDS}
          onClose={() => setShowAudioRecorder(false)}
          onRecorded={(file) => {
            setShowAudioRecorder(false);
            setPendingVideo(null);
            setPendingImage(null);
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
            setPendingVideo(file);
          }}
        />
      )}
    </div>
  );
}
