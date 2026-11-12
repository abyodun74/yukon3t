import { beforeEach, describe, expect, it, vi } from "vitest";
import { adPaymentVerdict } from "@/lib/ad-payment";

// The Stripe webhook marks an ad campaign paid only for a session that is actually paid, is the campaign's own, and
// charged exactly its price (src/lib/ad-payment.ts).

const campaign = { id: "cad00000000001", stripeCheckoutSessionId: "cs_test_1", priceCents: 4900, currency: "usd" };
const paidSession = { id: "cs_test_1", payment_status: "paid", amount_total: 4900, currency: "usd" };

describe("adPaymentVerdict", () => {
  it("is paid only for this campaign's session, paid in full in its currency", () => {
    expect(adPaymentVerdict(paidSession, campaign)).toBe("paid");
    expect(adPaymentVerdict({ ...paidSession, currency: "USD" }, campaign)).toBe("paid");
  });

  it("waits for the money on a delayed payment method", () => {
    expect(adPaymentVerdict({ ...paidSession, payment_status: "unpaid" }, campaign)).toBe("awaiting_payment");
    expect(adPaymentVerdict({ ...paidSession, payment_status: "no_payment_required" }, campaign)).toBe(
      "awaiting_payment",
    );
  });

  it("refuses another session, another amount or another currency", () => {
    expect(adPaymentVerdict({ ...paidSession, id: "cs_other" }, campaign)).toBe("mismatch");
    expect(adPaymentVerdict(paidSession, { ...campaign, stripeCheckoutSessionId: null })).toBe("mismatch");
    expect(adPaymentVerdict({ ...paidSession, amount_total: 1 }, campaign)).toBe("mismatch");
    expect(adPaymentVerdict({ ...paidSession, amount_total: null }, campaign)).toBe("mismatch");
    expect(adPaymentVerdict({ ...paidSession, currency: "eur" }, campaign)).toBe("mismatch");
  });
});

let event: { type: string; data: { object: Record<string, unknown> } };
const updateMany = vi.fn<(...args: unknown[]) => Promise<{ count: number }>>(async () => ({ count: 1 }));
const captureError = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

vi.mock("@/lib/stripe", () => ({ constructWebhookEvent: () => event }));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adCampaign: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === campaign.id ? campaign : null),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
  },
}));

const { POST } = await import("./route");

function deliver(type: string, session: Record<string, unknown>) {
  event = { type, data: { object: { metadata: { campaignId: campaign.id }, payment_intent: "pi_1", ...session } } };
  return POST(new Request("https://example.test/api/webhooks/stripe", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1" } }));
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    updateMany.mockClear();
    captureError.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("marks a paid checkout paid, guarded on PENDING_PAYMENT and the session id", async () => {
    const res = await deliver("checkout.session.completed", paidSession);
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: campaign.id, status: "PENDING_PAYMENT", stripeCheckoutSessionId: "cs_test_1" },
      data: expect.objectContaining({ status: "PENDING_REVIEW", stripePaymentIntentId: "pi_1" }),
    });
  });

  it("does not mark an unpaid (delayed) checkout paid, then does once async_payment_succeeded arrives", async () => {
    await deliver("checkout.session.completed", { ...paidSession, payment_status: "unpaid" });
    expect(updateMany).not.toHaveBeenCalled();
    await deliver("checkout.session.async_payment_succeeded", paidSession);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("ignores async_payment_failed and reports a mismatched amount without marking it paid", async () => {
    await deliver("checkout.session.async_payment_failed", { ...paidSession, payment_status: "unpaid" });
    await deliver("checkout.session.completed", { ...paidSession, amount_total: 100 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
