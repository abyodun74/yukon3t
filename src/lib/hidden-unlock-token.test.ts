import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIDDEN_UNLOCK_MAX_AGE_SECONDS,
  encodeHiddenUnlockToken,
  verifyHiddenUnlockToken,
} from "@/lib/hidden-unlock-token";
import { encode } from "next-auth/jwt";

const SECRET = "test-secret-for-hidden-unlock-token-0123456789";

afterEach(() => {
  vi.useRealTimers();
});

describe("hidden unlock token", () => {
  it("verifies for the user it was issued to", async () => {
    const token = await encodeHiddenUnlockToken("user-1", SECRET);
    expect(await verifyHiddenUnlockToken(token, "user-1", SECRET)).toBe(true);
  });

  it("is refused for any other user", async () => {
    const token = await encodeHiddenUnlockToken("user-1", SECRET);
    expect(await verifyHiddenUnlockToken(token, "user-2", SECRET)).toBe(false);
    expect(await verifyHiddenUnlockToken(token, "", SECRET)).toBe(false);
  });

  it("is refused when missing or not a token at all", async () => {
    expect(await verifyHiddenUnlockToken(undefined, "user-1", SECRET)).toBe(false);
    expect(await verifyHiddenUnlockToken("", "user-1", SECRET)).toBe(false);
    expect(await verifyHiddenUnlockToken("user-1", "user-1", SECRET)).toBe(false);
  });

  it("is refused once tampered with", async () => {
    const token = await encodeHiddenUnlockToken("user-1", SECRET);
    const middle = Math.floor(token.length / 2);
    const flipped = token.slice(0, middle) + (token[middle] === "A" ? "B" : "A") + token.slice(middle + 1);
    expect(await verifyHiddenUnlockToken(flipped, "user-1", SECRET)).toBe(false);
    expect(await verifyHiddenUnlockToken(token.slice(0, -4), "user-1", SECRET)).toBe(false);
  });

  it("is refused under a different secret", async () => {
    const token = await encodeHiddenUnlockToken("user-1", SECRET);
    expect(await verifyHiddenUnlockToken(token, "user-1", `${SECRET}-other`)).toBe(false);
  });

  it("can't be forged from a token signed for another purpose with the same secret", async () => {
    const sessionLike = await encode({ token: { sub: "user-1" }, secret: SECRET, salt: "authjs.session-token" });
    expect(await verifyHiddenUnlockToken(sessionLike, "user-1", SECRET)).toBe(false);
  });

  it("expires after about ten minutes", async () => {
    expect(HIDDEN_UNLOCK_MAX_AGE_SECONDS).toBe(600);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const token = await encodeHiddenUnlockToken("user-1", SECRET);

    vi.setSystemTime(new Date("2026-10-11T12:09:00Z"));
    expect(await verifyHiddenUnlockToken(token, "user-1", SECRET)).toBe(true);

    vi.setSystemTime(new Date("2026-10-11T12:11:00Z"));
    expect(await verifyHiddenUnlockToken(token, "user-1", SECRET)).toBe(false);
  });
});
