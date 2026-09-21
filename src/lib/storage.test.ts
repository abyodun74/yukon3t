import { describe, expect, it } from "vitest";
import { validateContentType, multipartPartCount, isVideoKind } from "./storage";

const VIDEO_KINDS = ["post-video", "comment-video", "message-video", "story-video", "muse-video", "ad-video"] as const;

describe("validateContentType — video uploads", () => {
  it("accepts MP4, WebM and QuickTime (.mov) for every video kind", () => {
    for (const kind of VIDEO_KINDS) {
      expect(validateContentType(kind, "video/mp4")).toBe("mp4");
      expect(validateContentType(kind, "video/webm")).toBe("webm");
      expect(validateContentType(kind, "video/quicktime")).toBe("mov");
    }
  });

  it("still refuses other video/container types", () => {
    for (const kind of VIDEO_KINDS) {
      expect(validateContentType(kind, "video/x-msvideo")).toBeNull();
      expect(validateContentType(kind, "video/x-matroska")).toBeNull();
      expect(validateContentType(kind, "application/octet-stream")).toBeNull();
    }
  });

  it("does not let a video type through on an image kind", () => {
    expect(validateContentType("post-image", "video/quicktime")).toBeNull();
    expect(validateContentType("avatar", "video/mp4")).toBeNull();
  });
});

describe("multipart upload sizing", () => {
  it("splits a file into equal 16MB parts plus a remainder", () => {
    const MB = 1024 * 1024;
    expect(multipartPartCount(1)).toBe(1);
    expect(multipartPartCount(16 * MB)).toBe(1);
    expect(multipartPartCount(16 * MB + 1)).toBe(2);
    expect(multipartPartCount(40 * MB)).toBe(3);
    expect(multipartPartCount(2048 * MB)).toBe(128); // the 2GB video cap
  });

  it("only video kinds are eligible for multipart", () => {
    for (const k of ["post-video", "message-video", "story-video", "muse-video", "comment-video", "ad-video"]) expect(isVideoKind(k)).toBe(true);
    for (const k of ["avatar", "post-image", "message-audio", "collab-material", "nope"]) expect(isVideoKind(k)).toBe(false);
  });
});
