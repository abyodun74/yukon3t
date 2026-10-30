import { beforeEach, describe, expect, it, vi } from "vitest";

// The public ad booking's uploads (audit H4, 2026-10-29): requestAdUpload runs the bot check, caps the declared
// size/type, keeps URLs short-lived and records the uploads for the sweep; createAdCampaign accepts only files named by
// the pass that call issued, never a second arbitrary object.

process.env.AUTH_SECRET = "test-secret-for-ad-upload-pass-0123456789";

const R2 = "https://media.example.com";
const passesBotGate = vi.fn();
const checkRateLimit = vi.fn();
const createUploadUrl = vi.fn();
const recordUploads = vi.fn();
const verifyUploadedSize = vi.fn();
const deleteOwnedObject = vi.fn();
const moderateMedia = vi.fn();
const adFindFirst = vi.fn();
const adCreate = vi.fn();

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/client-ip", () => ({ getClientIp: async () => "203.0.113.9" }));
vi.mock("@/lib/bot-protection", () => ({ isBotSubmission: () => false }));
vi.mock("@/lib/bot-gate", () => ({ passesBotGate: (...a: unknown[]) => passesBotGate(...a) }));
vi.mock("@/lib/moderation", () => ({ moderateMedia: (i: unknown) => moderateMedia(i) }));
vi.mock("@/lib/upload-records", () => ({ recordUploads: (...a: unknown[]) => recordUploads(...a) }));
vi.mock("@/lib/stripe", () => ({
  isPaymentsConfigured: () => true,
  createAdCheckoutSession: async () => ({ url: "https://checkout.example.com/x", sessionId: "cs_1" }),
  refundAdPayment: vi.fn(),
}));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    MEDIA_LIMITS: actual.MEDIA_LIMITS,
    validateContentType: actual.validateContentType,
    isStorageConfigured: () => true,
    createUploadUrl: (i: unknown) => createUploadUrl(i),
    verifyUploadedSize: (i: unknown) => verifyUploadedSize(i),
    deleteOwnedObject: (...a: unknown[]) => deleteOwnedObject(...a),
    keyFromPublicUrl: (url: string) => (url.startsWith(R2) ? url.slice(R2.length + 1) : null),
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adCampaign: {
      findFirst: (a: unknown) => adFindFirst(a),
      create: (a: unknown) => adCreate(a),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const { requestAdUpload, createAdCampaign } = await import("@/app/actions/ads");
const { MEDIA_LIMITS } = await import("@/lib/storage");

function uploadForm(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("mediaType", "IMAGE");
  fd.set("contentType", "image/jpeg");
  fd.set("size", "1000");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

function bookingForm(mediaUrl: string, pass: string | null, over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("companyName", "Acme");
  fd.set("contactName", "Ann Example");
  fd.set("contactEmail", "ann@example.com");
  fd.set("headline", "Great stuff");
  fd.set("body", "Buy our great stuff today");
  fd.set("linkUrl", "https://example.com");
  fd.set("mediaType", "IMAGE");
  fd.set("mediaUrl", mediaUrl);
  fd.set("durationDays", "7");
  if (pass) fd.set("adUploadPass", pass);
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  passesBotGate.mockResolvedValue({ ok: true });
  checkRateLimit.mockResolvedValue(true);
  createUploadUrl.mockImplementation(async ({ kind, userId }: { kind: string; userId: string }) => {
    const key = `${kind}/${userId}/u${++n}.bin`;
    return { uploadUrl: `https://r2.example.com/put/${key}`, publicUrl: `${R2}/${key}`, key };
  });
  verifyUploadedSize.mockResolvedValue(true);
  moderateMedia.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  adFindFirst.mockResolvedValue(null);
  adCreate.mockResolvedValue({ id: "cad00000000001" });
});

describe("requestAdUpload", () => {
  it("runs the bot check before minting anything", async () => {
    passesBotGate.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await requestAdUpload(uploadForm());
    expect(result.error).toBe("captcha");
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a declared size over the kind's cap, and a wrong content type", async () => {
    expect((await requestAdUpload(uploadForm({ size: String(MEDIA_LIMITS["ad-image"] + 1) }))).error).toBe("too_large");
    expect(
      (await requestAdUpload(uploadForm({ mediaType: "VIDEO", contentType: "video/mp4", size: String(MEDIA_LIMITS["ad-video"] + 1) })))
        .error,
    ).toBe("too_large");
    expect((await requestAdUpload(uploadForm({ contentType: "text/html" }))).error).toBe("invalid");
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("mints short-lived URLs, records them for the sweep, and returns a pass", async () => {
    const result = await requestAdUpload(
      uploadForm({ mediaType: "VIDEO", contentType: "video/mp4", size: "5000", thumbContentType: "image/jpeg", thumbSize: "100" }),
    );
    expect(result.error).toBeNull();
    expect(createUploadUrl).toHaveBeenCalledWith(expect.objectContaining({ kind: "ad-video", expiresInSeconds: 3600 }));
    expect(createUploadUrl).toHaveBeenCalledWith(expect.objectContaining({ kind: "ad-image", expiresInSeconds: 300 }));
    expect(recordUploads).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: "ad-video" }), expect.objectContaining({ kind: "ad-image" })],
      "anonymous",
    );
    expect(result.error === null && typeof result.pass).toBe("string");
  });

  it("caps the ad video far below the 2GB every signed-in video kind gets", () => {
    expect(MEDIA_LIMITS["ad-video"]).toBeLessThanOrEqual(250 * 1024 * 1024);
  });
});

describe("createAdCampaign", () => {
  async function mintImage() {
    const r = await requestAdUpload(uploadForm());
    if (r.error !== null) throw new Error("mint failed");
    return r;
  }

  it("books with the pass issued for that exact file", async () => {
    const minted = await mintImage();
    await createAdCampaign(bookingForm(minted.main.publicUrl, minted.pass));
    expect(adCreate).toHaveBeenCalled();
  });

  it("refuses without a pass, or with a pass for a different file", async () => {
    const minted = await mintImage();
    const other = await mintImage();
    expect(await createAdCampaign(bookingForm(minted.main.publicUrl, null))).toEqual({ error: "captcha" });
    expect(await createAdCampaign(bookingForm(minted.main.publicUrl, other.pass))).toEqual({ error: "captcha" });
    expect(adCreate).not.toHaveBeenCalled();
  });

  it("refuses any file that isn't this flow's own ad upload, before any R2 call", async () => {
    const minted = await mintImage();
    for (const url of [`${R2}/post-image/cvictim0000001/p.jpg`, `${R2}/ad-video/anonymous/v.mp4`, "https://evil.example/x.jpg"]) {
      expect(await createAdCampaign(bookingForm(url, minted.pass))).toEqual({ error: "invalid" });
    }
    expect(verifyUploadedSize).not.toHaveBeenCalled();
    expect(deleteOwnedObject).not.toHaveBeenCalled();
  });

  it("refuses a second booking for the same upload", async () => {
    const minted = await mintImage();
    adFindFirst.mockResolvedValue({ id: "cad00000000009" });
    expect(await createAdCampaign(bookingForm(minted.main.publicUrl, minted.pass))).toEqual({ error: "invalid" });
  });
});
