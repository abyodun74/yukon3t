"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { searchDiscoverPeople, type DiscoverSearchItem } from "@/app/actions/discover";
import { respondToConnection } from "@/app/actions/connections";
import { ConnectButton } from "@/components/connect-button";
import { UserLink } from "@/components/user-link";
import { useFeedText } from "@/components/feed-text";
import { useShellText } from "@/components/ui-text";
import {
  DISCOVER_SEARCH_DEBOUNCE_MS,
  DISCOVER_SEARCH_MAX_RESULTS,
  normalizeDiscoverSearchQuery,
} from "@/lib/discover-search";

type Status = "idle" | "short" | "searching" | "done" | "failed" | "rate_limited";

function AcceptButton({ connectionId, onAccepted }: { connectionId: string; onAccepted: (conversationId: string | null) => void }) {
  const { t } = useFeedText();
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-foreground-soft">{t.peopleSearch.incoming}</span>
      <button
        data-guest-block
        type="button"
        disabled={isPending}
        onClick={() => {
          setFailed(false);
          startTransition(async () => {
            try {
              const result = await respondToConnection(connectionId, true);
              if (result.error) {
                setFailed(true);
                return;
              }
              onAccepted(result.conversationId ?? null);
            } catch {
              setFailed(true);
            }
          });
        }}
        className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-ink disabled:opacity-50"
      >
        {t.people.accept}
      </button>
      {failed && <span role="alert" className="text-xs text-danger">{t.peopleSearch.acceptFailed}</span>}
    </div>
  );
}

function ResultAction({ item, onAccepted }: { item: DiscoverSearchItem; onAccepted: (conversationId: string | null) => void }) {
  if (item.state === "incoming" && item.connectionId) {
    return <AcceptButton connectionId={item.connectionId} onAccepted={onAccepted} />;
  }
  return (
    <ConnectButton
      targetId={item.person.id}
      openToIntents={item.person.openToIntents}
      status={item.state === "connected" ? "ACCEPTED" : item.state === "requested" ? "PENDING" : null}
      isRequester={item.state === "requested"}
      conversationId={item.conversationId}
    />
  );
}

/**
 * Discover's title row with a search icon. The icon opens a box that searches people by name or @username as you
 * type (debounced, searchDiscoverPeople in actions/discover.ts), each result with its Connect / Request sent /
 * Accept / Connected control.
 */
export function DiscoverPeopleSearch({ title, intro }: { title: string; intro: string }) {
  const { t } = useFeedText();
  const { t: shell } = useShellText();
  const text = t.peopleSearch;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [items, setItems] = useState<DiscoverSearchItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest request may write results: an earlier, slower answer must not overwrite a later one.
  const requestRef = useRef(0);
  const queryRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function run(query: string, nextPage: number) {
    const id = ++requestRef.current;
    try {
      const result = await searchDiscoverPeople(query, nextPage);
      if (id !== requestRef.current) return;
      if (result.error === "rate_limited") {
        setStatus("rate_limited");
        return;
      }
      setItems((current) => (nextPage === 1 ? result.items : [...current, ...result.items]));
      setHasMore(result.hasMore);
      setPage(nextPage);
      setStatus("done");
    } catch {
      if (id === requestRef.current) setStatus("failed");
    } finally {
      if (id === requestRef.current) setLoadingMore(false);
    }
  }

  function handleChange(next: string) {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    requestRef.current++;
    setLoadingMore(false);
    const query = normalizeDiscoverSearchQuery(next);
    queryRef.current = query;
    if (!query) {
      setItems([]);
      setHasMore(false);
      setStatus(next.trim() ? "short" : "idle");
      return;
    }
    setStatus("searching");
    timerRef.current = setTimeout(() => void run(query, 1), DISCOVER_SEARCH_DEBOUNCE_MS);
  }

  function close() {
    handleChange("");
    setOpen(false);
  }

  function markAccepted(personId: string, conversationId: string | null) {
    setItems((current) =>
      current.map((item) =>
        item.person.id === personId ? { ...item, state: "connected", connectionId: null, conversationId } : item,
      ),
    );
  }

  const atCap = status === "done" && !hasMore && items.length >= DISCOVER_SEARCH_MAX_RESULTS;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <button
          data-guest-block
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls="discover-people-search"
          aria-label={open ? text.close : text.open}
          title={open ? text.close : text.open}
          className="rounded-full border border-line p-2 text-foreground-soft hover:border-accent hover:text-accent"
        >
          {open ? <X size={18} /> : <Search size={18} />}
        </button>
      </div>
      <p className="mt-1 text-sm text-foreground-soft">{intro}</p>

      {open && (
        <div id="discover-people-search" className="mt-4">
          <form
            data-guest-ok
            role="search"
            onSubmit={(e) => e.preventDefault()}
            className="relative w-full"
          >
            <Search
              size={14}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-foreground-soft"
            />
            <input
              ref={inputRef}
              dir="auto"
              type="search"
              value={value}
              maxLength={60}
              autoComplete="off"
              enterKeyHint="search"
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
              placeholder={text.placeholder}
              aria-label={text.label}
              className="w-full rounded-full border border-line bg-surface py-2 ps-8 pe-3 text-sm outline-none focus:border-accent"
            />
          </form>

          <div aria-live="polite" className="mt-3 text-sm text-foreground-soft">
            {status === "short" && <p>{text.keepTyping}</p>}
            {status === "searching" && <p className="animate-loading-pulse">{text.searching}</p>}
            {status === "done" && items.length === 0 && <p>{text.none}</p>}
            {status === "failed" && <p role="alert" className="text-danger">{text.failed}</p>}
            {status === "rate_limited" && <p role="alert" className="text-danger">{text.rateLimited}</p>}
          </div>

          {items.length > 0 && status !== "searching" && (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {items.map((item) => (
                <li key={item.person.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <UserLink
                    userId={item.person.id}
                    name={item.person.name}
                    username={item.person.username}
                    avatarUrl={item.person.avatarUrl}
                    avatarSize={36}
                    className="min-w-0 font-semibold"
                  />
                  <ResultAction item={item} onAccepted={(conversationId) => markAccepted(item.person.id, conversationId)} />
                </li>
              ))}
            </ul>
          )}

          {status === "done" && hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => {
                  const query = queryRef.current;
                  if (!query) return;
                  setLoadingMore(true);
                  void run(query, page + 1);
                }}
                className="rounded-md border border-line px-4 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {loadingMore ? shell.common.loadingMore : text.showMore}
              </button>
            </div>
          )}
          {atCap && <p className="mt-3 text-center text-xs text-foreground-soft">{text.refine}</p>}
        </div>
      )}
    </>
  );
}
