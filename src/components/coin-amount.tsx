"use client";

import { useGiftsText } from "@/components/gifts-text";
import { formatCoins } from "@/lib/coins";
import { plural } from "@/lib/i18n/locales";

/**
 * A Y3T Coin amount: a small coin mark and the number, read out as "250 coins" by screen readers. Coins are granted by
 * YuKon3t and have no cash value, so this never shows a currency.
 */
export function CoinAmount({ amount, className }: { amount: number; className?: string }) {
  const { locale, t } = useGiftsText();
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${className ?? ""}`}>
      <CoinMark />
      <span aria-hidden>{formatCoins(amount, locale)}</span>
      <span className="sr-only">{plural(locale, t.market.coinsCount, amount)}</span>
    </span>
  );
}

/** The coin mark (decorative). */
export function CoinMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable={false} className="shrink-0">
      <circle cx="8" cy="8" r="7.25" fill="#F6C14B" stroke="#B9801A" strokeWidth="1.5" />
      <path d="M5.5 5.5 8 8.5l2.5-3M8 8.5V11" stroke="#8A5A12" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
