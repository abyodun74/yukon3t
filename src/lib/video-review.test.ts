import { beforeEach, describe, expect, it, vi } from "vitest";

// The long-video review's verdict (owner decision 2026-11-22): the transcript and frames go through the narrowed
// moderateText / moderateImage only. Swearing alone is not a flag (the profanity word list is gone), and the review
// itself deletes nothing but its own Cloudflare Stream copy: holding a flagged video is the cron's job.

const moderateText = vi.fn();
const moderateImage = vi.fn();
const deleteStreamVideo = vi.fn();
let vtt = "";

vi.mock("@/lib/moderation", () => ({
  moderateText: (t: string) => moderateText(t),
  moderateImage: (u: string) => moderateImage(u),
}));
vi.mock("@/lib/cloudflare-stream", () => ({
  isStreamConfigured: () => true,
  createStreamCopy: async () => "uid1",
  isStreamReady: async () => true,
  getCaptionState: async () => "ready",
  requestCaptions: async () => true,
  getCaptionsVtt: async () => vtt,
  vttToPlainText: (text: string) => text,
  thumbnailUrl: (uid: string, t: number) => `https://stream.example/${uid}/${t}.jpg`,
  deleteStreamVideo: (...a: unknown[]) => deleteStreamVideo(...a),
}));

const { advanceLongVideoReview } = await import("@/lib/video-review");

const review = () => advanceLongVideoReview({ videoUrl: "https://media.example/v.mp4", videoDurationSeconds: 90, streamUid: "uid1" });

beforeEach(() => {
  vi.clearAllMocks();
  vtt = "";
  moderateText.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  moderateImage.mockResolvedValue({ allowed: true, flaggedCategories: [] });
});

describe("advanceLongVideoReview", () => {
  it("does not hold a video for cursing: a sweary transcript the text check passes is clean", async () => {
    vtt = "what the fuck, this is some bullshit, damn it";
    expect(await review()).toEqual({ kind: "clean" });
    expect(moderateText).toHaveBeenCalledWith(vtt);
  });

  it("flags what the narrowed text check flags, by category", async () => {
    vtt = "a threat";
    moderateText.mockResolvedValue({ allowed: false, flaggedCategories: ["harassment/threatening"] });
    expect(await review()).toEqual({ kind: "flagged", reasons: ["audio: harassment/threatening"] });
  });

  it("checks a frame every 30s and names flagged frames", async () => {
    moderateImage.mockResolvedValueOnce({ allowed: true, flaggedCategories: [] });
    moderateImage.mockResolvedValueOnce({ allowed: false, flaggedCategories: ["violence/graphic"] });
    moderateImage.mockResolvedValueOnce({ allowed: true, flaggedCategories: [] });
    expect(await review()).toEqual({ kind: "flagged", reasons: ["frame@30s: violence/graphic"] });
    expect(moderateImage).toHaveBeenCalledTimes(3);
  });

  it("deletes only its own Stream copy once it has a verdict, never the video itself", async () => {
    moderateImage.mockResolvedValue({ allowed: false, flaggedCategories: ["sexual"] });
    await review();
    expect(deleteStreamVideo).toHaveBeenCalledTimes(1);
    expect(deleteStreamVideo).toHaveBeenCalledWith("uid1");
  });

  it("the profanity word list no longer exists", async () => {
    await expect(import("@/lib/profanity-wordlist" as string)).rejects.toThrow();
  });
});
