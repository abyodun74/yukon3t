"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Forward, X } from "lucide-react";
import { getShareableConversations, shareStoryToConversations } from "@/app/actions/stories";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useFeedText } from "@/components/feed-text";
import { useShellText } from "@/components/ui-text";
import { SendToChatsPicker } from "@/components/send-to-chats-picker";

/**
 * "Share" for a story: sends it into up to SHARE_MAX_RECIPIENTS of the caller's own conversations (DMs or groups) at
 * once, unlike StoryReplyBar which always replies straight to the story's author. Tick the chats, then Send
 * (SendToChatsPicker, the same interaction as forwarding a chat message).
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
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<{ value: string; label: string; username: string | null }[] | null>(null);
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
    setOpen(true);
    onOpenChange?.(true);
    if (conversations === null) {
      const result = await getShareableConversations();
      setConversations(result.conversations);
    }
  }

  async function send(conversationIds: string[]) {
    const result = await shareStoryToConversations(storyId, conversationIds);
    if (result.error) {
      // An expired story (or one whose author is now blocked) reads as a plain "couldn't share"; the picker words the rest.
      return { error: result.error, message: result.error === "not_found" ? t.stories.shareSheet.failed : undefined };
    }
    return { sent: result.sent, failed: result.failed };
  }

  const dialogRef = useDialogFocus<HTMLDivElement>(open, close);

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label={t.stories.shareSheet.button}
        className="rounded-full bg-black/40 p-1.5 text-white transition-transform hover:bg-black/60 active:scale-90"
      >
        <Forward size={16} />
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 outline-none"
          onClick={close}
        >
          <div
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p id={titleId} className="text-sm font-semibold">{t.stories.shareSheet.title}</p>
              <button
                type="button"
                onClick={close}
                aria-label={shell.common.close}
                className="rounded-lg p-1 text-foreground-soft hover:bg-line"
              >
                <X size={16} />
              </button>
            </div>
            <SendToChatsPicker
              items={conversations}
              getKey={(c) => c.value}
              getName={(c) => c.label}
              getUsername={(c) => c.username}
              listClassName="max-h-[45dvh]"
              loading={<li className="text-sm text-foreground-soft">{shell.common.loading}</li>}
              texts={{
                search: t.stories.shareSheet.searchFriends,
                clear: t.stories.shareSheet.clearSearch,
                noMatch: t.stories.shareSheet.noFriendMatch,
                empty: t.stories.shareSheet.empty,
              }}
              onSend={send}
              onSent={({ failed }) => {
                if (failed === 0) setTimeout(close, 1200);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
