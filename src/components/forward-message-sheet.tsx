"use client";

import { useEffect, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { Skeleton } from "@/components/skeleton";
import { UserAvatar } from "@/components/user-link";
import { FriendSearchList } from "@/components/friend-search-list";
import { forwardMessage, getForwardTargets } from "@/app/actions/messages";
import { FORWARD_MAX_RECIPIENTS } from "@/lib/message-forward";
import { useMessagesText } from "@/components/messages-text";
import { announce } from "@/lib/announce";
import { byCode, format, plural } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

type Target = { id: string; isGroup: boolean; label: string | null; avatarUrl: string | null; username: string | null };

/**
 * "Forward" from a chat bubble's menu: pick up to FORWARD_MAX_RECIPIENTS of your chats (the shared friend search) and
 * send. Only the message id and the picked chat ids go to the server (forwardMessage), never the text. Mounted by
 * ChatThread once per thread, for whichever message is being forwarded.
 */
export function ForwardMessageSheet({
  messageId,
  open,
  onClose,
  onHiddenLocked,
}: {
  messageId: string | null;
  open: boolean;
  onClose: () => void;
  /** The source chat is hidden and its PIN unlock just ran out. */
  onHiddenLocked: () => void;
}) {
  const { locale, t: messages } = useMessagesText();
  const t = messages.thread.forward;
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // A reopened sheet starts clean (adjusted during render, as share-modal.tsx does), and re-reads the chat list.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected([]);
      setError(null);
      setDone(null);
      setTargets(null);
      setLoadError(false);
    }
  }

  useEffect(() => {
    if (!open || targets !== null || loadError) return;
    let cancelled = false;
    getForwardTargets()
      .then((r) => {
        if (cancelled) return;
        if (r.error) setLoadError(true);
        else setTargets(r.targets);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, targets, loadError]);

  const full = selected.length >= FORWARD_MAX_RECIPIENTS;

  function labelOf(target: Target) {
    return target.label ?? (target.isGroup ? messages.fallback.group : messages.fallback.unknown);
  }

  function toggle(id: string) {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= FORWARD_MAX_RECIPIENTS) return prev;
      return [...prev, id];
    });
  }

  function send() {
    if (!messageId || selected.length === 0 || isPending || done) return;
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof forwardMessage>>;
      try {
        result = await forwardMessage(messageId, selected);
      } catch {
        setError(t.errors.other);
        return;
      }
      if (result.error === "hidden_locked") {
        onClose();
        onHiddenLocked();
        return;
      }
      if (result.error) {
        setError(byCode(t.errors, result.error));
        return;
      }
      const line = [
        plural(locale, t.sent, result.sent),
        ...(result.failed > 0 ? [plural(locale, t.partial, result.failed)] : []),
      ].join(". ");
      setDone(line);
      announce(line);
      if (result.failed === 0) setTimeout(onClose, 1200);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" responsive title={t.title} panelClassName="sm:max-w-sm">
      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {t.errors.load}
        </p>
      ) : (
        <FriendSearchList
          items={targets}
          getKey={(c) => c.id}
          getName={labelOf}
          getUsername={(c) => c.username}
          listClassName="max-h-64"
          loading={
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-2">
                  <Skeleton className="h-[26px] w-[26px] rounded-full" />
                  <Skeleton className="h-3 w-32" />
                </li>
              ))}
            </>
          }
          texts={{ search: t.search, clear: t.clear, noMatch: t.noMatch, empty: t.empty }}
          renderItem={(c) => {
            const checked = selected.includes(c.id);
            return (
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={Boolean(done) || (!checked && full)}
                onClick={() => toggle(c.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-line/60 disabled:opacity-50"
              >
                <UserAvatar avatarUrl={c.avatarUrl} name={labelOf(c)} size={26} />
                <span dir="auto" className="min-w-0 flex-1 truncate">
                  {labelOf(c)}
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
      )}
      <div className="mt-3 flex items-center gap-3">
        <p className="me-auto text-xs text-foreground-soft" aria-live="polite">
          {full && !done
            ? format(t.limit, { max: FORWARD_MAX_RECIPIENTS })
            : format(t.selected, { count: selected.length, max: FORWARD_MAX_RECIPIENTS })}
        </p>
        <button
          type="button"
          onClick={send}
          disabled={selected.length === 0 || isPending || Boolean(done) || !messageId}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {isPending ? t.sending : t.send}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="mt-2 text-sm text-success">
          {done}
        </p>
      )}
    </Sheet>
  );
}
