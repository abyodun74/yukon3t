"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link as LinkIcon, Send, Share as ShareIcon, UserPlus } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { Skeleton } from "@/components/skeleton";
import { SendToChatsPicker } from "@/components/send-to-chats-picker";
import { useCircleShareText } from "@/components/circle-share-text";
import { getMyConversationsForShare } from "@/app/actions/messages";
import { shareCircleToConversations } from "@/app/actions/share-to-chats";
import { canShareNatively, shareNative } from "@/lib/native-share";
import { announce } from "@/lib/announce";
import { circleShareUrl, isCircleShareable } from "@/lib/circle-share";

/** What the sheet needs of a Circle: nothing a viewer of the card can't already see. */
export type ShareableCircle = {
  id: string;
  slug: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
};

type Conversation = { id: string; label: string; avatarUrl: string | null; username: string | null };
type View = "root" | "chats";

function RowSkeletons() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="h-[26px] w-[26px] rounded-full" />
          <Skeleton className="h-3 w-32" />
        </li>
      ))}
    </>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one sheet for sharing a Circle, opened by a long press / right-click / ContextMenu key on any Circle card
 * (CircleLongPress) and by the Share button on a Circle's page (CircleShareButton).
 *
 * PUBLIC Circle: "Share in chats" (SendToChatsPicker, up to 5 chats; the server writes the message, see
 * shareCircleToConversations), "Share via…" (the OS share sheet, or a copied link where there is none) and "Copy
 * link". PRIVATE Circle: no share action at all (invite-only, see src/lib/circle-share.ts), just that explanation and,
 * for someone who can invite, a link to the Invite section of its page. The server refuses a private Circle anyway.
 */
export function CircleShareSheet({
  circle,
  canInvite = false,
  open,
  onClose,
}: {
  circle: ShareableCircle;
  /** The viewer is the Circle's owner or co-admin (the Invite flow is theirs). Only changes the private hint. */
  canInvite?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t, locale, dir } = useCircleShareText();
  const [view, setView] = useState<View>("root");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setView("root");
  }
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareable = isCircleShareable(circle);
  const url = circleShareUrl(circle.slug);

  useEffect(() => {
    if (!open || view !== "chats" || conversations !== null) return;
    let live = true;
    getMyConversationsForShare()
      .then((r) => {
        if (live) setConversations(r.conversations ?? []);
      })
      .catch(() => {
        if (live) setConversations([]);
      });
    return () => {
      live = false;
    };
  }, [open, view, conversations]);

  function say(message: string) {
    setStatus(message);
    announce(message);
  }

  async function copyLink() {
    say((await copyText(url)) ? t.linkCopied : t.copyFailed);
  }

  async function shareVia() {
    if (sharing) return;
    setStatus(null);
    if (canShareNatively()) {
      setSharing(true);
      try {
        const result = await shareNative({ url, text: circle.name });
        if (result.warning) say(result.warning);
      } finally {
        setSharing(false);
      }
      return;
    }
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ url, text: circle.name });
      } catch {
        // Dismissed, or refused by the browser: nothing to report.
      }
      return;
    }
    // No share sheet on this device: the link goes on the clipboard instead, and says so.
    await copyLink();
  }

  async function sendToChats(conversationIds: string[]) {
    const result = await shareCircleToConversations(circle.id, conversationIds);
    if (result.error === "invalid") return { error: "unavailable", message: t.unavailable };
    if (result.error) return { error: result.error };
    return { sent: result.sent, failed: result.failed };
  }

  const itemClass =
    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start text-sm hover:bg-line/60 disabled:opacity-50";

  return (
    <Sheet open={open} onClose={onClose} title={view === "chats" ? t.inChats : t.title} lang={locale} dir={dir}>
      <p dir="auto" className="mt-1 truncate text-sm font-medium text-foreground-soft">
        {circle.name}
      </p>

      {!shareable && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-foreground-soft">{t.privateHint}</p>
          {canInvite && (
            <>
              <p className="text-foreground-soft">{t.privateInviteHint}</p>
              <Link
                href={`/circles/${encodeURIComponent(circle.slug)}#circle-invites`}
                onClick={onClose}
                className={itemClass}
              >
                <UserPlus size={16} aria-hidden />
                {t.invite}
              </Link>
            </>
          )}
        </div>
      )}

      {shareable && view === "root" && (
        <div className="mt-3 space-y-1">
          <button type="button" onClick={() => setView("chats")} className={itemClass}>
            <Send size={16} aria-hidden />
            {t.inChats}
          </button>
          <button type="button" onClick={shareVia} disabled={sharing} className={itemClass}>
            <ShareIcon size={16} aria-hidden />
            {t.via}
          </button>
          <button type="button" onClick={copyLink} className={itemClass}>
            <LinkIcon size={16} aria-hidden />
            {t.copyLink}
          </button>
          <p className="min-h-4 px-2 text-xs text-foreground-soft" aria-live="polite">
            {status}
          </p>
        </div>
      )}

      {shareable && view === "chats" && (
        <>
          <SendToChatsPicker
            items={conversations}
            getKey={(c) => c.id}
            getName={(c) => c.label}
            getUsername={(c) => c.username}
            getAvatarUrl={(c) => c.avatarUrl}
            loading={<RowSkeletons />}
            texts={{ search: t.searchChats, clear: t.clearSearch, noMatch: t.noChatMatch, empty: t.noChats }}
            onSend={sendToChats}
            onSent={({ failed }) => {
              if (failed === 0) setTimeout(onClose, 1200);
            }}
          />
          <button
            type="button"
            onClick={() => setView("root")}
            className="mt-3 text-xs text-foreground-soft hover:text-accent"
          >
            {`${dir === "rtl" ? "→" : "←"} ${t.back}`}
          </button>
        </>
      )}
    </Sheet>
  );
}
