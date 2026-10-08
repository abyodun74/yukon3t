"use client";

import { useRef, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { uploadFileDirect, resizeImageFile } from "@/lib/upload-client";
import { createAmbientMoment, deleteAmbientMoment } from "@/app/actions/ambient";

type Moment = { id: string; imageUrl: string; caption: string | null; createdAt: Date };

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Couldn't read that upload — try again.",
  rate_limited: "Too many moments at once — wait a bit and try again.",
  too_large: "Image must be 25MB or smaller.",
  moderation: "That photo didn't pass our content guidelines and wasn't saved.",
  server_error: "Something went wrong saving that — try again.",
};

/**
 * Captures a single AmbientMoment (see that model's schema doc comment) —
 * deliberately no album, no multi-photo picker, no filters: "ambient
 * presence over performed posting" means the composer itself has to stay
 * this plain, not just the resulting content.
 */
export function AmbientMomentComposer({ initialMoments }: { initialMoments: Moment[] }) {
  const [moments, setMoments] = useState(initialMoments);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
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
      const resized = await resizeImageFile(file);
      const uploaded = await uploadFileDirect(resized, "ambient-image");
      if (!uploaded.ok) {
        setStatus("error");
        setMessage(
          uploaded.error === "not_configured"
            ? "Uploads aren't set up yet — check back soon."
            : uploaded.error === "network"
              ? "Couldn't reach the server — check your connection and try again."
              : "Upload failed — try again.",
        );
        return;
      }

      const fd = new FormData();
      fd.set("imageUrl", uploaded.publicUrl);
      fd.set("caption", caption);

      const result = await createAmbientMoment(fd);
      if (result.error) {
        setStatus("error");
        setMessage(ERROR_MESSAGES[result.error] ?? "Something went wrong.");
        return;
      }

      setMoments((prev) => [result.moment, ...prev]);
      setCaption("");
      setStatus("idle");
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleDelete(id: string) {
    setMoments((prev) => prev.filter((m) => m.id !== id));
    startTransition(async () => {
      await deleteAmbientMoment(id);
    });
  }

  return (
    <div>
      <div className="rounded-xl border border-line p-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          aria-label="Choose a photo"
          disabled={isPending}
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="block w-full text-sm text-foreground-soft file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent-ink"
        />
        <input
          aria-label="Add a caption (optional)"
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={120}
          placeholder="Add a caption (optional)"
          disabled={isPending}
          className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
        />
        {status === "uploading" && <p className="mt-2 text-xs text-foreground-soft">Sharing…</p>}
        {message && <p role="alert" className="mt-2 text-xs text-danger">{message}</p>}
      </div>

      {moments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-foreground-soft">
            Your active moments — visible to anyone who has you in their Inner Circle, gone in 48 hours
          </p>
          <ul className="mt-2 grid grid-cols-3 gap-2">
            {moments.map((moment) => (
              <li key={moment.id} className="group relative aspect-square overflow-hidden rounded-lg bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={moment.imageUrl} alt={moment.caption ?? ""} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => handleDelete(moment.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[0.625rem] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  Delete
                </button>
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.625rem] text-white">
                  {formatDistanceToNow(moment.createdAt, { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
