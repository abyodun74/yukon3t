import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAME_CAPTURE_INITIAL,
  STORY_DEVICE_ACCEPT,
  UPLOADABLE_IMAGE_TYPES,
  UPLOADABLE_VIDEO_TYPES,
  durationBucket,
  durationVerdict,
  fileExtension,
  frameCanvasSize,
  frameCaptureStep,
  frameRetryTarget,
  frameSeekTarget,
  isBlankFrame,
  mediaDiagnostic,
  normalizeMediaType,
  safeUploadName,
  sizeBucket,
  usableDuration,
  wholeSeconds,
  type FrameCaptureEvent,
  type FrameCaptureState,
} from "@/lib/media-file";
import { normalizeVideoFile } from "@/lib/video-file";
import { validateContentType } from "@/lib/storage";
import { MAX_STORY_VIDEO_SECONDS } from "@/lib/storage";

// The owner's file: an iPhone screen recording shared as a Story.
const OWNER_NAME = "ScreenRecording_11-13-2026 22-55-15_1.MP4";
const OWNER_SIZE = Math.round(9.9 * 1024 * 1024);
const OWNER_WIDTH = 1170;
const OWNER_HEIGHT = 2532;

function ownerFile(type = "video/mp4"): File {
  return new File([new Uint8Array(16)], OWNER_NAME, { type });
}

describe("fileExtension", () => {
  it("is case-insensitive and survives spaces, dashes and several dots", () => {
    expect(fileExtension(OWNER_NAME)).toBe("mp4");
    expect(fileExtension("IMG_0001.HEIC")).toBe("heic");
    expect(fileExtension("clip.final.MoV")).toBe("mov");
    expect(fileExtension("a/b\\Photo 12:30.JPG")).toBe("jpg");
  });
  it("answers empty for no extension, a dotfile, a trailing dot or junk", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
    expect(fileExtension("weird.mp4 ")).toBe("");
    expect(fileExtension("x.ünï")).toBe("");
    expect(fileExtension(null)).toBe("");
    expect(fileExtension("x." + "a".repeat(40))).toBe("");
  });
});

describe("normalizeMediaType", () => {
  it("recognises the owner's screen recording from its type", () => {
    expect(normalizeMediaType("video/mp4", OWNER_NAME)).toEqual({ kind: "video", type: "video/mp4" });
  });
  it("falls back to the upper-case extension when iOS/Android give no type", () => {
    expect(normalizeMediaType("", OWNER_NAME)).toEqual({ kind: "video", type: "video/mp4" });
    expect(normalizeMediaType("application/octet-stream", "IMG_1234.MOV")).toEqual({ kind: "video", type: "video/quicktime" });
    expect(normalizeMediaType(undefined, "IMG_1234.HEIC")).toEqual({ kind: "image", type: "image/heic" });
    expect(normalizeMediaType("", "photo.JPG")).toEqual({ kind: "image", type: "image/jpeg" });
  });
  it("ignores case and parameters, and maps aliases", () => {
    expect(normalizeMediaType("Video/MP4; codecs=hvc1", "x")).toEqual({ kind: "video", type: "video/mp4" });
    expect(normalizeMediaType("video/x-m4v", "a.m4v")).toEqual({ kind: "video", type: "video/mp4" });
    expect(normalizeMediaType("image/jpg", "a.jpg")).toEqual({ kind: "image", type: "image/jpeg" });
    expect(normalizeMediaType("IMAGE/PNG", "a")).toEqual({ kind: "image", type: "image/png" });
  });
  it("keeps the reported type when it is specific, even if the extension disagrees", () => {
    expect(normalizeMediaType("video/quicktime", "clip.mp4")).toEqual({ kind: "video", type: "video/quicktime" });
  });
  it("answers null for something that is neither", () => {
    expect(normalizeMediaType("application/pdf", "doc.pdf")).toBeNull();
    expect(normalizeMediaType("", "notes.txt")).toBeNull();
    expect(normalizeMediaType("", "")).toBeNull();
  });
});

describe("normalizeVideoFile (the owner's file)", () => {
  it("keeps a correctly typed upper-case .MP4 as the same File", () => {
    const f = ownerFile();
    expect(normalizeVideoFile(f)).toBe(f);
  });
  it("re-types an untyped .MP4 and drops the raw name", () => {
    const out = normalizeVideoFile(ownerFile(""));
    expect(out?.type).toBe("video/mp4");
    expect(out?.name).toBe("video.mp4");
  });
  it("maps video/x-m4v to an accepted type and refuses formats the server can't take", () => {
    expect(normalizeVideoFile(new File([""], "a.M4V", { type: "video/x-m4v" }))?.type).toBe("video/mp4");
    expect(normalizeVideoFile(new File([""], "a.3gp", { type: "video/3gpp" }))).toBeNull();
    expect(normalizeVideoFile(new File([""], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  });
});

describe("client and server agree on types", () => {
  it("every uploadable video type is accepted by story-video, post-video and muse-video", () => {
    for (const type of UPLOADABLE_VIDEO_TYPES) {
      expect(validateContentType("story-video", type)).not.toBeNull();
      expect(validateContentType("post-video", type)).not.toBeNull();
      expect(validateContentType("muse-video", type)).not.toBeNull();
    }
  });
  it("every uploadable image type is accepted by story-image, post-image and video-thumb", () => {
    for (const type of UPLOADABLE_IMAGE_TYPES) {
      expect(validateContentType("story-image", type)).not.toBeNull();
      expect(validateContentType("post-image", type)).not.toBeNull();
      expect(validateContentType("video-thumb", type)).not.toBeNull();
    }
  });
});

describe("safeUploadName", () => {
  it("never carries the original name", () => {
    expect(safeUploadName("video", "video/mp4")).toBe("video.mp4");
    expect(safeUploadName("image", "image/heic")).toBe("image.heic");
    expect(safeUploadName("image", "image/x-unknown")).toBe("image.bin");
  });
});

describe("duration rules", () => {
  it("treats Infinity, NaN, 0 and negatives as unknown", () => {
    expect(usableDuration(Infinity)).toBeNull();
    expect(usableDuration(NaN)).toBeNull();
    expect(usableDuration(0)).toBeNull();
    expect(usableDuration(-1)).toBeNull();
    expect(usableDuration(null)).toBeNull();
    expect(usableDuration(42.4)).toBe(42.4);
  });
  it("rounds to a whole second, at least 1", () => {
    expect(wholeSeconds(0.2)).toBe(1);
    expect(wholeSeconds(42.5)).toBe(43);
  });
  it("an Infinity-first screen recording is 'unknown', not refused, and its scanned length is judged normally", () => {
    expect(durationVerdict(Infinity, MAX_STORY_VIDEO_SECONDS)).toBe("unknown");
    expect(durationVerdict(37.8, MAX_STORY_VIDEO_SECONDS)).toBe("ok");
    expect(durationVerdict(120.03, MAX_STORY_VIDEO_SECONDS)).toBe("ok");
    expect(durationVerdict(121, MAX_STORY_VIDEO_SECONDS)).toBe("too_long");
  });
});

describe("frame capture", () => {
  const run = (events: FrameCaptureEvent[]) =>
    events.reduce<FrameCaptureState>((state, event) => frameCaptureStep(state, event), FRAME_CAPTURE_INITIAL);
  const ownerMeta: FrameCaptureEvent = { type: "metadata", duration: Infinity, width: OWNER_WIDTH, height: OWNER_HEIGHT };

  it("seek targets: about a second in, half a short clip, 0.5s when the length is unknown", () => {
    expect(frameSeekTarget(30)).toBe(1);
    expect(frameSeekTarget(0.6)).toBeCloseTo(0.3);
    expect(frameSeekTarget(Infinity)).toBe(0.5);
    expect(frameSeekTarget(NaN)).toBe(0.5);
    expect(frameRetryTarget(Infinity)).toBe(2);
    expect(frameRetryTarget(2)).toBeCloseTo(1.2);
  });

  it("the owner's recording (duration Infinity at first) seeks to 0.5s and finishes", () => {
    const afterMeta = run([ownerMeta]);
    expect(afterMeta).toMatchObject({ phase: "seeking", target: 0.5, duration: null });
    expect(run([ownerMeta, { type: "seeked" }, { type: "drawn", blank: false }])).toEqual({ phase: "done" });
  });

  it("a seek that never answers falls back to playing muted, then fails only if that stalls too", () => {
    expect(run([ownerMeta, { type: "seek_stalled" }])).toMatchObject({ phase: "playing", played: true });
    expect(run([ownerMeta, { type: "seek_stalled" }, { type: "frame_ready" }, { type: "drawn", blank: false }])).toEqual({
      phase: "done",
    });
    expect(run([ownerMeta, { type: "seek_stalled" }, { type: "seek_stalled" }])).toEqual({ phase: "failed", reason: "timeout" });
  });

  it("a blank first still is retried once later; a second blank one is used anyway", () => {
    const retry = run([ownerMeta, { type: "seeked" }, { type: "drawn", blank: true }]);
    expect(retry).toMatchObject({ phase: "seeking", target: 2, attempts: 1 });
    expect(run([ownerMeta, { type: "seeked" }, { type: "drawn", blank: true }, { type: "seeked" }, { type: "drawn", blank: true }])).toEqual({
      phase: "done",
    });
  });

  it("errors, missing dimensions, encode failures and the overall timeout end with a reason", () => {
    expect(run([{ type: "error" }])).toEqual({ phase: "failed", reason: "decode_error" });
    expect(run([{ type: "metadata", duration: 5, width: 0, height: 0 }])).toEqual({ phase: "failed", reason: "no_dimensions" });
    expect(run([ownerMeta, { type: "seeked" }, { type: "encode_failed" }])).toEqual({ phase: "failed", reason: "encode_failed" });
    expect(run([ownerMeta, { type: "timeout" }])).toEqual({ phase: "failed", reason: "timeout" });
  });

  it("is terminal once done or failed, and ignores events that don't apply", () => {
    const done = run([ownerMeta, { type: "seeked" }, { type: "drawn", blank: false }]);
    expect(frameCaptureStep(done, { type: "error" })).toBe(done);
    const loading = FRAME_CAPTURE_INITIAL;
    expect(frameCaptureStep(loading, { type: "seeked" })).toBe(loading);
  });

  it("scales the owner's 1170x2532 recording to a 1920px-tall still", () => {
    expect(frameCanvasSize(OWNER_WIDTH, OWNER_HEIGHT)).toEqual({ width: 887, height: 1920 });
    expect(frameCanvasSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(frameCanvasSize(0, 480)).toBeNull();
  });

  it("detects a transparent or black still", () => {
    expect(isBlankFrame(new Uint8ClampedArray(16 * 16 * 4))).toBe(true);
    const black = new Uint8ClampedArray(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : 0));
    expect(isBlankFrame(black)).toBe(true);
    const real = black.slice();
    real[40] = 200;
    expect(isBlankFrame(real)).toBe(false);
  });
});

describe("mediaDiagnostic", () => {
  it("describes the owner's file without its name", () => {
    const d = mediaDiagnostic({
      surface: "story",
      step: "frame_capture_timeout",
      code: "frameFailed",
      reportedType: "video/mp4",
      name: OWNER_NAME,
      size: OWNER_SIZE,
      duration: Infinity,
      platform: "ios",
    });
    expect(d).toEqual({
      surface: "story",
      step: "frame_capture_timeout",
      code: "frameFailed",
      kind: "video",
      reportedType: "video/mp4",
      ext: "mp4",
      size: "5-10MB",
      duration: "infinite",
      platform: "ios",
    });
    expect(JSON.stringify(d)).not.toContain("ScreenRecording");
  });
  it("never passes through a free-form type or extension", () => {
    const d = mediaDiagnostic({ surface: "story", step: "x", code: "y", reportedType: "application/x-secret-name", name: "my.secretext" });
    expect(d.reportedType).toBe("other");
    expect(d.ext).toBe("other");
    expect(d.platform).toBe("web");
    expect(mediaDiagnostic({ surface: "s", step: "x", code: "y", reportedType: "", name: "noext" })).toMatchObject({
      reportedType: "empty",
      ext: "none",
    });
  });
  it("buckets size and duration", () => {
    expect(sizeBucket(500)).toBe("<1MB");
    expect(sizeBucket(30 * 1024 * 1024)).toBe("25-100MB");
    expect(sizeBucket(undefined)).toBe("unknown");
    expect(durationBucket(NaN)).toBe("unknown");
    expect(durationBucket(90)).toBe("<=120s");
  });
});

describe("accept strings", () => {
  const modal = readFileSync(path.join(process.cwd(), "src/components/story-upload-modal.tsx"), "utf8");

  it("the Story's device picker shows photos and videos", () => {
    expect(STORY_DEVICE_ACCEPT.split(",")).toEqual(["image/*", "video/*"]);
    expect(modal).toContain("accept={STORY_DEVICE_ACCEPT}");
  });
  it("no Story input lists exact image types without the image/* wildcard (iOS would hide videos / skip HEIC conversion)", () => {
    const accepts = [...modal.matchAll(/accept=\{(.+)\}\s*$/gm)].map((m) => m[1]);
    expect(accepts.length).toBeGreaterThanOrEqual(3);
    for (const accept of accepts) {
      if (accept.includes("IMAGE_TYPES")) expect(accept).toContain("image/*");
      if (accept.includes("VIDEO_TYPES")) expect(accept).toContain("video/*");
    }
  });
  it("the camera input keeps the literal image/* Capacitor needs for capture", () => {
    expect(modal).toMatch(/accept=\{`\$\{IMAGE_TYPES\.join\(","\)\},image\/\*`\}\s*\n\s*capture="environment"/);
  });
});
