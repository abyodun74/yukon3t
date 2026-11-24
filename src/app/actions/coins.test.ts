import { beforeEach, describe, expect, it, vi } from "vitest";

// grantCoinsAction recipient lookup: id, then exact username, then exact (lowercased) email; refusals; grant unchanged.

type Row = { id: string; username: string | null; email: string; status: string; isGuestPreview: boolean };
const h = vi.hoisted(() => ({
  users: [] as Row[],
}));
const findUnique = vi.fn(async ({ where }: { where: Record<string, string> }) => {
  const [k, v] = Object.entries(where)[0];
  return h.users.find((u) => (u as unknown as Record<string, string | null>)[k] === v) ?? null;
});
const grantCoins = vi.fn(async (...args: unknown[]) => ({ outcome: "granted" as const, n: args.length }));
const getCoinBalance = vi.fn(async () => 0);

class Redirect extends Error {
  constructor(public to: string) {
    super(to);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireAdmin: async () => ({ id: "admin1" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: (a: never) => findUnique(a) } } }));
vi.mock("@/lib/coin-wallet", () => ({ grantCoins: (a: never) => grantCoins(a), getCoinBalance: () => getCoinBalance() }));

import { grantCoinsAction } from "./coins";

function form(recipient: string) {
  const f = new FormData();
  f.set("recipient", recipient);
  f.set("amount", "50");
  f.set("reason", "testing coins");
  f.set("formId", "form-id-12345");
  return f;
}
async function run(recipient: string) {
  try {
    await grantCoinsAction(form(recipient));
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  return "no-redirect";
}

beforeEach(() => {
  vi.clearAllMocks();
  h.users = [
    { id: "cmu1", username: "ada", email: "ada@example.com", status: "ACTIVE", isGuestPreview: false },
    { id: "cmu2", username: null, email: "owner@example.com", status: "ACTIVE", isGuestPreview: false },
    { id: "cmu3", username: "gone", email: "gone@example.com", status: "SUSPENDED", isGuestPreview: false },
    { id: "cmu4", username: "guest", email: "guest@example.com", status: "ACTIVE", isGuestPreview: true },
  ];
});

describe("grantCoinsAction recipient lookup", () => {
  it("finds by id first, then username, then email", async () => {
    expect(await run("cmu1")).toBe("/admin/coins?granted=50");
    expect(findUnique).toHaveBeenCalledTimes(1);
    findUnique.mockClear();
    expect(await run("@ada")).toBe("/admin/coins?granted=50");
    expect(findUnique).toHaveBeenCalledTimes(2);
    findUnique.mockClear();
    expect(await run("owner@example.com")).toBe("/admin/coins?granted=50");
    expect(findUnique.mock.calls.map((c) => Object.keys(c[0].where)[0])).toEqual(["id", "username", "email"]);
  });

  it("normalizes the email (trim, lowercase) and credits the user id, never the typed text", async () => {
    expect(await run("  Owner@Example.COM ")).toBe("/admin/coins?granted=50");
    const arg = grantCoins.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(arg[0]).toMatchObject({ adminId: "admin1", userId: "cmu2", amount: 50 });
    expect(JSON.stringify(arg[0])).not.toContain("example.com");
  });

  it("is exact only: partial usernames or emails match nothing", async () => {
    expect(await run("ad")).toBe("/admin/coins?error=recipient");
    expect(await run("owner@example")).toBe("/admin/coins?error=recipient");
    expect(await run("example.com")).toBe("/admin/coins?error=recipient");
    expect(grantCoins).not.toHaveBeenCalled();
  });

  it("refuses non-active and guest-preview accounts, also by email", async () => {
    expect(await run("gone@example.com")).toBe("/admin/coins?error=recipient");
    expect(await run("cmu3")).toBe("/admin/coins?error=recipient");
    expect(await run("guest@example.com")).toBe("/admin/coins?error=recipient");
    expect(grantCoins).not.toHaveBeenCalled();
  });

  it("keeps the balance cap and duplicate outcomes", async () => {
    getCoinBalance.mockResolvedValueOnce(2_000_000_000);
    expect(await run("ada")).toBe("/admin/coins?error=balance_cap");
    grantCoins.mockResolvedValueOnce({ outcome: "duplicate" } as never);
    expect(await run("ada")).toBe("/admin/coins?duplicate=1");
  });
});
