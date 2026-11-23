import { describe, expect, it } from "vitest";
import type { MediaModerationCheck } from "@/lib/moderation";
import {
  decideMediaModeration,
  mediaHoldAuditReason,
  mediaRejectAuditReason,
  mediaTypeFromMediaAuditReason,
  postIdFromMediaAuditReason,
  reasonsFromMediaAuditReason,
  MEDIA_HOLD_PERFORMED_BY,
  VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY,
  videoScanFailedHoldAuditReason,
  videoScanHoldKey,
  videoScanHoldTargetFromAuditReason,
  VIDEO_SCAN_HOLD_PERFORMED_BY_ALL,
  VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY,
  videoScanFlaggedHoldAuditReason,
  videoScanHoldHeadline,
  videoScanHoldTypeFromAuditReason,
  videoScanUnsureHoldAuditReason,
} from "@/lib/media-moderation-hold";
import { violationKeysFromReasons } from "@/lib/moderation-labels";

const ok = (source: string): MediaModerationCheck => ({ source, result: { allowed: true, flaggedCategories: [] } });
const flagged = (source: string, ...categories: string[]): MediaModerationCheck => ({
  source,
  result: { allowed: false, flaggedCategories: categories },
});
const apiError = (source: string, kind: "rejected" | "unavailable"): MediaModerationCheck => ({
  source,
  result: { allowed: true, flaggedCategories: ["moderation_api_error"], apiError: kind },
});

describe("decideMediaModeration", () => {
  it("publishes when nothing is flagged", () => {
    expect(decideMediaModeration([ok("caption"), ok("video frame")])).toEqual({ kind: "publish", reasons: [] });
  });

  it("never treats a moderation API failure (outage, timeout, refused input) as a flag", () => {
    expect(decideMediaModeration([apiError("caption", "unavailable"), apiError("video frame", "rejected")]).kind).toBe(
      "publish",
    );
  });

  it("holds an ordinary flagged video frame for review instead of rejecting it", () => {
    expect(decideMediaModeration([ok("caption"), flagged("video frame", "violence")])).toEqual({
      kind: "hold",
      reasons: ["video frame: violence"],
    });
  });

  it("holds a media post whose only flag is the caption (the media itself passed)", () => {
    expect(decideMediaModeration([flagged("caption", "harassment"), ok("video frame")])).toEqual({
      kind: "hold",
      reasons: ["caption: harassment"],
    });
  });

  it("holds adult sexual content (hidden, never public) rather than publishing it", () => {
    expect(decideMediaModeration([ok("caption"), flagged("photo", "sexual")]).kind).toBe("hold");
  });

  it("rejects outright anything in a must-delete category, wherever it was flagged", () => {
    expect(decideMediaModeration([ok("caption"), flagged("video frame", "sexual", "sexual/minors")])).toEqual({
      kind: "reject",
      reasons: ["video frame: sexual,sexual/minors"],
    });
    expect(decideMediaModeration([flagged("caption", "sexual/minors"), ok("photo 1")]).kind).toBe("reject");
  });

  it("lists every flagged part, and an API failure next to a real flag doesn't hide it", () => {
    const decision = decideMediaModeration([
      apiError("caption", "unavailable"),
      flagged("photo 1", "violence"),
      ok("photo 2"),
      flagged("photo 3", "self-harm", "moderation_api_error"),
    ]);
    expect(decision).toEqual({ kind: "hold", reasons: ["photo 1: violence", "photo 3: self-harm"] });
  });

  it("writes reasons the existing label helpers already read", () => {
    const { reasons } = decideMediaModeration([flagged("video frame", "violence/graphic"), flagged("caption", "hate")]);
    expect(violationKeysFromReasons(reasons)).toEqual(["violence/graphic", "hate"]);
  });

  it("still names a flagged part that came with no category list", () => {
    expect(decideMediaModeration([flagged("video frame")]).reasons).toEqual(["video frame: flagged"]);
  });
});

describe("audit reason strings", () => {
  it("round-trips the held post id, media type and reasons", () => {
    const reason = mediaHoldAuditReason("cpost123", "VIDEO", ["video frame: violence", "caption: harassment"]);
    expect(postIdFromMediaAuditReason(reason)).toBe("cpost123");
    expect(mediaTypeFromMediaAuditReason(reason)).toBe("VIDEO");
    expect(reasonsFromMediaAuditReason(reason)).toEqual(["video frame: violence", "caption: harassment"]);
  });

  it("a rejection names no post (nothing was stored) but keeps type and reasons", () => {
    const reason = mediaRejectAuditReason("IMAGE", ["photo: sexual/minors"]);
    expect(postIdFromMediaAuditReason(reason)).toBeNull();
    expect(mediaTypeFromMediaAuditReason(reason)).toBe("IMAGE");
    expect(reasonsFromMediaAuditReason(reason)).toEqual(["photo: sexual/minors"]);
  });

  it("finds nothing in an unrelated reason", () => {
    expect(postIdFromMediaAuditReason("Long-video automated review flagged for admin review: audio: hate")).toBeNull();
    expect(reasonsFromMediaAuditReason("no structure here")).toEqual([]);
  });
});

describe("no automatic deletion of held content (owner decision 2026-11-22)", () => {
  it("has no review-window expiry any more", async () => {
    const hold = await import("@/lib/media-moderation-hold");
    for (const gone of ["MEDIA_HOLD_REVIEW_WINDOW_MS", "mediaHoldExpiresAt", "expiredMediaHoldWindow", "mediaHoldExpiredAuditReason"]) {
      expect(gone in hold).toBe(false);
    }
  });

  it("only a must-delete category (sexual content involving minors) is ever rejected; every other flag is a hold", () => {
    for (const category of ["sexual", "violence", "violence/graphic", "harassment/threatening", "hate", "hate/threatening"]) {
      expect(decideMediaModeration([flagged("video frame", category)]).kind).toBe("hold");
    }
    expect(decideMediaModeration([flagged("video frame", "sexual/minors")]).kind).toBe("reject");
  });
});

describe("video scan failure hold reasons", () => {
  it("names the item and gives the plain reason first, then the scan's detail", () => {
    const reason = videoScanFailedHoldAuditReason("muse", "cmuse1", "Hive rejected_media, HTTP 413; failed 6 of 6 attempts");
    expect(reason).toBe(
      "Video held for admin review: automatic video scan could not process this file (muse:cmuse1, VIDEO): Hive rejected_media, HTTP 413; failed 6 of 6 attempts",
    );
    expect(videoScanHoldTargetFromAuditReason(reason)).toEqual({ kind: "muse", id: "cmuse1" });
    expect(reasonsFromMediaAuditReason(reason)).toEqual(["Hive rejected_media, HTTP 413", "failed 6 of 6 attempts"]);
  });

  it("reads post, comment and muse holds, and nothing else", () => {
    expect(videoScanHoldTargetFromAuditReason(videoScanFailedHoldAuditReason("post", "cp1", "x"))).toEqual({
      kind: "post",
      id: "cp1",
    });
    expect(videoScanHoldTargetFromAuditReason(videoScanFailedHoldAuditReason("comment", "cc1", "x"))).toEqual({
      kind: "comment",
      id: "cc1",
    });
    expect(videoScanHoldTargetFromAuditReason(mediaHoldAuditReason("cp1", "IMAGE", ["photo: sexual"]))).toBeNull();
    expect(videoScanHoldKey("comment", "cc1")).toBe("comment:cc1");
  });

  it("uses its own performedBy, so the 14-day media-hold sweep never reads these rows", () => {
    expect(VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY).not.toBe(MEDIA_HOLD_PERFORMED_BY);
  });
});

describe("video scan verdict hold reasons (VLM unsure / flagged)", () => {
  it("an unsure hold names the item and carries the model's reason, shown as 'Held for review: ... unsure — <reason>'", () => {
    const reason = videoScanUnsureHoldAuditReason("post", "cp1", "too dark to tell; maybe skin");
    expect(reason).toBe(
      "Video held for admin review: automatic video scan was unsure (post:cp1, VIDEO): too dark to tell, maybe skin",
    );
    expect(videoScanHoldTargetFromAuditReason(reason)).toEqual({ kind: "post", id: "cp1" });
    expect(videoScanHoldTypeFromAuditReason(reason)).toBe("unsure");
    expect(videoScanHoldHeadline(reason)).toBe(
      "Held for review: automatic video scan was unsure — too dark to tell, maybe skin",
    );
  });

  it("an unsure hold with no reason still reads clearly", () => {
    const reason = videoScanUnsureHoldAuditReason("muse", "cm1", "  ");
    expect(videoScanHoldHeadline(reason)).toBe("Held for review: automatic video scan was unsure — no reason given");
  });

  it("a flagged hold lists the categories then the model's reason", () => {
    const reason = videoScanFlaggedHoldAuditReason("comment", "cc1", ["sexual_explicit", "violence"], "nudity\nand blood");
    expect(reason).toBe(
      "Video held for admin review: automatic video scan flagged this video (comment:cc1, VIDEO): sexual_explicit,violence; nudity and blood",
    );
    expect(videoScanHoldTargetFromAuditReason(reason)).toEqual({ kind: "comment", id: "cc1" });
    expect(videoScanHoldTypeFromAuditReason(reason)).toBe("flagged");
    expect(videoScanHoldHeadline(reason)).toBe(
      "Hidden: automatic video scan flagged this video — sexual_explicit,violence; nudity and blood",
    );
  });

  it("a model reason naming another item can't redirect the hold", () => {
    const reason = videoScanUnsureHoldAuditReason("post", "creal", "see (post:cother, VIDEO)");
    expect(videoScanHoldTargetFromAuditReason(reason)).toEqual({ kind: "post", id: "creal" });
  });

  it("a scan-failure hold keeps its own headline and type", () => {
    const reason = videoScanFailedHoldAuditReason("post", "cp1", "Hive rejected_media, HTTP 400");
    expect(videoScanHoldTypeFromAuditReason(reason)).toBe("scan_failed");
    expect(videoScanHoldHeadline(reason)).toBe("Held for review: automatic video scan could not process this file");
    expect(videoScanHoldTypeFromAuditReason(mediaHoldAuditReason("cp1", "VIDEO", ["video frame: sexual"]))).toBeNull();
  });

  it("is written under its own performedBy, never the 14-day sweep's, and the hold readers cover both kinds", () => {
    expect(VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY).not.toBe(MEDIA_HOLD_PERFORMED_BY);
    expect(VIDEO_SCAN_HOLD_PERFORMED_BY_ALL).toEqual([VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY, VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY]);
  });
});
