import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_CALLER_NAME } from "@/lib/hidden-chats-rules";

const avatarUrlForRing = vi.fn();
vi.mock("@/lib/avatar-storage", () => ({ avatarUrlForRing: (...a: unknown[]) => avatarUrlForRing(...a) }));

import { nativeRingCallerAvatarUrl } from "@/lib/call-avatar-server";

const ROUTE_AVATAR = "/api/avatar/ana1/0f8fad5b-d9cb-469f-a165-70867728950e-t.jpg";
const SIGNED = "https://acct.r2.cloudflarestorage.com/yk-avatars/avatar/ana1/0f8fad5b-d9cb-469f-a165-70867728950e-t.jpg?X-Amz-Expires=300&X-Amz-Signature=abc";

describe("nativeRingCallerAvatarUrl", () => {
  beforeEach(() => {
    avatarUrlForRing.mockReset();
  });

  it("signs a private (route-form) avatar and passes the absolute link on", async () => {
    avatarUrlForRing.mockResolvedValue(SIGNED);
    await expect(nativeRingCallerAvatarUrl("Ana", ROUTE_AVATAR)).resolves.toBe(SIGNED);
    expect(avatarUrlForRing).toHaveBeenCalledWith(ROUTE_AVATAR);
  });

  it("never sends a picture for a caller announced as Private call, and doesn't even sign one", async () => {
    avatarUrlForRing.mockResolvedValue(SIGNED);
    await expect(nativeRingCallerAvatarUrl(HIDDEN_CALLER_NAME, ROUTE_AVATAR)).resolves.toBeNull();
    expect(avatarUrlForRing).not.toHaveBeenCalled();
  });

  it("is null for a caller with no picture", async () => {
    await expect(nativeRingCallerAvatarUrl("Ana", null)).resolves.toBeNull();
    expect(avatarUrlForRing).not.toHaveBeenCalled();
  });

  it("is null when signing fails or throws, so the ring just has no picture", async () => {
    avatarUrlForRing.mockResolvedValue(null);
    await expect(nativeRingCallerAvatarUrl("Ana", ROUTE_AVATAR)).resolves.toBeNull();
    avatarUrlForRing.mockImplementation(async () => {
      throw new Error("r2 down");
    });
    await expect(nativeRingCallerAvatarUrl("Ana", ROUTE_AVATAR)).resolves.toBeNull();
  });

  it("drops anything that isn't an absolute https URL (a relative route URL needs a session cookie)", async () => {
    for (const bad of [ROUTE_AVATAR, "http://media.example.com/a.jpg", "javascript:alert(1)", `https://x/${"a".repeat(3000)}`]) {
      avatarUrlForRing.mockResolvedValue(bad);
      await expect(nativeRingCallerAvatarUrl("Ana", "https://media.example.com/a.jpg")).resolves.toBeNull();
    }
  });

  it("keeps a legacy public https avatar as is", async () => {
    const legacy = "https://media.example.com/avatar/ana1/0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
    avatarUrlForRing.mockResolvedValue(legacy);
    await expect(nativeRingCallerAvatarUrl(null, legacy)).resolves.toBe(legacy);
  });
});
