"use client";

import { useEffect, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { GiftArt } from "@/components/gift-art";
import { useGiftsText } from "@/components/gifts-text";
import { createGiftIntent, getGiftCatalog, sendFreeGift, type GiftCatalogProduct } from "@/app/actions/gifts";
import { giftItemName, giftProductDescription, giftProductName } from "@/lib/gift-names";
import { GIFT_MESSAGE_MAX, giftPriceLabel } from "@/lib/gifts";
import { GIFT_UNIVERSE_STYLES, type GiftUniverseStyle } from "@/lib/gift-universes";
import type { GiftShelves } from "@/lib/gift-occasions";
import { byCode, format } from "@/lib/i18n/locales";

export type GiftPickerPlace =
  | { context: "DIRECT" }
  | { context: "CHAT"; conversationId: string }
  | { context: "LIVE"; liveStreamId: string };

/**
 * Choosing and sending a gift (Phase A layout). The server (getGiftCatalog) checks every rule for this recipient first
 * and returns the shelves: "Right now" when an occasion applies (with its reason, e.g. "It's their birthday today"),
 * the free kind words, then the five universes, each with its own look (src/lib/gift-universes.ts, globals.css). Then
 * an optional note of up to GIFT_MESSAGE_MAX characters, and Send: a free gift goes through sendFreeGift, anything
 * else through createGiftIntent, which both enforce every rule again. `place` says where it is sent from. In a live
 * stream the server only offers gifts with a live effect, never Love & Emotion, never free ones.
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

  // A fresh form on every open (adjusted during render, the pattern report-form.tsx uses).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(null);
      setNote("");
      setStatus({ kind: "idle" });
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
          onClick={() => setSelected(product.sku)}
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

  const shelves = catalog?.shelves;

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" responsive title={title} lang={locale} dir={dir} panelClassName="sm:max-w-md">
      {status.kind === "sent" ? (
        <div className="py-4 text-center">
          <p role="status" className="text-sm text-success">
            {t.sent}
          </p>
          <button type="button" onClick={onClose} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm">
            {t.close}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
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
            <section aria-labelledby="gift-shelf-right-now" className="rounded-2xl border border-accent/40 bg-accent-soft/40 p-3">
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
            <section aria-labelledby="gift-shelf-kind-words">
              <h3 id="gift-shelf-kind-words" className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                {t.kindWordsHeading}
              </h3>
              <p className="mb-2 text-xs text-foreground-soft">{t.kindWordsIntro}</p>
              <ul className="grid grid-cols-4 gap-2">{pick(shelves.kindWords).map((p) => productButton(p, null))}</ul>
            </section>
          )}

          {shelves?.universes.map(({ universe, skus }) => {
            const style = GIFT_UNIVERSE_STYLES[universe];
            const headingId = `gift-universe-${universe.toLowerCase()}`;
            const products = pick(skus);
            const singles = products.filter((p) => !p.isBox);
            const boxes = products.filter((p) => p.isBox);
            return (
              <section key={universe} aria-labelledby={headingId} className={`gift-universe ${style.className}`}>
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

          {selectedProduct && (
            <p className="text-xs text-foreground-soft">
              {selectedProduct.isBox
                ? format(t.contains, { items: giftProductDescription(t, selectedProduct) })
                : giftProductDescription(t, selectedProduct)}
            </p>
          )}
          {catalog && (
            <div>
              <label htmlFor="gift-note" className="block text-xs font-medium text-foreground-soft">
                {t.messageLabel}
              </label>
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
              <p id="gift-note-count" className={`text-end text-xs ${noteTooLong ? "text-danger" : "text-foreground-soft"}`}>
                <bdi>{`${noteLength}/${GIFT_MESSAGE_MAX}`}</bdi>
              </p>
            </div>
          )}
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
          {catalog && (
            <button
              type="button"
              onClick={send}
              disabled={!selectedProduct || noteTooLong || isPending}
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
            >
              {isPending ? t.sending : t.sendButton}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Each universe's small header mark (decorative; its motion is CSS, off with reduce motion). */
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
