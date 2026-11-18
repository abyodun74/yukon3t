import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { videoScanHoldHeadline, videoScanUnsureHoldAuditReason } from "@/lib/media-moderation-hold";

// /admin/moderation is an async Server Component with many database sections, so instead of rendering it this checks
// its source for the pieces that make a moderate-videos hold reviewable: it reads every hold kind (scan failure AND
// the VLM's unsure/flagged verdicts), shows the headline with the model's reason, and keeps the video player.

const source = readFileSync(path.join(process.cwd(), "src/app/admin/moderation/page.tsx"), "utf8");

describe("admin moderation page: video scan holds", () => {
  it("reads unsure/flagged verdict holds as well as scan-failure holds", () => {
    expect(source).toContain("performedBy: { in: [...VIDEO_SCAN_HOLD_PERFORMED_BY_ALL] }");
    expect(source).not.toContain("performedBy: VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY");
  });

  it("shows the headline built from the audit reason (the model's reason for unsure/flagged)", () => {
    expect(source).toContain("headline: videoScanHoldHeadline(row.reason)");
    expect(source).toContain("{hold.headline}");
    expect(videoScanHoldHeadline(videoScanUnsureHoldAuditReason("post", "cp1", "blurry close-up"))).toBe(
      "Held for review: automatic video scan was unsure — blurry close-up",
    );
  });

  it("keeps the video player beside Publish/Remove for every held kind", () => {
    const block = source.slice(source.indexOf("function VideoScanHold("));
    expect(block).toMatch(/<video\s+src=\{videoUrl\}\s+controls/);
    for (const kind of ["post", "comment", "muse"]) {
      expect(source).toContain(`scanHoldByKey.get(videoScanHoldKey("${kind}"`);
    }
    expect(source.match(/<VideoScanHold /g)?.length).toBe(3);
  });
});
