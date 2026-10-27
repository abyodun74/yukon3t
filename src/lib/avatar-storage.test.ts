import { beforeEach, describe, expect, it, vi } from "vitest";

const presignAvatarGet = vi.fn();
const isAvatarBucketConfigured = vi.fn();
vi.mock("@/lib/storage", () => ({
  presignAvatarGet: (...a: unknown[]) => presignAvatarGet(...a),
  isAvatarBucketConfigured: () => isAvatarBucketConfigured(),
  deleteAvatarObject: vi.fn(),
  deleteObject: vi.fn(),
  headAvatarObject: vi.fn(),
  keyBelongsToOwner: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));

import { avatarUrlForRing, RING_AVATAR_PRESIGN_TTL_SECONDS } from "@/lib/avatar-storage";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("avatarUrlForRing", () => {
  beforeEach(() => {
    presignAvatarGet.mockReset();
    isAvatarBucketConfigured.mockReset().mockReturnValue(true);
  });

  it("signs only the thumbnail of a two-size private avatar, for a few minutes, signed now", async () => {
    presignAvatarGet.mockResolvedValue("https://signed.example/t");
    await expect(avatarUrlForRing(`/api/avatar/ana1/${UUID}-t.jpg`)).resolves.toBe("https://signed.example/t");
    expect(presignAvatarGet).toHaveBeenCalledTimes(1);
    const [key, options] = presignAvatarGet.mock.calls[0] as [string, { expiresIn: number; signingDate?: Date }];
    expect(key).toBe(`avatar/ana1/${UUID}-t.jpg`);
    expect(options.expiresIn).toBe(RING_AVATAR_PRESIGN_TTL_SECONDS);
    expect(RING_AVATAR_PRESIGN_TTL_SECONDS).toBeLessThanOrEqual(600);
    // Not the hour-aligned signing the in-app route uses: that could leave a link already near its end.
    expect(options.signingDate).toBeUndefined();
  });

  it("returns a legacy public avatar unchanged and null for none", async () => {
    await expect(avatarUrlForRing("https://media.example.com/a.jpg")).resolves.toBe("https://media.example.com/a.jpg");
    await expect(avatarUrlForRing(null)).resolves.toBeNull();
    expect(presignAvatarGet).not.toHaveBeenCalled();
  });

  it("is null without the private bucket, or when signing fails", async () => {
    isAvatarBucketConfigured.mockReturnValue(false);
    await expect(avatarUrlForRing(`/api/avatar/ana1/${UUID}-t.jpg`)).resolves.toBeNull();
    isAvatarBucketConfigured.mockReturnValue(true);
    presignAvatarGet.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(avatarUrlForRing(`/api/avatar/ana1/${UUID}-t.jpg`)).resolves.toBeNull();
    error.mockRestore();
  });
});
