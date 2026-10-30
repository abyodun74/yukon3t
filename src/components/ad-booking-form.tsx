"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Upload, Video, X } from "lucide-react";
import { createAdCampaign, requestAdUpload } from "@/app/actions/ads";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile } from "@/lib/upload-client";
import { WRITE_ONCE_UPLOAD_PROTOCOL, WRITE_ONCE_UPLOAD_PROTOCOL_FIELD } from "@/lib/write-once-upload";
import { MediaPickerButton } from "@/components/media-picker-button";
import { AD_DURATION_OPTIONS, AD_UPLOAD_PASS_FIELD, MAX_AD_VIDEO_SECONDS, adPriceCents, formatCents } from "@/lib/ads";
import { HONEYPOT_FIELD, FORM_TIMESTAMP_FIELD, currentTimeMs } from "@/lib/bot-protection";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/turnstile-shared";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { INITIAL_TURNSTILE_STATE, heldSubmitMessage, type TurnstileState } from "@/lib/turnstile-lifecycle";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";
import { useAdvertiseText } from "@/components/advertise-text";
import { aroundPlaceholder, byCode, plural } from "@/lib/i18n/locales";
import { normalizeVideoFile } from "@/lib/video-file";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Kept in sync with storage.ts's MEDIA_LIMITS["ad-video"] (a 30s clip) — duplicated locally for the
// same reason as post-composer.tsx's MAX_VIDEO_BYTES.
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

// The codes an upload or the booking action can answer with. Anything else reads as "couldn't submit".
const RESULT_CODES = [
  "too_large",
  "moderation",
  "rate_limited",
  "not_configured",
  "payment_setup_failed",
  "invalid",
  "network",
  "captcha",
  "captcha_unavailable",
] as const;

type MintedUpload = { uploadUrl: string; publicUrl: string; key: string; headers: Record<string, string> };

// The presigned URL was already minted by requestAdUpload (which ran the bot check), so uploadFileDirect is handed a
// "request" function that just returns it: same PUT, retry and timeout handling as every other upload.
function putMinted(file: File, kind: "ad-image" | "ad-video", minted: MintedUpload) {
  return uploadFileDirect(file, kind, async () => ({ error: null, ...minted }));
}

export function AdBookingForm() {
  const { locale, t: advertise } = useAdvertiseText();
  const t = advertise.form;
  function errorMessage(code: string) {
    const known = (RESULT_CODES as readonly string[]).includes(code);
    return byCode(t.errors, known ? code : "other");
  }
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
  // Bot deterrents (see src/lib/bot-protection.ts): this form has no auth
  // wall, so it's the one genuinely public content-creation form in the
  // app besides sign-up/password-reset.
  const [honeypot, setHoneypot] = useState("");
  const mountedAtRef = useRef(currentTimeMs());
  // Turnstile (see turnstile-widget.tsx), which only runs once the advertiser taps "Verify you're human". This form isn't a real <form>, so
  // the token comes through onToken into a ref rather than a hidden input —
  // a ref, because it can refresh while a large video is still uploading and
  // has to be read at the moment the FormData is built, not at click time.
  // Bumping turnstileReset discards the spent token after each attempt.
  const turnstileRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const turnstileTokenRef = useRef<string | null>(null);
  // The widget's lifecycle, so a hold-back can say why there's no token (not tapped / still running / what failed).
  const turnstileStateRef = useRef<TurnstileState>(INITIAL_TURNSTILE_STATE);
  const [turnstileReset, setTurnstileReset] = useState(0);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const price = adPriceCents(durationDays);
  const [continueBefore, continueAfter] = aroundPlaceholder(t.continue, "price");

  async function pickImage(f: File | undefined) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      setError(t.errors.imageType);
      return;
    }
    const resized = await resizeImageFile(f);
    if (resized.size > MAX_IMAGE_BYTES) {
      setError(t.errors.imageTooLarge);
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
      setError(t.errors.videoType);
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError(t.errors.videoTooLarge);
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
        setError(plural(locale, t.errors.videoTooLong, MAX_AD_VIDEO_SECONDS));
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
      setError(t.errors.details);
      return;
    }
    if (!headline.trim() || !body.trim() || !linkUrl.trim()) {
      setError(t.errors.adFields);
      return;
    }
    if (!file || !mediaType) {
      setError(t.errors.media);
      return;
    }
    if (turnstileRequired && !turnstileTokenRef.current) {
      setError(heldSubmitMessage(turnstileStateRef.current, t.turnstile));
      return;
    }
    setError(null);
    startTransition(async () => {
      // A video's poster frame is captured first so its size is known when the upload URLs are requested.
      const frame = mediaType === "VIDEO" ? await captureVideoFrameFromFile(file) : null;

      // One bot check per attempt, spent here: requestAdUpload mints the upload URLs and hands back a pass that
      // createAdCampaign accepts for these exact files. Read the token now, at the moment of the request.
      const uploadFd = new FormData();
      uploadFd.set("mediaType", mediaType);
      uploadFd.set("contentType", file.type);
      uploadFd.set("size", String(file.size));
      if (frame) {
        uploadFd.set("thumbContentType", frame.type);
        uploadFd.set("thumbSize", String(frame.size));
      }
      uploadFd.set(HONEYPOT_FIELD, honeypot);
      uploadFd.set(FORM_TIMESTAMP_FIELD, String(mountedAtRef.current));
      uploadFd.set(WRITE_ONCE_UPLOAD_PROTOCOL_FIELD, WRITE_ONCE_UPLOAD_PROTOCOL);
      if (turnstileRequired) {
        const token = turnstileTokenRef.current;
        if (!token) {
          setError(heldSubmitMessage(turnstileStateRef.current, t.turnstile));
          return;
        }
        uploadFd.set(TURNSTILE_RESPONSE_FIELD, token);
      }

      try {
        let minted;
        try {
          minted = await requestAdUpload(uploadFd);
        } catch {
          setError(errorMessage("network"));
          return;
        }
        if (minted.error !== null) {
          setError(errorMessage(minted.error));
          return;
        }

        const mainKind = mediaType === "IMAGE" ? "ad-image" : "ad-video";
        const [mainResult, thumbResult] = await Promise.all([
          putMinted(file, mainKind, minted.main),
          frame && minted.thumb ? putMinted(frame, "ad-image", minted.thumb) : Promise.resolve(null),
        ]);
        if (!mainResult.ok) {
          setError(errorMessage(mainResult.error));
          return;
        }
        const media = {
          mediaUrl: mainResult.publicUrl,
          mediaThumbnailUrl: thumbResult?.ok ? thumbResult.publicUrl : undefined,
        };

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
        fd.set(HONEYPOT_FIELD, honeypot);
        fd.set(FORM_TIMESTAMP_FIELD, String(mountedAtRef.current));
        fd.set(AD_UPLOAD_PASS_FIELD, minted.pass);

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
      } finally {
        // requestAdUpload consumed this token whether or not the booking went
        // through; get a fresh one for the next attempt.
        setTurnstileReset((n) => n + 1);
      }
    });
  }

  return (
    <div className="rounded-xl border border-line p-5">
      <input
        type="text"
        name={HONEYPOT_FIELD}
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ad-company-name" className="block text-sm font-medium">
            {t.company}
          </label>
          <input
            id="ad-company-name"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            maxLength={100}
            autoComplete="organization"
            dir="auto"
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="ad-contact-name" className="block text-sm font-medium">
            {t.contactName}
          </label>
          <input
            id="ad-contact-name"
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            maxLength={100}
            autoComplete="name"
            dir="auto"
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="ad-contact-email" className="block text-sm font-medium">
          {t.contactEmail}
        </label>
        <input
          id="ad-contact-email"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder={t.emailPlaceholder}
          autoComplete="email"
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-foreground-soft">{t.emailHint}</p>
      </div>

      <div className="mt-4">
        <label htmlFor="ad-headline" className="block text-sm font-medium">
          {t.headline}
        </label>
        <input
          id="ad-headline"
          type="text"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={80}
          placeholder={t.headlinePlaceholder}
          dir="auto"
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="ad-body" className="block text-sm font-medium">
          {t.copy}
        </label>
        <textarea
          id="ad-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={280}
          rows={3}
          placeholder={t.copyPlaceholder}
          dir="auto"
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="ad-link-url" className="block text-sm font-medium">
          {t.link}
        </label>
        <input
          id="ad-link-url"
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder={t.linkPlaceholder}
          autoComplete="url"
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">{t.creative}</label>
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
          }}
        />
        {/* accept must include the literal "image/*" — Capacitor's own
            WebView file-chooser handler only routes a capture-enabled
            input to the native camera intent when
            acceptTypes.contains("image/*") is true; see avatar-upload.tsx's
            camera input for the full explanation. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={`${IMAGE_TYPES.join(",")},image/*`}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
          }}
        />
        {/* accept must include the literal "video/*" — confirmed live via
            adb logcat on a real Samsung device: the WebView's file-chooser
            collapses this multi-type accept list to a single MIME type on
            the GET_CONTENT intent (typ=video/mp4 only, video/webm silently
            dropped), so a video whose reported type doesn't match that one
            exact string never shows as pickable. See post-composer.tsx's
            equivalent input for the full writeup. */}
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
              aria-label={t.removeMedia}
              className="absolute end-1 top-1 rounded-full bg-black/60 p-2 text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-4 rounded-lg border border-dashed border-line py-8 ps-4">
            <MediaPickerButton
              icon={<Upload size={18} />}
              title={t.addPhoto}
              options={[
                {
                  label: t.uploadFromDevice,
                  icon: <Upload size={14} />,
                  onSelect: () => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    imageInputRef.current?.click();
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
            />
            <MediaPickerButton
              icon={<Video size={18} />}
              title={t.addVideo}
              options={[
                {
                  label: t.uploadFromDevice,
                  icon: <Upload size={14} />,
                  onSelect: () => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    videoInputRef.current?.click();
                  },
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">{t.duration}</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {AD_DURATION_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setDurationDays(days)}
              aria-pressed={durationDays === days}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                durationDays === days ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-accent"
              }`}
            >
              {plural(locale, t.days, days)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between rounded-lg bg-accent-soft px-4 py-3">
        <span className="text-sm font-medium">{t.total}</span>
        <bdi className="text-lg font-semibold text-accent">{formatCents(price)}</bdi>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      <TurnstileWidget
        className="mt-4"
        locale={locale}
        strings={t.turnstile}
        attest={false}
        resetSignal={turnstileReset}
        onToken={(token) => {
          turnstileTokenRef.current = token;
        }}
        onStateChange={(state) => {
          turnstileStateRef.current = state;
        }}
      />

      <button
        type="button"
        disabled={isPending}
        onClick={submit}
        className="mt-4 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
      >
        {isPending ? (
          t.preparing
        ) : (
          <>
            {continueBefore}
            <bdi>{formatCents(price)}</bdi>
            {continueAfter}
          </>
        )}
      </button>
      <p className="mt-2 text-center text-xs text-foreground-soft">{t.stripeNote}</p>
      <p className="mt-1 text-center text-xs text-foreground-soft">{plural(locale, t.oneTime, durationDays)}</p>
    </div>
  );
}
