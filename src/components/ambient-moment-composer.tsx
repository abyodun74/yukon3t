"use client";

import { useRef, useState, useTransition } from "react";
import { uploadFileDirect, resizeImageFile } from "@/lib/upload-client";
import { createAmbientMoment, deleteAmbientMoment } from "@/app/actions/ambient";
import { useSettingsText } from "@/components/settings-text";
import { useUiText } from "@/components/ui-text";
import { formatTimeAgo } from "@/lib/format-date";
import { byCode } from "@/lib/i18n/locales";

type Moment = { id: string; imageUrl: string; caption: string | null; createdAt: Date };

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
  const { locale, t: settings } = useSettingsText();
  const t = settings.ambient.moment;
  const justNow = useUiText().t.time.justNow;

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus("error");
      setMessage(t.errors.type);
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
            ? t.errors.not_configured
            : uploaded.error === "network"
              ? t.errors.network
              : t.errors.upload,
        );
        return;
      }

      const fd = new FormData();
      fd.set("imageUrl", uploaded.publicUrl);
      fd.set("caption", caption);

      const result = await createAmbientMoment(fd);
      if (result.error) {
        setStatus("error");
        // Only the action's own codes: the upload wording above is not theirs to pick.
        setMessage(
          byCode(
            {
              invalid: t.errors.invalid,
              rate_limited: t.errors.rate_limited,
              too_large: t.errors.too_large,
              moderation: t.errors.moderation,
              server_error: t.errors.server_error,
              other: t.errors.other,
            },
            result.error,
          ),
        );
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
          aria-label={t.choosePhoto}
          disabled={isPending}
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="block w-full text-sm text-foreground-soft file:me-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent-ink"
        />
        <input
          aria-label={t.caption}
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={120}
          placeholder={t.caption}
          dir="auto"
          disabled={isPending}
          className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
        />
        {status === "uploading" && <p className="mt-2 text-xs text-foreground-soft">{t.sharing}</p>}
        {message && <p role="alert" className="mt-2 text-xs text-danger">{message}</p>}
      </div>

      {moments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-foreground-soft">{t.active}</p>
          <ul className="mt-2 grid grid-cols-3 gap-2">
            {moments.map((moment) => (
              <li key={moment.id} className="group relative aspect-square overflow-hidden rounded-lg bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={moment.imageUrl} alt={moment.caption ?? ""} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => handleDelete(moment.id)}
                  className="absolute end-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[0.625rem] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  {t.delete}
                </button>
                <span className="absolute bottom-1 start-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.625rem] text-white">
                  {formatTimeAgo(moment.createdAt, locale, justNow)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
