"use client";

import { Capacitor } from "@capacitor/core";
import { captureError } from "@/lib/error-tracking";
import { capturePostHogEvent } from "@/lib/posthog-client";
import { mediaDiagnostic } from "@/lib/media-file";

/**
 * Reports one failed step of a photo/video upload (Story composer, share-in sheet, post composer) so the next failure on a real
 * phone is diagnosable: PostHog `media_upload_failed` and a Sentry event, both carrying only mediaDiagnostic's
 * coarse fields (surface, step, error code, kind, a known MIME type or "other", a known extension or "other", size
 * and duration buckets, platform). Never the file name, its bytes, a URL or a storage key. Never throws.
 */
export function reportMediaUploadFailure(input: {
  surface: "story" | "share-target" | "post";
  step: string;
  code: string;
  file?: File | null;
  duration?: number | null;
  /** Which try of the same draft this was (1, 2, 3+): tells "failed once" from "kept failing after a failure". */
  attempt?: number | null;
  /** Whether this try reused the previous try's idempotency key (its outcome was unknown). */
  reusedKey?: boolean | null;
}) {
  try {
    const props = mediaDiagnostic({
      surface: input.surface,
      step: input.step,
      code: input.code,
      reportedType: input.file?.type ?? null,
      name: input.file?.name ?? null,
      size: input.file?.size ?? null,
      duration: input.duration ?? null,
      platform: Capacitor.getPlatform(),
    });
    const extra: Record<string, string> = {};
    if (typeof input.attempt === "number" && input.attempt > 0) extra.attempt = input.attempt >= 3 ? "3+" : String(input.attempt);
    if (typeof input.reusedKey === "boolean") extra.reusedKey = input.reusedKey ? "yes" : "no";
    const event = { ...props, ...extra };
    capturePostHogEvent("media_upload_failed", event);
    void captureError(new Error(`media_upload_failed:${props.surface}:${props.step}:${props.code}`), event);
  } catch {
    // Reporting must never become a new failure.
  }
}
