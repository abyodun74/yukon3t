"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { FriendSearchList, type FriendSearchTexts } from "@/components/friend-search-list";
import { UserAvatar } from "@/components/user-link";
import { useUiText } from "@/components/ui-text";
import { announce } from "@/lib/announce";
import { byCode, format, plural } from "@/lib/i18n/locales";
import { SHARE_MAX_RECIPIENTS, toggleShareSelection } from "@/lib/share-to-chats";
import { cn } from "@/lib/utils";

/** What the sheet's send answered: counts, or an error code (and optionally the sheet's own wording for it). */
export type SendToChatsOutcome = { sent: number; failed: number } | { error: string; message?: string };

/**
 * The "Send to a friend" step of the share sheets (post, Muse, Story, sharing in from another app): tick up to
 * SHARE_MAX_RECIPIENTS chats in the shared friend search, then Send once. The same interaction as forwarding a chat
 * message (forward-message-sheet.tsx): a tick per row (role="checkbox"), "N of 5 selected", a notice when full, one
 * Send button, then "Sent to N chats" / "Couldn't send to M chats".
 *
 * - Selection lives here, so it is gone whenever the picker unmounts (Back, closing the sheet); the search only
 *   filters what is shown, so a ticked chat stays ticked while it is filtered out.
 * - Send is disabled until something is ticked, and while sending (a ref, not just state, drops a second tap).
 * - Once something was sent the rows and Send stay disabled; `onSent` decides what the sheet does next.
 */
export function SendToChatsPicker<T>({
  items,
  getKey,
  getName,
  getUsername,
  getAvatarUrl,
  loading,
  texts,
  listClassName,
  onSend,
  onSent,
  disabled = false,
}: {
  /** null while loading. */
  items: readonly T[] | null;
  getKey: (item: T) => string;
  getName: (item: T) => string;
  getUsername?: (item: T) => string | null | undefined;
  getAvatarUrl?: (item: T) => string | null | undefined;
  loading: ReactNode;
  texts: FriendSearchTexts;
  listClassName?: string;
  /** Sends to the ticked chats (1 to SHARE_MAX_RECIPIENTS ids, in the order ticked). Must not throw for a refusal. */
  onSend: (conversationIds: string[]) => Promise<SendToChatsOutcome>;
  /** After a send that reached at least one chat. */
  onSent?: (result: { sent: number; failed: number; conversationIds: string[] }) => void;
  /** Locks the picker from outside (e.g. an upload the sheet is running). */
  disabled?: boolean;
}) {
  const { locale, dir, t: ui } = useUiText();
  const t = ui.sendToChats;
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const full = selected.length >= SHARE_MAX_RECIPIENTS;
  const locked = disabled || sending || done !== null;

  function toggle(id: string) {
    if (locked) return;
    setError(null);
    setSelected((prev) => toggleShareSelection(prev, id));
  }

  async function send() {
    if (sendingRef.current || selected.length === 0 || locked) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const ids = [...selected];
    let result: SendToChatsOutcome;
    try {
      result = await onSend(ids);
    } catch {
      result = { error: "other" };
    }
    sendingRef.current = false;
    setSending(false);
    if ("error" in result) {
      setError(result.message ?? byCode(t.errors, result.error));
      return;
    }
    const line = [
      plural(locale, t.sent, result.sent),
      ...(result.failed > 0 ? [plural(locale, t.partial, result.failed)] : []),
    ].join(". ");
    setDone(line);
    announce(line);
    onSent?.({ sent: result.sent, failed: result.failed, conversationIds: ids });
  }

  return (
    <>
      <FriendSearchList
        items={items}
        getKey={getKey}
        getName={getName}
        getUsername={getUsername}
        listClassName={listClassName}
        loading={loading}
        texts={texts}
        renderItem={(item) => {
          const id = getKey(item);
          const checked = selected.includes(id);
          const name = getName(item);
          return (
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              disabled={locked || (!checked && full)}
              onClick={() => toggle(id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-line/60 disabled:opacity-50"
            >
              <UserAvatar avatarUrl={getAvatarUrl?.(item) ?? null} name={name} size={26} />
              <span dir="auto" className="min-w-0 flex-1 truncate">
                {name}
              </span>
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-accent bg-accent text-accent-ink" : "border-line",
                )}
              >
                {checked && <Check size={12} />}
              </span>
            </button>
          );
        }}
      />
      <div lang={locale} dir={dir} className="mt-3 flex items-center gap-3">
        <p className="me-auto text-xs text-foreground-soft" aria-live="polite">
          {full && !done
            ? format(t.limit, { max: SHARE_MAX_RECIPIENTS })
            : format(t.selected, { count: selected.length, max: SHARE_MAX_RECIPIENTS })}
        </p>
        <button
          type="button"
          onClick={send}
          disabled={selected.length === 0 || locked}
          className="shrink-0 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {sending ? t.sending : t.send}
        </button>
      </div>
      {error && (
        <p lang={locale} dir={dir} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {done && (
        <p lang={locale} dir={dir} role="status" className="mt-2 text-sm text-success">
          {done}
        </p>
      )}
    </>
  );
}
