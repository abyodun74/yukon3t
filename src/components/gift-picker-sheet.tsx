"use client";

import { useEffect, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { GiftArt } from "@/components/gift-art";
import { useGiftsText } from "@/components/gifts-text";
import { createGiftIntent, getGiftCatalog, type GiftCatalogProduct } from "@/app/actions/gifts";
import { giftItemName, giftProductDescription, giftProductName } from "@/lib/gift-names";
import { GIFT_MESSAGE_MAX, giftPriceLabel } from "@/lib/gifts";
import { byCode, format } from "@/lib/i18n/locales";

export type GiftPickerPlace =
  | { context: "DIRECT" }
  | { context: "CHAT"; conversationId: string }
  | { context: "LIVE"; liveStreamId: string };

/**
 * Choosing and sending a gift: the catalog (single gifts, then boxes), an optional note of up to GIFT_MESSAGE_MAX
 * characters, and Send. Only rendered where giftsEnabledFor is on for the viewer; createGiftIntent enforces every
 * rule again on the server. `place` says where it is sent from (a profile, a chat, a live stream). In a live stream
 * only gifts that carry a live effect are offered, since that is what the room shows.
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
  const [products, setProducts] = useState<GiftCatalogProduct[] | null>(null);
  const [loadError, setLoadError] = useState(false);
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
    if (!open || products) return;
    let cancelled = false;
    getGiftCatalog()
      .then((result) => {
        if (cancelled) return;
        if (result.error) setLoadError(true);
        else setProducts(result.products);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, products, loadKey]);

  const offered = (products ?? []).filter(
    (p) => place.context !== "LIVE" || p.items.some((item) => item.kind === "LIVE_EFFECT"),
  );
  const singles = offered.filter((p) => !p.isBox);
  const boxes = offered.filter((p) => p.isBox);
  const noteLength = [...note.trim()].length;
  const noteTooLong = noteLength > GIFT_MESSAGE_MAX;

  function send() {
    if (!selected || noteTooLong || isPending) return;
    startTransition(async () => {
      try {
        const result = await createGiftIntent(selected, recipientId, note.trim() || null, place);
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

  function productButton(product: GiftCatalogProduct) {
    const isSelected = selected === product.sku;
    const name = giftProductName(t, product);
    return (
      <li key={product.sku}>
        <button
          type="button"
          onClick={() => setSelected(product.sku)}
          aria-pressed={isSelected}
          className={`relative flex w-full flex-col items-center gap-1 rounded-xl border p-2 text-center text-xs transition-colors ${
            isSelected ? "border-accent bg-accent-soft" : "border-line hover:border-accent"
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
              <GiftArt
                key={`${item.slug}-${i}`}
                assetKey={item.assetKey}
                name={giftItemName(t, item.slug)}
                size={product.isBox ? 32 : 44}
              />
            ))}
          </span>
          <span className="font-medium">{name}</span>
          <span className="text-foreground-soft">{giftPriceLabel(product.priceMinor, product.currency, locale)}</span>
        </button>
      </li>
    );
  }

  const selectedProduct = offered.find((p) => p.sku === selected) ?? null;

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
          {!products && !loadError && (
            <p role="status" className="text-sm text-foreground-soft">
              {t.loading}
            </p>
          )}
          {loadError && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-danger">{t.loadFailed}</span>
              <button
                type="button"
                onClick={() => {
                  setLoadError(false);
                  setLoadKey((k) => k + 1);
                }}
                className="text-accent underline"
              >
                {t.retry}
              </button>
            </div>
          )}
          {singles.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-soft">{t.singlesHeading}</h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{singles.map(productButton)}</ul>
            </section>
          )}
          {boxes.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-soft">{t.boxesHeading}</h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{boxes.map(productButton)}</ul>
            </section>
          )}
          {selectedProduct && (
            <p className="text-xs text-foreground-soft">
              {selectedProduct.isBox
                ? format(t.contains, { items: giftProductDescription(t, selectedProduct) })
                : giftProductDescription(t, selectedProduct)}
            </p>
          )}
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
            disabled={!selected || noteTooLong || isPending}
            className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? t.sending : t.sendButton}
          </button>
        </div>
      )}
    </Sheet>
  );
}
