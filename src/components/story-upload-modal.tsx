"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Loader2, Upload, Video, X } from "lucide-react";
import { createStory } from "@/app/actions/stories";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile } from "@/lib/upload-client";
import { MediaPickerButton } from "@/components/media-picker-button";
import { isStaleDeploymentError, STALE_DEPLOYMENT_MESSAGE } from "@/lib/stale-deployment";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Kept in sync with storage.ts's MAX_VIDEO_BYTES — duplicated locally rather
// than imported, since storage.ts pulls in the server-only @aws-sdk/client-s3
// SDK and can't be bundled into a "use client" component (same pattern
// chat-thread.tsx uses for its own MAX_*_BYTES constants).
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 120;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];
const VIDEO_EXTENSION_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };
// createStory has no batch endpoint — each item is its own upload + DB row —
// 5 keeps a single "share" action from turning into an unbounded upload run,
// and stays comfortably under storyCreate's 10/hour rate limit even with a
// retry.
const MAX_ITEMS = 5;

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
};

/**
 * Android's document picker often hands back a file from a content:// URI
 * (Google Photos, a file manager, etc.) with File.type empty or wrong,
 * even for a perfectly normal .mp4 — a strict MIME-type check alone
 * rejected those outright with no indication why. Falls back to the file
 * extension, and returns a corrected File so the upload itself (which
 * sends file.type as the R2 object's Content-Type) doesn't inherit the
 * same wrong/empty type.
 */
function normalizeVideoFile(f: File): File | null {
  if (VIDEO_TYPES.includes(f.type)) return f;
  const ext = f.name.split(".").pop()?.toLowerCase();
  const detectedType = ext ? VIDEO_EXTENSION_TYPES[ext] : undefined;
  if (!detectedType) return null;
  return new File([f], f.name, { type: detectedType });
}

function errorMessage(code: string) {
  switch (code) {
    case "too_large":
      return "That file is too large.";
    case "moderation":
      return "That didn't pass our content guidelines.";
    case "rate_limited":
      return "You're posting stories too fast — slow down a little.";
    case "not_configured":
      return "Story uploads aren't set up yet.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    case "stale_deployment":
      return STALE_DEPLOYMENT_MESSAGE;
    case "server_error":
      return "Your video uploaded, but posting it failed — try again in a moment.";
    default:
      return "Couldn't post that story — try again.";
  }
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

async function processImageFile(f: File): Promise<{ item: StoryItem } | { error: string }> {
  if (!IMAGE_TYPES.includes(f.type)) return { error: "Use a JPEG, PNG, or WebP image." };
  const resized = await resizeImageFile(f);
  if (resized.size > MAX_IMAGE_BYTES) return { error: "Images must be 25MB or smaller." };
  return {
    item: { id: makeId(), file: resized, mediaType: "IMAGE", previewUrl: URL.createObjectURL(resized), upload: { status: "uploading" } },
  };
}

/**
 * Wraps the same <video> metadata-probe pattern the single-file version
 * used, as a Promise so it composes with Promise.all across a multi-file
 * selection (see addVideos below).
 */
function processVideoFile(rawFile: File): Promise<{ item: StoryItem } | { error: string }> {
  return new Promise((resolve) => {
    const f = normalizeVideoFile(rawFile);
    if (!f) {
      resolve({ error: "Use an MP4 or WebM video." });
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      resolve({ error: "Video must be 2GB or smaller." });
      return;
    }

    const probeUrl = URL.createObjectURL(f);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = probeUrl;

    // Some Android devices/codecs never fire loadedmetadata for a file this
    // <video> element can't decode (nor onerror, in a few cases) — without
    // this, picking such a video did nothing at all: no preview, no error,
    // the modal just sat there looking broken. A duration probe failure is
    // a client-side nicety, not a security boundary, so it fails open
    // (lets the video through unchecked) rather than blocking the upload.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(probeUrl);
    };
    const toItem = (): { item: StoryItem } => ({
      item: { id: makeId(), file: f, mediaType: "VIDEO", previewUrl: URL.createObjectURL(f), upload: { status: "uploading" } },
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      finish();
      resolve(toItem());
    }, 4000);

    probe.onloadedmetadata = () => {
      if (settled) return;
      finish();
      if (Number.isFinite(probe.duration) && probe.duration > MAX_VIDEO_SECONDS) {
        resolve({ error: `Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.` });
        return;
      }
      resolve(toItem());
    };
    probe.onerror = () => {
      if (settled) return;
      finish();
      resolve(toItem());
    };
  });
}

export function StoryUploadModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<StoryItem[]>([]);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
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
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  function setItemUpload(id: string, upload: UploadState) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, upload } : i)));
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
   */
  async function startUpload(item: StoryItem) {
    if (item.mediaType === "IMAGE") {
      const result = await uploadFileDirect(item.file, "story-image");
      if (!result.ok) {
        setItemUpload(item.id, { status: "error", message: errorMessage(result.error) });
        return;
      }
      setItemUpload(item.id, { status: "done", mediaUrl: result.publicUrl });
      return;
    }

    const [videoResult, thumb] = await Promise.all([
      uploadFileDirect(item.file, "story-video"),
      captureVideoFrameFromFile(item.file).then((frame) => (frame ? uploadFileDirect(frame, "video-thumb") : null)),
    ]);
    if (!videoResult.ok) {
      setItemUpload(item.id, { status: "error", message: errorMessage(videoResult.error) });
      return;
    }
    setItemUpload(item.id, {
      status: "done",
      mediaUrl: videoResult.publicUrl,
      mediaThumbnailUrl: thumb?.ok ? thumb.publicUrl : undefined,
    });
  }

  function addResults(results: ({ item: StoryItem } | { error: string })[], overflow: number) {
    const newItems = results.filter((r): r is { item: StoryItem } => "item" in r).map((r) => r.item);
    const messages = [...new Set(results.filter((r): r is { error: string } => "error" in r).map((r) => r.error))];
    if (overflow > 0) messages.push(`You can add up to ${MAX_ITEMS} items per story batch — ${overflow} left out.`);
    if (newItems.length) {
      setItems((prev) => [...prev, ...newItems]);
      for (const item of newItems) startUpload(item);
    }
    setError(messages.length ? messages.join(" ") : null);
  }

  async function addImages(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    const allowed = Math.max(0, MAX_ITEMS - items.length);
    const results = await Promise.all(incoming.slice(0, allowed).map(processImageFile));
    addResults(results, incoming.length - allowed);
  }

  async function addVideos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    const allowed = Math.max(0, MAX_ITEMS - items.length);
    const results = await Promise.all(incoming.slice(0, allowed).map(processVideoFile));
    addResults(results, incoming.length - allowed);
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
      if (result.error) return { ok: false as const, message: errorMessage(result.error) };
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: isStaleDeploymentError(err) ? errorMessage("stale_deployment") : errorMessage("network") };
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
        setError(`${postedIds.size} of ${total} posted. ${total - postedIds.size} failed: ${firstFailureMessage ?? "try again."}`);
        return;
      }

      router.refresh();
      onClose();
    });
  }

  const atCapacity = items.length >= MAX_ITEMS;
  const readyCount = items.filter((i) => i.upload.status === "done").length;
  const anyUploading = items.some((i) => i.upload.status === "uploading");

  return (
    <div className="animate-modal-backdrop-in fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add to your story</h2>
          <button type="button" onClick={onClose} className="text-foreground-soft hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            addImages(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addImages(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept={VIDEO_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            addVideos(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {items.map((item) => (
              <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg bg-black">
                {item.mediaType === "IMAGE" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <>
                    <video src={item.previewUrl} muted className="h-full w-full object-cover" />
                    <Video size={14} className="absolute bottom-1 left-1 text-white drop-shadow" />
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
                    title={`${item.upload.status === "error" ? item.upload.message : ""} — tap to retry`}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-white"
                  >
                    <AlertCircle size={18} />
                    <span className="text-[10px] font-medium">Tap to retry</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={isPending}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {!atCapacity && !isPending && (
              <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line">
                <MediaPickerButton
                  icon={<Upload size={16} />}
                  title="Add more"
                  options={[
                    { label: "Add photos", icon: <Upload size={14} />, onSelect: () => imageInputRef.current?.click() },
                    { label: "Take a photo", icon: <Camera size={14} />, onSelect: () => cameraInputRef.current?.click() },
                    { label: "Add videos", icon: <Video size={14} />, onSelect: () => videoInputRef.current?.click() },
                  ]}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-center gap-4 rounded-lg border border-dashed border-line py-10">
            <MediaPickerButton
              icon={<Upload size={18} />}
              title="Add photos"
              options={[
                {
                  label: "Upload from device",
                  icon: <Upload size={14} />,
                  onSelect: () => imageInputRef.current?.click(),
                },
                {
                  label: "Take a photo",
                  icon: <Camera size={14} />,
                  onSelect: () => cameraInputRef.current?.click(),
                },
              ]}
            />
            <MediaPickerButton
              icon={<Video size={18} />}
              title="Add videos"
              options={[
                {
                  label: "Upload from device",
                  icon: <Upload size={14} />,
                  onSelect: () => videoInputRef.current?.click(),
                },
              ]}
            />
          </div>
        )}

        {items.length > 0 && (
          <>
            <p className="mt-2 text-center text-[11px] text-foreground-soft">
              {items.length} of {MAX_ITEMS} — tap the × to remove, or a failed item to retry it.
            </p>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={200}
              placeholder={items.length > 1 ? "Add a caption to all (optional)" : "Add a caption (optional)"}
              className="mt-2 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </>
        )}

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <button
          type="button"
          disabled={readyCount === 0 || anyUploading || isPending}
          onClick={submit}
          className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {isPending
            ? progress
              ? `Posting ${progress.done}/${progress.total}...`
              : "Posting..."
            : anyUploading
              ? "Uploading..."
              : readyCount > 1
                ? `Share ${readyCount} to your story`
                : "Share to your story"}
        </button>
        <p className="mt-2 text-center text-[11px] text-foreground-soft">Disappears after 24 hours.</p>
      </div>
    </div>
  );
}
