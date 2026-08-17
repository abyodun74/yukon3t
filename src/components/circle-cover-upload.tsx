"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadFileDirect, resizeImageFile } from "@/lib/upload-client";
import { confirmCircleCoverUpload } from "@/app/actions/circles";

const MAX_COVER_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function CircleCoverUpload({
  circleId,
  currentUrl,
}: {
  circleId: string;
  currentUrl: string | null;
}) {
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "error" | "not_configured" | "success"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

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
      const resized = await resizeImageFile(file);
      if (resized.size > MAX_COVER_BYTES) {
        setStatus("error");
        setMessage("Image must be 12MB or smaller.");
        return;
      }

      const uploaded = await uploadFileDirect(resized, "circle-cover");
      if (!uploaded.ok) {
        setStatus(uploaded.error === "not_configured" ? "not_configured" : "error");
        setMessage(
          uploaded.error === "not_configured"
            ? "Circle picture uploads aren't set up yet — check back soon."
            : uploaded.error === "network"
              ? "Couldn't reach the server — check your connection and try again."
              : "Upload failed — try again.",
        );
        return;
      }

      const fd = new FormData();
      fd.set("circleId", circleId);
      fd.set("key", uploaded.key);
      fd.set("publicUrl", uploaded.publicUrl);

      let result;
      try {
        result = await confirmCircleCoverUpload(fd);
      } catch {
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
              : result.error === "forbidden"
                ? "Only the Circle's owner or co-admins can change its picture."
                : "Couldn't save that photo — try again.",
        );
        return;
      }

      setPreview(uploaded.publicUrl);
      setStatus("success");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
        aria-label="Change Circle picture"
        className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface disabled:opacity-50"
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
          {status === "uploading" ? "Uploading..." : "Change Circle picture"}
        </button>
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
    </div>
  );
}
