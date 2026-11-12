import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { constructWebhookEvent } from "@/lib/stripe";
import { AD_PAYMENT_EVENTS, adPaymentVerdict } from "@/lib/ad-payment";
import { captureError } from "@/lib/error-tracking";
import type Stripe from "stripe";

/**
 * The only place a campaign moves from PENDING_PAYMENT to PENDING_REVIEW —
 * createAdCampaign only gets the advertiser to Stripe Checkout, it can't
 * itself know whether the card was actually charged. Reads the raw body
 * (request.text(), not .json()) because Stripe's signature is computed over
 * the exact bytes sent; anything that reparses/reserializes JSON first
 * would invalidate it.
 *
 * Marked paid only on a session that is actually paid (`payment_status: "paid"`), is the one this campaign created,
 * and charged exactly the campaign's price (src/lib/ad-payment.ts). A delayed payment method completes Checkout
 * unpaid; its `checkout.session.async_payment_succeeded` event is what marks it paid, and a failed one leaves the
 * campaign in PENDING_PAYMENT (an admin can reject it).
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (AD_PAYMENT_EVENTS.has(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session;
    const campaignId = session.metadata?.campaignId;
    const campaign = campaignId
      ? await prisma.adCampaign.findUnique({
          where: { id: campaignId },
          select: { id: true, stripeCheckoutSessionId: true, priceCents: true, currency: true },
        })
      : null;
    if (campaign) {
      const verdict = adPaymentVerdict(session, campaign);
      if (verdict === "paid") {
        const paymentIntentId =
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        // updateMany + a status guard, not update: a retried webhook delivery
        // (Stripe resends on anything but a 2xx), or completed followed by
        // async_payment_succeeded, must not overwrite paidAt with a later
        // timestamp or bounce a campaign an admin already reviewed back to
        // PENDING_REVIEW.
        await prisma.adCampaign.updateMany({
          where: { id: campaign.id, status: "PENDING_PAYMENT", stripeCheckoutSessionId: session.id },
          data: { status: "PENDING_REVIEW", paidAt: new Date(), stripePaymentIntentId: paymentIntentId },
        });
      } else if (verdict === "mismatch") {
        // Ids and amounts only: no advertiser details in logs.
        const detail = {
          where: "stripe-webhook",
          eventType: event.type,
          campaignId: campaign.id,
          sessionId: session.id,
          amountTotal: session.amount_total,
          currency: session.currency,
        };
        console.error("[stripe-webhook] checkout session does not match its campaign; not marked paid", detail);
        await captureError(new Error("Stripe checkout session does not match its ad campaign"), detail);
      }
    }
  }

  return NextResponse.json({ received: true });
}
