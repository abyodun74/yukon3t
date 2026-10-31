import { beforeEach, describe, expect, it, vi } from "vitest";

// Security audit H3: requestUploadUrls hands back the headers each write-once URL was signed with, and refuses an
// outdated client bundle (one that would PUT without them); startNativeVideoUpload gives the installed Android apps'
// native uploader a one-part multipart upload instead of a header-signed URL.

const createUploadUrl = vi.fn();
const createSinglePartUpload = vi.fn();
const recordUploads = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => ({ id: "user1" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/moderation", () => ({ moderateImage: vi.fn() }));
vi.mock("@/lib/trust", () => ({ recomputeTrustScore: vi.fn() }));
vi.mock("@/lib/upload-records", () => ({ recordUploads: (...a: unknown[]) => recordUploads(...a) }));
vi.mock("@/lib/fetch-remote-image", () => ({ fetchRemoteImage: vi.fn() }));
vi.mock("@/lib/avatar-storage", () => ({ deleteStoredAvatar: vi.fn() }));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    isStorageConfigured: () => true,
    createUploadUrl: (i: unknown) => createUploadUrl(i),
    createSinglePartUpload: (i: unknown) => createSinglePartUpload(i),
  };
});

const { requestUploadUrls, startNativeVideoUpload } = await import("@/app/actions/media");
const { WRITE_ONCE_UPLOAD_PROTOCOL } = await import("@/lib/write-once-upload");

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue(true);
  createUploadUrl.mockImplementation(async ({ kind }: { kind: string }) => ({
    uploadUrl: `https://r2.example.com/${kind}`,
    publicUrl: `https://media.example.com/${kind}`,
    key: `${kind}/user1/k`,
    headers: { "If-None-Match": "*" },
  }));
});

describe("requestUploadUrls", () => {
  it("returns each URL with the headers it was signed with", async () => {
    const res = await requestUploadUrls(
      [
        { kind: "post-image", contentType: "image/jpeg" },
        { kind: "video-thumb", contentType: "image/jpeg" },
      ],
      WRITE_ONCE_UPLOAD_PROTOCOL,
    );
    if (!("items" in res) || !res.items) throw new Error(String(res.error));
    expect(res.items).toHaveLength(2);
    for (const item of res.items) expect(item).toMatchObject({ error: null, headers: { "If-None-Match": "*" } });
  });

  it("answers a client bundle from before write-once uploads with stale_deployment, minting nothing", async () => {
    for (const protocol of [undefined, "", "write-once-0"]) {
      const res = await requestUploadUrls([{ kind: "post-image", contentType: "image/jpeg" }], protocol);
      expect(res).toEqual({ error: "stale_deployment" });
    }
    expect(createUploadUrl).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("profile pictures have no public upload", () => {
  it("requestUploadUrls refuses the avatar kind, minting nothing", async () => {
    const res = await requestUploadUrls([{ kind: "avatar", contentType: "image/jpeg" }], WRITE_ONCE_UPLOAD_PROTOCOL);
    expect(res).toEqual({ error: "invalid" });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("startNativeVideoUpload refuses it too", async () => {
    const f = new FormData();
    f.set("kind", "avatar");
    f.set("contentType", "image/jpeg");
    f.set("size", "1");
    expect((await startNativeVideoUpload(f)).error).toBe("invalid");
    expect(createSinglePartUpload).not.toHaveBeenCalled();
  });

  it("confirmAvatarUpload (the public confirm) is gone", async () => {
    expect("confirmAvatarUpload" in (await import("@/app/actions/media"))).toBe(false);
  });
});

describe("startNativeVideoUpload", () => {
  function fd(over: Record<string, string> = {}) {
    const f = new FormData();
    f.set("kind", "post-video");
    f.set("contentType", "video/mp4");
    f.set("size", "1234");
    for (const [k, v] of Object.entries(over)) f.set(k, v);
    return f;
  }

  it("starts a one-part multipart upload and records it for the sweep", async () => {
    createSinglePartUpload.mockResolvedValue({ key: "post-video/user1/a.mp4", uploadId: "u1", partUrl: "https://r2/part", publicUrl: "https://m/a.mp4" });
    const res = await startNativeVideoUpload(fd());
    expect(res).toEqual({ error: null, key: "post-video/user1/a.mp4", uploadId: "u1", partUrl: "https://r2/part", publicUrl: "https://m/a.mp4" });
    expect(createSinglePartUpload).toHaveBeenCalledWith({ kind: "post-video", contentType: "video/mp4", userId: "user1", sizeBytes: 1234 });
    expect(recordUploads).toHaveBeenCalledWith([{ key: "post-video/user1/a.mp4", kind: "post-video" }], "user1");
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("accepts an unknown (0) size from the device, refuses a negative one", async () => {
    createSinglePartUpload.mockResolvedValue({ key: "post-video/user1/a.mp4", uploadId: "u1", partUrl: "p", publicUrl: "m" });
    expect((await startNativeVideoUpload(fd({ size: "0" }))).error).toBeNull();
    expect((await startNativeVideoUpload(fd({ size: "-1" }))).error).toBe("invalid");
  });

  it("maps a storage refusal (non-video kind, oversize) to invalid", async () => {
    createSinglePartUpload.mockRejectedValue(new Error("invalid_content_type"));
    expect((await startNativeVideoUpload(fd({ kind: "post-image", contentType: "image/jpeg" }))).error).toBe("invalid");
    expect(recordUploads).not.toHaveBeenCalled();
  });

  it("is rate limited like every other upload request", async () => {
    checkRateLimit.mockResolvedValue(false);
    expect((await startNativeVideoUpload(fd())).error).toBe("rate_limited");
    expect(createSinglePartUpload).not.toHaveBeenCalled();
  });
});
