import { beforeEach, describe, expect, it, vi } from "vitest";

// Public ad counters (src/lib/ad-counters.ts): a validated campaign id, ACTIVE only, and once per viewer IP per
// campaign per window, so the numbers advertisers see can't be inflated by reloading or scripting the action.

const ACTIVE = "cad00000000001";
const updateMany = vi.fn(async ({ where }: { where: { id: string; status: string } }) => ({
  count: where.id === ACTIVE && where.status === "ACTIVE" ? 1 : 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { adCampaign: { updateMany: (a: { where: { id: string; status: string } }) => updateMany(a) } },
}));

const { recordAdClickFor, recordAdImpressionFor } = await import("@/lib/ad-counters");

describe("ad counters", () => {
  beforeEach(() => {
    updateMany.mockClear();
  });

  it("counts a click once per IP per campaign in its window, another IP separately", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}-${Math.random()}`;
    expect(await recordAdClickFor(ACTIVE, ip)).toBe(true);
    expect(await recordAdClickFor(ACTIVE, ip)).toBe(false);
    expect(await recordAdClickFor(ACTIVE, `${ip}-other`)).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: ACTIVE, status: "ACTIVE" },
      data: { clickCount: { increment: 1 } },
    });
  });

  it("counts impressions on their own budget", async () => {
    const ip = `impression-${Math.random()}`;
    expect(await recordAdImpressionFor(ACTIVE, ip)).toBe(true);
    expect(await recordAdImpressionFor(ACTIVE, ip)).toBe(false);
    expect(await recordAdClickFor(ACTIVE, ip)).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: ACTIVE, status: "ACTIVE" },
      data: { impressionCount: { increment: 1 } },
    });
  });

  it("ignores anything that isn't a campaign id without touching the database", async () => {
    for (const bad of [42, null, { id: ACTIVE }, "", "x".repeat(500), "not a cuid!"]) {
      expect(await recordAdClickFor(bad, `bad-${Math.random()}`)).toBe(false);
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("doesn't count a campaign that isn't ACTIVE", async () => {
    expect(await recordAdClickFor("cad00000000999", `inactive-${Math.random()}`)).toBe(false);
  });
});

describe("recordAdImpression is no longer a Server Action", async () => {
  it("is not exported from actions/ads.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/actions/ads.ts", "utf8");
    expect(source).not.toMatch(/export async function recordAdImpression/);
    expect(source).toMatch(/export async function recordAdClick\(id: unknown\)/);
  });
});
