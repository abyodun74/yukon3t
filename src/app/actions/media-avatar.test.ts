import { beforeEach, describe, expect, it, vi } from "vitest";

// Profile pictures have one upload path: two presigned PUTs into the private avatar bucket (a ~320px thumbnail and a
// ~1080px image), then confirmPrivateAvatarUpload copies both to served keys, checks and moderates them, and saves the
// same-origin route form. There is no public path and no AVATAR_PRIVATE flag any more.

const OLD = "0f8fad5b-d9cb-469f-a165-70867728950e";
const T_UP = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const F_UP = "16fd2706-8baf-433b-82eb-8c7fada847da";
const NEW_UUID = "11111111-2222-4333-8444-555555555555";

const user = { id: "user1", avatarUrl: `/api/avatar/user1/${OLD}.jpg` as string | null };
const isAvatarBucketConfigured = vi.fn();
const createAvatarUploadUrl = vi.fn();
const copyAvatarObject = vi.fn();
const headAvatarObject = vi.fn();
const presignAvatarGet = vi.fn();
const deleteAvatarObject = vi.fn();
const moderateImage = vi.fn();
const deleteStoredAvatar = vi.fn();
const userUpdate = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return { ...actual, randomUUID: () => NEW_UUID };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: (...a: unknown[]) => userUpdate(...a) } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/moderation", () => ({ moderateImage: (...a: unknown[]) => moderateImage(...a) }));
vi.mock("@/lib/trust", () => ({ recomputeTrustScore: vi.fn() }));
vi.mock("@/lib/upload-records", () => ({ recordUploads: vi.fn() }));
vi.mock("@/lib/fetch-remote-image", () => ({ fetchRemoteImage: vi.fn() }));
vi.mock("@/lib/avatar-storage", () => ({ deleteStoredAvatar: (...a: unknown[]) => deleteStoredAvatar(...a) }));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    isAvatarBucketConfigured: () => isAvatarBucketConfigured(),
    createAvatarUploadUrl: (...a: unknown[]) => createAvatarUploadUrl(...a),
    copyAvatarObject: (...a: unknown[]) => copyAvatarObject(...a),
    headAvatarObject: (...a: unknown[]) => headAvatarObject(...a),
    presignAvatarGet: (...a: unknown[]) => presignAvatarGet(...a),
    deleteAvatarObject: (...a: unknown[]) => deleteAvatarObject(...a),
  };
});

const { requestPrivateAvatarUpload, confirmPrivateAvatarUpload } = await import("@/app/actions/media");

const thumbKey = `avatar-upload/user1/${T_UP}.webp`;
const fullKey = `avatar-upload/user1/${F_UP}.webp`;
const servedThumb = `avatar/user1/${NEW_UUID}-t.webp`;
const servedFull = `avatar/user1/${NEW_UUID}-f.webp`;

beforeEach(() => {
  vi.clearAllMocks();
  user.avatarUrl = `/api/avatar/user1/${OLD}.jpg`;
  isAvatarBucketConfigured.mockReturnValue(true);
  checkRateLimit.mockResolvedValue(true);
  let n = 0;
  createAvatarUploadUrl.mockImplementation(async () => {
    n += 1;
    return { uploadUrl: `https://r2.example.com/avatar-bucket/up${n}`, key: n === 1 ? thumbKey : fullKey };
  });
  copyAvatarObject.mockResolvedValue(undefined);
  headAvatarObject.mockImplementation(async (key: string) =>
    key === servedThumb ? { size: 30_000, contentType: "image/webp" } : { size: 400_000, contentType: "image/webp" },
  );
  presignAvatarGet.mockImplementation(async (key: string) => `https://signed.example/${key}`);
  moderateImage.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  deleteAvatarObject.mockResolvedValue(true);
  userUpdate.mockResolvedValue({});
});

describe("requestPrivateAvatarUpload", () => {
  it("hands out two private upload URLs (thumbnail + full)", async () => {
    const res = await requestPrivateAvatarUpload({ contentType: "image/webp" });
    expect(res).toEqual({
      error: null,
      thumbUploadUrl: "https://r2.example.com/avatar-bucket/up1",
      thumbKey,
      fullUploadUrl: "https://r2.example.com/avatar-bucket/up2",
      fullKey,
    });
    expect(createAvatarUploadUrl).toHaveBeenCalledTimes(2);
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
  });

  it("answers not_configured without the avatar bucket (no flag decides this any more)", async () => {
    isAvatarBucketConfigured.mockReturnValue(false);
    expect(await requestPrivateAvatarUpload({ contentType: "image/webp" })).toEqual({ error: "not_configured" });
    expect(createAvatarUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a type that isn't JPEG/PNG/WebP", async () => {
    expect((await requestPrivateAvatarUpload({ contentType: "image/gif" })).error).toBe("invalid");
    expect(createAvatarUploadUrl).not.toHaveBeenCalled();
  });
});

describe("confirmPrivateAvatarUpload", () => {
  it("copies both uploads to served keys, moderates both, saves the route form and deletes the previous picture", async () => {
    const res = await confirmPrivateAvatarUpload({ thumbKey, fullKey });
    expect(res).toEqual({ error: null, avatarUrl: `/api/avatar/user1/${NEW_UUID}-t.webp` });
    expect(copyAvatarObject.mock.calls).toEqual([
      [thumbKey, servedThumb],
      [fullKey, servedFull],
    ]);
    expect(moderateImage.mock.calls.map((c) => c[0]).sort()).toEqual(
      [`https://signed.example/${servedFull}`, `https://signed.example/${servedThumb}`].sort(),
    );
    // The upload keys are dropped once copied; the served ones stay.
    expect(deleteAvatarObject.mock.calls.map((c) => c[0]).sort()).toEqual([fullKey, thumbKey].sort());
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: { avatarUrl: `/api/avatar/user1/${NEW_UUID}-t.webp` },
    });
    // A user still on the old single-image (backfilled) route form gets it deleted through deleteStoredAvatar.
    expect(deleteStoredAvatar).toHaveBeenCalledWith(`/api/avatar/user1/${OLD}.jpg`, "user1");
  });

  it("refuses someone else's upload keys, and keys from another namespace", async () => {
    for (const keys of [
      { thumbKey: `avatar-upload/user2/${T_UP}.webp`, fullKey },
      { thumbKey: `avatar/user1/${T_UP}.webp`, fullKey },
      { thumbKey, fullKey: thumbKey },
    ]) {
      expect((await confirmPrivateAvatarUpload(keys)).error).toBe("invalid");
    }
    expect(copyAvatarObject).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("drops both served copies when either image fails moderation", async () => {
    moderateImage.mockImplementation(async (url: string) =>
      url.includes("-f.") ? { allowed: false, flaggedCategories: ["nudity"] } : { allowed: true, flaggedCategories: [] },
    );
    const res = await confirmPrivateAvatarUpload({ thumbKey, fullKey });
    expect(res).toEqual({ error: "moderation", categories: ["nudity"] });
    expect(deleteAvatarObject.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([servedThumb, servedFull]));
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("refuses an oversized thumbnail", async () => {
    headAvatarObject.mockResolvedValue({ size: 3 * 1024 * 1024, contentType: "image/webp" });
    expect((await confirmPrivateAvatarUpload({ thumbKey, fullKey })).error).toBe("too_large");
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("answers not_configured without the avatar bucket", async () => {
    isAvatarBucketConfigured.mockReturnValue(false);
    expect(await confirmPrivateAvatarUpload({ thumbKey, fullKey })).toEqual({ error: "not_configured" });
    expect(copyAvatarObject).not.toHaveBeenCalled();
  });
});
