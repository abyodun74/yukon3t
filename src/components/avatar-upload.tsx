"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Upload } from "lucide-react";
import { resizeImageToMax, uploadPrivateAvatar } from "@/lib/upload-client";
import { confirmPrivateAvatarUpload } from "@/app/actions/media";
import { AVATAR_FULL_DIMENSION, AVATAR_THUMB_DIMENSION, AVATAR_THUMB_MAX_BYTES } from "@/lib/avatar-url";
import { ImageCropModal } from "@/components/image-crop-modal";
import { MediaPickerButton } from "@/components/media-picker-button";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";
import { useProfileText } from "@/components/profile-text";
import { byCode } from "@/lib/i18n/locales";

const MAX_AVATAR_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * A profile picture is always private (see src/lib/avatar-url.ts): a ~1080px image and a ~320px thumbnail made from
 * it (same encoder, so the same type) go to the private avatar bucket, then are saved as the same-origin
 * /api/avatar/… path.
 */
export function AvatarUpload({ currentUrl }: { currentUrl: string | null }) {
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "error" | "not_configured" | "success"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const t = useProfileText().t.avatar;

  function handlePicked(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus("error");
      setMessage(t.errors.type);
      return;
    }
    setStatus("idle");
    setMessage(null);
    setCropFile(file);
  }

  function handleFile(file: File) {
    setStatus("uploading");
    setMessage(null);
    startTransition(() => upload(file));
  }

  async function upload(file: File) {
    // Resize before the size check: a raw phone photo routinely exceeds 12MB, the resized version essentially never does.
    const full = await resizeImageToMax(file, AVATAR_FULL_DIMENSION);
    const thumb = await resizeImageToMax(full, AVATAR_THUMB_DIMENSION);
    if (full.size > MAX_AVATAR_BYTES || thumb.size > AVATAR_THUMB_MAX_BYTES) {
      setStatus("error");
      setMessage(t.errors.too_large);
      return;
    }

    const uploaded = await uploadPrivateAvatar(full, thumb);
    if (!uploaded.ok) {
      setStatus(uploaded.error === "not_configured" ? "not_configured" : "error");
      setMessage(
        uploaded.error === "not_configured"
          ? t.errors.not_configured
          : uploaded.error === "network"
            ? t.errors.network
            : t.errors.upload,
      );
      return;
    }

    let result;
    try {
      result = await confirmPrivateAvatarUpload({ thumbKey: uploaded.thumbKey, fullKey: uploaded.fullKey });
    } catch {
      // A rejected server-action call (e.g. connectivity dropped between the upload finishing and this confirm step)
      // would otherwise be an uncaught exception that crashes the whole page.
      setStatus("error");
      setMessage(t.errors.network);
      return;
    }
    if (result.error !== null) {
      setStatus("error");
      // Only these two codes have wording of their own; anything else is the general "couldn't save".
      setMessage(
        byCode({ moderation: t.errors.moderation, too_large: t.errors.too_large, other: t.errors.other }, result.error),
      );
      return;
    }

    setPreview(result.avatarUrl);
    setStatus("success");
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (isNativePickerActive()) return;
          markNativePickerActive();
          galleryInputRef.current?.click();
        }}
        // Leads with the visible "No photo" text when that's what's showing,
        // so the name still matches what a Voice Control user reads.
        aria-label={preview ? t.change : t.noPhotoChange}
        className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-line bg-surface disabled:opacity-50"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-foreground-soft">
            {t.noPhoto}
          </div>
        )}
      </button>
      <div>
        <input
          ref={galleryInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            handlePicked(e.target.files?.[0]);
            // Reset so picking the same file again still fires onChange.
            e.target.value = "";
          }}
        />
        {/* capture="user" (front camera) — a profile picture is normally a
            selfie, unlike the rest of the app's camera buttons (post/story/
            chat/ads), which default to "environment" for photographing
            whatever's in front of you.

            accept must include the literal "image/*" — Capacitor's own
            WebView file-chooser handler
            (BridgeWebChromeClient.onShowFileChooser) only routes a
            capture-enabled input to the native camera intent when
            acceptTypes.contains("image/*") is true; a list of only
            specific MIME types (as ACCEPTED_TYPES has here) fails that
            check and silently falls back to the plain file/gallery picker
            instead — confirmed live, this is why "Take a photo" opened the
            same chooser as "Choose from gallery" with no camera shortcut.
            The specific types stay too; only their presence in
            downstream validation matters, not what's offered here. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={`${ACCEPTED_TYPES.join(",")},image/*`}
          capture="user"
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            handlePicked(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <MediaPickerButton
          title={t.changePhoto}
          disabled={isPending}
          menuPlacement="bottom"
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
          options={[
            {
              label: t.fromGallery,
              icon: <Upload size={14} />,
              onSelect: () => {
                if (isNativePickerActive()) return;
                markNativePickerActive();
                galleryInputRef.current?.click();
              },
            },
            {
              label: t.takePhoto,
              icon: <Camera size={14} />,
              onSelect: () => {
                if (isNativePickerActive()) return;
                markNativePickerActive();
                cameraInputRef.current?.click();
              },
            },
          ]}
        >
          {status === "uploading" ? t.uploading : t.changePhoto}
        </MediaPickerButton>
        <p className="mt-1 text-xs text-foreground-soft">
          {t.hint}
        </p>
        {message && (
          <p
            role={status === "success" ? "status" : "alert"}
            className={`mt-1 text-xs ${status === "success" ? "text-success" : "text-danger"}`}
          >
            {message}
          </p>
        )}
      </div>
      {cropFile && (
        <ImageCropModal
          key={cropFile.name + cropFile.size}
          file={cropFile}
          aspect={1}
          title={t.cropTitle}
          onCancel={() => setCropFile(null)}
          onCropped={(cropped) => {
            setCropFile(null);
            handleFile(cropped);
          }}
        />
      )}
    </div>
  );
}
