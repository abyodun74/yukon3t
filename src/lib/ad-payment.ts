/**
 * Whether a Stripe Checkout Session really paid for an ad campaign (pure; used by the Stripe webhook route).
 *
 * `checkout.session.completed` only means the customer finished Checkout. With a delayed payment method (bank debit,
 * some wallets) it arrives with `payment_status: "unpaid"` and the money follows later in
 * `checkout.session.async_payment_succeeded` (or never, `..._failed`). So a campaign is marked paid only when the
 * session says `paid` AND it is the session this campaign created (stored as `stripeCheckoutSessionId`) AND the amount
 * and currency are exactly the campaign's price. Anything else leaves the campaign where it is.
 */

export type AdCheckoutSessionFacts = {
  id: string;
  payment_status: string | null | undefined;
  amount_total: number | null | undefined;
  currency: string | null | undefined;
};

export type AdCampaignPaymentFacts = {
  stripeCheckoutSessionId: string | null;
  priceCents: number;
  currency: string;
};

export type AdPaymentVerdict =
  /** Paid in full for this campaign: move PENDING_PAYMENT -> PENDING_REVIEW. */
  | "paid"
  /** Checkout finished but the money hasn't arrived (delayed method): wait for async_payment_succeeded. */
  | "awaiting_payment"
  /** Not this campaign's session, or a different amount/currency: never mark paid; report it. */
  | "mismatch";

export function adPaymentVerdict(session: AdCheckoutSessionFacts, campaign: AdCampaignPaymentFacts): AdPaymentVerdict {
  if (!campaign.stripeCheckoutSessionId || campaign.stripeCheckoutSessionId !== session.id) return "mismatch";
  if (session.amount_total !== campaign.priceCents) return "mismatch";
  if ((session.currency ?? "").toLowerCase() !== campaign.currency.toLowerCase()) return "mismatch";
  if (session.payment_status !== "paid") return "awaiting_payment";
  return "paid";
}

/** The Checkout events that can carry a finished payment. */
export const AD_PAYMENT_EVENTS: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);
