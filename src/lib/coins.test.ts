import { describe, expect, it } from "vitest";
import {
  COIN_BALANCE_MAX,
  COIN_GRANT_MAX,
  GIFT_QUANTITY_MAX,
  balanceAfterSpend,
  coinGrantKey,
  coinPurchaseKey,
  coinRefundKey,
  coinTotal,
  formatCoins,
  grantRefusal,
  isClientRequestId,
  normalizeGiftQuantity,
  sameCoinRequest,
  spendRefusal,
} from "@/lib/coins";
import { checkoutRequestId } from "@/lib/use-checkout-request-id";

// Y3T Coins' pure rules: the server-side total, quantities, balances, grants and the idempotency keys.

describe("coin totals (always computed on the server from its own price)", () => {
  it("is unit price x quantity, for sane whole numbers only", () => {
    expect(coinTotal(25, 1)).toBe(25);
    expect(coinTotal(25, 4)).toBe(100);
    expect(coinTotal(1500, GIFT_QUANTITY_MAX)).toBe(15000);
    expect(coinTotal(null, 1)).toBeNull();
    expect(coinTotal(undefined, 1)).toBeNull();
    expect(coinTotal(0, 1)).toBeNull();
    expect(coinTotal(-5, 1)).toBeNull();
    expect(coinTotal(2.5, 2)).toBeNull();
    expect(coinTotal(25, 0)).toBeNull();
    expect(coinTotal(25, GIFT_QUANTITY_MAX + 1)).toBeNull();
    expect(coinTotal(25, 1.5)).toBeNull();
  });

  it("accepts a quantity of 1..10 (absent means 1), nothing else", () => {
    expect(normalizeGiftQuantity(undefined)).toBe(1);
    expect(normalizeGiftQuantity(1)).toBe(1);
    expect(normalizeGiftQuantity(10)).toBe(10);
    for (const bad of [0, 11, -1, 1.5, "2", null, NaN, Infinity]) expect(normalizeGiftQuantity(bad), String(bad)).toBeNull();
  });
});

describe("balances", () => {
  it("refuses a spend the balance can't cover, and allows spending it exactly to zero", () => {
    expect(spendRefusal(100, 101)).toBe("insufficient_coins");
    expect(spendRefusal(100, 100)).toBeNull();
    expect(spendRefusal(0, 1)).toBe("insufficient_coins");
    expect(balanceAfterSpend(100, 100)).toBe(0);
    expect(balanceAfterSpend(175, 25)).toBe(150);
  });

  it("caps grants per grant and per wallet", () => {
    expect(grantRefusal(1, 0)).toBeNull();
    expect(grantRefusal(COIN_GRANT_MAX, 0)).toBeNull();
    for (const bad of [0, -10, COIN_GRANT_MAX + 1, 2.5, "100", null]) expect(grantRefusal(bad, 0), String(bad)).toBe("invalid_amount");
    expect(grantRefusal(10, COIN_BALANCE_MAX - 10)).toBeNull();
    expect(grantRefusal(11, COIN_BALANCE_MAX - 10)).toBe("balance_cap");
  });
});

describe("idempotency", () => {
  it("scopes a purchase key to its buyer, so two people's request ids never collide", () => {
    expect(coinPurchaseKey("userA", "req-1")).toBe("coins:userA:req-1");
    expect(coinPurchaseKey("userA", "req-1")).not.toBe(coinPurchaseKey("userB", "req-1"));
    expect(coinRefundKey("p1")).toBe("refund:p1");
    expect(coinGrantKey("form-1")).toBe("grant:form-1");
    // The three kinds of key can't be confused with each other.
    expect(new Set([coinPurchaseKey("x", "y"), coinRefundKey("x"), coinGrantKey("x")]).size).toBe(3);
  });

  it("accepts only request ids of a safe shape", () => {
    expect(isClientRequestId("3f0e5a3c-8a1b-4c7d-9e2f-1a2b3c4d5e6f")).toBe(true);
    expect(isClientRequestId("abcdef0123456789abcdef0123456789")).toBe(true);
    for (const bad of ["", "short", "has space here", "x".repeat(65), "a:b:c:d:e:f", null, 12345678]) {
      expect(isClientRequestId(bad), String(bad)).toBe(false);
    }
  });

  it("treats only the very same request as a retry", () => {
    const request = { buyerId: "u", productId: "p", quantity: 2, recipientId: "r" };
    expect(sameCoinRequest({ ...request }, request)).toBe(true);
    expect(sameCoinRequest({ ...request, quantity: 1 }, request)).toBe(false);
    expect(sameCoinRequest({ ...request, productId: "q" }, request)).toBe(false);
    expect(sameCoinRequest({ ...request, recipientId: "s" }, request)).toBe(false);
    expect(sameCoinRequest({ ...request, buyerId: null }, request)).toBe(false);
  });

  it("the checkout reuses one request id for retries of the same choice, and a new one for a new choice", () => {
    let n = 0;
    const make = () => `id-${++n}`;
    const first = checkoutRequestId(null, "rose|bob|1|", make);
    expect(first.id).toBe("id-1");
    const retry = checkoutRequestId(first.state, "rose|bob|1|", make);
    expect(retry.id).toBe("id-1");
    const changed = checkoutRequestId(retry.state, "rose|bob|2|", make);
    expect(changed.id).toBe("id-2");
    // After a settled answer (state cleared) the same choice is a new request.
    expect(checkoutRequestId(null, "rose|bob|2|", make).id).toBe("id-3");
  });
});

describe("display", () => {
  it("formats amounts in the reader's language, with no currency", () => {
    expect(formatCoins(1500, "en")).toBe("1,500");
    expect(formatCoins(1500, "de")).toBe("1.500");
    expect(formatCoins(25, "en")).not.toMatch(/[$€£]/);
  });
});
