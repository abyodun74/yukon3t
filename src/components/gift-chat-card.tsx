"use client";

import { useEffect, useState, useTransition } from "react";
import { GiftArt } from "@/components/gift-art";
import { GiftOpenOverlay } from "@/components/gift-open-overlay";
import { useGiftsText } from "@/components/gifts-text";
import { getGiftChatCard, openGift, sendThankYouGift, type GiftChatCard as Card, type OpenedGift } from "@/app/actions/gifts";
import { byCode } from "@/lib/i18n/locales";
import { giftItemName, giftProductName } from "@/lib/gift-names";

/**
 * A gift inside a chat (Message.giftSendId). The message itself carries nothing but the link; the card is loaded
 * from the server for the two people in the chat (getGiftChatCard), so a revoked gift or a block since shows only
 * "no longer available". The recipient can open it from here, and (Phase A) send one free "Thank You" back for it,
 * which lands as a card in this same chat. A Thank You card offers nothing further: no reply gift, nothing to buy.
 * Rendered only where gifts are on for the viewer.
 */
export function GiftChatCard({ giftSendId }: { giftSendId: string }) {
  const { locale, dir, t } = useGiftsText();
  const [card, setCard] = useState<Card | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [opened, setOpened] = useState<OpenedGift | null>(null);
  const [isPending, startTransition] = useTransition();
  const [thanks, setThanks] = useState<{ kind: "idle" | "sent" } | { kind: "error"; code: string }>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    getGiftChatCard(giftSendId)
      .then((result) => {
        if (cancelled) return;
        if (result.error) setState("unavailable");
        else {
          setCard(result.card);
          setState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [giftSendId]);

  function open() {
    startTransition(async () => {
      try {
        const result = await openGift(giftSendId);
        if (result.error === null) {
          setOpened(result.gift);
          setCard((c) => (c ? { ...c, status: "OPENED" } : c));
        }
      } catch {
        // The card stays as it was; the recipient can try again.
      }
    });
  }

  function thank() {
    startTransition(async () => {
      try {
        const result = await sendThankYouGift(giftSendId);
        if (result.error) {
          setThanks({ kind: "error", code: result.error });
          if (result.error === "already_thanked") setCard((c) => (c ? { ...c, canThank: false } : c));
          return;
        }
        setThanks({ kind: "sent" });
        setCard((c) => (c ? { ...c, canThank: false } : c));
      } catch {
        setThanks({ kind: "error", code: "other" });
      }
    });
  }

  if (state !== "ready" || !card) {
    return (
      <p lang={locale} dir={dir} className="text-xs italic text-foreground-soft" role={state === "loading" ? "status" : undefined}>
        {state === "loading" ? t.card.loading : t.card.unavailable}
      </p>
    );
  }

  const statusLabel = card.status === "DELIVERED" ? t.card.unopened : card.status === "OPENED" ? t.card.opened : t.card.hidden;
  return (
    <div lang={locale} dir={dir} className="flex min-w-[12rem] items-center gap-3">
      <span className="flex shrink-0 -space-x-3 rtl:space-x-reverse">
        {card.items.slice(0, 3).map((item, i) => (
          <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={giftItemName(t, item.slug)} size={40} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{card.isRecipient ? t.card.received : t.card.sent}</span>
        <span className="block text-xs opacity-80">
          {giftProductName(t, { sku: card.productSku, isBox: card.isBox, items: card.items })} · {statusLabel}
        </span>
        {card.message && (
          <span dir="auto" className="mt-1 block break-words text-sm">
            {card.message}
          </span>
        )}
        {card.isRecipient && card.status === "DELIVERED" && (
          <button
            type="button"
            onClick={open}
            disabled={isPending}
            className="mt-1 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-60"
          >
            {t.card.open}
          </button>
        )}
        {card.isRecipient && card.canThank && !card.isThankYou && (
          <button
            type="button"
            onClick={thank}
            disabled={isPending}
            className="ms-1 mt-1 rounded-full border border-current/30 px-3 py-1 text-xs font-semibold disabled:opacity-60"
          >
            {isPending ? t.thankYou.sending : t.thankYou.button}
          </button>
        )}
        {thanks.kind === "sent" && (
          <span role="status" className="mt-1 block text-xs">
            {t.thankYou.sent}
          </span>
        )}
        {thanks.kind === "error" && (
          <span role="alert" className="mt-1 block text-xs">
            {byCode(t.errors, thanks.code)}
          </span>
        )}
      </span>
      <GiftOpenOverlay gift={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
