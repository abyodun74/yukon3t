// Y3T Coins: pure rules, unit-tested (coins.test.ts) and client-safe. The server half is coin-wallet.ts (the wallet and
// its ledger, every change in one transaction), the admin grant is app/actions/coins.ts and the spend is
// createGiftIntent (app/actions/gifts.ts).
//
// Owner decisions (2026-11): coins are GRANTED BY YUKON3T ONLY. Nobody can buy them: no Stripe, no Apple or Google
// billing, no price in money anywhere, and no "add coins" purchase path. They have no cash value, can't be transferred
// to anyone, sold or cashed out, and are only spent on gifts. A gift's price and total are always read and computed on
// the server; whatever a browser says a price, total or balance is, is never used.

/** The `currency` a coin-paid GiftPurchase records (its amountMinor is the coins spent). Never money. */
export const COIN_CURRENCY = "Y3T_COIN";

/** A grant never takes a wallet above this (the wallet itself only has to stay >= 0). */
export const COIN_BALANCE_MAX = 10_000_000;

/** One admin grant gives at most this many coins. */
export const COIN_GRANT_MAX = 100_000;

/** Longest reason an admin can record with a grant. */
export const COIN_GRANT_REASON_MAX = 200;

/** One purchase gives 1..GIFT_QUANTITY_MAX of a gift (the database CHECK says the same). */
export const GIFT_QUANTITY_MAX = 10;

/**
 * The quantity as a whole number in 1..GIFT_QUANTITY_MAX, or null for anything else (a fraction, 0, a string, NaN).
 * Absent (undefined) means 1.
 */
export function normalizeGiftQuantity(raw: unknown): number | null {
  if (raw === undefined) return 1;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= GIFT_QUANTITY_MAX ? raw : null;
}

/**
 * What `quantity` of a gift costs: the server's own unit price x quantity. Null when either is not a sane positive whole
 * number (a product with no coin price can't be sent for coins).
 */
export function coinTotal(unitPrice: number | null | undefined, quantity: number): number | null {
  if (typeof unitPrice !== "number" || !Number.isInteger(unitPrice) || unitPrice < 1) return null;
  if (normalizeGiftQuantity(quantity) === null) return null;
  return unitPrice * quantity;
}

/** "insufficient_coins" when a balance can't cover `total`, else null. */
export function spendRefusal(balance: number, total: number): "insufficient_coins" | null {
  return balance >= total ? null : "insufficient_coins";
}

/** What a wallet would have left after spending `total` (never below 0 in a real spend: spendRefusal comes first). */
export function balanceAfterSpend(balance: number, total: number): number {
  return balance - total;
}

/** Why an admin grant of `amount` to a wallet holding `balance` is refused, or null. */
export function grantRefusal(amount: unknown, balance: number): "invalid_amount" | "balance_cap" | null {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > COIN_GRANT_MAX) return "invalid_amount";
  if (balance + amount > COIN_BALANCE_MAX) return "balance_cap";
  return null;
}

/**
 * A request id the browser makes once per checkout (crypto.randomUUID()) and sends again with every retry of the same
 * checkout. Only its shape is checked; it is never trusted for anything but "is this the same request again".
 */
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
export function isClientRequestId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_REQUEST_ID.test(value);
}

/**
 * The idempotency key of one coin-paid purchase: GiftPurchase.providerTxnId (unique per provider) and the SPEND ledger
 * row's idempotencyKey. Scoped to the buyer, so one person's request id can never collide with another's.
 */
export function coinPurchaseKey(buyerId: string, clientRequestId: string): string {
  return `coins:${buyerId}:${clientRequestId}`;
}

/** The ledger idempotency key of the refund of one coin-paid purchase (written at most once). */
export function coinRefundKey(purchaseId: string): string {
  return `refund:${purchaseId}`;
}

/** The ledger idempotency key of one admin grant (the form's own id, so a double submit grants once). */
export function coinGrantKey(formId: string): string {
  return `grant:${formId}`;
}

/**
 * Whether an existing purchase found under a request's idempotency key is the same request (a retry or a double tap),
 * so its outcome may be answered again. Anything else under the same key is refused, never re-sent.
 */
export function sameCoinRequest(
  existing: { buyerId: string | null; productId: string; quantity: number; recipientId: string | null },
  request: { buyerId: string; productId: string; quantity: number; recipientId: string },
): boolean {
  return (
    existing.buyerId === request.buyerId &&
    existing.productId === request.productId &&
    existing.quantity === request.quantity &&
    existing.recipientId === request.recipientId
  );
}

/** A coin amount for display ("1,500"), in the reader's language. */
export function formatCoins(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
  } catch {
    return String(amount);
  }
}
