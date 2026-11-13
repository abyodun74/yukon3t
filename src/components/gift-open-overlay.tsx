"use client";

import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Sheet } from "@/components/sheet";
import { GiftArt } from "@/components/gift-art";
import { useGiftsText } from "@/components/gifts-text";
import { resolveGiftArt } from "@/lib/gift-assets";
import { giftItemName, giftProductName } from "@/lib/gift-names";
import { format } from "@/lib/i18n/locales";
import type { OpenedGift } from "@/app/actions/gifts";

/**
 * Opening a gift: the box's lid lifts and what was inside rises out of it, one item after another. With "reduce
 * motion" on (the OS setting, which MotionConfig also honours app-wide) the contents are simply shown, with no
 * movement at all. What was opened is announced to screen readers through a polite live region; there is no sound.
 * Only the recipient ever sees this, so it may say who sent the gift.
 */
export function GiftOpenOverlay({ gift, onClose }: { gift: OpenedGift | null; onClose: () => void }) {
  const { locale, dir, t } = useGiftsText();
  const reduce = useReducedMotion();
  const names = gift ? gift.items.map((item) => giftItemName(t, item.slug)) : [];
  const listFormat = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  // A single gift whose art is a picture (a photo, not a small drawing) is shown large enough to see.
  const artSize = gift?.items.length === 1 && resolveGiftArt(gift.items[0].assetKey).type === "image" ? 160 : 56;

  return (
    <Sheet open={gift !== null} onClose={onClose} title={t.open.title} lang={locale} dir={dir} panelClassName="max-w-sm">
      {gift && (
        <div className="mt-2 flex flex-col items-center text-center">
          <p className="sr-only" aria-live="polite">
            {format(t.open.announce, { items: listFormat.format(names) })}
          </p>
          <p className="text-sm font-semibold">{giftProductName(t, { sku: gift.productSku, isBox: gift.isBox, items: gift.items })}</p>
          <p className="text-xs text-foreground-soft">
            {gift.senderName ? format(t.open.from, { name: gift.senderName }) : t.open.fromSomeone}
          </p>

          <div className="relative mt-4 flex min-h-28 w-full items-end justify-center" aria-hidden>
            {!reduce && (
              <m.div
                className="absolute bottom-0 h-16 w-24 rounded-lg bg-accent/80"
                initial={{ opacity: 1, scaleY: 1 }}
                animate={{ opacity: 0, scaleY: 0.6 }}
                transition={{ delay: 0.5, duration: 0.35, ease: "easeIn" }}
              >
                <m.div
                  className="absolute -top-3 left-1/2 h-4 w-28 -translate-x-1/2 rounded-md bg-accent"
                  initial={{ y: 0, rotate: 0 }}
                  animate={{ y: -36, rotate: -14, opacity: 0 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                />
              </m.div>
            )}
            <div className="relative flex flex-wrap items-end justify-center gap-3">
              {gift.items.map((item, i) =>
                reduce ? (
                  <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={names[i]} size={artSize} eager />
                ) : (
                  <m.div
                    key={`${item.slug}-${i}`}
                    initial={{ y: 28, scale: 0.6, opacity: 0 }}
                    animate={{ y: 0, scale: 1, opacity: 1 }}
                    transition={{ delay: 0.55 + i * 0.12, type: "spring", stiffness: 420, damping: 22 }}
                  >
                    <GiftArt assetKey={item.assetKey} name={names[i]} size={artSize} eager />
                  </m.div>
                ),
              )}
            </div>
          </div>

          <ul className="mt-4 space-y-0.5 text-sm">
            {gift.items.map((item, i) => (
              <li key={`${item.slug}-${i}`}>
                {names[i]} <span className="text-xs text-foreground-soft">· {t.kinds[item.kind]}</span>
              </li>
            ))}
          </ul>
          {gift.message && (
            <p dir="auto" className="mt-3 w-full break-words rounded-lg bg-surface px-3 py-2 text-sm ph-no-capture">
              {gift.message}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
          >
            {t.open.done}
          </button>
        </div>
      )}
    </Sheet>
  );
}
