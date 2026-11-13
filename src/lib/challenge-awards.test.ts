import { beforeEach, describe, expect, it, vi } from "vitest";

// The Champion award (src/lib/challenge-awards.ts) and taking it back (src/lib/challenge-revoke.ts), against a mocked
// transaction: one SYSTEM_AWARD purchase per winner row (keyed by the row, so never twice), no buyer and no sender,
// delivered through deliverGiftPurchase only; revoking never deletes, and cancelling revokes every award, removes the
// winners' bell rows and keeps the record.

const deliverGiftPurchase = vi.fn(async (id: string) => {
  void id;
  return "delivered";
});
const sendPushToUser = vi.fn();
const sendFcmActivityToUser = vi.fn();
const notifyBadgeChange = vi.fn();
const captureError = vi.fn();
const revokeGiftSend = vi.fn(async (_tx: unknown, sendId: string) => ({ senderId: null, recipientId: `owner-of-${sendId}` }));

vi.mock("@/lib/gift-delivery", () => ({ deliverGiftPurchase: (id: string) => deliverGiftPurchase(id) }));
vi.mock("@/lib/push", () => ({ sendPushToUser: (...a: unknown[]) => sendPushToUser(...a) }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: (...a: unknown[]) => sendFcmActivityToUser(...a) }));
vi.mock("@/lib/realtime-server", () => ({ notifyBadgeChange: (...a: unknown[]) => notifyBadgeChange(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
vi.mock("@/lib/gift-revoke", () => ({ revokeGiftSend: (tx: unknown, id: string) => revokeGiftSend(tx, id) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { championAwardTxnId, createChampionAwardsInTx, deliverChallengeAwards, pushChallengeResult } from "@/lib/challenge-awards";
import { cancelChallengeInTx, revokeChallengeAward } from "@/lib/challenge-revoke";

let product: { id: string; currency: string } | null;
let purchases: Record<string, unknown>[];
let links: Record<string, string | null>;
let purchaseUpdates: unknown[];

function tx() {
  return {
    giftProduct: { findFirst: vi.fn(async () => product) },
    giftPurchase: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        purchases.push(data);
        return { id: `p${purchases.length}`, send: { id: `s${purchases.length}` } };
      }),
      updateMany: vi.fn(async (args: unknown) => {
        purchaseUpdates.push(args);
        return { count: 1 };
      }),
    },
    challengeWinner: {
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { awardSendId: string } }) => {
        if (links[where.id]) return { count: 0 };
        links[where.id] = data.awardSendId;
        return { count: 1 };
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  product = { id: "gift_product_award.arena-champion", currency: "USD" };
  purchases = [];
  links = {};
  purchaseUpdates = [];
});

describe("createChampionAwardsInTx", () => {
  it("creates one SYSTEM_AWARD purchase per new winner row: no buyer, no sender, price 0, keyed by the row", async () => {
    const t = tx();
    const ids = await createChampionAwardsInTx(t as never, "ch1", [
      { id: "w1", userId: "alice" },
      { id: "w2", userId: "bob" },
    ]);
    expect(ids).toEqual(["p1", "p2"]);
    expect(t.giftProduct.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sku: "award.arena-champion", active: true, webPriceMinor: 0 } }),
    );
    expect(purchases[0]).toMatchObject({
      buyerId: null,
      provider: "SYSTEM_AWARD",
      providerTxnId: championAwardTxnId("w1"),
      status: "PENDING",
      amountMinor: 0,
      rawRef: "challenge:ch1",
      send: { create: { senderId: null, recipientId: "alice", context: "DIRECT", status: "AWAITING_PAYMENT" } },
    });
    expect(links).toEqual({ w1: "s1", w2: "s2" });
  });

  it("is idempotent per winner row: a row already linked to an award makes the whole transaction fail", async () => {
    links.w1 = "s-old";
    await expect(createChampionAwardsInTx(tx() as never, "ch1", [{ id: "w1", userId: "alice" }])).rejects.toThrow();
    expect(championAwardTxnId("w1")).toBe(championAwardTxnId("w1"));
    expect(championAwardTxnId("w1")).not.toBe(championAwardTxnId("w2"));
  });

  it("gives nothing (the result still stands) when the award product is missing or switched off", async () => {
    product = null;
    expect(await createChampionAwardsInTx(tx() as never, "ch1", [{ id: "w1", userId: "alice" }])).toEqual([]);
    expect(purchases).toEqual([]);
  });
});

describe("deliverChallengeAwards", () => {
  it("delivers each through deliverGiftPurchase and never throws", async () => {
    deliverGiftPurchase.mockRejectedValueOnce(new Error("db blip"));
    await expect(deliverChallengeAwards(["p1", "p2"])).resolves.toBeUndefined();
    expect(deliverGiftPurchase.mock.calls.map((c) => c[0])).toEqual(["p1", "p2"]);
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});

describe("pushChallengeResult", () => {
  it("pushes the bell row's own link and the declarer's name only", async () => {
    await pushChallengeResult({ declarer: { id: "h", name: "Hana" }, winnerIds: ["alice"], circleSlug: "runners" });
    const payload = (sendPushToUser.mock.calls[0][1] as (l: string) => { title: string; body: string; url: string })("en");
    expect(payload).toEqual({ title: "Hana", body: "declared you a winner of a challenge", url: "/circles/runners#challenges" });
    await pushChallengeResult({ declarer: { id: "h", name: null }, winnerIds: ["bob"], circleSlug: null });
    const live = (sendPushToUser.mock.calls[1][1] as (l: string) => { url: string })("en");
    expect(live.url).toBe("/u/bob#gifts");
    expect(notifyBadgeChange).toHaveBeenCalledWith("bob");
  });
});

describe("revoking and cancelling", () => {
  it("revokes an award without deleting it: a pending purchase can't be delivered any more", async () => {
    const t = tx();
    await revokeChallengeAward(t as never, "s1");
    expect(purchaseUpdates[0]).toEqual({ where: { send: { id: "s1" }, status: "PENDING" }, data: { status: "REVOKED" } });
    expect(revokeGiftSend).toHaveBeenCalledWith(t, "s1");
  });

  function cancelTx(status: string) {
    const state = { status, updated: null as unknown, deleted: null as unknown };
    const t = {
      ...tx(),
      challenge: {
        findUnique: vi.fn(async () => ({
          id: "ch1",
          status: state.status,
          hostId: "host",
          circleId: "circle",
          liveStreamId: null,
          winners: [
            { userId: "alice", awardSendId: "s1" },
            { userId: "bob", awardSendId: null },
          ],
        })),
        updateMany: vi.fn(async ({ data }: { data: unknown }) => {
          state.updated = data;
          return { count: 1 };
        }),
      },
      notification: {
        deleteMany: vi.fn(async (args: unknown) => {
          state.deleted = args;
          return { count: 2 };
        }),
      },
    };
    return { t, state };
  }

  it("cancels: CANCELLED, every award revoked, the winners' bell rows removed, the winner rows kept", async () => {
    const { t, state } = cancelTx("DECIDED");
    const out = await cancelChallengeInTx(t as never, "ch1", { userId: null, byAdmin: true });
    expect(out).toMatchObject({ hostId: "host", wasDecided: true, winnerIds: ["alice", "bob"] });
    expect(state.updated).toMatchObject({ status: "CANCELLED", cancelledById: null, cancelledByAdmin: true });
    expect(revokeGiftSend).toHaveBeenCalledTimes(1);
    expect(revokeGiftSend).toHaveBeenCalledWith(t, "s1");
    expect(state.deleted).toEqual({ where: { challengeId: "ch1", type: "CHALLENGE_RESULT" } });
  });

  it("leaves an already cancelled challenge alone", async () => {
    const { t, state } = cancelTx("CANCELLED");
    await cancelChallengeInTx(t as never, "ch1", { userId: "host", byAdmin: false });
    expect(state.updated).toBeNull();
    expect(revokeGiftSend).not.toHaveBeenCalled();
  });
});
