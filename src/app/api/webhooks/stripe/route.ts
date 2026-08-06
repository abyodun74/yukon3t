import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { constructWebhookEvent } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * The only place a campaign moves from PENDING_PAYMENT to PENDING_REVIEW —
 * createAdCampaign only gets the advertiser to Stripe Checkout, it can't
 * itself know whether the card was actually charged. Reads the raw body
 * (request.text(), not .json()) because Stripe's signature is computed over
 * the exact bytes sent; anything that reparses/reserializes JSON first
 * would invalidate it.
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const campaignId = session.metadata?.campaignId;
    if (campaignId) {
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

      // updateMany + a status guard, not update: a retried webhook delivery
      // (Stripe resends on anything but a 2xx) hitting this twice should
      // not overwrite paidAt with a later timestamp or bounce a campaign an
      // admin already reviewed back to PENDING_REVIEW.
      await prisma.adCampaign.updateMany({
        where: { id: campaignId, status: "PENDING_PAYMENT" },
        data: { status: "PENDING_REVIEW", paidAt: new Date(), stripePaymentIntentId: paymentIntentId },
      });
    }
  }

  return NextResponse.json({ received: true });
}
