"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { filterBySearch, normalizeSearchQuery } from "@/lib/friend-search";

export type FriendSearchTexts = {
  /** Placeholder and accessible name of the box. */
  search: string;
  /** Accessible name of the clear (x) button. */
  clear: string;
  /** Shown when the search matches nobody. */
  noMatch: string;
  /** Shown when there is nobody to pick at all. */
  empty: string;
};

/**
 * A search box above a scrolling list of people, shared by every "send to a friend" picker (post, Muse, Story and
 * share-target sheets). The caller loads the WHOLE list once (no paging), and this filters it in memory as the user
 * types, so a search always covers everyone.
 *
 * - The box sits outside the scrolling `<ul>`, so it stays put (and visible above the keyboard) while the list scrolls.
 * - Never auto-focuses: the keyboard opens only when the user taps the box.
 * - The query lives here, so it is gone whenever the picker unmounts (Back, closing the sheet).
 * - The list keeps a minimum height while a search narrows it, so the sheet doesn't collapse and jump under the thumb.
 * - Logical (start/end) spacing only, so it is right-to-left safe.
 */
export function FriendSearchList<T>({
  items,
  getKey,
  getName,
  getUsername,
  renderItem,
  loading,
  texts,
  listClassName = "max-h-72",
}: {
  /** null while loading. */
  items: readonly T[] | null;
  getKey: (item: T) => string;
  getName: (item: T) => string;
  getUsername?: (item: T) => string | null | undefined;
  /** Renders the contents of one `<li>`. */
  renderItem: (item: T) => ReactNode;
  /** Rows shown while `items` is null. */
  loading: ReactNode;
  texts: FriendSearchTexts;
  /** Max-height class of the scroll area. */
  listClassName?: string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () =>
      items === null
        ? null
        : filterBySearch(items, query, (item) => [getName(item), getUsername?.(item)]),
    [items, query, getName, getUsername],
  );

  const showSearch = items === null || items.length > 0;
  const searching = normalizeSearchQuery(query) !== "";

  return (
    <div className="mt-3">
      {showSearch && (
        <div className="relative mb-2">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-foreground-soft"
          />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            dir="auto"
            value={query}
            disabled={items === null}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={(e) => {
              // The keyboard is still animating open; once it has, keep the box in view.
              const el = e.currentTarget;
              setTimeout(() => el.scrollIntoView?.({ block: "nearest" }), 300);
            }}
            placeholder={texts.search}
            aria-label={texts.search}
            // 16px on a phone so iOS doesn't zoom the page on focus; [&::-webkit-search-cancel-button] hides the
            // browser's own clear control, which would double up with ours.
            className="w-full rounded-lg border border-line bg-transparent py-2 ps-9 pe-9 text-base outline-none focus:border-accent sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query !== "" && (
            <button
              type="button"
              // Keep focus (and the keyboard) in the box when clearing.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={texts.clear}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-foreground-soft hover:bg-line/60"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      <ul className={`${searching ? "min-h-48" : ""} space-y-1 overflow-y-auto overscroll-contain ${listClassName}`}>
        {filtered === null && loading}
        {items?.length === 0 && <li className="px-2 py-1 text-sm text-foreground-soft">{texts.empty}</li>}
        {items !== null && items.length > 0 && filtered?.length === 0 && (
          <li role="status" className="px-2 py-1 text-sm text-foreground-soft">
            {texts.noMatch}
          </li>
        )}
        {filtered?.map((item) => (
          <li key={getKey(item)}>{renderItem(item)}</li>
        ))}
      </ul>
    </div>
  );
}
