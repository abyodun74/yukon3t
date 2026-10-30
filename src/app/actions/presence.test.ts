import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string; lastSeenAt: Date | null };
const updateMany = vi.fn();
const checkRateLimit = vi.fn(async () => true);

vi.mock("@/lib/auth-guards", () => ({ requireUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { updateMany: (...a: unknown[]) => updateMany(...a) } } }));

import { pingPresence } from "@/app/actions/presence";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pingPresence", () => {
  it("skips the write while lastSeenAt is under 30s old", async () => {
    user = { id: "u1", lastSeenAt: new Date(Date.now() - 10_000) };
    expect(await pingPresence()).toEqual({ error: null });
    expect(updateMany).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("writes lastSeenAt once it is older, or was never set", async () => {
    user = { id: "u1", lastSeenAt: new Date(Date.now() - 31_000) };
    await pingPresence();
    user = { id: "u1", lastSeenAt: null };
    await pingPresence();
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "u1" }, data: { lastSeenAt: expect.any(Date) } });
  });
});
