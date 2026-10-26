import { describe, expect, it } from "vitest";
import type { MediaModerationCheck } from "@/lib/moderation";
import {
  decideMediaModeration,
  expiredMediaHoldWindow,
  mediaHoldAuditReason,
  mediaHoldExpiredAuditReason,
  mediaHoldExpiresAt,
  mediaRejectAuditReason,
  mediaTypeFromMediaAuditReason,
  MEDIA_HOLD_REVIEW_WINDOW_MS,
  MEDIA_HOLD_SWEEP_LOOKBACK_MS,
  postIdFromMediaAuditReason,
  reasonsFromMediaAuditReason,
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

  it("an expiry names the post and says it wasn't a confirmed violation", () => {
    const reason = mediaHoldExpiredAuditReason("cpost123");
    expect(postIdFromMediaAuditReason(reason)).toBe("cpost123");
    expect(reason).toContain("14 days");
    expect(reason).toContain("Not a confirmed violation");
  });

  it("finds nothing in an unrelated reason", () => {
    expect(postIdFromMediaAuditReason("Long-video automated review flagged for admin review: audio: hate")).toBeNull();
    expect(reasonsFromMediaAuditReason("no structure here")).toEqual([]);
  });
});

describe("review window", () => {
  it("is 14 days and expires a hold exactly that long after it started", () => {
    expect(MEDIA_HOLD_REVIEW_WINDOW_MS).toBe(14 * 24 * 60 * 60 * 1000);
    const heldAt = new Date("2026-10-01T12:00:00Z");
    expect(mediaHoldExpiresAt(heldAt).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });

  it("sweeps holds older than the window, looking back a bounded way further", () => {
    const now = new Date("2026-10-26T00:00:00Z");
    const { gte, lt } = expiredMediaHoldWindow(now);
    expect(lt.getTime()).toBe(now.getTime() - MEDIA_HOLD_REVIEW_WINDOW_MS);
    expect(gte.getTime()).toBe(lt.getTime() - MEDIA_HOLD_SWEEP_LOOKBACK_MS);
    // A hold from yesterday is not due; one from 15 days ago is.
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    expect(yesterday < lt).toBe(false);
    expect(fifteenDaysAgo < lt && fifteenDaysAgo >= gte).toBe(true);
  });
});
