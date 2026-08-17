"use client";

import { useRef, useState, useTransition } from "react";
import { uploadFileDirect, resizeImageFile, waitForForeground } from "@/lib/upload-client";
import { confirmAvatarUpload } from "@/app/actions/media";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function AvatarUpload({ currentUrl }: { currentUrl: string | null }) {
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "error" | "not_configured" | "success"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus("error");
      setMessage("Use a JPEG, PNG, or WebP image.");
      return;
    }

    setStatus("uploading");
    setMessage(null);

    startTransition(async () => {
      // The picker Activity returning control here backgrounds and resumes
      // the WebView right around this point — resizing (canvas.toBlob)
      // immediately during that transition can produce a Blob whose backing
      // store the WebView evicts, which later fails the upload with
      // net::ERR_UPLOAD_FILE_CHANGED even though the page looks fully
      // foregrounded by then. Waiting for a real visible state first avoids
      // creating the Blob during the fragile window; a no-op if already
      // foregrounded.
      await waitForForeground();

      // Resize before the size check — a raw phone photo routinely exceeds
      // 5MB, but the resized version essentially never does.
      const resized = await resizeImageFile(file);
      if (resized.size > MAX_AVATAR_BYTES) {
        setStatus("error");
        setMessage("Image must be 5MB or smaller.");
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
              ? "Image must be 5MB or smaller."
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
        onClick={() => inputRef.current?.click()}
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
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {status === "uploading" ? "Uploading..." : "Change photo"}
        </button>
        <p className="mt-1 text-xs text-foreground-soft">
          JPEG, PNG, or WebP, up to 5MB. No sexually explicit content.
        </p>
        {message && (
          <p
            className={`mt-1 text-xs ${status === "success" ? "text-success" : "text-danger"}`}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
