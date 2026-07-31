"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, CheckCheck, MoreHorizontal } from "lucide-react";
import {
  sendMessage,
  getConversationMessages,
  deleteMessageForMe,
  deleteMessageForEveryone,
} from "@/app/actions/messages";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { isEmojiOnly } from "@/lib/emoji";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 3000;

type MessageData = {
  id: string;
  senderId: string;
  content: string;
  moderationStatus: "PUBLISHED" | "FLAGGED" | "REMOVED";
  deliveredAt: Date | null;
  readAt: Date | null;
  deletedForEveryoneAt: Date | null;
  createdAt: Date;
};

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

function MessageBubble({
  message,
  mine,
  onDeleted,
}: {
  message: MessageData;
  mine: boolean;
  onDeleted: (messageId: string, mode: "me" | "everyone") => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const deleted = Boolean(message.deletedForEveryoneAt);
  const bigEmoji = !deleted && message.moderationStatus === "PUBLISHED" && isEmojiOnly(message.content);

  return (
    <div className="group relative">
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
          mine ? "bg-accent text-accent-ink" : "bg-surface",
        )}
      >
        {deleted ? (
          <p className={cn("italic", mine ? "text-accent-ink/70" : "text-foreground-soft")}>
            This message was deleted
          </p>
        ) : (
          <p className={cn("whitespace-pre-wrap break-words", bigEmoji && "text-3xl leading-none")}>
            {message.moderationStatus === "PUBLISHED" ? message.content : "This message is under review."}
          </p>
        )}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            mine ? "text-accent-ink/70" : "text-foreground-soft",
          )}
        >
          <span>{formatTime(message.createdAt)}</span>
          {mine && <ReceiptIcon message={message} />}
        </div>
      </div>

      {!deleted && (
        <div className={cn("absolute top-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100", mine ? "-left-7" : "-right-7")}>
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
                mine ? "left-0" : "right-0",
              )}
            >
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
  otherUserName,
}: {
  conversationId: string;
  initialMessages: MessageData[];
  currentUserId: string;
  otherUserName: string;
}) {
  const [messages, setMessages] = useState<MessageData[]>(initialMessages);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const result = await getConversationMessages(conversationId);
      if (!cancelled && result.error === null) {
        setMessages(result.messages as MessageData[]);
      }
    };
    // Fire immediately on mount too — this is the real "mark as read"
    // signal (only ever runs in a live browser, never during SSR/prefetch),
    // not just the recurring poll.
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function handleSend() {
    const text = content.trim();
    if (!text || isPending) return;
    setContent("");
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("conversationId", conversationId);
      fd.set("content", text);
      const result = await sendMessage(fd);
      if (result.error) {
        setError(result.error === "rate_limited" ? "Slow down a little." : "Couldn't send that.");
        setContent(text);
        return;
      }
      if (result.message) {
        setMessages((prev) => [...prev, result.message as MessageData]);
      }
    });
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

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex-1 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-background p-4">
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const prev = messages[i - 1];
          const grouped = Boolean(prev && prev.senderId === m.senderId);
          return (
            <div
              key={m.id}
              className={cn("flex", mine ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-3")}
            >
              <MessageBubble message={m} mine={mine} onDeleted={handleDeleted} />
            </div>
          );
        })}
        {messages.length === 0 && (
          <p className="text-sm text-foreground-soft">
            Say hello — remember, you can only DM after both of you accepted
            the connection request.
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex items-end gap-2 rounded-xl border border-line p-2">
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
          placeholder={`Message ${otherUserName}...`}
          className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        <EmojiPickerButton onSelect={insertEmoji} />
        <button
          type="button"
          disabled={isPending || !content.trim()}
          onClick={handleSend}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
