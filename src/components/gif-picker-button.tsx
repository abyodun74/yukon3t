"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Sticker } from "lucide-react";
import { searchGiphyGifs, trendingGiphyGifs } from "@/app/actions/gifs";
import { computePopoverPosition, type PopoverPosition } from "@/lib/popover-position";

const PICKER_WIDTH = 320;
const PICKER_HEIGHT = 360;
const SEARCH_DEBOUNCE_MS = 350;

export function GifPickerButton({
  onSelect,
  disabled,
}: {
  onSelect: (gifUrl: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<{ id: string; gifUrl: string; previewUrl: string }[]>([]);
  // The picker's default grid, loaded once per open — mirrors the
  // WhatsApp/iMessage GIF tray showing a populated trending feed
  // immediately instead of a blank "search to get started" state.
  const [trending, setTrending] = useState<{ id: string; gifUrl: string; previewUrl: string }[]>([]);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  // Which query `gifs` currently holds results for — only ever set inside
  // the async search callback below (a real response arriving), never
  // synchronously in an effect body, so `loading` (derived by comparing
  // this to the live query) stays render-safe.
  const [resolvedQuery, setResolvedQuery] = useState("");

  const trimmedQuery = query.trim();
  const visibleGifs = trimmedQuery ? gifs : trending;
  const loading = trimmedQuery !== "" ? resolvedQuery !== trimmedQuery : !trendingLoaded;

  useEffect(() => {
    if (!open) return;

    function close(e: Event) {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);

    // Re-measure and reposition (not dismiss) on a viewport resize — the
    // search input's autoFocus opens the on-screen keyboard right after
    // this popup's initial position was computed against the pre-keyboard
    // viewport, so without this the popup can open assuming full-screen
    // space below it and end up with its bottom portion (including results
    // and the "Powered by GIPHY" attribution) hidden behind the keyboard.
    function reposition() {
      if (buttonRef.current) {
        setPosition(computePopoverPosition(buttonRef.current.getBoundingClientRect(), PICKER_WIDTH, PICKER_HEIGHT));
      }
    }
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    // Fallback for when the keyboard's open animation doesn't fire a
    // visualViewport resize event at all on some Android WebView versions
    // (confirmed on-device: the popup stayed mis-sized under the keyboard
    // for the whole session with no resize event ever correcting it) — one
    // re-measure after the keyboard's typical animation window closes that
    // gap regardless of whether the event fires.
    const fallbackTimer = setTimeout(reposition, 350);

    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      clearTimeout(fallbackTimer);
    };
  }, [open]);

  // Debounced live search — a fresh requestId per keystroke discards any
  // still-in-flight response from an earlier, now-stale query. Every
  // setState call here happens inside the async callback (a real response
  // arriving), never synchronously in the effect body itself.
  useEffect(() => {
    if (!open || !trimmedQuery) return undefined;
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      const result = await searchGiphyGifs(trimmedQuery);
      if (requestIdRef.current !== requestId) return;
      setResolvedQuery(trimmedQuery);
      setNotConfigured(result.error === "not_configured");
      setGifs(result.gifs);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmedQuery, open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      setPosition(computePopoverPosition(buttonRef.current.getBoundingClientRect(), PICKER_WIDTH, PICKER_HEIGHT));
      setQuery("");
      setGifs([]);
      setNotConfigured(false);
      setResolvedQuery("");
      if (!trendingLoaded) {
        trendingGiphyGifs().then((result) => {
          setNotConfigured(result.error === "not_configured");
          setTrending(result.gifs);
          setTrendingLoaded(true);
        });
      }
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
        className="rounded-lg p-1.5 text-foreground-soft hover:bg-line disabled:opacity-40"
        title="Add a GIF"
        aria-label="Add a GIF"
      >
        <Sticker size={16} />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={popupRef}
            className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
            style={{ top: position.top, left: position.left, width: position.width, height: position.height }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
              <Search size={14} className="shrink-0 text-foreground-soft" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search GIFs"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {notConfigured && (
                <p className="p-3 text-center text-xs text-foreground-soft">GIF search isn&apos;t set up yet.</p>
              )}
              {!notConfigured && !loading && visibleGifs.length === 0 && (
                <p className="p-3 text-center text-xs text-foreground-soft">
                  {trimmedQuery === "" ? "No trending GIFs right now." : "No GIFs found for that search."}
                </p>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {visibleGifs.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => {
                      onSelect(gif.gifUrl);
                      setOpen(false);
                    }}
                    className="block overflow-hidden rounded-md hover:opacity-80"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted preview thumbnail, not a local/optimizable asset */}
                    <img src={gif.previewUrl} alt="" loading="lazy" className="h-24 w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
            {/* Required by Giphy's API terms whenever their search/content
                is used — see the "Powered by GIPHY" attribution requirement
                on the production-access application form. */}
            <div className="shrink-0 border-t border-line px-2 py-1 text-center text-[10px] text-foreground-soft">
              Powered by GIPHY
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
