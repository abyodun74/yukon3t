"use client";

import { useState } from "react";
import { Forward, X } from "lucide-react";
import { getShareableConversations, shareStoryToConversation } from "@/app/actions/stories";

/**
 * "Share" for a story — forwards it into one of the caller's own
 * conversations (DM or group), unlike StoryReplyBar which always replies
 * straight to the story's author. Tap-to-send, like a native share sheet:
 * no separate "confirm" step, since sending to more than one person just
 * means tapping more than one row before closing.
 */
export function StoryShareButton({
  storyId,
  onOpenChange,
}: {
  storyId: string;
  /** Lets the viewer pause its auto-advance timer while this sheet is open, same as its own viewers/comments panels do. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<{ value: string; label: string }[] | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    onOpenChange?.(false);
  }

  async function openSheet() {
    setOpen(true);
    onOpenChange?.(true);
    setError(null);
    if (conversations === null) {
      const result = await getShareableConversations();
      setConversations(result.conversations);
    }
  }

  async function send(conversationId: string) {
    setError(null);
    const result = await shareStoryToConversation(storyId, conversationId);
    if (result.error) {
      setError("Couldn't share that — try again.");
      return;
    }
    setSentTo((prev) => new Set(prev).add(conversationId));
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label="Share story"
        className="rounded-full bg-black/40 p-1.5 text-white transition-transform hover:bg-black/60 active:scale-90"
      >
        <Forward size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60" onClick={close}>
          <div
            className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-surface p-4 text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Share to</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg p-1 text-foreground-soft hover:bg-line"
              >
                <X size={16} />
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
            <ul className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
              {conversations === null && <li className="text-sm text-foreground-soft">Loading…</li>}
              {conversations?.length === 0 && (
                <li className="text-sm text-foreground-soft">
                  No conversations to share to yet — connect with someone first.
                </li>
              )}
              {conversations?.map((c) => {
                const sent = sentTo.has(c.value);
                return (
                  <li key={c.value}>
                    <button
                      type="button"
                      disabled={sent}
                      onClick={() => send(c.value)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-line disabled:opacity-60"
                    >
                      <span className="min-w-0 truncate">{c.label}</span>
                      {sent && <span className="shrink-0 text-xs text-accent">Sent</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
