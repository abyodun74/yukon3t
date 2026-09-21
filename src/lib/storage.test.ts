import { describe, expect, it } from "vitest";
import { validateContentType } from "./storage";

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
