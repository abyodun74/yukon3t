"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Loader2, Upload, Video, X } from "lucide-react";
import { createStory } from "@/app/actions/stories";
import { uploadFileDirect, captureVideoFrameDetailed, probeVideoDuration, resizeImageFile } from "@/lib/upload-client";
import { MediaPickerButton } from "@/components/media-picker-button";
import { pickImagesNative } from "@/lib/native-gallery-picker";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";
import { looksLikeStaleServerActionError } from "@/lib/stale-build";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/sheet";
import { useFeedText } from "@/components/feed-text";
import { format, plural, byCode } from "@/lib/i18n/locales";
import { normalizeVideoFile } from "@/lib/video-file";
import {
  STORY_DEVICE_ACCEPT,
  durationVerdict,
  isUploadableImageType,
  normalizeMediaType,
  safeUploadName,
} from "@/lib/media-file";
import { reportMediaUploadFailure } from "@/lib/media-upload-diagnostics";
import { useStoryUploadText } from "@/components/story-upload-text";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Kept in sync with storage.ts's MAX_VIDEO_BYTES — duplicated locally rather
// than imported, since storage.ts pulls in the server-only @aws-sdk/client-s3
// SDK and can't be bundled into a "use client" component (same pattern
// chat-thread.tsx uses for its own MAX_*_BYTES constants).
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 120;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
/** Error codes worded by the storyUpload dictionary rather than feed.stories.upload.errors. */
const STORY_UPLOAD_CODES = ["frameFailed", "imageUnreadable", "unsupportedFile", "fileReadFailed"] as const;
type StoryUploadCode = (typeof STORY_UPLOAD_CODES)[number];
function isStoryUploadCode(code: string): code is StoryUploadCode {
  return (STORY_UPLOAD_CODES as readonly string[]).includes(code);
}
// createStory has no batch endpoint — each item is its own upload + DB row —
// and story creation itself has no rate limit (unlimited uploads over
// time). There's deliberately no cap on how many items one picker
// selection can queue up either; NATIVE_PICKER_LIMIT below only bounds the
// single call to Android's native picker (it needs *some* integer), not
// how many batches/selections you can add in a row.
const NATIVE_PICKER_LIMIT = 100;

type UploadState =
  | { status: "uploading" }
  | { status: "done"; mediaUrl: string; mediaThumbnailUrl?: string }
  | { status: "error"; message: string };

type StoryItem = {
  /** Local-only key for React/removal — never sent to the server. */
  id: string;
  file: File;
  mediaType: "IMAGE" | "VIDEO";
  previewUrl: string;
  upload: UploadState;
  /** The probed length (diagnostics only; Infinity/unknown is allowed through, the server doesn't need it). */
  durationSeconds: number | null;
};

/** A picked file that couldn't be added: the error code, and what a failure report may say about it. */
type ProcessError = { error: string; step: string; file: File; duration?: number | null };
type ProcessResult = { item: StoryItem } | ProcessError;


function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// Background choices for a text-only story — deliberately a small fixed
// palette (not a free color picker) to keep this a quick, low-friction flow
// rather than a whole design tool. Each pairs a background with a readable
// foreground text color instead of computing contrast at render time.
const TEXT_STORY_BACKGROUNDS: { bg: string; fg: string }[] = [
  { bg: "#14181a", fg: "#ffffff" },
  { bg: "#3654ff", fg: "#ffffff" },
  { bg: "#e0245e", fg: "#ffffff" },
  { bg: "#17bf63", fg: "#ffffff" },
  { bg: "#f9a825", fg: "#14181a" },
  { bg: "#ffffff", fg: "#14181a" },
];
const TEXT_STORY_SIZE = { width: 1080, height: 1920 };
const TEXT_STORY_MAX_CHARS = 500;

/**
 * Greedy word wrap for <canvas> text. A word wider than maxWidth on its own is
 * split by character so nothing is ever drawn past the canvas edges.
 */
function wrapCanvasText(ctx: CanvasRenderingContext2D, words: string[], maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  const pushWord = (word: string) => {
    const attempt = current ? `${current} ${word}` : word;
    if (ctx.measureText(attempt).width <= maxWidth) {
      current = attempt;
      return;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      return;
    }
    // Hard-break by code point (keeps emoji/surrogate pairs intact).
    for (const ch of Array.from(word)) {
      if (current && ctx.measureText(current + ch).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
  };
  for (const word of words) pushWord(word);
  if (current) lines.push(current);
  return lines;
}

/**
 * Rasterizes a text-only story into an <canvas>-drawn image — reuses the
 * entire existing image story pipeline (upload, moderation, feed rendering)
 * with zero schema/backend changes, rather than adding a new StoryMediaType
 * TEXT variant that every story-reading surface would then need to learn
 * about. Word-wraps manually since <canvas> text has no built-in wrapping;
 * font size steps down for a longer post so it still fits the fixed canvas
 * instead of overflowing or getting clipped.
 */
async function renderTextStoryImage(text: string, colors: { bg: string; fg: string }): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = TEXT_STORY_SIZE.width;
  canvas.height = TEXT_STORY_SIZE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const maxWidth = canvas.width * 0.84;
  let fontSize = text.length > 220 ? 56 : text.length > 100 ? 68 : 84;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // A single long unbroken string (a pasted URL) can't be word-wrapped, so it
  // used to draw as one line far wider than the canvas and get cut off on both
  // sides. Step the font down (to a readable floor) until the longest word
  // fits, then hard-break whatever still doesn't (see wrapCanvasText).
  const words = text.split(/\s+/).filter(Boolean);
  const setFont = (px: number) => {
    ctx.font = `700 ${px}px system-ui, -apple-system, sans-serif`;
  };
  setFont(fontSize);
  while (fontSize > 44 && words.some((w) => ctx.measureText(w).width > maxWidth)) {
    fontSize -= 4;
    setFont(fontSize);
  }
  const lines = wrapCanvasText(ctx, words, maxWidth);
  // Very long text: keep the whole block inside the frame (with margin).
  const maxBlockHeight = canvas.height * 0.86;
  while (fontSize > 28 && lines.length * fontSize * 1.3 > maxBlockHeight) {
    fontSize -= 4;
    setFont(fontSize);
    lines.splice(0, lines.length, ...wrapCanvasText(ctx, words, maxWidth));
  }

  const lineHeight = fontSize * 13 / 10;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight));

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  // Read into a plain ArrayBuffer-backed File rather than using the Blob
  // directly — same reasoning as resizeImageFile/captureVideoFrame in
  // upload-client.ts (a canvas.toBlob() Blob has been confirmed backed by
  // an already-invalid temp file on Android WebView).
  const buffer = await blob.arrayBuffer();
  return new File([buffer], "story-text.png", { type: "image/png" });
}

/**
 * A picked photo, made uploadable: its real type is worked out case-insensitively from the type or extension
 * (normalizeMediaType: an empty type, `.HEIC`, `image/jpg`), then it is decoded and re-encoded on a canvas
 * (resizeImageFile: long side <= 1920px, so iOS's canvas-area limit is never reached, and HEIC/HEIF become WebP, or
 * PNG on Safari, which can't encode WebP). Anything still not JPEG/PNG/WebP afterwards couldn't be decoded here.
 */
async function processImageFile(raw: File): Promise<ProcessResult> {
  const normalized = normalizeMediaType(raw.type, raw.name);
  if (!normalized || normalized.kind !== "image") return { error: "unsupportedFile", step: "image_type", file: raw };
  // GIFs aren't a Story image type, and drawing one would silently keep only its first frame.
  if (normalized.type === "image/gif") return { error: "imageType", step: "image_type", file: raw };
  const typed =
    raw.type === normalized.type ? raw : new File([raw], safeUploadName("image", normalized.type), { type: normalized.type });
  const resized = await resizeImageFile(typed);
  if (!isUploadableImageType(resized.type)) return { error: "imageUnreadable", step: "image_decode", file: raw };
  if (resized.size > MAX_IMAGE_BYTES) return { error: "imageTooLarge", step: "image_size", file: raw };
  return {
    item: {
      id: makeId(),
      file: resized,
      mediaType: "IMAGE",
      previewUrl: URL.createObjectURL(resized),
      upload: { status: "uploading" },
      durationSeconds: null,
    },
  };
}

/**
 * A picked video, made uploadable: type normalized (`.MP4`/`.MOV` in any case, an empty type, `video/x-m4v`), size
 * checked, and its length read with probeVideoDuration, which also handles the Infinity an iPhone screen recording
 * reports until scanned. A length that can't be read on this device lets the video through (createStory doesn't
 * need it); only a known length over the cap refuses it.
 */
async function processVideoFile(raw: File): Promise<ProcessResult> {
  const f = normalizeVideoFile(raw);
  if (!f) return { error: "videoType", step: "video_type", file: raw };
  if (f.size > MAX_VIDEO_BYTES) return { error: "videoTooLarge", step: "video_size", file: raw };
  const duration = await probeVideoDuration(f);
  if (durationVerdict(duration, MAX_VIDEO_SECONDS) === "too_long") {
    return { error: "videoTooLong", step: "video_duration", file: raw, duration };
  }
  return {
    item: {
      id: makeId(),
      file: f,
      mediaType: "VIDEO",
      previewUrl: URL.createObjectURL(f),
      upload: { status: "uploading" },
      durationSeconds: duration,
    },
  };
}

/** Routes one picked file (from any of the inputs) to the photo or video path; never rejects. */
async function processPickedFile(raw: File): Promise<ProcessResult> {
  try {
    const normalized = normalizeMediaType(raw.type, raw.name);
    if (normalized?.kind === "video") return await processVideoFile(raw);
    if (normalized?.kind === "image") return await processImageFile(raw);
    return { error: "unsupportedFile", step: "pick_type", file: raw };
  } catch {
    // A file the picker already invalidated (ERR_UPLOAD_FILE_CHANGED-style) or any other read failure.
    return { error: "fileReadFailed", step: "pick_read", file: raw };
  }
}

/**
 * Migrated onto the shared Sheet component (see that file) — the caller
 * now renders this unconditionally once `open` has ever been true (Sheet's
 * AnimatePresence needs it mounted through its own exit animation), so the
 * reset-on-close block below is what gives a reopened composer its fresh-
 * form behavior back (previously automatic, since each open used to be a
 * brand new mount) — including revoking every outstanding item's object
 * URL, which the existing unmount-only cleanup effect further down no
 * longer reaches on a mere close (the component doesn't actually unmount
 * anymore).
 */
export function StoryUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useFeedText();
  const { t: storyText } = useStoryUploadText();
  // Per item: whatever part of a video Story already reached storage, so a retry only redoes what failed.
  const uploadedPartsRef = useRef(new Map<string, { videoUrl?: string; thumbUrl?: string }>());
  const [items, setItems] = useState<StoryItem[]>([]);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  // "text": a typed/pasted-text story, rasterized to an image at post time
  // (see renderTextStoryImage) instead of picking a photo/video — mutually
  // exclusive with the media grid below rather than combinable in one
  // batch, matching how a text-story tab works elsewhere (Instagram, etc.).
  const [mode, setMode] = useState<"media" | "text">("media");
  const [textValue, setTextValue] = useState("");
  const [textBgIndex, setTextBgIndex] = useState(0);
  const [textPosting, setTextPosting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Revoking each item's object URL only on unmount (not on every items
  // change) needs the latest array available without retriggering the
  // cleanup effect — a ref mirror, kept current via its own effect (never
  // written during render), is the standard way to do that.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Reset happens at the start of the NEXT open, not at close — revoking
  // still-displayed items' object URLs (or just blanking the form) the
  // moment it closes would visibly break their thumbnails/reset the form
  // while Sheet's exit animation is still fading the whole panel out. A
  // final safety net for "closed and never reopened" still exists below
  // (the real unmount-only cleanup effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      // The plain `items` state (not itemsRef) — safe to read during
      // render, unlike a ref; itemsRef only exists for the unmount-only
      // cleanup effect below, which needs the latest array without
      // re-running itself on every items change.
      for (const item of items) URL.revokeObjectURL(item.previewUrl);
      setItems([]);
      setCaption("");
      setError(null);
      setProgress(null);
      setMode("media");
      setTextValue("");
      setTextBgIndex(0);
    }
  }

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  function setItemUpload(id: string, upload: UploadState) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, upload } : i)));
  }

  /** The words for an error code from either dictionary (story-specific photo/video problems, or the shared ones). */
  function errorMessage(code: string): string {
    if (isStoryUploadCode(code)) return storyText[code];
    if (code === "videoTooLong") return plural(locale, t.stories.upload.errors.videoTooLong, MAX_VIDEO_SECONDS);
    return byCode(t.stories.upload.errors, code);
  }

  /** Marks one tile failed, says why under the grid (a tile's own title isn't visible on a phone) and reports it. */
  function failItem(item: StoryItem, step: string, code: string) {
    const message = errorMessage(code);
    setItemUpload(item.id, { status: "error", message });
    setError(format(storyText.failedItem, { message }));
    reportMediaUploadFailure({ surface: "story", step, code, file: item.file, duration: item.durationSeconds });
  }

  /**
   * Uploads a single item's media to R2 the moment it's added, rather than
   * waiting for "Share" — the longer a picked video sits before it's
   * actually read for upload, the more likely Android's content:// picker
   * (Google Photos, a cloud-backed gallery, etc.) has already invalidated
   * the underlying temp file out from under it, which surfaces as a plain
   * "couldn't reach the server" failure with nothing actually wrong
   * network-wise. A multi-item batch (pick more, write a caption, review
   * the grid) makes that dwell time much longer than the old single-file
   * flow's pick-then-immediately-tap-Share, so starting each upload
   * immediately keeps that gap as small as it was before. Retried by
   * tapping the failed item's own retry control, not by re-picking it.
   *
   * A video Story needs its still frame (createStory refuses one without:
   * `frame_required`), so a video whose frame couldn't be made is a failed
   * tile right here, with its own message, instead of a tile that looked
   * ready and only failed after "Share". Whatever already went up (the video,
   * or the frame) is kept for the retry, which only redoes the missing part.
   */
  async function startUpload(item: StoryItem) {
    // Also covers the retry path (the failed tile's own onClick, below):
    // without this, tapping "Tap to retry" left the item's status stuck at
    // "error" for the whole re-upload — no spinner feedback that the tap
    // did anything, and nothing stopped a second tap mid-retry from firing
    // a duplicate concurrent upload of the same file.
    setItemUpload(item.id, { status: "uploading" });
    if (item.mediaType === "IMAGE") {
      const result = await uploadFileDirect(item.file, "story-image");
      if (!result.ok) {
        failItem(item, "image_upload", result.error);
        return;
      }
      setItemUpload(item.id, { status: "done", mediaUrl: result.publicUrl });
      return;
    }

    type Part = { ok: true; url: string } | { ok: false; error: string; step: string };
    const kept = uploadedPartsRef.current.get(item.id) ?? {};
    const videoPart: Promise<Part> = kept.videoUrl
      ? Promise.resolve({ ok: true, url: kept.videoUrl })
      : uploadFileDirect(item.file, "story-video").then((r) =>
          r.ok ? { ok: true, url: r.publicUrl } : { ok: false, error: r.error, step: "video_upload" },
        );
    const framePart: Promise<Part> = kept.thumbUrl
      ? Promise.resolve({ ok: true, url: kept.thumbUrl })
      : captureVideoFrameDetailed(item.file).then(async (captured): Promise<Part> => {
          if (!captured.frame) {
            return { ok: false, error: "frameFailed", step: `frame_capture_${captured.reason ?? "unknown"}` };
          }
          const up = await uploadFileDirect(captured.frame, "video-thumb");
          return up.ok ? { ok: true, url: up.publicUrl } : { ok: false, error: up.error, step: "thumb_upload" };
        });
    const [video, frame] = await Promise.all([videoPart, framePart]);
    uploadedPartsRef.current.set(item.id, {
      videoUrl: video.ok ? video.url : undefined,
      thumbUrl: frame.ok ? frame.url : undefined,
    });
    if (!video.ok) {
      failItem(item, video.step, video.error);
      return;
    }
    if (!frame.ok) {
      failItem(item, frame.step, frame.error);
      return;
    }
    setItemUpload(item.id, { status: "done", mediaUrl: video.url, mediaThumbnailUrl: frame.url });
  }

  function addResults(results: ProcessResult[]) {
    const newItems = results.filter((r): r is { item: StoryItem } => "item" in r).map((r) => r.item);
    const failures = results.filter((r): r is ProcessError => "error" in r);
    for (const failure of failures) {
      reportMediaUploadFailure({
        surface: "story",
        step: failure.step,
        code: failure.error,
        file: failure.file,
        duration: failure.duration,
      });
    }
    const messages = [...new Set(failures.map((r) => errorMessage(r.error)))];
    if (newItems.length) {
      setItems((prev) => [...prev, ...newItems]);
      for (const item of newItems) void startUpload(item);
    }
    setError(messages.length ? messages.join(" ") : null);
  }

  /** Every input (photos+videos, videos, camera) and the Android native photo picker land here. */
  async function addFiles(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return;
    // Copied out before the input is cleared (the FileList is live).
    const incoming = Array.from(fileList);
    const results = await Promise.all(incoming.map(processPickedFile));
    addResults(results);
  }

  /**
   * Nicer native multi-select on Android (see native-gallery-picker.ts);
   * null means it didn't run (iOS, web, or an older installed build), so
   * the caller falls back to the plain <input type="file" multiple>, which
   * takes photos AND videos (STORY_DEVICE_ACCEPT): on iPhone this is the
   * only picker, and a photos-only accept list hid every video, screen
   * recordings included. An empty (non-null) array means the user opened
   * the native picker and backed out with nothing selected — a no-op, same
   * as cancelling the file dialog.
   */
  async function pickImagesOrFallback() {
    if (isNativePickerActive()) return;
    const native = await pickImagesNative(NATIVE_PICKER_LIMIT);
    if (native) {
      if (native.length > 0) void addFiles(native);
      return;
    }
    markNativePickerActive();
    imageInputRef.current?.click();
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  /** Posts one already-uploaded item's story row — isolated so one failure never blocks the rest of the batch (see submit()). */
  async function postOneStory(item: StoryItem & { upload: { status: "done"; mediaUrl: string; mediaThumbnailUrl?: string } }) {
    const fd = new FormData();
    fd.set("mediaType", item.mediaType);
    fd.set("mediaUrl", item.upload.mediaUrl);
    if (item.upload.mediaThumbnailUrl) fd.set("mediaThumbnailUrl", item.upload.mediaThumbnailUrl);
    if (caption.trim()) fd.set("caption", caption.trim());

    try {
      const result = await createStory(fd);
      if (result.error) {
        reportMediaUploadFailure({ surface: "story", step: "create_story", code: result.error, file: item.file, duration: item.durationSeconds });
        return { ok: false as const, message: errorMessage(result.error === "frame_required" ? "frameFailed" : result.error) };
      }
      return { ok: true as const };
    } catch (err) {
      const code = looksLikeStaleServerActionError(err) ? "stale_deployment" : "network";
      reportMediaUploadFailure({ surface: "story", step: "create_story", code, file: item.file, duration: item.durationSeconds });
      return { ok: false as const, message: byCode(t.stories.upload.errors, code) };
    }
  }

  /** Rasterizes the current text/background into an image, then posts it through the exact same upload+createStory path as any picked photo. */
  async function submitText() {
    const trimmed = textValue.trim();
    if (!trimmed || textPosting) return;
    setTextPosting(true);
    setError(null);
    try {
      const file = await renderTextStoryImage(trimmed, TEXT_STORY_BACKGROUNDS[textBgIndex]);
      const result = await uploadFileDirect(file, "story-image");
      if (!result.ok) {
        setError(byCode(t.stories.upload.errors, result.error));
        return;
      }
      const fd = new FormData();
      fd.set("mediaType", "IMAGE");
      fd.set("mediaUrl", result.publicUrl);
      const created = await createStory(fd);
      if (created.error) {
        setError(byCode(t.stories.upload.errors, created.error));
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(looksLikeStaleServerActionError(err) ? byCode(t.stories.upload.errors, "stale_deployment") : byCode(t.stories.upload.errors, "network"));
    } finally {
      setTextPosting(false);
    }
  }

  function submit() {
    const ready = items.filter((i): i is StoryItem & { upload: Extract<UploadState, { status: "done" }> } => i.upload.status === "done");
    if (ready.length === 0 || isPending) return;
    setError(null);
    startTransition(async () => {
      const total = ready.length;
      setProgress({ done: 0, total });
      const postedIds = new Set<string>();
      let firstFailureMessage: string | null = null;

      // Sequential, not Promise.all: each createStory call isn't
      // idempotent, so items post one at a time and a failure partway
      // through leaves the earlier successes in place rather than racing
      // duplicate writes on a blind retry.
      for (const item of ready) {
        const outcome = await postOneStory(item);
        if (outcome.ok) {
          postedIds.add(item.id);
          URL.revokeObjectURL(item.previewUrl);
        } else {
          firstFailureMessage ??= outcome.message;
        }
        setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
      }

      setProgress(null);
      setItems((prev) => prev.filter((i) => !postedIds.has(i.id)));

      if (postedIds.size < total) {
        setError(
          format(t.stories.upload.partial, {
            posted: postedIds.size,
            total,
            failed: total - postedIds.size,
            reason: firstFailureMessage ?? t.stories.upload.partialReason,
          }),
        );
        return;
      }

      router.refresh();
      onClose();
    });
  }

  const readyCount = items.filter((i) => i.upload.status === "done").length;
  const anyUploading = items.some((i) => i.upload.status === "uploading");

  return (
    // Portaled by Sheet into the root overlay host (src/components/overlay-root.tsx) on the sheet layer: never inside
    // the Home story tray's horizontal scroller or the avatar that opened it. It used to sit in a `relative z-[70]`
    // wrapper there, a stacking context inside that scroller, which is where it came up invisible on iPhone
    // (2026-11-14). The panel is bounded to the space between the safe areas and scrolls by itself, so Share is
    // always reachable (.overlay-panel-bounded, globals.css).
    <Sheet open={open} onClose={onClose} title={t.stories.addToStory} panelClassName="overlay-panel-bounded">
        {/* Switching modes mid-batch would mean juggling two unrelated
            in-progress flows (uploaded media items vs. a typed draft) at
            once, so the toggle itself only shows before either has
            started — once a photo/video is added, this is committed to
            "media" for this open of the modal. */}
        {items.length === 0 && (
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
            <button
              type="button"
              onClick={() => setMode("media")}
              aria-pressed={mode === "media"}
              className={cn(
                "rounded-md py-1.5 text-xs font-medium",
                mode === "media" ? "bg-surface shadow-[var(--shadow-sm)]" : "text-foreground-soft",
              )}
            >
              {t.stories.upload.photoVideo}
            </button>
            <button
              type="button"
              onClick={() => setMode("text")}
              aria-pressed={mode === "text"}
              className={cn(
                "rounded-md py-1.5 text-xs font-medium",
                mode === "text" ? "bg-surface shadow-[var(--shadow-sm)]" : "text-foreground-soft",
              )}
            >
              {t.stories.upload.text}
            </button>
          </div>
        )}

        {mode === "text" ? (
          <div className="mt-3">
            <div
              // Story-shaped (9:16) but never taller than about half the visible screen, so the colours and Share
              // stay on screen with the keyboard up; the posted image is drawn at its own fixed size regardless.
              className="relative mx-auto flex aspect-[9/16] h-[min(55dvh,36rem)] max-w-full items-center justify-center overflow-hidden rounded-lg p-6"
              style={{ backgroundColor: TEXT_STORY_BACKGROUNDS[textBgIndex].bg }}
            >
              <textarea dir="auto"
                aria-label={t.stories.upload.textLabel}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value.slice(0, TEXT_STORY_MAX_CHARS))}
                placeholder={t.stories.upload.textPlaceholder}
                maxLength={TEXT_STORY_MAX_CHARS}
                autoFocus
                className="h-full w-full min-w-0 max-w-full resize-none break-words bg-transparent text-center text-lg font-semibold outline-none [overflow-wrap:anywhere] placeholder:opacity-60"
                style={{ color: TEXT_STORY_BACKGROUNDS[textBgIndex].fg }}
              />
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
              {TEXT_STORY_BACKGROUNDS.map((c, i) => (
                <button
                  key={c.bg}
                  type="button"
                  onClick={() => setTextBgIndex(i)}
                  aria-label={format(t.stories.upload.background, { index: i + 1 })}
                  aria-pressed={i === textBgIndex}
                  className={cn(
                    "h-7 w-7 rounded-full border-2",
                    i === textBgIndex ? "border-accent" : "border-line",
                  )}
                  style={{ backgroundColor: c.bg }}
                />
              ))}
            </div>

            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}

            <button
              type="button"
              disabled={!textValue.trim() || textPosting}
              onClick={submitText}
              className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
            >
              {textPosting ? t.stories.upload.posting : t.stories.upload.share}
            </button>
            <p className="mt-2 text-center text-[0.6875rem] text-foreground-soft">{t.stories.upload.disappears}</p>
          </div>
        ) : (
          <>
        {/* "Upload from device" when Android's native photo picker isn't
            there (always on iPhone): photos AND videos. It used to list the
            three exact image types, which made iOS hide every video (screen
            recordings included) from this picker. `image/*` also keeps iOS
            converting HEIC photos to JPEG on the way in. */}
        <input
          ref={imageInputRef}
          type="file"
          accept={STORY_DEVICE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {/* accept must include the literal "image/*" — Capacitor's own
            WebView file-chooser handler only routes a capture-enabled
            input to the native camera intent when
            acceptTypes.contains("image/*") is true; see avatar-upload.tsx's
            camera input for the full explanation. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={`${IMAGE_TYPES.join(",")},image/*`}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {/* accept must include the literal "video/*" — confirmed live via
            adb logcat on a real Samsung device: the WebView's file-chooser
            collapses this multi-type accept list to a single MIME type on
            the GET_CONTENT intent (typ=video/mp4 only, video/webm silently
            dropped), so a video whose reported type doesn't match that one
            exact string never shows as pickable. See post-composer.tsx's
            equivalent input for the full writeup. */}
        <input
          ref={videoInputRef}
          type="file"
          accept={`${VIDEO_TYPES.join(",")},video/*`}
          multiple
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {items.map((item) => (
              <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg bg-black">
                {item.mediaType === "IMAGE" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <>
                    {/* #t=0.1 + preload: iOS otherwise paints nothing for a paused, never-played <video> (a black tile). */}
                    <video src={`${item.previewUrl}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    <Video size={14} className="absolute bottom-1 start-1 text-white drop-shadow" />
                  </>
                )}

                {item.upload.status === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 size={20} className="animate-spin text-white" />
                  </div>
                )}
                {item.upload.status === "error" && (
                  <button
                    type="button"
                    onClick={() => startUpload(item)}
                    title={format(t.stories.upload.retryTitle, { message: item.upload.status === "error" ? item.upload.message : "" })}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-white"
                  >
                    <AlertCircle size={18} />
                    <span className="text-[0.625rem] font-medium">{t.stories.upload.tapToRetry}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={isPending}
                  aria-label={t.stories.upload.remove}
                  className="absolute end-1 top-1 rounded-full bg-black/60 p-1 text-white disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {!isPending && (
              <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line">
                <MediaPickerButton
                  // Opens downward: the panel scrolls (overlay-panel-bounded), and a menu opening upward from near its top
                  // would be cut off by it; downward it just extends the scroll.
                  menuPlacement="bottom"
                  icon={<Upload size={16} />}
                  title={t.stories.upload.addMore}
                  options={[
                    { label: t.stories.upload.addPhotos, icon: <Upload size={14} />, onSelect: pickImagesOrFallback },
                    {
                      label: t.stories.upload.takePhoto,
                      icon: <Camera size={14} />,
                      onSelect: () => {
                        if (isNativePickerActive()) return;
                        markNativePickerActive();
                        cameraInputRef.current?.click();
                      },
                    },
                    {
                      label: t.stories.upload.addVideos,
                      icon: <Video size={14} />,
                      onSelect: () => {
                        if (isNativePickerActive()) return;
                        markNativePickerActive();
                        videoInputRef.current?.click();
                      },
                    },
                  ]}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-center gap-4 rounded-lg border border-dashed border-line py-10">
            <MediaPickerButton
                  // Opens downward: the panel scrolls (overlay-panel-bounded), and a menu opening upward from near its top
                  // would be cut off by it; downward it just extends the scroll.
                  menuPlacement="bottom"
              icon={<Upload size={18} />}
              title={t.stories.upload.addPhotos}
              options={[
                {
                  label: t.stories.upload.uploadFromDevice,
                  icon: <Upload size={14} />,
                  onSelect: pickImagesOrFallback,
                },
                {
                  label: t.stories.upload.takePhoto,
                  icon: <Camera size={14} />,
                  onSelect: () => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    cameraInputRef.current?.click();
                  },
                },
              ]}
            />
            <MediaPickerButton
                  // Opens downward: the panel scrolls (overlay-panel-bounded), and a menu opening upward from near its top
                  // would be cut off by it; downward it just extends the scroll.
                  menuPlacement="bottom"
              icon={<Video size={18} />}
              title={t.stories.upload.addVideos}
              options={[
                {
                  label: t.stories.upload.uploadFromDevice,
                  icon: <Upload size={14} />,
                  onSelect: () => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    videoInputRef.current?.click();
                  },
                },
              ]}
            />
          </div>
        )}

        {items.length > 0 && (
          <>
            <p className="mt-2 text-center text-[0.6875rem] text-foreground-soft">
              {plural(locale, t.stories.upload.added, items.length)}
            </p>
            <input dir="auto"
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={200}
              placeholder={items.length > 1 ? t.stories.upload.captionAll : t.stories.upload.caption}
              aria-label={items.length > 1 ? t.stories.upload.captionAll : t.stories.upload.caption}
              className="mt-2 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </>
        )}

        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}

        <button
          type="button"
          disabled={readyCount === 0 || anyUploading || isPending}
          onClick={submit}
          className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {isPending
            ? progress
              ? format(t.stories.upload.postingProgress, { done: progress.done, total: progress.total })
              : t.stories.upload.posting
            : anyUploading
              ? t.stories.upload.uploading
              : readyCount > 1
                ? format(t.stories.upload.shareCount, { count: readyCount })
                : t.stories.upload.share}
        </button>
        <p className="mt-2 text-center text-[0.6875rem] text-foreground-soft">{t.stories.upload.disappears}</p>
          </>
        )}
    </Sheet>
  );
}
