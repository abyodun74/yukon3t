import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sweep-stuck-gift-purchases cron route: bearer-authenticated (CRON_SECRET), runs one bounded sweep
// (src/lib/gift-purchase-sweep.ts, tested in gift-purchase-sweep.test.ts) and reports a failed run as a 500 and to
// error tracking.
const sweepStuckGiftPurchases = vi.fn();
const captureError = vi.fn();
vi.mock("@/lib/gift-purchase-sweep", () => ({ sweepStuckGiftPurchases: (...a: unknown[]) => sweepStuckGiftPurchases(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

import { GET } from "./route";

const request = (auth?: string) =>
  new Request("https://yukon3t.test/api/cron/sweep-stuck-gift-purchases", auth ? { headers: { authorization: auth } } : {});
const empty = { due: 0, delivered: 0, undeliverable: 0, refunded: 0, alreadyDone: 0, busy: 0, failed: 0, skipped: 0 };

describe("GET /api/cron/sweep-stuck-gift-purchases", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    sweepStuckGiftPurchases.mockReset();
    sweepStuckGiftPurchases.mockResolvedValue(empty);
    captureError.mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("is not configured without CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(request("Bearer s3cret"))).status).toBe(503);
    expect(sweepStuckGiftPurchases).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong bearer token and sweeps nothing", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer nope"))).status).toBe(401);
    expect(sweepStuckGiftPurchases).not.toHaveBeenCalled();
  });

  it("runs one sweep and answers its counts", async () => {
    sweepStuckGiftPurchases.mockResolvedValue({ ...empty, due: 3, delivered: 1, refunded: 2 });
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: null, ...empty, due: 3, delivered: 1, refunded: 2 });
    expect(sweepStuckGiftPurchases).toHaveBeenCalledTimes(1);
  });

  it("reports a failed run as a 500 and to error tracking", async () => {
    sweepStuckGiftPurchases.mockRejectedValue(new Error("boom"));
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
