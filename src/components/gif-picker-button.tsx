"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayHost, useOverlayZ } from "@/components/overlay-root";
import { Search, Sticker } from "lucide-react";
import { searchGiphyGifs, trendingGiphyGifs } from "@/app/actions/gifs";
import { computePopoverPosition, type PopoverPosition } from "@/lib/popover-position";
import { useUiText } from "@/components/ui-text";

const PICKER_WIDTH = 320;
const PICKER_HEIGHT = 360;
const SEARCH_DEBOUNCE_MS = 350;

type Gif = { id: string; gifUrl: string; previewUrl: string };
type GifList = { error: string | null; gifs: Gif[] };

// Giphy's trending feed, fetched once per page load and shared by every picker (the composer popover and the Muse
// comments panel): it is the same list for everyone for a while, and each fetch is a real Giphy API request. A failed
// fetch is forgotten so the next open tries again.
let trendingRequest: Promise<GifList> | null = null;
function loadTrending(): Promise<GifList> {
  trendingRequest ??= trendingGiphyGifs().catch(() => {
    trendingRequest = null;
    return { error: "failed", gifs: [] };
  });
  return trendingRequest;
}

export function GifPickerButton({
  onSelect,
  disabled,
}: {
  onSelect: (gifUrl: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Portaled to the root overlay host, on the sheet layer (one above the overlay it was opened from).
  const overlayHost = useOverlayHost();
  const popupZ = useOverlayZ("sheet");
  const { locale, dir, t } = useUiText();
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function close(e: Event) {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", close);

    // Re-measure and reposition — never dismiss — on scroll or resize, so
    // the popup follows the button instead of disappearing. The search
    // input's autoFocus opens the on-screen keyboard right after this popup
    // opens, which on mobile also scrolls that input into view — a real
    // scroll that a "close on scroll" version of this was confirmed live to
    // act on instantly (a plain 3px window.scrollBy() closed it), and no
    // fixed grace period reliably outlasts that keyboard/scroll animation.
    // Same fix as EmojiPickerButton, which shares this positioning code.
    function reposition() {
      if (buttonRef.current) {
        setPosition(computePopoverPosition(buttonRef.current.getBoundingClientRect(), PICKER_WIDTH, PICKER_HEIGHT));
      }
    }
    // rAF-throttled — window scroll fires far more often than once per
    // frame, and reposition() does a measure + setState on every call.
    let repositionQueued = false;
    function onScrollOrResize() {
      if (repositionQueued) return;
      repositionQueued = true;
      requestAnimationFrame(() => {
        repositionQueued = false;
        reposition();
      });
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.visualViewport?.addEventListener("resize", onScrollOrResize);
    // Fallback for when the keyboard's open animation doesn't fire a
    // visualViewport resize event at all on some Android WebView versions
    // (confirmed on-device: the popup stayed mis-sized under the keyboard
    // for the whole session with no resize event ever correcting it) — one
    // re-measure after the keyboard's typical animation window closes that
    // gap regardless of whether the event fires.
    const fallbackTimer = setTimeout(reposition, 350);

    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.visualViewport?.removeEventListener("resize", onScrollOrResize);
      clearTimeout(fallbackTimer);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      setPosition(computePopoverPosition(buttonRef.current.getBoundingClientRect(), PICKER_WIDTH, PICKER_HEIGHT));
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className="rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line disabled:opacity-40"
        title={t.gif.add}
        aria-label={t.gif.add}
        aria-expanded={open}
      >
        <Sticker size={16} />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={popupRef}
            lang={locale}
            dir={dir}
            className="fixed flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
            style={{ zIndex: popupZ, top: position.top, left: position.left, width: position.width, height: position.height }}
          >
            <GifSearchPanel
              autoFocus
              onSelect={(gifUrl) => {
                onSelect(gifUrl);
                setOpen(false);
              }}
            />
          </div>,
          overlayHost ?? document.body,
        )}
    </>
  );
}

/**
 * The GIF search itself: a search field, Giphy's trending feed until something is typed, a debounced live search
 * (a fresh request id per query, so a stale answer never replaces a newer one) and the required GIPHY attribution.
 * Fills its parent (a flex column). Mounted fresh on every open, so each open starts from the trending grid. Used by
 * GifPickerButton's popover and by the Muse comments composer's panel (comment-picker-panel.tsx).
 */
export function GifSearchPanel({
  onSelect,
  autoFocus = false,
  gridClassName = "grid-cols-2",
}: {
  onSelect: (gifUrl: string) => void;
  /** The popover focuses its search field at once; an in-place panel leaves the keyboard down until a tap. */
  autoFocus?: boolean;
  gridClassName?: string;
}) {
  const { t } = useUiText();
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  // The picker's default grid — mirrors the WhatsApp/iMessage GIF tray showing a populated trending feed immediately
  // instead of a blank "search to get started" state.
  const [trending, setTrending] = useState<Gif[]>([]);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const requestIdRef = useRef(0);
  // Which query `gifs` currently holds results for — only ever set inside the async search callback below (a real
  // response arriving), never synchronously in an effect body, so `loading` (derived by comparing this to the live
  // query) stays render-safe.
  const [resolvedQuery, setResolvedQuery] = useState("");

  const trimmedQuery = query.trim();
  const visibleGifs = trimmedQuery ? gifs : trending;
  const loading = trimmedQuery !== "" ? resolvedQuery !== trimmedQuery : !trendingLoaded;

  useEffect(() => {
    let cancelled = false;
    loadTrending().then((result) => {
      if (cancelled) return;
      setNotConfigured(result.error === "not_configured");
      setTrending(result.gifs);
      setTrendingLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced live search. Every setState call here happens inside the async callback (a real response arriving),
  // never synchronously in the effect body itself.
  useEffect(() => {
    if (!trimmedQuery) return undefined;
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      const result = await searchGiphyGifs(trimmedQuery).catch(() => ({ error: "failed", gifs: [] as Gif[] }));
      if (requestIdRef.current !== requestId) return;
      setResolvedQuery(trimmedQuery);
      setNotConfigured(result.error === "not_configured");
      setGifs(result.gifs);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <Search size={14} className="shrink-0 text-foreground-soft" aria-hidden />
        <input
          aria-label={t.gif.search}
          autoFocus={autoFocus}
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.gif.search}
          className="w-full bg-transparent text-base outline-none sm:text-sm"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {notConfigured && <p className="p-3 text-center text-xs text-foreground-soft">{t.gif.notConfigured}</p>}
        {!notConfigured && !loading && visibleGifs.length === 0 && (
          <p className="p-3 text-center text-xs text-foreground-soft">
            {trimmedQuery === "" ? t.gif.noTrending : t.gif.noResults}
          </p>
        )}
        <div className={`grid gap-1.5 ${gridClassName}`}>
          {visibleGifs.map((gif) => (
            <button
              key={gif.id}
              type="button"
              onClick={() => onSelect(gif.gifUrl)}
              className="block overflow-hidden rounded-md hover:opacity-80"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted preview thumbnail, not a local/optimizable asset */}
              <img src={gif.previewUrl} alt={t.comments.gifAlt} loading="lazy" decoding="async" className="h-24 w-full object-cover" />
            </button>
          ))}
        </div>
      </div>
      {/* Required by Giphy's API terms whenever their search/content is used — see the "Powered by GIPHY"
          attribution requirement on the production-access application form. */}
      <div className="shrink-0 border-t border-line px-2 py-1 text-center text-[0.625rem] text-foreground-soft">
        Powered by GIPHY
      </div>
    </>
  );
}
