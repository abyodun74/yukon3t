import Stripe from "stripe";

// The official SDK, not a raw-fetch integration like daily.ts — webhook
// signature verification (constructEvent) is security-critical and easy to
// get subtly wrong by hand, unlike Daily's two simple REST calls.
export function isPaymentsConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let cachedClient: Stripe | null = null;

function client() {
  if (cachedClient) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("not_configured");
  cachedClient = new Stripe(key);
  return cachedClient;
}

/**
 * Hosted Stripe Checkout, not embedded Elements — the browser is fully
 * redirected to checkout.stripe.com and back, so no Stripe.js/publishable
 * key or CSP changes are needed on our side at all.
 */
export async function createAdCheckoutSession({
  campaignId,
  companyName,
  headline,
  priceCents,
  currency,
  contactEmail,
}: {
  campaignId: string;
  companyName: string;
  headline: string;
  priceCents: number;
  currency: string;
  contactEmail: string;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) throw new Error("not_configured");

  const session = await client().checkout.sessions.create({
    mode: "payment",
    customer_email: contactEmail,
    line_items: [
      {
        price_data: {
          currency,
          unit_amount: priceCents,
          product_data: {
            name: `YuKon3t ad: ${companyName}`,
            description: headline,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { campaignId },
    success_url: `${baseUrl}/advertise/success?campaign=${campaignId}`,
    cancel_url: `${baseUrl}/advertise?campaign=${campaignId}&canceled=1`,
  });

  return { url: session.url, sessionId: session.id };
}

export function constructWebhookEvent(payload: string | Buffer, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("not_configured");
  return client().webhooks.constructEvent(payload, signature, secret);
}

export async function retrieveCheckoutSession(sessionId: string) {
  return client().checkout.sessions.retrieve(sessionId);
}

/** Best-effort — a refund failing (e.g. already refunded) shouldn't block rejecting the campaign itself. */
export async function refundAdPayment(paymentIntentId: string) {
  try {
    await client().refunds.create({ payment_intent: paymentIntentId });
    return true;
  } catch {
    return false;
  }
}
