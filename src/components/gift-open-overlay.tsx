"use client";

import { useState, useTransition } from "react";
import { GiftReveal, useGiftRevealClose } from "@/components/gift-reveal";
import { useGiftsText } from "@/components/gifts-text";
import { sendThankYouGift, type OpenedGift } from "@/app/actions/gifts";
import { giftRevealSender } from "@/lib/gift-effect-plan";
import { giftPieceNumber } from "@/lib/gifts-data";
import { giftItemName, giftProductName } from "@/lib/gift-names";
import { byCode, format } from "@/lib/i18n/locales";

/**
 * Opening a gift: the recipient's reveal (GiftReveal, the same screen the marketplace previews), with the real sender
 * (@username, else their name; nobody for an award), the gift's name and tier, and the sender's note. Only the
 * recipient ever gets an OpenedGift (openGift), so only they see who sent it and what they wrote.
 *
 * Replay plays it again. "Send thank you" sends the one free Thank You for it through the existing sendThankYouGift
 * (recipient only, once per gift, rate-limited, block and send rules checked on the server); it is offered only while
 * openGift says it still can be. Box contents, edition and piece numbers (recipient only) and the Birthday Candle (a
 * tap blows it out, a still change) sit under the note. What was opened is announced through a polite live region.
 */
export function GiftOpenOverlay({
  gift,
  onClose,
  onThanked,
}: {
  gift: OpenedGift | null;
  onClose: () => void;
  /** After a Thank You went out from the reveal (a chat card hides its own Thank You button). */
  onThanked?: () => void;
}) {
  if (!gift) return null;
  return <GiftOpenReveal key={gift.sendId} gift={gift} onClose={onClose} onThanked={onThanked} />;
}

function GiftOpenReveal({ gift, onClose, onThanked }: { gift: OpenedGift; onClose: () => void; onThanked?: () => void }) {
  const { locale, t } = useGiftsText();
  const names = gift.items.map((item) => giftItemName(t, item.slug));
  const listFormat = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const [blown, setBlown] = useState(false);
  const [thanks, setThanks] = useState<{ kind: "idle" | "sent" | "thanked" } | { kind: "error"; code: string }>(() => ({
    kind: gift.thanked ? "thanked" : "idle",
  }));
  const [isPending, startTransition] = useTransition();
  const hasCandle = gift.items.some((item) => item.slug === "birthday-candle");
  // The Birthday Candle, once blown out, is drawn without its flame.
  const items = gift.items.map((item) => ({
    slug: item.slug,
    assetKey: item.slug === "birthday-candle" && blown ? "birthday-candle-out" : item.assetKey,
  }));
  const canThank = gift.canThank && thanks.kind !== "sent" && thanks.kind !== "thanked";
  const numbered = gift.items.some((item) => giftPieceNumber(item.slug) !== null) || gift.editions.length > 0;

  function thank() {
    startTransition(async () => {
      try {
        const result = await sendThankYouGift(gift.sendId);
        if (result.error) {
          setThanks(result.error === "already_thanked" ? { kind: "thanked" } : { kind: "error", code: result.error });
          return;
        }
        setThanks({ kind: "sent" });
        onThanked?.();
      } catch {
        setThanks({ kind: "error", code: "other" });
      }
    });
  }

  return (
    <GiftReveal
      mode="recipient"
      tier={gift.tier}
      items={items}
      giftName={giftProductName(t, { sku: gift.productSku, isBox: gift.isBox, items: gift.items })}
      sender={giftRevealSender({ isAward: gift.isAward, username: gift.senderUsername, name: gift.senderName })}
      message={gift.message}
      announcement={format(t.open.announce, { items: listFormat.format(names) })}
      onClose={onClose}
      details={
        <>
          {(gift.items.length > 1 || numbered) && (
            <ul className="space-y-0.5 text-xs text-white/75">
              {gift.items.map((item, i) => {
                const piece = giftPieceNumber(item.slug);
                const edition = gift.editions.find((e) => e.slug === item.slug);
                return (
                  <li key={`${item.slug}-${i}`}>
                    {names[i]} <span className="text-white/55">· {t.kinds[item.kind]}</span>
                    {piece !== null && <span className="text-white/55"> · {format(t.pieceLabel, { number: piece })}</span>}
                    {edition && <span className="font-semibold"> · {format(t.editionLabel, { number: edition.number })}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {gift.editions.length > 0 && <p className="text-[11px] text-white/55">{t.editionNote}</p>}
          {hasCandle && (
            <button
              type="button"
              onClick={() => setBlown(true)}
              disabled={blown}
              className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white hover:border-white/60 disabled:opacity-70"
            >
              <span aria-live="polite">{blown ? t.candle.blown : t.candle.blow}</span>
            </button>
          )}
        </>
      }
      primary={
        <>
          {canThank ? (
            <button
              type="button"
              onClick={thank}
              disabled={isPending}
              className="w-full rounded-full bg-accent px-4 py-3 text-sm font-semibold uppercase tracking-wider text-accent-ink disabled:opacity-60"
            >
              {isPending ? t.thankYou.sending : t.open.sendThankYou}
            </button>
          ) : (
            <DoneButton className="w-full rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink" />
          )}
          {thanks.kind === "sent" && (
            <p role="status" className="text-sm text-white/85">
              {t.thankYou.sent}
            </p>
          )}
          {thanks.kind === "thanked" && <p className="text-xs text-white/65">{t.open.thanked}</p>}
          {thanks.kind === "error" && (
            <p role="alert" className="text-sm text-red-200">
              {byCode(t.errors, thanks.code)}
            </p>
          )}
        </>
      }
      secondary={
        canThank ? (
          <DoneButton className="flex h-10 items-center rounded-full border border-white/30 px-4 text-sm font-medium text-white hover:border-white/60" />
        ) : null
      }
    />
  );
}

function DoneButton({ className }: { className: string }) {
  const { t } = useGiftsText();
  const close = useGiftRevealClose();
  return (
    <button type="button" onClick={() => close()} className={className}>
      {t.open.done}
    </button>
  );
}
