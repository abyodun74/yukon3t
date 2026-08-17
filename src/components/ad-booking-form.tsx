"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Upload, Video, X } from "lucide-react";
import { createAdCampaign, requestAdUploadUrl } from "@/app/actions/ads";
import {
  uploadFileDirect,
  captureVideoFrameFromFile,
  resizeImageFile,
  withRetry,
  waitForForeground,
} from "@/lib/upload-client";
import { MediaPickerButton } from "@/components/media-picker-button";
import { AD_DURATION_OPTIONS, MAX_AD_VIDEO_SECONDS, adPriceCents, formatCents } from "@/lib/ads";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Kept in sync with storage.ts's MAX_VIDEO_BYTES — duplicated locally for the
// same reason as post-composer.tsx's MAX_VIDEO_BYTES.
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];
const VIDEO_EXTENSION_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };

// Same content:// URI MIME-type gap as story-upload-modal.tsx's pickVideo —
// a mobile document picker often hands back an empty/wrong File.type even
// for a normal .mp4.
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
      return "That creative didn't pass our content guidelines.";
    case "rate_limited":
      return "Too many attempts — try again shortly.";
    case "not_configured":
      return "Ad bookings aren't set up yet — check back soon.";
    case "payment_setup_failed":
      return "Couldn't start checkout — try again.";
    case "invalid":
      return "Please check your inputs.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    default:
      return "Couldn't submit that booking — try again.";
  }
}

// This never actually calls uploadFileDirect with "kind" pointed at requestUploadUrl
// (the authenticated one) — it goes through requestAdUploadUrl instead, passed
// in as a same-shaped function so uploadFileDirect doesn't need an authed/public
// branch of its own.
async function uploadAdFile(file: File, kind: "ad-image" | "ad-video") {
  return uploadFileDirect(file, kind, requestAdUploadUrl);
}

export function AdBookingForm() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [durationDays, setDurationDays] = useState<number>(AD_DURATION_OPTIONS[1]);
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const price = adPriceCents(durationDays);

  async function pickImage(f: File | undefined) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    // Wait for the picker Activity's pause/resume transition to fully
    // settle before resizing — see post-composer.tsx's pickImages for why
    // (resizing during that window can produce a Blob the WebView evicts,
    // later failing the upload with net::ERR_UPLOAD_FILE_CHANGED).
    await waitForForeground();
    const resized = await resizeImageFile(f);
    if (resized.size > MAX_IMAGE_BYTES) {
      setError("Images must be 8MB or smaller.");
      return;
    }
    setError(null);
    setMediaType("IMAGE");
    setFile(resized);
  }

  function pickVideo(rawFile: File | undefined) {
    if (!rawFile) return;
    const f = normalizeVideoFile(rawFile);
    if (!f) {
      setError("Use an MP4 or WebM video.");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError("Video must be 500MB or smaller.");
      return;
    }

    const url = URL.createObjectURL(f);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      finish();
      setError(null);
      setMediaType("VIDEO");
      setFile(f);
    }, 4000);

    probe.onloadedmetadata = () => {
      if (settled) return;
      finish();
      if (Number.isFinite(probe.duration) && probe.duration > MAX_AD_VIDEO_SECONDS) {
        setError(`Videos must be ${MAX_AD_VIDEO_SECONDS} seconds or shorter.`);
        return;
      }
      setError(null);
      setMediaType("VIDEO");
      setFile(f);
    };
    probe.onerror = () => {
      if (settled) return;
      finish();
      setError(null);
      setMediaType("VIDEO");
      setFile(f);
    };
  }

  function submit() {
    if (isPending) return;
    if (!companyName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError("Fill in your company and contact details.");
      return;
    }
    if (!headline.trim() || !body.trim() || !linkUrl.trim()) {
      setError("Fill in your ad's headline, copy, and link.");
      return;
    }
    if (!file || !mediaType) {
      setError("Add a photo or video for your ad.");
      return;
    }
    setError(null);
    startTransition(async () => {
      let media: { mediaUrl: string; mediaThumbnailUrl?: string };
      if (mediaType === "IMAGE") {
        const result = await uploadAdFile(file, "ad-image");
        if (!result.ok) {
          setError(errorMessage(result.error));
          return;
        }
        media = { mediaUrl: result.publicUrl };
      } else {
        const [videoResult, thumb] = await Promise.all([
          uploadAdFile(file, "ad-video"),
          captureVideoFrameFromFile(file).then((frame) =>
            frame ? withRetry(() => uploadFileDirect(frame, "video-thumb")) : null,
          ),
        ]);
        if (!videoResult.ok) {
          setError(errorMessage(videoResult.error));
          return;
        }
        media = { mediaUrl: videoResult.publicUrl, mediaThumbnailUrl: thumb?.ok ? thumb.publicUrl : undefined };
      }

      const fd = new FormData();
      fd.set("companyName", companyName.trim());
      fd.set("contactName", contactName.trim());
      fd.set("contactEmail", contactEmail.trim());
      fd.set("headline", headline.trim());
      fd.set("body", body.trim());
      fd.set("linkUrl", linkUrl.trim());
      fd.set("mediaType", mediaType);
      fd.set("mediaUrl", media.mediaUrl);
      if (media.mediaThumbnailUrl) fd.set("mediaThumbnailUrl", media.mediaThumbnailUrl);
      fd.set("durationDays", String(durationDays));

      try {
        // createAdCampaign redirects to Stripe on success (throwing Next's
        // internal redirect signal) rather than returning — only a rejected
        // result actually reaches here.
        const result = await createAdCampaign(fd);
        if (result?.error) {
          setError(errorMessage(result.error));
        }
      } catch {
        setError(errorMessage("network"));
      }
    });
  }

  return (
    <div className="rounded-xl border border-line p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Company name</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            maxLength={100}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Contact name</label>
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            maxLength={100}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">Contact email</label>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="you@company.com"
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-foreground-soft">Your receipt and review status go here.</p>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">Headline</label>
        <input
          type="text"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={80}
          placeholder="What are you advertising?"
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">Ad copy</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={280}
          rows={3}
          placeholder="A sentence or two describing what you're offering."
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">Link URL</label>
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://yourcompany.com"
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">Creative</label>
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          capture="environment"
          className="hidden"
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept={VIDEO_TYPES.join(",")}
          className="hidden"
          onChange={(e) => pickVideo(e.target.files?.[0])}
        />

        {file && previewUrl ? (
          <div className="relative mt-2 aspect-video w-full max-w-sm overflow-hidden rounded-lg bg-black">
            {mediaType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <video src={previewUrl} controls className="h-full w-full object-contain" />
            )}
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setMediaType(null);
              }}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-4 rounded-lg border border-dashed border-line py-8 pl-4">
            <MediaPickerButton
              icon={<Upload size={18} />}
              title="Add a photo"
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
              title="Add a video"
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
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">Duration</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {AD_DURATION_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setDurationDays(days)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                durationDays === days ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-accent"
              }`}
            >
              {days} days
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between rounded-lg bg-accent-soft px-4 py-3">
        <span className="text-sm font-medium">Total</span>
        <span className="text-lg font-semibold text-accent">{formatCents(price)}</span>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button
        type="button"
        disabled={isPending}
        onClick={submit}
        className="mt-4 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
      >
        {isPending ? "Preparing checkout..." : `Continue to payment — ${formatCents(price)}`}
      </button>
      <p className="mt-2 text-center text-xs text-foreground-soft">
        You&apos;ll pay securely via Stripe. Ads go live after a quick review, usually within one business day.
      </p>
    </div>
  );
}
