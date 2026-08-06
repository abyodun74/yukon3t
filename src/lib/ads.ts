/**
 * Placeholder pricing — a flat rate per day, no audience targeting or
 * placement tiers. Easy to tune from one place once real pricing is
 * decided; nothing else hardcodes a dollar amount.
 */
export const AD_PRICE_PER_DAY_CENTS = 4900; // $49.00/day
export const AD_CURRENCY = "usd";
export const AD_DURATION_OPTIONS = [3, 7, 14, 30] as const;
export const MAX_AD_VIDEO_SECONDS = 30;

export function adPriceCents(durationDays: number) {
  return durationDays * AD_PRICE_PER_DAY_CENTS;
}

export function formatCents(cents: number, currency: string = AD_CURRENCY) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
