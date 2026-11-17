"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Upload, Video, X } from "lucide-react";
import { createAnnouncement, updateAnnouncement } from "@/app/actions/announcements";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile, withRetry } from "@/lib/upload-client";
import { MediaPickerButton } from "@/components/media-picker-button";
import { markNativePickerInactive, openFilePicker } from "@/lib/native-picker-activity";
import { normalizeVideoFile } from "@/lib/video-file";
import { AnnouncementTranslationsFields } from "@/components/announcement-translations-fields";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TRANSLATION_LOCALES,
  isAnnouncementTranslationLocale,
  translationSubmitProblem,
  translationsForSubmit,
  type AnnouncementTranslationLocale,
  type SubmitProblem,
  type TranslationFields,
} from "@/lib/announcement-translations";
import { TARGET_LANGUAGE_NAMES } from "@/lib/translation";

// Not imported from storage.ts — that module pulls in node:crypto/the AWS
// SDK (server-only), which a "use client" component importing it drags into
// the browser bundle outright (confirmed live: Netlify's webpack build fails
// with "node:crypto ... Unhandled scheme" the moment a client file imports
// any value, even just a constant, from storage.ts). Duplicated locally
// instead, same reasoning/pattern as ad-booking-form.tsx's own
// MAX_IMAGE_BYTES/MAX_VIDEO_BYTES — kept in sync with storage.ts's
// MEDIA_LIMITS["announcement-image"/"announcement-video"] and
// MAX_ANNOUNCEMENT_VIDEO_SECONDS.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 120;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

type MediaType = "IMAGE" | "VIDEO";
export type AnnouncementMedia = { type: MediaType; url: string; thumbnailUrl: string | null };
export type EditableAnnouncement = {
  id: string;
  title: string;
  body: string;
  translations: TranslationFields;
  media: AnnouncementMedia | null;
};

function languageName(locale: string | null | undefined, fallback: string) {
  return isAnnouncementTranslationLocale(locale) ? TARGET_LANGUAGE_NAMES[locale] : fallback;
}

function translationProblemMessage(problem: SubmitProblem) {
  const name = TARGET_LANGUAGE_NAMES[problem.locale];
  switch (problem.reason) {
    case "untranslated":
      return `${name} still has passages marked "NOT TRANSLATED YET" from a partial draft. Translate them (and remove the marker) or clear ${name}.`;
    case "too_long":
      return `${name} is over the limit (title ${ANNOUNCEMENT_TITLE_MAX}, body ${ANNOUNCEMENT_BODY_MAX} characters). Shorten it.`;
    default:
      return `${name} needs both a title (3+ chars) and a body (10+ chars), or leave both empty.`;
  }
}

function errorMessage(code: string, verb: "post" | "save", locale?: string | null) {
  switch (code) {
    case "too_large":
      return "That file is too large.";
    case "invalid":
      return "Please fill in a title (3+ chars) and body (10+ chars).";
    case "invalid_translation":
      return `${languageName(locale, "A translation")} needs both a title (3+ chars) and a body (10+ chars) within the length limits and with no "NOT TRANSLATED YET" passages, or leave both empty.`;
    case "rate_limited":
      return "Too many edits for now. Try again later.";
    case "not_found":
      return "This announcement no longer exists (it may have been deleted).";
    default:
      return verb === "post" ? "Couldn't post that — try again." : "Couldn't save that — try again.";
  }
}

export function CreateAnnouncementForm() {
  return <AnnouncementForm editing={null} />;
}

/** /admin/announcements/[id]/edit: the same form, filled with a posted announcement. Saving sends no push. */
export function EditAnnouncementForm({ announcement }: { announcement: EditableAnnouncement }) {
  return <AnnouncementForm editing={announcement} />;
}

function AnnouncementForm({ editing }: { editing: EditableAnnouncement | null }) {
  const router = useRouter();
  const verb = editing ? "save" : "post";
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // A newly picked file (on an edit: replaces the current attachment).
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<MediaType | null>(null);
  // Edit only: the posted attachment, until the admin removes it.
  const [existingMedia, setExistingMedia] = useState<AnnouncementMedia | null>(editing?.media ?? null);
  // The English (base) version is controlled so "Draft translations" can read it.
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [translations, setTranslations] = useState<TranslationFields>(editing?.translations ?? {});
  const [drafted, setDrafted] = useState<AnnouncementTranslationLocale[]>([]);
  const [activeLocale, setActiveLocale] = useState<AnnouncementTranslationLocale>(ANNOUNCEMENT_TRANSLATION_LOCALES[0]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  function clearMedia() {
    setFile(null);
    setMediaType(null);
  }

  async function pickImage(f: File | undefined) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    const resized = await resizeImageFile(f);
    if (resized.size > MAX_IMAGE_BYTES) {
      setError("Images must be 25MB or smaller.");
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
      setError("Use an MP4, MOV or WebM video.");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError("Video must be 2GB or smaller.");
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
      if (Number.isFinite(probe.duration) && probe.duration > MAX_VIDEO_SECONDS) {
        setError(`Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
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

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    // A half-filled, over-long or partially drafted language is refused before anything is uploaded (the server
    // checks again).
    const problem = translationSubmitProblem(translations);
    if (problem) {
      setActiveLocale(problem.locale);
      setError(translationProblemMessage(problem));
      return;
    }
    formData.set("translations", JSON.stringify(translationsForSubmit(translations)));
    if (editing) {
      formData.set("id", editing.id);
      formData.set("media", file && mediaType ? "replace" : editing.media && !existingMedia ? "remove" : "keep");
    }
    startTransition(async () => {
      if (file && mediaType) {
        let media: { mediaUrl: string; mediaThumbnailUrl?: string };
        if (mediaType === "IMAGE") {
          const result = await uploadFileDirect(file, "announcement-image");
          if (!result.ok) {
            setError(errorMessage(result.error, verb));
            return;
          }
          media = { mediaUrl: result.publicUrl };
        } else {
          const [videoResult, thumb] = await Promise.all([
            uploadFileDirect(file, "announcement-video"),
            captureVideoFrameFromFile(file).then((frame) =>
              frame ? withRetry(() => uploadFileDirect(frame, "video-thumb")) : null,
            ),
          ]);
          if (!videoResult.ok) {
            setError(errorMessage(videoResult.error, verb));
            return;
          }
          media = { mediaUrl: videoResult.publicUrl, mediaThumbnailUrl: thumb?.ok ? thumb.publicUrl : undefined };
        }
        formData.set("mediaType", mediaType);
        formData.set("mediaUrl", media.mediaUrl);
        if (media.mediaThumbnailUrl) formData.set("mediaThumbnailUrl", media.mediaThumbnailUrl);
      }

      const result = editing ? await updateAnnouncement(formData) : await createAnnouncement(formData);
      if (result.error) {
        const locale = "locale" in result ? result.locale : null;
        if (isAnnouncementTranslationLocale(locale)) setActiveLocale(locale);
        setError(errorMessage(result.error, verb, locale));
        return;
      }
      if (editing) {
        // Back to the list, which shows the saved text (the action revalidated it).
        setSaved(true);
        setDrafted([]);
        router.push("/admin/announcements");
        return;
      }
      formRef.current?.reset();
      clearMedia();
      setTitle("");
      setBody("");
      setTranslations({});
      setDrafted([]);
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-3 rounded-xl border border-line p-4">
      {editing && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-foreground">
          Saving changes updates this announcement in place. It does not send a notification or push, does not show it
          as new again, and keeps its date and place in the list.
        </p>
      )}
      <div>
        <label htmlFor="title" className="text-xs font-medium text-foreground-soft">
          Title (English)
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={120}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label htmlFor="body" className="text-xs font-medium text-foreground-soft">
          What&apos;s new (English)
        </label>
        <textarea
          id="body"
          name="body"
          rows={4}
          maxLength={4000}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <AnnouncementTranslationsFields
        englishTitle={title}
        englishBody={body}
        value={translations}
        onChange={setTranslations}
        drafted={drafted}
        onDrafted={setDrafted}
        activeLocale={activeLocale}
        onActiveLocaleChange={setActiveLocale}
        disabled={isPending}
        submitVerb={verb === "post" ? "posting" : "saving"}
      />

      <div>
        <label className="text-xs font-medium text-foreground-soft">Media (optional)</label>
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
            // Cleared so picking the same file again still fires `change`.
            e.target.value = "";
          }}
        />
        {/* accept must include the literal "image/*" — Capacitor's own
            WebView file-chooser handler only routes a capture-enabled input
            to the native camera intent when acceptTypes.contains("image/*")
            is true; see avatar-upload.tsx's camera input for the full
            explanation. A screenshot is just another file from "Upload from
            device" below — no separate handling needed for it. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={`${IMAGE_TYPES.join(",")},image/*`}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
            // Cleared so picking the same file again still fires `change`.
            e.target.value = "";
          }}
        />
        {/* accept must include the literal "video/*" — see ad-booking-form.tsx's
            equivalent input for the full writeup (confirmed live via adb
            logcat: the WebView's file-chooser otherwise collapses this
            multi-type accept list to a single MIME type). */}
        <input
          ref={videoInputRef}
          type="file"
          accept={`${VIDEO_TYPES.join(",")},video/*`}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickVideo(e.target.files?.[0]);
            // Cleared so picking the same file again still fires `change`.
            e.target.value = "";
          }}
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
              onClick={clearMedia}
              aria-label="Remove media"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-2 text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : existingMedia ? (
          <div className="mt-2 space-y-1">
            <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-lg bg-black">
              {existingMedia.type === "VIDEO" ? (
                <video
                  src={existingMedia.url}
                  poster={existingMedia.thumbnailUrl ?? undefined}
                  controls
                  className="h-full w-full object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={existingMedia.url} alt="" className="h-full w-full object-contain" />
              )}
              <button
                type="button"
                onClick={() => setExistingMedia(null)}
                aria-label="Remove the current media"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-2 text-white"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-foreground-soft">Current media. Remove it to delete it or to add a different one.</p>
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-4 rounded-lg border border-dashed border-line py-6 pl-4">
              <MediaPickerButton
                icon={<Upload size={18} />}
                title="Add a photo or screenshot"
                menuPlacement="bottom"
                options={[
                  {
                    label: "Upload from device",
                    icon: <Upload size={14} />,
                    onSelect: () => {
                      openFilePicker(imageInputRef.current);
                    },
                  },
                  {
                    label: "Take a photo",
                    icon: <Camera size={14} />,
                    onSelect: () => {
                      openFilePicker(cameraInputRef.current);
                    },
                  },
                ]}
              />
              <MediaPickerButton
                icon={<Video size={18} />}
                title="Add a video"
                menuPlacement="bottom"
                options={[
                  {
                    label: "Upload from device",
                    icon: <Upload size={14} />,
                    onSelect: () => {
                      openFilePicker(videoInputRef.current);
                    },
                  },
                ]}
              />
            </div>
            {editing?.media && (
              <p className="text-xs text-foreground-soft">
                The current media will be deleted when you save.{" "}
                <button type="button" onClick={() => setExistingMedia(editing.media)} className="underline">
                  Keep it
                </button>
              </p>
            )}
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {saved && <p role="status" className="text-xs text-foreground-soft">Saved. No one was notified.</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {editing ? (isPending ? "Saving..." : "Save changes") : isPending ? "Posting..." : "Post announcement"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => router.push("/admin/announcements")}
            disabled={isPending}
            className="text-sm text-foreground-soft hover:text-accent disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
