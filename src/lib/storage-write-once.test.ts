import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";

// Security audit H3: public-bucket single-PUT URLs are write-once (`If-None-Match: *` signed into the URL), and the
// installed Android apps' native video uploader, which can't send that header, gets a one-part multipart URL instead.
// Presigning is pure local crypto, so this runs against fake credentials with no network.

const ENV = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  R2_BUCKET_NAME: "media-bucket",
  R2_PUBLIC_URL: "https://media.example.com",
};
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  delete process.env.R2_ENDPOINT;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

const { createUploadUrl, createSinglePartUpload } = await import("./storage");

function signedHeaders(url: string) {
  return (new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
}

describe("createUploadUrl: write-once public uploads", () => {
  const kinds = [
    "post-image",
    "post-video",
    "video-thumb",
    "message-image",
    "message-video",
    "message-audio",
    "story-image",
    "story-video",
    "muse-video",
    "muse-audio",
    "comment-video",
    "comment-audio",
    "circle-cover",
    "collab-material",
    "ambient-image",
    "avatar",
    "ad-image",
    "ad-video",
    "announcement-image",
    "announcement-video",
    "voice-dictation",
  ] as const;
  const typeFor = (kind: string) =>
    kind.endsWith("video") ? "video/mp4" : kind.endsWith("audio") || kind === "voice-dictation" ? "audio/webm" : kind === "collab-material" ? "application/pdf" : "image/jpeg";

  it.each(kinds)("%s: signs If-None-Match as a header (never a query parameter) and returns it for the client", async (kind) => {
    const { uploadUrl, headers, key } = await createUploadUrl({ kind, contentType: typeFor(kind), userId: "user1" });
    const url = new URL(uploadUrl);
    expect(signedHeaders(uploadUrl)).toContain("if-none-match");
    expect(signedHeaders(uploadUrl)).toContain("host");
    // Content-Type stays unsigned (the presigner always leaves it out), as before.
    expect(signedHeaders(uploadUrl)).not.toContain("content-type");
    for (const name of url.searchParams.keys()) expect(name.toLowerCase()).not.toBe("if-none-match");
    expect(headers).toEqual({ "If-None-Match": "*" });
    expect(url.pathname).toBe(`/media-bucket/${key}`);
  });

  it("returns a fresh copy of the headers each time (a caller can't mutate the shared constant)", async () => {
    const a = await createUploadUrl({ kind: "post-image", contentType: "image/jpeg", userId: "u" });
    (a.headers as Record<string, string>)["If-None-Match"] = "tampered";
    const b = await createUploadUrl({ kind: "post-image", contentType: "image/jpeg", userId: "u" });
    expect(b.headers).toEqual({ "If-None-Match": "*" });
  });

  it("keeps the explicit short lifetime the ad flow asks for", async () => {
    const { uploadUrl } = await createUploadUrl({ kind: "ad-image", contentType: "image/jpeg", userId: "anonymous", expiresInSeconds: 300 });
    expect(new URL(uploadUrl).searchParams.get("X-Amz-Expires")).toBe("300");
  });
});

describe("createSinglePartUpload: the native video uploader's URL", () => {
  it("is part 1 of a multipart upload, with only host signed (the Java code sends no other header that must match)", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ UploadId: "upload-123" } as never);
    const started = await createSinglePartUpload({ kind: "post-video", contentType: "video/mp4", userId: "user1", sizeBytes: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const url = new URL(started.partUrl);
    expect(url.searchParams.get("partNumber")).toBe("1");
    expect(url.searchParams.get("uploadId")).toBe("upload-123");
    expect(signedHeaders(started.partUrl)).toEqual(["host"]);
    expect(started.key).toMatch(/^post-video\/user1\/[0-9a-f-]{36}\.mp4$/);
    expect(started.publicUrl).toBe(`https://media.example.com/${started.key}`);
    expect(started.uploadId).toBe("upload-123");
    send.mockRestore();
  });

  it("refuses non-video kinds and sizes over the kind's cap before starting anything", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    await expect(createSinglePartUpload({ kind: "post-image", contentType: "image/jpeg", userId: "u", sizeBytes: 10 })).rejects.toThrow(
      "invalid_content_type",
    );
    await expect(
      createSinglePartUpload({ kind: "post-video", contentType: "video/mp4", userId: "u", sizeBytes: 3 * 1024 * 1024 * 1024 }),
    ).rejects.toThrow("invalid_size");
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });
});
