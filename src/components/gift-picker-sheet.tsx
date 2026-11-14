"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { GiftArt } from "@/components/gift-art";
import { useGiftsText } from "@/components/gifts-text";
import { createGiftIntent, getGiftCatalog, sendFreeGift, type GiftCatalogProduct } from "@/app/actions/gifts";
import { giftItemName, giftProductDescription, giftProductName } from "@/lib/gift-names";
import { GIFT_MESSAGE_MAX, giftPriceLabel } from "@/lib/gifts";
import { GIFT_UNIVERSE_STYLES, type GiftUniverseStyle } from "@/lib/gift-universes";
import type { GiftShelves } from "@/lib/gift-occasions";
import {
  activeGiftSection,
  chipScrollDelta,
  giftPickerSections,
  giftScrollBehavior,
  giftSectionId,
  giftSectionScrollTop,
  keyboardInset,
  toggleGiftSelection,
  type GiftPickerSectionKey,
} from "@/lib/gift-picker-nav";
import { byCode, format } from "@/lib/i18n/locales";

export type GiftPickerPlace =
  | { context: "DIRECT" }
  | { context: "CHAT"; conversationId: string }
  | { context: "LIVE"; liveStreamId: string };

/**
 * Choosing and sending a gift. The server (getGiftCatalog) checks every rule for this recipient first and returns the
 * shelves: "Right now" when an occasion applies (with its reason, e.g. "It's their birthday today"), the free kind
 * words, then the five universes, each with its own look (src/lib/gift-universes.ts, globals.css). Then an optional
 * note of up to GIFT_MESSAGE_MAX characters, and Send: a free gift goes through sendFreeGift, anything else through
 * createGiftIntent, which both enforce every rule again. `place` says where it is sent from. In a live stream the
 * server only offers gifts with a live effect, never Love & Emotion, never free ones.
 *
 * Layout: the panel is never taller than the visible screen (`.gift-picker-panel`: dvh, the notch, and the iOS
 * keyboard through visualViewport), in three regions: the sheet's own title row plus a row of section chips (fixed),
 * ONE scrolling list of shelves, and a fixed footer with the chosen gift, the note and Send, so sending never needs a
 * scroll. The sheet is dragged closed from its grabber/title only (`dragFromHandle`), so the list scrolls freely.
 * Section ids, the scroll-spy and selection rules are the pure src/lib/gift-picker-nav.ts.
 */
export function GiftPickerSheet({
  open,
  onClose,
  recipientId,
  recipientName,
  place,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  recipientId: string;
  recipientName: string | null;
  place: GiftPickerPlace;
  onSent?: () => void;
}) {
  const { locale, dir, t } = useGiftsText();
  const [catalog, setCatalog] = useState<{ products: GiftCatalogProduct[]; shelves: GiftShelves } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "sent" | "undeliverable" } | { kind: "error"; code: string }>({
    kind: "idle",
  });
  const [isPending, startTransition] = useTransition();
  const [loadKey, setLoadKey] = useState(0);
  const [activeSection, setActiveSection] = useState<GiftPickerSectionKey | null>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const scrollRef = useRef<HTMLDivElement>(null);
  const chipRowRef = useRef<HTMLElement>(null);
  // While a chip's own scroll is running, the scroll-spy keeps the tapped chip current instead of flickering through
  // every section passed on the way.
  const spyLockUntil = useRef(0);
  const keyboard = useKeyboardViewport(open);

  // A fresh form on every open (adjusted during render, the pattern report-form.tsx uses).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(null);
      setNote("");
      setStatus({ kind: "idle" });
      setActiveSection(null);
    }
  }

  useEffect(() => {
    if (!open || catalog) return;
    let cancelled = false;
    getGiftCatalog(recipientId, place.context)
      .then((result) => {
        if (cancelled) return;
        if (result.error) setLoadError(result.error);
        else setCatalog({ products: result.products, shelves: result.shelves });
      })
      .catch(() => {
        if (!cancelled) setLoadError("other");
      });
    return () => {
      cancelled = true;
    };
  }, [open, catalog, loadKey, recipientId, place.context]);

  const shelves = catalog?.shelves;
  const sections = shelves ? giftPickerSections(shelves) : [];
  const sectionKeys = sections.map((s) => s.key).join(",");
  const listShown = open && status.kind !== "sent";

  // Scroll-spy: an IntersectionObserver on the list (plus a frame-throttled scroll listener for long sections whose
  // edges cross no threshold) re-measures the sections and marks the one being read.
  useEffect(() => {
    const region = scrollRef.current;
    if (!listShown || !region || !sectionKeys) return;
    const keys = sectionKeys.split(",") as GiftPickerSectionKey[];
    const elements = keys.map((key) => document.getElementById(giftSectionId(key)));
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (performance.now() < spyLockUntil.current) return;
      const regionTop = region.getBoundingClientRect().top;
      const tops = keys.flatMap((key, i) => {
        const el = elements[i];
        return el ? [{ key, top: el.getBoundingClientRect().top - regionTop + region.scrollTop }] : [];
      });
      setActiveSection(activeGiftSection(tops, region));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(schedule, { root: region, rootMargin: "0px 0px -55% 0px", threshold: [0, 1] });
    for (const el of elements) if (el) observer?.observe(el);
    const release = () => {
      spyLockUntil.current = 0;
      schedule();
    };
    region.addEventListener("scroll", schedule, { passive: true });
    region.addEventListener("scrollend", release);
    schedule();
    return () => {
      observer?.disconnect();
      region.removeEventListener("scroll", schedule);
      region.removeEventListener("scrollend", release);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [listShown, sectionKeys]);

  // Keep the current chip in view in its own (horizontally scrolling) row.
  useEffect(() => {
    const row = chipRowRef.current;
    if (!row || !activeSection) return;
    const chip = row.querySelector<HTMLElement>(`[aria-controls="${giftSectionId(activeSection)}"]`);
    if (!chip) return;
    const delta = chipScrollDelta(chip.getBoundingClientRect(), row.getBoundingClientRect());
    if (delta !== 0) row.scrollBy({ left: delta, behavior: giftScrollBehavior(reduceMotion) });
  }, [activeSection, reduceMotion]);

  function jumpTo(key: GiftPickerSectionKey, at: number) {
    const region = scrollRef.current;
    const section = document.getElementById(giftSectionId(key));
    if (!region || !section) return;
    const behavior = giftScrollBehavior(reduceMotion);
    const top = giftSectionScrollTop(section.getBoundingClientRect().top, region.getBoundingClientRect().top, region.scrollTop);
    // `at` is the tap's event timeStamp (the same clock as performance.now()).
    spyLockUntil.current = at + (behavior === "smooth" ? 1000 : 150);
    setActiveSection(key);
    region.scrollTo({ top, behavior });
  }

  const bySku = new Map((catalog?.products ?? []).map((p) => [p.sku, p]));
  const pick = (skus: string[]) => skus.map((sku) => bySku.get(sku)).filter((p): p is GiftCatalogProduct => Boolean(p));
  const noteLength = [...note.trim()].length;
  const noteTooLong = noteLength > GIFT_MESSAGE_MAX;
  const selectedProduct = selected ? (bySku.get(selected) ?? null) : null;

  function send() {
    if (!selectedProduct || noteTooLong || isPending) return;
    startTransition(async () => {
      try {
        const text = note.trim() || null;
        const result =
          selectedProduct.free && place.context !== "LIVE"
            ? await sendFreeGift(selectedProduct.sku, recipientId, text, place)
            : await createGiftIntent(selectedProduct.sku, recipientId, text, place);
        if (result.error) {
          setStatus({ kind: "error", code: result.error });
          return;
        }
        setStatus({ kind: result.delivered ? "sent" : "undeliverable" });
        if (result.delivered) onSent?.();
      } catch {
        setStatus({ kind: "error", code: "other" });
      }
    });
  }

  const title = recipientName ? format(t.sendTo, { name: recipientName }) : t.pickerTitle;
  // A refusal (blocks, age, the recipient's choice) is said plainly; anything else can be retried.
  const refused = loadError && ["disabled", "unavailable", "adult_only", "not_accepting", "invalid"].includes(loadError);

  function productButton(product: GiftCatalogProduct, style: GiftUniverseStyle | null) {
    const isSelected = selected === product.sku;
    const name = giftProductName(t, product);
    const piece = !product.isBox ? product.items[0]?.piece : null;
    return (
      <li key={product.sku}>
        <button
          type="button"
          onClick={() => setSelected((current) => toggleGiftSelection(current, product.sku))}
          aria-pressed={isSelected}
          className={`relative flex w-full flex-col items-center gap-1 rounded-xl border p-2 text-center text-xs transition-colors ${
            isSelected ? (style ? "gift-universe-selected" : "border-accent bg-accent-soft") : "border-line hover:border-accent"
          }`}
        >
          {isSelected && (
            <span className="absolute end-1 top-1 rounded-full bg-accent p-0.5 text-accent-ink">
              <Check size={10} aria-hidden />
              <span className="sr-only">{t.selected}</span>
            </span>
          )}
          <span className="flex -space-x-3 rtl:space-x-reverse">
            {product.items.slice(0, 4).map((item, i) => (
              <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={giftItemName(t, item.slug)} size={product.isBox ? 32 : 44} />
            ))}
          </span>
          <span className="font-medium">{name}</span>
          {piece ? <span className="text-[10px] uppercase tracking-wide opacity-80">{format(t.pieceLabel, { number: piece })}</span> : null}
          <span className="text-foreground-soft">{product.free ? t.free : giftPriceLabel(product.priceMinor, product.currency, locale)}</span>
        </button>
      </li>
    );
  }

  function chipLabel(section: (typeof sections)[number]) {
    if (section.kind === "rightNow") return t.rightNowHeading;
    if (section.kind === "kindWords") return t.kindWordsHeading;
    return t.universes[section.universe].name;
  }

  const panelStyle = keyboard
    ? ({ "--gift-kb": `${keyboard.inset}px`, "--gift-vvh": `${keyboard.height}px` } as CSSProperties)
    : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="bottom-sheet"
      responsive
      dragFromHandle
      title={title}
      lang={locale}
      dir={dir}
      panelClassName="gift-picker-panel sm:max-w-md"
      panelStyle={panelStyle}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      {status.kind === "sent" ? (
        <div className="px-4 py-4 text-center">
          <p role="status" className="text-sm text-success">
            {t.sent}
          </p>
          <button type="button" onClick={onClose} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm">
            {t.close}
          </button>
        </div>
      ) : (
        <>
          {sections.length > 1 && (
            <nav
              ref={chipRowRef}
              aria-label={t.universesNav}
              data-gift-chips
              className="gift-picker-chips flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2"
            >
              {sections.map((section) => {
                const current = activeSection === section.key;
                const universeClass =
                  section.kind === "universe" ? `gift-universe ${GIFT_UNIVERSE_STYLES[section.universe].className} gift-universe-chip` : "";
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={(e) => jumpTo(section.key, e.timeStamp)}
                    aria-controls={giftSectionId(section.key)}
                    aria-current={current ? "true" : undefined}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${current ? "font-semibold" : "font-medium"} ${
                      universeClass ||
                      (current ? "border-accent bg-accent-soft text-foreground" : "border-line bg-surface text-foreground-soft hover:border-accent")
                    }`}
                  >
                    {chipLabel(section)}
                  </button>
                );
              })}
            </nav>
          )}

          <div
            ref={scrollRef}
            role="region"
            aria-label={t.giftListLabel}
            tabIndex={0}
            data-gift-scroll
            className="gift-picker-scroll min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 pt-1 outline-none"
          >
            <p className="text-xs text-foreground-soft">
              {t.pickerIntro} {t.testingNote}
            </p>
            {!catalog && !loadError && (
              <p role="status" className="text-sm text-foreground-soft">
                {t.loading}
              </p>
            )}
            {loadError &&
              (refused ? (
                <p role="alert" className="text-sm text-danger">
                  {byCode(t.errors, loadError)}
                </p>
              ) : (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-danger">{loadError === "rate_limited" ? t.errors.rate_limited : t.loadFailed}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLoadError(null);
                      setLoadKey((k) => k + 1);
                    }}
                    className="text-accent underline"
                  >
                    {t.retry}
                  </button>
                </div>
              ))}

            {shelves?.rightNow && (
              <section
                id={giftSectionId("right-now")}
                aria-labelledby="gift-shelf-right-now"
                className="scroll-mt-2 rounded-2xl border border-accent/40 bg-accent-soft/40 p-3"
              >
                <h3 id="gift-shelf-right-now" className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                  {t.rightNowHeading}
                </h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {shelves.rightNow.occasions.map((occasion) => (
                    <li key={occasion.kind} className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-line">
                      {t.occasions.reasons[occasion.reasonKey]}
                    </li>
                  ))}
                </ul>
                <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">{pick(shelves.rightNow.skus).map((p) => productButton(p, null))}</ul>
              </section>
            )}

            {shelves && shelves.kindWords.length > 0 && (
              <section id={giftSectionId("kind-words")} aria-labelledby="gift-shelf-kind-words" className="scroll-mt-2">
                <h3 id="gift-shelf-kind-words" className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                  {t.kindWordsHeading}
                </h3>
                <p className="mb-2 text-xs text-foreground-soft">{t.kindWordsIntro}</p>
                <ul className="grid grid-cols-4 gap-2">{pick(shelves.kindWords).map((p) => productButton(p, null))}</ul>
              </section>
            )}

            {sections.map((section) => {
              if (section.kind !== "universe") return null;
              const universe = section.universe;
              const style = GIFT_UNIVERSE_STYLES[universe];
              const headingId = `gift-universe-${universe.toLowerCase()}`;
              const products = pick(shelves?.universes.find((u) => u.universe === universe)?.skus ?? []);
              const singles = products.filter((p) => !p.isBox);
              const boxes = products.filter((p) => p.isBox);
              return (
                <section
                  key={universe}
                  id={giftSectionId(section.key)}
                  aria-labelledby={headingId}
                  className={`gift-universe scroll-mt-2 ${style.className}`}
                >
                  <div className="gift-universe-header mb-2 flex items-center gap-2 px-3 py-2">
                    <UniverseOrnament ornament={style.ornament} />
                    <span className="min-w-0">
                      <h3 id={headingId} className="text-sm font-semibold">
                        {t.universes[universe].name}
                      </h3>
                      <span className="block text-xs opacity-80">{t.universes[universe].tagline}</span>
                    </span>
                  </div>
                  {singles.length > 0 && <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{singles.map((p) => productButton(p, style))}</ul>}
                  {boxes.length > 0 && (
                    <>
                      <h4 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-soft">{t.boxesHeading}</h4>
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{boxes.map((p) => productButton(p, style))}</ul>
                    </>
                  )}
                </section>
              );
            })}
          </div>

          {catalog && (
            <div data-gift-footer className="shrink-0 space-y-2 border-t border-line px-4 pt-2.5">
              <div className="flex min-h-10 items-center gap-2" aria-live="polite">
                {selectedProduct ? (
                  <>
                    <span className="flex shrink-0 -space-x-2 rtl:space-x-reverse">
                      {selectedProduct.items.slice(0, 3).map((item, i) => (
                        <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={giftItemName(t, item.slug)} size={32} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="sr-only">{t.selectedGift}: </span>
                      <span className="block truncate text-sm font-medium">{giftProductName(t, selectedProduct)}</span>
                      <span className="block truncate text-xs text-foreground-soft">
                        {selectedProduct.isBox
                          ? format(t.contains, { items: giftProductDescription(t, selectedProduct) })
                          : giftProductDescription(t, selectedProduct)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold">
                      {selectedProduct.free ? t.free : giftPriceLabel(selectedProduct.priceMinor, selectedProduct.currency, locale)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-foreground-soft">{t.noneSelected}</span>
                )}
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="gift-note" className="text-xs font-medium text-foreground-soft">
                    {t.messageLabel}
                  </label>
                  <p id="gift-note-count" className={`text-xs ${noteTooLong ? "text-danger" : "text-foreground-soft"}`}>
                    <bdi>{`${noteLength}/${GIFT_MESSAGE_MAX}`}</bdi>
                  </p>
                </div>
                <textarea
                  id="gift-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  dir="auto"
                  placeholder={t.messagePlaceholder}
                  aria-describedby="gift-note-count"
                  aria-invalid={noteTooLong}
                  className="mt-1 w-full resize-none rounded-lg border border-line bg-background px-3 py-2 text-base sm:text-sm"
                />
              </div>
              {status.kind === "undeliverable" && (
                <p role="alert" className="text-sm text-danger">
                  {t.undeliverable}
                </p>
              )}
              {status.kind === "error" && (
                <p role="alert" className="text-sm text-danger">
                  {byCode(t.errors, status.code)}
                </p>
              )}
              <button
                type="button"
                onClick={send}
                disabled={!selectedProduct || noteTooLong || isPending}
                className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
              >
                {isPending ? t.sending : t.sendButton}
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/**
 * The visible height and the keyboard's cover while the picker is open, from window.visualViewport (null when no
 * keyboard covers the page, or no visualViewport). The picker's panel reads them as --gift-vvh / --gift-kb.
 */
function useKeyboardViewport(active: boolean): { inset: number; height: number } | null {
  const [state, setState] = useState<{ inset: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !vv) return;
    let frame = 0;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const inset = keyboardInset({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop });
        const next = inset ? { inset, height: Math.round(vv.height) } : null;
        setState((prev) => (prev?.inset === next?.inset && prev?.height === next?.height ? prev : next));
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return active ? state : null;
}

/** Each universe's small header mark (decorative and static: nothing in the picker moves when it opens). */
function UniverseOrnament({ ornament }: { ornament: GiftUniverseStyle["ornament"] }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", "aria-hidden": true as const, className: "gift-universe-ornament shrink-0" };
  switch (ornament) {
    case "bloom":
      return (
        <svg {...common}>
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx="12" cy="7" rx="3" ry="5" fill="currentColor" opacity="0.55" transform={`rotate(${a} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        </svg>
      );
    case "burst":
      return (
        <svg {...common}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M12 2v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${a} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      );
    case "pixel":
      return (
        <svg {...common}>
          <path d="M11 3h2v2h2v2h2v2h-4v12h-2V9H7V7h2V5h2z" fill="currentColor" />
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <path d="M6 4h12l4 6-10 11L2 10z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M2 10h20M9 4l3 17 3-17" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case "lantern":
    default:
      return (
        <svg {...common}>
          <path d="M12 1v3" stroke="currentColor" strokeWidth="1.5" />
          <rect x="7" y="5" width="10" height="13" rx="5" fill="currentColor" opacity="0.7" />
          <path d="M9.5 6c-1 4-1 7 0 11M14.5 6c1 4 1 7 0 11" stroke="currentColor" strokeWidth="1" fill="none" />
          <path d="M12 18v4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}
