"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Link as LinkIcon, Send, Share as ShareIcon } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { Skeleton } from "@/components/skeleton";
import { SendToChatsPicker, type SendToChatsOutcome } from "@/components/send-to-chats-picker";
import { getMyConversationsForShare } from "@/app/actions/messages";
import { canShareNatively, shareNative } from "@/lib/native-share";
import { announce } from "@/lib/announce";
import type { Locale } from "@/lib/i18n/locales";

/** The wording the generic sheet needs; each area's dictionary (circleShare, collabShare) supplies it. */
export type ShareLinkSheetText = {
  title: string;
  inChats: string;
  via: string;
  copyLink: string;
  linkCopied: string;
  copyFailed: string;
  back: string;
  searchChats: string;
  clearSearch: string;
  noChatMatch: string;
  noChats: string;
  unavailable: string;
};

/** What the server action behind "Share in chats" answers (counts only). */
export type ShareToChatsAnswer = { error: string } | { error: null; sent: number; failed: number };

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

/** The row style the sheets use for their actions (also for the "Invite people" link of a private item). */
export const SHARE_SHEET_ITEM_CLASS =
  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start text-sm hover:bg-line/60 disabled:opacity-50";

/**
 * The one sheet for sharing a link to a page of the app (a Circle: circle-share-sheet.tsx; a Collab:
 * collab-share-sheet.tsx). Shareable: "Share in chats" (SendToChatsPicker, up to 5 chats; the server writes the
 * message, `sendToChats` is the area's server action), "Share via…" (the OS share sheet, or a copied link where there
 * is none) and "Copy link" (`url`, always the canonical https://yukon3t.com link). Not shareable: only `notShareable`
 * (the area's explanation, e.g. invite-only). The server refuses a non-shareable item anyway.
 */
export function ShareLinkSheet({
  open,
  onClose,
  name,
  url,
  shareable,
  notShareable,
  text: t,
  locale,
  dir,
  sendToChats,
}: {
  open: boolean;
  onClose: () => void;
  /** Shown under the title and passed as the share text: the item's name/title, nothing else. */
  name: string;
  url: string;
  shareable: boolean;
  notShareable: ReactNode;
  text: ShareLinkSheetText;
  locale: Locale;
  dir: "ltr" | "rtl";
  sendToChats: (conversationIds: string[]) => Promise<ShareToChatsAnswer>;
}) {
  const [view, setView] = useState<View>("root");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setView("root");
  }
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

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
        const result = await shareNative({ url, text: name });
        if (result.warning) say(result.warning);
      } finally {
        setSharing(false);
      }
      return;
    }
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ url, text: name });
      } catch {
        // Dismissed, or refused by the browser: nothing to report.
      }
      return;
    }
    // No share sheet on this device: the link goes on the clipboard instead, and says so.
    await copyLink();
  }

  async function onSend(conversationIds: string[]): Promise<SendToChatsOutcome> {
    const result = await sendToChats(conversationIds);
    if (result.error === "invalid") return { error: "unavailable", message: t.unavailable };
    if (result.error !== null) return { error: result.error };
    return { sent: result.sent, failed: result.failed };
  }

  return (
    <Sheet open={open} onClose={onClose} title={view === "chats" ? t.inChats : t.title} lang={locale} dir={dir}>
      <p dir="auto" className="mt-1 truncate text-sm font-medium text-foreground-soft">
        {name}
      </p>

      {!shareable && <div className="mt-3 space-y-2 text-sm">{notShareable}</div>}

      {shareable && view === "root" && (
        <div className="mt-3 space-y-1">
          <button type="button" onClick={() => setView("chats")} className={SHARE_SHEET_ITEM_CLASS}>
            <Send size={16} aria-hidden />
            {t.inChats}
          </button>
          <button type="button" onClick={shareVia} disabled={sharing} className={SHARE_SHEET_ITEM_CLASS}>
            <ShareIcon size={16} aria-hidden />
            {t.via}
          </button>
          <button type="button" onClick={copyLink} className={SHARE_SHEET_ITEM_CLASS}>
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
            onSend={onSend}
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
