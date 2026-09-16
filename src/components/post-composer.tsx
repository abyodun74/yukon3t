"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Camera, Circle, ImageDown, ImagePlus, Link as LinkIcon, Mic, Upload, Video, X } from "lucide-react";
import { createPost, confirmPostDeviceChallenge } from "@/app/actions/circles";
import { addImageFromUrl, requestUploadUrl } from "@/app/actions/media";
import { resolveSharedVideoLink } from "@/app/actions/embeds";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile, withRetry } from "@/lib/upload-client";
import { isStaleDeploymentError, STALE_DEPLOYMENT_MESSAGE } from "@/lib/stale-deployment";
import { parseVideoEmbedUrl, type EmbedProvider } from "@/lib/video-embed";
import { normalizeLinkUrl } from "@/lib/link-url";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { consumePendingShareMedia, subscribePendingShareMedia } from "@/lib/share-target-store";
import { GifPickerButton } from "@/components/gif-picker-button";
import { EmojiTypeSuggestions } from "@/components/emoji-type-suggestions";
import { VideoRecorderModal } from "@/components/video-recorder-modal";
import { MediaPickerButton } from "@/components/media-picker-button";
import { pickImagesNative } from "@/lib/native-gallery-picker";
import { pickVideoNative, uploadVideoNative } from "@/lib/native-video-picker";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";
import { DictationRecorder } from "@/components/dictation-recorder";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Kept in sync with storage.ts's MAX_VIDEO_BYTES — duplicated locally rather
// than imported, since storage.ts pulls in the server-only @aws-sdk/client-s3
// SDK and can't be bundled into a "use client" component.
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;
// In-browser recording stays short — bounded by MediaRecorder holding the
// whole clip in memory on the recording device, not by moderation coverage.
const MAX_RECORD_VIDEO_SECONDS = 60;
// Picking an existing file can go up to an hour. Kept in sync with
// storage.ts's MAX_VIDEO_DURATION_SECONDS (duplicated locally rather than
// imported — storage.ts pulls in the server-only @aws-sdk/client-s3 SDK and
// can't be bundled into a "use client" component). Anything over
// VIDEO_INSTANT_PUBLISH_MAX_SECONDS still uploads fine, but publishes
// hidden pending review instead of going out immediately — see
// videoNeedsHold in actions/circles.ts.
const MAX_UPLOAD_VIDEO_SECONDS = 3600;
const VIDEO_INSTANT_PUBLISH_MAX_SECONDS = 600;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];
const VIDEO_EXTENSION_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };

// Same content:// URI MIME-type gap as ad-booking-form.tsx's and
// story-upload-modal.tsx's pickVideo — a mobile picker (confirmed live via
// Android's system Photo Picker/Google Photos) often hands back an empty or
// wrong File.type even for a normal .mp4, so the strict VIDEO_TYPES.includes
// check below silently rejected every video picked that way: pickVideo bailed
// out before ever calling setVideo/setStatus/setErrorText, which is exactly
// why nothing appeared to happen — no error banner, no attached video.
function normalizeVideoFile(f: File): File | null {
  if (VIDEO_TYPES.includes(f.type)) return f;
  const ext = f.name.split(".").pop()?.toLowerCase();
  const detectedType = ext ? VIDEO_EXTENSION_TYPES[ext] : undefined;
  if (!detectedType) return null;
  return new File([f], f.name, { type: detectedType });
}

const EMBED_PROVIDER_LABELS: Record<EmbedProvider, string> = {
  YOUTUBE: "YouTube",
  VIMEO: "Vimeo",
  TIKTOK: "TikTok",
  DAILYMOTION: "Dailymotion",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};

function formatSecondsLabel(seconds: number) {
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

// datetime-local inputs want "YYYY-MM-DDTHH:mm" in the viewer's own local
// time — Date#toISOString() is UTC, so the offset has to be subtracted out
// by hand rather than just slicing the ISO string.
function nowForDateTimeLocal() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function errorMessage(code: string) {
  switch (code) {
    case "not_configured":
      return "Media uploads aren't set up yet — you can still post text.";
    case "too_large":
      return "That file is too large.";
    case "moderation":
      return "That media didn't pass our content guidelines and wasn't posted.";
    case "not_a_member":
      return "Join this Circle first.";
    case "rate_limited":
      return "You're posting too fast — slow down a little.";
    case "invalid":
      return "That link isn't valid — check it starts with http:// or https://.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    case "stale_deployment":
      return STALE_DEPLOYMENT_MESSAGE;
    case "unavailable":
      return "Couldn't transcribe that clip — try again.";
    default:
      return "Couldn't post — try again.";
  }
}

function deviceChallengeErrorMessage(code: string) {
  switch (code) {
    case "invalid_code":
      return "That code didn't match — check it and try again.";
    case "expired":
      return "That code expired — resend and try again.";
    case "too_many_attempts":
      return "Too many wrong attempts — resend and try again.";
    case "not_found":
      return "That verification has expired — resend and try again.";
    case "rate_limited":
      return "Too many attempts. Please wait a bit and try again.";
    default:
      return "Couldn't verify that code — try again.";
  }
}

function imageUrlErrorMessage(code: string) {
  switch (code) {
    case "blocked_host":
      return "That URL isn't allowed — link directly to a public image.";
    case "invalid_content_type":
      return "That link isn't a JPEG, PNG, or WebP image.";
    case "too_large":
      return "That image is too large (max 25MB).";
    case "fetch_failed":
      return "Couldn't fetch that image — check the link and try again.";
    case "not_configured":
      return "Media uploads aren't set up yet.";
    case "rate_limited":
      return "You're adding images too fast — slow down a little.";
    default:
      return "Couldn't add that image — check the link and try again.";
  }
}

export function PostComposer({
  circleId,
  channelId,
  placeholder = circleId ? "Share something with this Circle..." : "Share a photo, a short video, or an update...",
  // Prefilled from the viewer's account-wide default (Settings) — purely a
  // starting point for the per-post picker below, not itself enforced.
  // Meaningless (and hidden) for a Circle post: circleId is always stored
  // PUBLIC server-side since Circle membership is already that post's real
  // access boundary (see createPost/getVisiblePostsWhere).
  defaultVisibility = "PUBLIC",
}: {
  circleId?: string;
  channelId?: string;
  placeholder?: string;
  defaultVisibility?: "PUBLIC" | "CONNECTIONS_ONLY";
}) {
  const [images, setImages] = useState<File[]>([]);
  const [urlImages, setUrlImages] = useState<string[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  // Set when a video was picked via Android's native picker (see
  // pickVideoNative) instead of the plain <input type="file"> — that path
  // uploads the video from native code the moment it's picked rather than
  // waiting for Post (native code never hands the raw bytes to JS at all,
  // so there's no File here to defer uploading the usual way), so this
  // holds the already-uploaded result rather than a File.
  const [nativeVideoUpload, setNativeVideoUpload] = useState<{
    videoUrl: string;
    videoThumbnailUrl?: string;
    videoDurationSeconds?: number;
    name: string;
  } | null>(null);
  const [nativeVideoUploading, setNativeVideoUploading] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  // A picked Giphy GIF URL — never uploaded, so it bypasses uploadAll's
  // File-handling branches entirely.
  const [pendingGif, setPendingGif] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "error" | "uploading">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [isEvent, setIsEvent] = useState(false);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [imageUrlValue, setImageUrlValue] = useState("");
  const [imageUrlPending, setImageUrlPending] = useState(false);
  const [imageUrlError, setImageUrlError] = useState<string | null>(null);
  const [showEmbedInput, setShowEmbedInput] = useState(false);
  const [embedUrlValue, setEmbedUrlValue] = useState("");
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [showDictation, setShowDictation] = useState(false);
  // Set when createPost pauses on an unrecognized device — holds the exact
  // FormData that attempt built (media already uploaded) so, once the
  // emailed code is confirmed, the same post can be resubmitted without
  // re-uploading anything or losing the draft.
  const [deviceChallenge, setDeviceChallenge] = useState<{ id: string; fd: FormData } | null>(null);
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceChallengeError, setDeviceChallengeError] = useState<string | null>(null);
  const [deviceChallengePending, setDeviceChallengePending] = useState(false);
  // Mirrors the (otherwise uncontrolled — see the textarea below)
  // content field's live value, just for driving the emoji suggestion
  // strip — doesn't control the textarea itself, so it stays in sync via
  // the textarea's own onChange plus the two spots below that mutate
  // contentRef.current directly (insertEmoji, appendDictatedText).
  const [suggestionText, setSuggestionText] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const imageCount = images.length + urlImages.length;
  const hasOtherMedia =
    Boolean(video) || Boolean(nativeVideoUpload) || nativeVideoUploading || Boolean(embedUrl) || Boolean(pendingGif);
  const parsedEmbed = useMemo(() => (embedUrl ? parseVideoEmbedUrl(embedUrl) : null), [embedUrl]);

  function insertEmoji(emoji: string) {
    const el = contentRef.current;
    if (!el) return;
    el.setRangeText(emoji, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, "end");
    el.focus();
    setSuggestionText(el.value);
  }

  function appendDictatedText(text: string) {
    const el = contentRef.current;
    const trimmed = text.trim();
    if (!el || !trimmed) return;
    el.value = el.value ? `${el.value} ${trimmed}` : trimmed;
    el.focus();
    setSuggestionText(el.value);
  }

  // Picks up media handed off by ShareTargetGate ("New post" from another
  // app's Share sheet) — see share-target-store.ts. Checked both on mount
  // (covers navigating here from elsewhere) and via subscribePendingShareMedia
  // (covers the case confirmed live: PostComposer lives inline on /home,
  // which is also where ShareTargetGate itself renders over, so
  // router.push("/home") when already there doesn't remount this component
  // at all — the mount check alone silently missed it). Deferred a
  // microtask rather than read synchronously in the effect body — same
  // async-boundary shape as every other "check on mount" effect in this
  // codebase (e.g. ShareTargetGate's own checkForPendingShare().then(...)),
  // which react-hooks/set-state-in-effect wants rather than a same-tick
  // setState call directly in the effect body.
  useEffect(() => {
    function applyShare() {
      Promise.resolve().then(async () => {
        const shared = consumePendingShareMedia();
        if (!shared) return;
        // Through the same pickImages/pickVideo validation (type/size/
        // resize) as any other attach path, not straight into state — a
        // share-sheet hand-off is no more trustworthy than a raw file
        // picker/paste.
        if (shared.images.length > 0) pickImages(shared.images);
        if (shared.video) pickVideo(shared.video);
        if (shared.text) {
          const trimmed = shared.text.trim();
          // A share that's a bare link (no other caption text) is usually
          // a video app's own Share sheet handing over a link instead of
          // the actual file (confirmed live: a shared TikTok video landed
          // in the post body as a plain unclickable URL). Route it through
          // the same embed path "paste a link" already uses instead of
          // dropping it into the caption as inert text — not specific to
          // any one app: if direct parsing fails, resolveSharedVideoLink
          // follows the link's own redirect chain (any app's short/
          // tracking-link scheme, not just TikTok's) and re-checks the
          // landing URL the same way a manually pasted link would be.
          let handled = false;
          if (parseVideoEmbedUrl(trimmed)) {
            addEmbed(trimmed);
            handled = true;
          } else {
            const looksLikeUrl = (() => {
              try {
                new URL(trimmed);
                return true;
              } catch {
                return false;
              }
            })();
            if (looksLikeUrl) {
              const { url: resolved } = await resolveSharedVideoLink(trimmed);
              if (resolved) {
                addEmbed(resolved);
                handled = true;
              }
            }
          }
          if (!handled) appendDictatedText(trimmed);
        }
      });
    }
    applyShare();
    return subscribePendingShareMedia(applyShare);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/subscribe-only; pickImages/pickVideo/appendDictatedText/addEmbed read current state via closures each render, but this effect's setup only ever needs to run once
  }, []);

  // Object URLs are created once per image set (memoized on `images`), not
  // on every render — creating one inline in JSX would leak a new blob URL
  // on every re-render. The paired effect only handles revocation.
  const imagePreviewUrls = useMemo(
    () => images.map((file) => URL.createObjectURL(file)),
    [images],
  );
  useEffect(() => {
    return () => {
      imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imagePreviewUrls]);

  // FileList | File[] — a real <input>/paste event always hands this a
  // FileList, but ShareTargetGate's pending-share pickup (below) only has a
  // plain File[] (there's no real DOM FileList to build without a fake
  // DataTransfer), and Array.from() treats both identically.
  async function pickImages(files: FileList | File[] | null, options: { autoPost?: boolean } = {}) {
    if (!files) return;
    const all = Array.from(files);
    const picked = all.filter((f) => IMAGE_TYPES.includes(f.type));
    // A device/native-picker MIME type this app doesn't recognize (seen
    // live with HEIC/HEIF, the default photo format on several recent
    // Android phones) used to just vanish here with zero feedback — the
    // exact "picked a photo, nothing happened" shape a HEIC pick produced
    // before GalleryPickerPlugin.java started normalizing to JPEG
    // natively. That native fix should mean this never fires for a normal
    // gallery pick anymore, but surfacing it beats a silent no-op if some
    // other device/format combination hits the same gap.
    if (picked.length === 0 && all.length > 0) {
      setStatus("error");
      setErrorText("That image format isn't supported — try a JPEG, PNG, WebP, or GIF.");
      return;
    }
    // Resize before the size check — a raw phone photo routinely exceeds
    // 25MB, but the resized version essentially never does, so this check
    // is really just a backstop against a resize failure (rare, fails
    // open to the original file) rather than the normal path.
    let next: File[];
    try {
      next = await Promise.all(picked.map(resizeImageFile));
    } catch (err) {
      console.error("[pickImages] resizeImageFile failed", err);
      setStatus("error");
      setErrorText("Couldn't process that image — try again.");
      return;
    }
    const tooBig = next.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      setStatus("error");
      setErrorText("Images must be 25MB or smaller each.");
      return;
    }
    if (options.autoPost) {
      setStatus("uploading");
      setErrorText(null);
      const uploaded = await Promise.all(next.map((f) => uploadFileDirect(f, "post-image")));
      const failed = uploaded.find((u) => !u.ok);
      if (failed && !failed.ok) {
        setStatus("error");
        setErrorText(errorMessage(failed.error));
        return;
      }
      await autoSubmitMedia({
        mediaType: "IMAGE",
        mediaUrls: uploaded.map((u) => (u.ok ? u.publicUrl : "")).filter(Boolean),
      });
      return;
    }
    setVideo(null);
    setVideoDurationSeconds(null);
    setEmbedUrl(null);
    setPendingGif(null);
    const remaining = Math.max(0, MAX_IMAGES - urlImages.length);
    setImages((prev) => [...prev, ...next].slice(0, remaining));
  }

  // Handles an image pasted straight from the keyboard — Gboard's own
  // suggestion strip (stickers, or an image search result) lands here as a
  // real clipboard file the same way a copy-pasted image from Photos would,
  // not as literal text, so a plain textarea wouldn't otherwise do anything
  // useful with it. Routed through the exact same pickImages() as the
  // "Add a photo" button — same resize/size-check/moderation pipeline, no
  // separate path to keep in sync. Only preventDefault()s when there's
  // actually an image to grab; an ordinary text paste (the overwhelming
  // majority of paste events here) falls through untouched.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (e.clipboardData.files.length === 0) return;
    e.preventDefault();
    pickImages(e.clipboardData.files);
  }

  async function addImageUrl() {
    const url = imageUrlValue.trim();
    if (!url || imageCount >= MAX_IMAGES) return;
    setImageUrlPending(true);
    setImageUrlError(null);
    const fd = new FormData();
    fd.set("url", url);
    const result = await addImageFromUrl(fd);
    setImageUrlPending(false);
    if (result.error || !result.publicUrl) {
      setImageUrlError(imageUrlErrorMessage(result.error ?? "invalid"));
      return;
    }
    setVideo(null);
    setVideoDurationSeconds(null);
    setEmbedUrl(null);
    setPendingGif(null);
    setUrlImages((prev) => [...prev, result.publicUrl].slice(0, MAX_IMAGES));
    setImageUrlValue("");
    setShowImageUrlInput(false);
  }

  function pickVideo(rawFile: File | undefined) {
    if (!rawFile) return;
    const file = normalizeVideoFile(rawFile);
    if (!file) {
      setStatus("error");
      setErrorText("Use an MP4 or WebM video.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setStatus("error");
      setErrorText("Video must be 2GB or smaller.");
      return;
    }

    // Attach synchronously rather than waiting on the <video> element's
    // loadedmetadata event — that event can take a while (or, on some
    // Android devices/codecs, never fire at all, nor does onerror) to
    // resolve for a large file. Gating attachment on it left `video` state
    // null in the meantime, so a user who picked a valid video and hit
    // "Post" before it resolved fell through to the generic "attach a
    // photo/video" validation error despite having picked one. Duration is
    // now checked in the background below and only removes the video
    // after the fact if it's too long — the common case (post submitted
    // any time after the picker closes) never sees that window at all.
    setImages([]);
    setUrlImages([]);
    setEmbedUrl(null);
    setPendingGif(null);
    setVideo(file);
    setVideoDurationSeconds(null);
    setStatus("idle");
    setErrorText(null);

    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (!Number.isFinite(probe.duration)) return;
      if (probe.duration > MAX_UPLOAD_VIDEO_SECONDS) {
        // Only clear it if this is still the video that was picked — a
        // second, different pick before this one's metadata resolved
        // shouldn't clobber it.
        setVideo((current) => (current === file ? null : current));
        setStatus("error");
        setErrorText(`Videos must be ${formatSecondsLabel(MAX_UPLOAD_VIDEO_SECONDS)} or shorter.`);
        return;
      }
      // Sent along with the post so the server can route anything over
      // Hive's 60s scan limit to manual review instead of publishing it
      // unmoderated — see videoNeedsManualReview in actions/circles.ts.
      setVideoDurationSeconds(Math.round(probe.duration));
    };
    probe.onerror = () => {
      // Can't determine duration — fails open (video stays attached
      // unchecked) rather than blocking a post over a client-side probe
      // that isn't a security boundary anyway. The server simply won't get
      // a videoDurationSeconds for this one, so if it's actually over 60s
      // it'll still just publish immediately like before this change.
      URL.revokeObjectURL(url);
    };
  }

  /**
   * Android-only counterpart to pickVideo, for a video picked via
   * pickVideoNative (see that file for why the plain <input type="file">
   * path is a dead end for video on this platform). Uploads eagerly, right
   * here at pick time, rather than deferring to Post like the File-based
   * path above — native code never hands the raw video bytes to JS at all
   * (see native-video-picker.ts), so there's no File to defer uploading
   * the usual way; the content:// URI itself may also not stay valid
   * indefinitely, so uploading promptly is the safer choice anyway.
   */
  async function handleNativeVideoAttach(
    native: NonNullable<Awaited<ReturnType<typeof pickVideoNative>>>,
    options: { autoPost?: boolean } = {},
  ) {
    if (native.size > MAX_VIDEO_BYTES) {
      setStatus("error");
      setErrorText("Video must be 2GB or smaller.");
      return;
    }
    if (native.durationSeconds && native.durationSeconds > MAX_UPLOAD_VIDEO_SECONDS) {
      setStatus("error");
      setErrorText(`Videos must be ${formatSecondsLabel(MAX_UPLOAD_VIDEO_SECONDS)} or shorter.`);
      return;
    }

    setImages([]);
    setUrlImages([]);
    setEmbedUrl(null);
    setPendingGif(null);
    setVideo(null);
    setNativeVideoUpload(null);
    setStatus("idle");
    setErrorText(null);
    setNativeVideoUploading(true);

    try {
      const fd = new FormData();
      fd.set("kind", "post-video");
      fd.set("contentType", native.mimeType);
      const requested = await requestUploadUrl(fd);
      if (requested.error || !requested.uploadUrl || !requested.publicUrl) {
        setStatus("error");
        setErrorText(errorMessage(requested.error ?? "network"));
        return;
      }

      const uploaded = await uploadVideoNative(native.uri, requested.uploadUrl, native.mimeType);
      if (!uploaded) {
        setStatus("error");
        setErrorText(errorMessage("network"));
        return;
      }

      // The thumbnail is a small JPEG File already (see
      // pickVideoNative/base64ToFile) — the existing, already-working
      // image upload path handles it from here, same as every other
      // photo upload in this app.
      const thumbnailResult = native.thumbnailFile
        ? await uploadFileDirect(native.thumbnailFile, "video-thumb")
        : null;

      if (options.autoPost) {
        await autoSubmitMedia({
          mediaType: "VIDEO",
          mediaUrls: [],
          videoUrl: requested.publicUrl,
          videoThumbnailUrl: thumbnailResult?.ok ? thumbnailResult.publicUrl : undefined,
          videoDurationSeconds: native.durationSeconds ?? undefined,
        });
        return;
      }

      setNativeVideoUpload({
        videoUrl: requested.publicUrl,
        videoThumbnailUrl: thumbnailResult?.ok ? thumbnailResult.publicUrl : undefined,
        videoDurationSeconds: native.durationSeconds ?? undefined,
        name: native.name,
      });
    } finally {
      setNativeVideoUploading(false);
    }
  }

  // urlOverride lets the incoming-share handler above set an embed
  // programmatically (a resolved TikTok URL the user never typed anywhere)
  // instead of only ever reading the visible input field.
  function addEmbed(urlOverride?: string) {
    const url = (urlOverride ?? embedUrlValue).trim();
    // A recognized video provider gets a proper iframe embed; any other
    // http(s) link is still accepted and posted as a plain link — only the
    // protocol is checked, no allowlist of hosts.
    if (!parseVideoEmbedUrl(url) && !normalizeLinkUrl(url)) {
      setEmbedError("Enter a valid link, starting with http:// or https://.");
      return;
    }
    setImages([]);
    setUrlImages([]);
    setVideo(null);
    setVideoDurationSeconds(null);
    setPendingGif(null);
    setEmbedUrl(url);
    setEmbedError(null);
    setEmbedUrlValue("");
    setShowEmbedInput(false);
  }

  async function uploadAll(): Promise<
    | { error: string }
    | {
        mediaType: "NONE" | "IMAGE" | "VIDEO" | "EMBED" | "LINK" | "GIF";
        mediaUrls: string[];
        videoUrl?: string;
        videoThumbnailUrl?: string;
        videoDurationSeconds?: number;
        embedUrl?: string;
      }
  > {
    if (pendingGif) {
      return { mediaType: "GIF", mediaUrls: [pendingGif] };
    }

    if (imageCount > 0) {
      // Each local image is an independent presigned-URL request + direct
      // PUT to R2 — uploading them one at a time in sequence was the main
      // cause of multi-image posts feeling slow. URL-sourced images are
      // already uploaded (that happened when they were added), so they just
      // pass straight through.
      const results = images.length > 0
        ? await Promise.all(images.map((file) => uploadFileDirect(file, "post-image")))
        : [];
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) return { error: failed.error };
      return {
        mediaType: "IMAGE",
        mediaUrls: [...results.map((r) => (r.ok ? r.publicUrl : "")), ...urlImages],
      };
    }

    if (nativeVideoUpload) {
      // Already uploaded eagerly at pick time by handleNativeVideoAttach —
      // nothing left to do here but hand the results through.
      return {
        mediaType: "VIDEO",
        mediaUrls: [],
        videoUrl: nativeVideoUpload.videoUrl,
        videoThumbnailUrl: nativeVideoUpload.videoThumbnailUrl,
        videoDurationSeconds: nativeVideoUpload.videoDurationSeconds,
      };
    }

    if (video) {
      // Frame capture reads the local file directly — it never depended on
      // the video actually being uploaded yet, so run both uploads
      // concurrently instead of the video → capture → thumbnail chain this
      // used to be. That chain was the main cause of "video posting feels
      // slow": two full network round-trips in sequence when neither one
      // needed to wait for the other.
      const [videoResult, thumbnailUrl] = await Promise.all([
        uploadFileDirect(video, "post-video"),
        captureVideoFrameFromFile(video).then((frame) =>
          frame ? uploadFileDirect(frame, "video-thumb") : null,
        ),
      ]);
      if (!videoResult.ok) return { error: videoResult.error };

      return {
        mediaType: "VIDEO",
        mediaUrls: [],
        videoUrl: videoResult.publicUrl,
        videoThumbnailUrl: thumbnailUrl?.ok ? thumbnailUrl.publicUrl : undefined,
        videoDurationSeconds: videoDurationSeconds ?? undefined,
      };
    }

    if (embedUrl) {
      // Nothing to upload — createPost re-parses and validates this link
      // itself; the client-side parse above is only for instant feedback.
      // A recognized video provider gets the iframe-embed treatment;
      // anything else is posted as a plain link.
      return {
        mediaType: parseVideoEmbedUrl(embedUrl) ? "EMBED" : "LINK",
        mediaUrls: [],
        embedUrl,
      };
    }

    return { mediaType: "NONE", mediaUrls: [] };
  }

  /**
   * Submits an already-built, already-media-uploaded FormData to createPost
   * and handles every outcome, including the device-verification pause —
   * shared by the normal submit path and confirmDeviceCode's resubmission
   * below so neither has to duplicate the retry/result handling.
   */
  // Publishes attached media straight away with an empty caption — no
  // review-in-the-composer step, no separate "Post" tap. Requested
  // explicitly: "Upload from device" should behave like the existing
  // Share-to-Feed flow already does for shared content (picking the
  // destination is itself the confirmation to publish), not require a
  // second manual step after the picker already closes. Reuses
  // submitPostFormData as-is — same retry/device-challenge/error handling
  // and post-success state reset every other post already gets, just with
  // a synthetic FormData instead of the real form's fields.
  async function autoSubmitMedia(media: {
    mediaType: "IMAGE" | "VIDEO";
    mediaUrls: string[];
    videoUrl?: string;
    videoThumbnailUrl?: string;
    videoDurationSeconds?: number;
  }) {
    const fd = new FormData();
    fd.set("content", "");
    fd.set("visibility", defaultVisibility);
    if (circleId) fd.set("circleId", circleId);
    if (channelId) fd.set("channelId", channelId);
    fd.set("mediaType", media.mediaType);
    fd.set("mediaUrls", JSON.stringify(media.mediaUrls));
    if (media.videoUrl) fd.set("videoUrl", media.videoUrl);
    if (media.videoThumbnailUrl) fd.set("videoThumbnailUrl", media.videoThumbnailUrl);
    if (media.videoDurationSeconds) fd.set("videoDurationSeconds", String(media.videoDurationSeconds));
    await submitPostFormData(fd);
  }

  async function submitPostFormData(fd: FormData) {
    let result;
    try {
      // By this point any media has already been uploaded — a single
      // transient failure here (a brief 503 from the server, a
      // dropped packet) would otherwise throw away that upload and
      // show a scary "couldn't reach the server" error for something
      // a moment's retry would have gotten past. Same retry helper
      // uploadFileDirect already uses for exactly this reason. A
      // stale Server Action id (this tab open since before a
      // redeploy) is excluded from retrying — see isStaleDeploymentError.
      result = await withRetry(
        () => createPost(fd),
        3,
        1000,
        false,
        (err) => !isStaleDeploymentError(err),
      );
    } catch (err) {
      // A rejected server-action call (e.g. no connectivity) would
      // otherwise be an uncaught exception that crashes the whole
      // page instead of showing a normal composer error.
      setStatus("error");
      setErrorText(isStaleDeploymentError(err) ? STALE_DEPLOYMENT_MESSAGE : errorMessage("network"));
      return;
    }
    if (result.error === "device_verification_required" && result.challengeId) {
      // Held, not failed — don't clear the draft or the uploaded media
      // reference. The composer switches to a small inline code-entry
      // step; confirmDeviceCode resubmits this same fd once it passes.
      setStatus("idle");
      setDeviceChallenge({ id: result.challengeId, fd });
      return;
    }
    if (result.error) {
      setStatus("error");
      setErrorText(errorMessage(result.error));
    } else {
      setStatus("idle");
      setImages([]);
      setUrlImages([]);
      setVideo(null);
      setVideoDurationSeconds(null);
      setNativeVideoUpload(null);
      setEmbedUrl(null);
      setPendingGif(null);
      setIsEvent(false);
      setEventAt("");
      setEventLocation("");
      setSuggestionText("");
      formRef.current?.reset();
      router.refresh();
    }
  }

  async function confirmDeviceCode() {
    if (!deviceChallenge) return;
    setDeviceChallengeError(null);
    setDeviceChallengePending(true);
    try {
      const res = await confirmPostDeviceChallenge(deviceChallenge.id, deviceCode.trim());
      if (res.error) {
        setDeviceChallengeError(deviceChallengeErrorMessage(res.error));
        return;
      }
      const fd = deviceChallenge.fd;
      setDeviceChallenge(null);
      setDeviceCode("");
      setStatus("uploading");
      await submitPostFormData(fd);
    } catch {
      setDeviceChallengeError(deviceChallengeErrorMessage("network"));
    } finally {
      setDeviceChallengePending(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="rounded-xl border border-line p-4"
      action={(fd) => {
        const content = String(fd.get("content") ?? "").trim();
        if (!content && imageCount === 0 && !video && !nativeVideoUpload && !embedUrl && !pendingGif && !isEvent) {
          setStatus("error");
          setErrorText("Write something, attach a photo/video, or add event details first.");
          return;
        }
        if (isEvent) {
          if (!eventAt || new Date(eventAt) <= new Date()) {
            setStatus("error");
            setErrorText("Pick a future date and time for the event.");
            return;
          }
          if (!eventLocation.trim()) {
            setStatus("error");
            setErrorText("Add a location for the event.");
            return;
          }
        }
        if (circleId) fd.set("circleId", circleId);
        if (channelId) fd.set("channelId", channelId);
        // The datetime-local input's raw value has no timezone info, so
        // re-send it as an absolute instant: new Date(eventAt) here
        // correctly parses it as the browser's own local time, but the
        // server would parse the same raw string as UTC (its own
        // timezone) if we sent it unconverted — silently shifting the
        // event time by the server/client UTC offset.
        if (isEvent && eventAt) fd.set("eventAt", new Date(eventAt).toISOString());
        setStatus("uploading");
        setErrorText(null);
        startTransition(async () => {
          const media = await uploadAll();
          if ("error" in media) {
            setStatus("error");
            setErrorText(errorMessage(media.error));
            return;
          }
          fd.set("mediaType", media.mediaType);
          fd.set("mediaUrls", JSON.stringify(media.mediaUrls));
          if (media.videoUrl) fd.set("videoUrl", media.videoUrl);
          if (media.videoThumbnailUrl) fd.set("videoThumbnailUrl", media.videoThumbnailUrl);
          if (media.videoDurationSeconds) fd.set("videoDurationSeconds", String(media.videoDurationSeconds));
          if (media.embedUrl) fd.set("embedUrl", media.embedUrl);

          await submitPostFormData(fd);
        });
      }}
    >
      <textarea
        ref={contentRef}
        name="content"
        maxLength={50000}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => setSuggestionText(e.target.value)}
        onPaste={handlePaste}
        className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <EmojiTypeSuggestions text={suggestionText} onSelect={insertEmoji} />

      {(images.length > 0 || urlImages.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((file, i) => (
            <div key={`local-${i}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrls[i]}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove image"
                className="absolute right-0 top-0 rounded-full bg-black/60 p-1.5 text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {urlImages.map((url, i) => (
            <div key={`url-${url}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
              {/* Already a public URL of our own bucket (fetched server-side) — no object URL needed. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setUrlImages((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove image"
                className="absolute right-0 top-0 rounded-full bg-black/60 p-1.5 text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showImageUrlInput && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="url"
            value={imageUrlValue}
            onChange={(e) => setImageUrlValue(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="flex-1 rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={imageUrlPending || !imageUrlValue.trim()}
            onClick={addImageUrl}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
          >
            {imageUrlPending ? "Adding..." : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowImageUrlInput(false);
              setImageUrlError(null);
            }}
            aria-label="Cancel"
            className="p-2 -m-2 text-foreground-soft"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {imageUrlError && <p className="mt-1 text-xs text-danger">{imageUrlError}</p>}

      {video && (
        <div className="mt-2 rounded-lg border border-line px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate">{video.name}</span>
            <button
              type="button"
              onClick={() => {
                setVideo(null);
                setVideoDurationSeconds(null);
              }}
              aria-label="Remove video"
              className="p-2 -m-2 text-danger"
            >
              <X size={14} />
            </button>
          </div>
          {videoDurationSeconds !== null && videoDurationSeconds > VIDEO_INSTANT_PUBLISH_MAX_SECONDS && (
            <p className="mt-1 text-foreground-soft">
              Over {formatSecondsLabel(VIDEO_INSTANT_PUBLISH_MAX_SECONDS)} — this won&apos;t go live until it&apos;s reviewed.
            </p>
          )}
        </div>
      )}

      {nativeVideoUploading && (
        <div className="mt-2 rounded-lg border border-line px-3 py-2 text-xs text-foreground-soft">
          Uploading video…
        </div>
      )}

      {nativeVideoUpload && (
        <div className="mt-2 rounded-lg border border-line px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate">{nativeVideoUpload.name}</span>
            <button
              type="button"
              onClick={() => setNativeVideoUpload(null)}
              aria-label="Remove video"
              className="p-2 -m-2 text-danger"
            >
              <X size={14} />
            </button>
          </div>
          {nativeVideoUpload.videoDurationSeconds !== undefined &&
            nativeVideoUpload.videoDurationSeconds > VIDEO_INSTANT_PUBLISH_MAX_SECONDS && (
              <p className="mt-1 text-foreground-soft">
                Over {formatSecondsLabel(VIDEO_INSTANT_PUBLISH_MAX_SECONDS)} — this won&apos;t go live until it&apos;s reviewed.
              </p>
            )}
        </div>
      )}

      {embedUrl && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <span className="flex-1 truncate">
            {parsedEmbed ? `${EMBED_PROVIDER_LABELS[parsedEmbed.provider]} video linked` : embedUrl}
          </span>
          <button
            type="button"
            onClick={() => setEmbedUrl(null)}
            aria-label="Remove linked video"
            className="p-2 -m-2 text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {pendingGif && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted preview, not a local/optimizable asset */}
          <img src={pendingGif} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          <span className="flex-1 truncate">GIF attached</span>
          <button
            type="button"
            onClick={() => setPendingGif(null)}
            aria-label="Remove GIF"
            className="p-2 -m-2 text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {showEmbedInput && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="url"
            value={embedUrlValue}
            onChange={(e) => setEmbedUrlValue(e.target.value)}
            placeholder="Paste any link, or a YouTube/Vimeo/TikTok/Dailymotion/Instagram video"
            className="flex-1 rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!embedUrlValue.trim()}
            onClick={() => addEmbed()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setShowEmbedInput(false);
              setEmbedError(null);
            }}
            className="text-foreground-soft"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {embedError && <p className="mt-1 text-xs text-danger">{embedError}</p>}

      {isEvent && (
        <div className="mt-2 space-y-2 rounded-lg border border-line p-3">
          <div>
            <label className="block text-xs font-medium text-foreground-soft">When</label>
            <input
              type="datetime-local"
              name="eventAt"
              value={eventAt}
              onChange={(e) => setEventAt(e.target.value)}
              min={nowForDateTimeLocal()}
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-soft">Where</label>
            <input
              type="text"
              name="eventLocation"
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              maxLength={200}
              placeholder="Address, venue, or a video call link"
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <input
            ref={imageInputRef}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              markNativePickerInactive();
              pickImages(e.target.files, { autoPost: true });
            }}
          />
          {/* accept must include the literal "image/*" — Capacitor's own
              WebView file-chooser handler only routes a capture-enabled
              input to the native camera intent when
              acceptTypes.contains("image/*") is true; a list of only
              specific MIME types fails that check and silently falls back
              to the plain file/gallery picker instead of opening the
              camera — confirmed live. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept={`${IMAGE_TYPES.join(",")},image/*`}
            capture="environment"
            className="hidden"
            onChange={(e) => {
              markNativePickerInactive();
              pickImages(e.target.files);
            }}
          />
          {/* accept must include the literal "video/*" — confirmed live via
              adb logcat on a real Samsung device: the WebView's file-chooser
              handler collapses this multi-type accept list down to a single
              MIME type on the GET_CONTENT intent it sends to Android's
              picker (typ=video/mp4 only, video/webm silently dropped), so
              any device-recorded video whose reported type doesn't match
              that one exact string never shows as pickable — no error, the
              composer just never receives a file. Same fix shape as the
              already-working "image/*" fallback on the camera-capture input
              above. */}
          <input
            ref={videoInputRef}
            type="file"
            accept={`${VIDEO_TYPES.join(",")},video/*`}
            className="hidden"
            onChange={(e) => {
              markNativePickerInactive();
              pickVideo(e.target.files?.[0]);
            }}
          />
          <MediaPickerButton
            icon={<ImagePlus size={16} />}
            title="Add a photo"
            disabled={hasOtherMedia || imageCount >= MAX_IMAGES}
            options={[
              {
                label: "Upload from device",
                icon: <Upload size={14} />,
                onSelect: async () => {
                  if (isNativePickerActive()) return;
                  // Nicer native multi-select on Android (see
                  // native-gallery-picker.ts); null means it didn't run
                  // (iOS, web, or an older installed build), so fall back
                  // to the plain <input type="file" multiple> below. An
                  // empty (non-null) array means the user opened the
                  // native picker and backed out with nothing selected —
                  // a no-op, same as cancelling the file dialog.
                  const native = await pickImagesNative(MAX_IMAGES - imageCount);
                  if (native) {
                    if (native.length > 0) await pickImages(native, { autoPost: true });
                    return;
                  }
                  markNativePickerActive();
                  imageInputRef.current?.click();
                },
              },
              {
                label: "Take a photo",
                icon: <Camera size={14} />,
                onSelect: () => {
                  if (isNativePickerActive()) return;
                  markNativePickerActive();
                  cameraInputRef.current?.click();
                },
              },
              {
                label: "Add from a URL",
                icon: <ImageDown size={14} />,
                onSelect: () => setShowImageUrlInput(true),
              },
            ]}
          />
          <MediaPickerButton
            icon={<Video size={16} />}
            title="Add a video"
            disabled={
              imageCount > 0 ||
              Boolean(video) ||
              Boolean(nativeVideoUpload) ||
              nativeVideoUploading ||
              Boolean(embedUrl) ||
              Boolean(pendingGif)
            }
            options={[
              {
                label: "Upload from device",
                icon: <Upload size={14} />,
                onSelect: async () => {
                  if (isNativePickerActive()) return;
                  const native = await pickVideoNative();
                  if (native) {
                    await handleNativeVideoAttach(native, { autoPost: true });
                    return;
                  }
                  markNativePickerActive();
                  videoInputRef.current?.click();
                },
              },
              {
                label: "Record live",
                icon: <Circle size={14} className="text-danger" fill="currentColor" />,
                onSelect: () => setShowRecorder(true),
              },
            ]}
          />
          <button
            type="button"
            onClick={() => setShowEmbedInput((v) => !v)}
            disabled={
              imageCount > 0 || Boolean(video) || Boolean(nativeVideoUpload) || nativeVideoUploading || Boolean(pendingGif)
            }
            className={cn(
              "rounded-lg p-2.5 -m-1 hover:bg-line disabled:opacity-40",
              showEmbedInput ? "text-accent" : "text-foreground-soft",
            )}
            title="Add a link"
            aria-label="Add a link"
          >
            <LinkIcon size={16} />
          </button>
          <button
            type="button"
            onClick={() => setIsEvent((v) => !v)}
            className={cn(
              "rounded-lg p-2.5 -m-1 hover:bg-line",
              isEvent ? "text-accent" : "text-foreground-soft",
            )}
            title={isEvent ? "Remove event details" : "Add event details"}
            aria-label={isEvent ? "Remove event details" : "Add event details"}
          >
            <Calendar size={16} />
          </button>
          <EmojiPickerButton onSelect={insertEmoji} />
          <GifPickerButton onSelect={(gifUrl) => setPendingGif(gifUrl)} disabled={hasOtherMedia || imageCount > 0} />
          <button
            type="button"
            onClick={() => setShowDictation(true)}
            disabled={showDictation}
            className="rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line disabled:opacity-40"
            title="Dictate text"
            aria-label="Dictate text"
          >
            <Mic size={16} />
          </button>
          <p className="ml-1 hidden text-xs text-foreground-soft sm:inline">
            Posts are prescreened for safety before they appear.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Meaningless inside a Circle — membership there is already the
              access boundary, and createPost always stores those PUBLIC
              server-side regardless of what this would send. */}
          {!circleId && (
            <>
              <label htmlFor="post-visibility" className="sr-only">
                Who can see this post
              </label>
              <select
                id="post-visibility"
                name="visibility"
                defaultValue={defaultVisibility}
                title="Who can see this post"
                aria-label="Who can see this post"
                className="rounded-lg border border-line bg-background px-2 py-1.5 text-xs text-foreground-soft outline-none focus:border-accent"
              >
                <option value="PUBLIC">Everyone</option>
                <option value="CONNECTIONS_ONLY">Friends only</option>
                <option value="PRIVATE">Private</option>
              </select>
            </>
          )}
          <button
            type="submit"
            disabled={isPending || nativeVideoUploading || status === "uploading"}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            {/* status stays "uploading" through the auto-post paths below
                too (pickImages/handleNativeVideoAttach with autoPost),
                which don't run inside startTransition (isPending would
                never flip true for them) — checking status alone covers
                both that flow and the normal Post-button submit. */}
            {status === "uploading" ? "Posting..." : "Post"}
          </button>
        </div>
      </div>
      {showDictation && (
        <DictationRecorder
          onTranscribed={appendDictatedText}
          onError={(code) => {
            setStatus("error");
            setErrorText(errorMessage(code));
          }}
          onDone={() => setShowDictation(false)}
        />
      )}

      {status === "error" && errorText && (
        <p className="mt-1 text-xs text-danger">
          {errorText}
          {errorText === STALE_DEPLOYMENT_MESSAGE && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-1.5 font-medium underline"
            >
              Refresh
            </button>
          )}
        </p>
      )}

      {showRecorder && (
        <VideoRecorderModal
          maxSeconds={MAX_RECORD_VIDEO_SECONDS}
          onClose={() => setShowRecorder(false)}
          onRecorded={(file) => {
            setShowRecorder(false);
            pickVideo(file);
          }}
        />
      )}
      {deviceChallenge && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="font-semibold">We don&apos;t recognize this device</p>
          <p className="mt-1 text-foreground-soft">
            For your security, enter the 6-digit code we just emailed you to publish this post. Your draft is
            still here — it&apos;ll go out the moment you confirm.
          </p>
          {deviceChallengeError && <p className="mt-2 text-danger">{deviceChallengeError}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={deviceCode}
              onChange={(e) => setDeviceCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="w-32 rounded-lg border border-line bg-background px-3 py-2 text-center text-sm tracking-[0.3em] outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={deviceChallengePending || deviceCode.trim().length === 0}
              onClick={confirmDeviceCode}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
            >
              {deviceChallengePending ? "Confirming..." : "Confirm and post"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeviceChallenge(null);
                setDeviceCode("");
                setDeviceChallengeError(null);
                setStatus("idle");
              }}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
