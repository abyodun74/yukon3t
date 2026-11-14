// Pure, client-safe rules for a photo or video picked from a phone (no DOM, no storage.ts import), shared by the
// Story composer, the share-in sheet and video-file.ts. Unit-tested in media-file.test.ts, including a synthetic copy
// of an iPhone screen recording ("ScreenRecording_11-13-2026 22-55-15_1.MP4", video/mp4, ~9.9 MB, 1170x2532, whose
// <video>.duration reads Infinity until the file has been scanned).

/** What every public image upload kind accepts (storage.ts CONTENT_TYPE_ALLOWLIST, story-image / video-thumb). */
export const UPLOADABLE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** What every public video upload kind accepts (storage.ts CONTENT_TYPE_ALLOWLIST, story-video / post-video ...). */
export const UPLOADABLE_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

/**
 * The Story composer's "Upload from device" input. iOS shows videos (screen recordings included) in its picker only
 * when the accept list names a video type, and converts HEIC photos to JPEG for an `image/*` list, so this is the
 * wildcard pair, never a list of exact image types (that hid every video, which is how an iPhone screen recording
 * could not be chosen from the Story's photo button at all).
 */
export const STORY_DEVICE_ACCEPT = "image/*,video/*";

const VIDEO_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
};

const IMAGE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

// Spellings browsers, Android content providers and the iOS Share Extension (UTType.preferredMIMEType) really report.
const TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/heic-sequence": "image/heic",
  "image/heif-sequence": "image/heif",
  "video/x-m4v": "video/mp4",
  "video/m4v": "video/mp4",
  "video/x-quicktime": "video/quicktime",
};

// Types that say nothing about the content: fall back to the extension.
const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

/** The lower-cased extension after the last dot ("" when there is none). Never throws, whatever the name. */
export function fileExtension(name: string | null | undefined): string {
  if (!name) return "";
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

export type MediaKind = "image" | "video";
export type NormalizedMediaType = { kind: MediaKind; type: string } | null;

/**
 * The real kind and canonical MIME type of a picked file, from its reported type (case and parameters ignored,
 * known aliases mapped) or, when that is empty or generic, its extension (case-insensitive: `.MP4`, `.MOV`, `.HEIC`).
 * Null when it is neither a photo nor a video.
 */
export function normalizeMediaType(reportedType: string | null | undefined, name: string | null | undefined): NormalizedMediaType {
  const raw = (reportedType ?? "").split(";")[0].trim().toLowerCase();
  const type = TYPE_ALIASES[raw] ?? raw;
  if (!GENERIC_TYPES.has(type)) {
    if (type.startsWith("video/")) return { kind: "video", type };
    if (type.startsWith("image/")) return { kind: "image", type };
  }
  const ext = fileExtension(name);
  if (VIDEO_BY_EXTENSION[ext]) return { kind: "video", type: VIDEO_BY_EXTENSION[ext] };
  if (IMAGE_BY_EXTENSION[ext]) return { kind: "image", type: IMAGE_BY_EXTENSION[ext] };
  // A video type the server doesn't take (video/3gpp, video/x-matroska) is still a video, so the person is told
  // "use MP4 or MOV" rather than "that isn't a photo or video".
  return null;
}

/** True when the server would accept this (already normalized) video type as-is. */
export function isUploadableVideoType(type: string): boolean {
  return (UPLOADABLE_VIDEO_TYPES as readonly string[]).includes(type);
}

/** True when the server would accept this (already normalized) image type as-is. */
export function isUploadableImageType(type: string): boolean {
  return (UPLOADABLE_IMAGE_TYPES as readonly string[]).includes(type);
}

/**
 * A safe file name for a re-wrapped File: the original name is never needed (object keys are server-made UUIDs and
 * nothing sends the name), so this drops it entirely rather than carrying spaces, colons or non-ASCII further.
 */
export function safeUploadName(kind: MediaKind | "thumb", type: string): string {
  const ext =
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
      "image/gif": "gif",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
    }[type] ?? "bin";
  return `${kind}.${ext}`;
}

// --- Duration ---------------------------------------------------------------------------------------------------

/**
 * A <video>.duration reading as a usable length, or null. iOS screen recordings (ReplayKit, variable frame rate)
 * and MediaRecorder WebMs read Infinity (sometimes NaN, or 0) until the file has been scanned, so only a finite,
 * positive number counts.
 */
export function usableDuration(raw: number | null | undefined): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Whole seconds, at least 1: the servers' schemas want an integer (a 0.4s clip is still a video). */
export function wholeSeconds(raw: number): number {
  return Math.max(1, Math.round(raw));
}

/**
 * What a picked video's length means for a composer with a cap: "ok", "too_long", or "unknown" (could not be read
 * on this device; the caller decides whether that blocks).
 */
export function durationVerdict(raw: number | null | undefined, maxSeconds: number): "ok" | "too_long" | "unknown" {
  const d = usableDuration(raw);
  if (d === null) return "unknown";
  // Half a second of grace: a "2:00" clip is often 120.03s.
  return d > maxSeconds + 0.5 ? "too_long" : "ok";
}

// --- Poster-frame capture ---------------------------------------------------------------------------------------

/**
 * Where to grab a still from: about a second in (a ReplayKit recording's first frame is often black, and time 0
 * isn't always seekable), never past the middle of a short clip, and 0.5s when the length isn't known yet.
 */
export function frameSeekTarget(rawDuration: number | null | undefined): number {
  const d = usableDuration(rawDuration);
  if (d === null) return 0.5;
  return Math.max(0, Math.min(1, d / 2));
}

/** A later time to try once more when the first still came out blank. */
export function frameRetryTarget(rawDuration: number | null | undefined): number {
  const d = usableDuration(rawDuration);
  if (d === null) return 2;
  return Math.max(0, Math.min(3, d * 0.6));
}

/** The longest side of a captured still (matches resizeImageFile's cap). */
export function frameCanvasSize(width: number, height: number, maxSide = 1920): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * True when RGBA pixel data is effectively empty: fully transparent (iOS WebKit's result of drawing a <video> that
 * has not painted a frame yet) or uniformly black.
 */
export function isBlankFrame(rgba: ArrayLike<number>): boolean {
  if (rgba.length < 4) return true;
  let opaque = 0;
  let bright = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] > 8) {
      opaque++;
      if (rgba[i] > 16 || rgba[i + 1] > 16 || rgba[i + 2] > 16) bright++;
    }
  }
  return opaque === 0 || bright === 0;
}

export type FrameCaptureState =
  | { phase: "loading"; duration: number | null; attempts: number; played: boolean }
  | { phase: "seeking"; duration: number | null; target: number; attempts: number; played: boolean }
  | { phase: "playing"; duration: number | null; attempts: number; played: true }
  | { phase: "drawing"; duration: number | null; attempts: number; played: boolean }
  | { phase: "done" }
  | { phase: "failed"; reason: FrameFailureReason };

export type FrameFailureReason = "decode_error" | "timeout" | "no_dimensions" | "blank" | "encode_failed";

export type FrameCaptureEvent =
  | { type: "metadata"; duration: number; width: number; height: number }
  | { type: "seeked" }
  | { type: "seek_stalled" }
  | { type: "frame_ready" }
  | { type: "drawn"; blank: boolean }
  | { type: "encode_failed" }
  | { type: "error" }
  | { type: "timeout" };

export const FRAME_CAPTURE_INITIAL: FrameCaptureState = { phase: "loading", duration: null, attempts: 0, played: false };

/**
 * The poster-frame grab as a state machine, so the browser half (captureVideoFrameDetailed in upload-client.ts) only
 * wires events to it. Rules: wait for metadata, then seek to frameSeekTarget; a seek that never answers (some iOS
 * versions with a not-yet-scanned file) falls back to playing the muted clip and grabbing the first painted frame;
 * a blank still is retried once at a later time; an error, missing dimensions or the overall timeout fail with a
 * reason the caller reports. Missing audio is irrelevant here: nothing reads it.
 */
export function frameCaptureStep(state: FrameCaptureState, event: FrameCaptureEvent): FrameCaptureState {
  if (state.phase === "done" || state.phase === "failed") return state;
  if (event.type === "timeout") return { phase: "failed", reason: "timeout" };
  if (event.type === "error") return { phase: "failed", reason: "decode_error" };

  switch (state.phase) {
    case "loading":
      if (event.type === "metadata") {
        if (!(event.width > 0) || !(event.height > 0)) return { phase: "failed", reason: "no_dimensions" };
        const duration = usableDuration(event.duration);
        return { phase: "seeking", duration, target: frameSeekTarget(duration), attempts: state.attempts, played: state.played };
      }
      return state;
    case "seeking":
      if (event.type === "seeked" || event.type === "frame_ready") {
        return { phase: "drawing", duration: state.duration, attempts: state.attempts, played: state.played };
      }
      if (event.type === "seek_stalled") {
        return state.played
          ? { phase: "failed", reason: "timeout" }
          : { phase: "playing", duration: state.duration, attempts: state.attempts, played: true };
      }
      return state;
    case "playing":
      if (event.type === "frame_ready" || event.type === "seeked") {
        return { phase: "drawing", duration: state.duration, attempts: state.attempts, played: true };
      }
      if (event.type === "seek_stalled") return { phase: "failed", reason: "timeout" };
      return state;
    case "drawing":
      if (event.type === "encode_failed") return { phase: "failed", reason: "encode_failed" };
      if (event.type === "drawn") {
        if (!event.blank) return { phase: "done" };
        if (state.attempts === 0) {
          return {
            phase: "seeking",
            duration: state.duration,
            target: frameRetryTarget(state.duration),
            attempts: 1,
            played: state.played,
          };
        }
        // Still blank at a second time: a genuinely black opening (a screen recording of a dark screen) is still a
        // real frame of the video, so it is used rather than refusing the video.
        return { phase: "done" };
      }
      return state;
  }
}

// --- Diagnostics ------------------------------------------------------------------------------------------------

export function sizeBucket(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "unknown";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return "<1MB";
  if (mb < 5) return "1-5MB";
  if (mb < 10) return "5-10MB";
  if (mb < 25) return "10-25MB";
  if (mb < 100) return "25-100MB";
  if (mb < 500) return "100-500MB";
  return ">=500MB";
}

export function durationBucket(seconds: number | null | undefined): string {
  if (seconds === Infinity) return "infinite";
  const d = usableDuration(seconds);
  if (d === null) return "unknown";
  if (d <= 15) return "<=15s";
  if (d <= 60) return "<=60s";
  if (d <= 120) return "<=120s";
  if (d <= 300) return "<=300s";
  return ">300s";
}

const KNOWN_DIAGNOSTIC_TYPES = new Set<string>([
  ...UPLOADABLE_IMAGE_TYPES,
  ...UPLOADABLE_VIDEO_TYPES,
  "image/heic",
  "image/heif",
  "image/gif",
  "",
]);
const KNOWN_DIAGNOSTIC_EXTENSIONS = new Set([...Object.keys(VIDEO_BY_EXTENSION), ...Object.keys(IMAGE_BY_EXTENSION), ""]);

export type MediaDiagnostic = {
  surface: string;
  step: string;
  code: string;
  kind: string;
  reportedType: string;
  ext: string;
  size: string;
  duration: string;
  platform: string;
};

/**
 * The only facts a media upload failure report may carry: never the file name, its content, a URL or a key. The
 * reported type and extension are kept only when they are one of a fixed known list ("other" otherwise), so nothing
 * free-form from the device reaches Sentry/PostHog.
 */
export function mediaDiagnostic(input: {
  surface: string;
  step: string;
  code: string;
  reportedType?: string | null;
  name?: string | null;
  size?: number | null;
  duration?: number | null;
  platform?: string | null;
}): MediaDiagnostic {
  const reported = (input.reportedType ?? "").split(";")[0].trim().toLowerCase();
  const ext = fileExtension(input.name);
  const normalized = normalizeMediaType(input.reportedType, input.name);
  return {
    surface: input.surface,
    step: input.step,
    code: input.code,
    kind: normalized?.kind ?? "other",
    reportedType: KNOWN_DIAGNOSTIC_TYPES.has(reported) ? reported || "empty" : "other",
    ext: KNOWN_DIAGNOSTIC_EXTENSIONS.has(ext) ? ext || "none" : "other",
    size: sizeBucket(input.size),
    duration: durationBucket(input.duration),
    platform: input.platform === "ios" || input.platform === "android" ? input.platform : "web",
  };
}
