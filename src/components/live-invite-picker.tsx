"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { searchLiveInvitees, type LiveInviteCandidate } from "@/app/actions/live-stream-invites";
import { UserAvatar } from "@/components/user-link";
import { useLiveText } from "@/components/live-text";
import { DISCOVER_SEARCH_DEBOUNCE_MS, normalizeDiscoverSearchQuery } from "@/lib/discover-search";
import { format, plural } from "@/lib/i18n/locales";

type Status = "idle" | "short" | "searching" | "done" | "failed" | "rate_limited";

/** Where the people searched will be invited: a stream being run, or the Go live sheet's chosen audience. */
export type LiveInviteContext = { liveStreamId: string } | { circleId?: string; targetUserId?: string };

/**
 * Pick several people to invite onto a live's stage: a search box (debounced, searchLiveInvitees: the same query
 * rules and limits as Discover people search, filtered on the server for blocks, privacy, the stream's audience and
 * who's already on stage or invited) and the people picked so far as removable chips. Shared by the Go live sheet and
 * the in-room Invite sheet. Keyboard: arrow keys move from the box through the results, Enter or Space picks, Escape
 * clears the box; the picked count and search state are announced politely.
 */
export function LiveInvitePicker({
  context,
  selected,
  onChange,
  max,
}: {
  context: LiveInviteContext;
  selected: LiveInviteCandidate[];
  onChange: (next: LiveInviteCandidate[]) => void;
  max: number;
}) {
  const { locale, t: live } = useLiveText();
  const t = live.invite;
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [items, setItems] = useState<LiveInviteCandidate[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const contextKey = JSON.stringify(context);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // A different audience (the Go live sheet's "Who can watch") changes who may be invited: start the search over.
  const lastContextRef = useRef(contextKey);
  useEffect(() => {
    if (lastContextRef.current === contextKey) return;
    lastContextRef.current = contextKey;
    requestRef.current++;
    if (timerRef.current) clearTimeout(timerRef.current);
    const query = normalizeDiscoverSearchQuery(value);
    if (!query) return;
    timerRef.current = setTimeout(() => void run(query), DISCOVER_SEARCH_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  async function run(query: string) {
    const id = ++requestRef.current;
    try {
      const result = await searchLiveInvitees(query, context);
      if (id !== requestRef.current) return;
      if (result.error === "rate_limited") {
        setStatus("rate_limited");
        return;
      }
      if (result.error) {
        setStatus("failed");
        return;
      }
      setItems(result.items);
      setStatus("done");
    } catch {
      if (id === requestRef.current) setStatus("failed");
    }
  }

  function handleChange(next: string) {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    requestRef.current++;
    const query = normalizeDiscoverSearchQuery(next);
    if (!query) {
      setItems([]);
      setStatus(next.trim() ? "short" : "idle");
      return;
    }
    setStatus("searching");
    timerRef.current = setTimeout(() => void run(query), DISCOVER_SEARCH_DEBOUNCE_MS);
  }

  const selectedIds = new Set(selected.map((p) => p.id));
  const results = items.filter((p) => !selectedIds.has(p.id));
  const full = selected.length >= max;

  function add(person: LiveInviteCandidate) {
    if (selectedIds.has(person.id) || full) return;
    onChange([...selected, person]);
    inputRef.current?.focus();
  }

  function remove(id: string) {
    onChange(selected.filter((p) => p.id !== id));
  }

  function focusResult(index: number) {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-result]");
    if (!buttons || buttons.length === 0) return;
    const clamped = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[clamped]?.focus();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusResult(0);
    } else if (e.key === "Escape" && value) {
      e.preventDefault();
      e.stopPropagation();
      handleChange("");
    } else if (e.key === "Enter") {
      // Never submits the surrounding form: Enter picks the first result when there is exactly one obvious choice.
      e.preventDefault();
      if (results.length === 1) add(results[0]!);
    }
  }

  function onResultKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusResult(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) inputRef.current?.focus();
      else focusResult(index - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.focus();
    }
  }

  const statusText =
    status === "short"
      ? t.typeMore
      : status === "searching"
        ? t.searching
        : status === "failed"
          ? t.searchFailed
          : status === "rate_limited"
            ? live.errors.rate_limited
            : status === "done" && results.length === 0
              ? t.noResults
              : "";

  return (
    <div>
      {selected.length > 0 && (
        <ul aria-label={t.selectedLabel} className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((p) => {
            const name = p.name ?? p.username ?? live.stage.someone;
            return (
              <li key={p.id}>
                <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 ps-1 pe-1 text-xs">
                  <UserAvatar avatarUrl={p.avatarUrl} name={p.name} size={22} />
                  <bdi className="max-w-32 truncate">{name}</bdi>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    aria-label={format(t.remove, { name })}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-foreground-soft hover:bg-line hover:text-foreground"
                  >
                    <X size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-foreground-soft"
        />
        <input
          ref={inputRef}
          type="search"
          dir="auto"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={t.searchLabel}
          placeholder={t.searchPlaceholder}
          value={value}
          disabled={full}
          maxLength={60}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          // 16px text: iOS zooms the page into any smaller input on focus.
          className="w-full rounded-md border border-line bg-background py-2 ps-8 pe-9 text-base outline-none focus:border-accent disabled:opacity-60 sm:text-sm"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              handleChange("");
              inputRef.current?.focus();
            }}
            aria-label={t.clearSearch}
            className="absolute end-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-foreground-soft hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <p aria-live="polite" className="mt-1 min-h-4 text-xs text-foreground-soft">
        {full ? format(t.maxReached, { max }) : statusText}
        {selected.length > 0 && (
          <span className="sr-only"> {plural(locale, t.selected, selected.length)}</span>
        )}
      </p>

      {results.length > 0 && !full && (
        <ul
          id={listId}
          ref={listRef}
          aria-label={t.resultsLabel}
          className="mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-md border border-line"
        >
          {results.map((p, index) => {
            const name = p.name ?? p.username ?? live.stage.someone;
            return (
              <li key={p.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  data-result
                  onClick={() => add(p)}
                  onKeyDown={(e) => onResultKeyDown(e, index)}
                  aria-label={format(t.add, { name })}
                  className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-1.5 text-start hover:bg-surface focus:bg-surface focus:outline-none"
                >
                  <UserAvatar avatarUrl={p.avatarUrl} name={p.name} size={32} />
                  <span className="min-w-0 flex-1">
                    <bdi className="block truncate text-sm font-medium">{name}</bdi>
                    {p.username && (
                      <span dir="ltr" className="block truncate text-xs text-foreground-soft">
                        @{p.username}
                      </span>
                    )}
                  </span>
                  {p.connected && (
                    <span className="flex shrink-0 items-center gap-0.5 text-[0.6875rem] text-foreground-soft">
                      <Check size={12} aria-hidden />
                      {t.connected}
                    </span>
                  )}
                  <Plus size={16} aria-hidden className="shrink-0 text-accent" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
