"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Upload } from "lucide-react";
import { uploadFileDirect, resizeImageFile } from "@/lib/upload-client";
import { confirmAvatarUpload } from "@/app/actions/media";
import { ImageCropModal } from "@/components/image-crop-modal";
import { MediaPickerButton } from "@/components/media-picker-button";

const MAX_AVATAR_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

  function handlePicked(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus("error");
      setMessage("Use a JPEG, PNG, or WebP image.");
      return;
    }
    setStatus("idle");
    setMessage(null);
    setCropFile(file);
  }

  function handleFile(file: File) {
    setStatus("uploading");
    setMessage(null);

    startTransition(async () => {
      // Resize before the size check — a raw phone photo routinely exceeds
      // 12MB, but the resized version essentially never does.
      const resized = await resizeImageFile(file);
      if (resized.size > MAX_AVATAR_BYTES) {
        setStatus("error");
        setMessage("Image must be 12MB or smaller.");
        return;
      }

      const uploaded = await uploadFileDirect(resized, "avatar");
      if (!uploaded.ok) {
        setStatus(uploaded.error === "not_configured" ? "not_configured" : "error");
        setMessage(
          uploaded.error === "not_configured"
            ? "Profile picture uploads aren't set up yet — check back soon."
            : uploaded.error === "network"
              ? "Couldn't reach the server — check your connection and try again."
              : "Upload failed — try again.",
        );
        return;
      }

      const fd = new FormData();
      fd.set("key", uploaded.key);
      fd.set("publicUrl", uploaded.publicUrl);

      let result;
      try {
        result = await confirmAvatarUpload(fd);
      } catch {
        // A rejected server-action call (e.g. connectivity dropped between
        // the upload finishing and this confirm step) would otherwise be
        // an uncaught exception that crashes the whole page.
        setStatus("error");
        setMessage("Couldn't reach the server — check your connection and try again.");
        return;
      }

      if (result.error) {
        setStatus("error");
        setMessage(
          result.error === "moderation"
            ? "That photo didn't pass our content guidelines and wasn't saved."
            : result.error === "too_large"
              ? "Image must be 12MB or smaller."
              : "Couldn't save your photo — try again.",
        );
        return;
      }

      setPreview(uploaded.publicUrl);
      setStatus("success");
    });
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={isPending}
        onClick={() => galleryInputRef.current?.click()}
        aria-label="Change profile picture"
        className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-line bg-surface disabled:opacity-50"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-foreground-soft">
            No photo
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
            handlePicked(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <MediaPickerButton
          title="Change photo"
          disabled={isPending}
          menuPlacement="bottom"
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
          options={[
            {
              label: "Choose from gallery",
              icon: <Upload size={14} />,
              onSelect: () => galleryInputRef.current?.click(),
            },
            {
              label: "Take a photo",
              icon: <Camera size={14} />,
              onSelect: () => cameraInputRef.current?.click(),
            },
          ]}
        >
          {status === "uploading" ? "Uploading..." : "Change photo"}
        </MediaPickerButton>
        <p className="mt-1 text-xs text-foreground-soft">
          JPEG, PNG, or WebP, up to 12MB. No sexually explicit content.
        </p>
        {message && (
          <p
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
          title="Crop profile picture"
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
