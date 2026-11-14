"use client";

import { Capacitor } from "@capacitor/core";
import { captureError } from "@/lib/error-tracking";
import { capturePostHogEvent } from "@/lib/posthog-client";
import { mediaDiagnostic } from "@/lib/media-file";

/**
 * Reports one failed step of a photo/video upload (Story composer, share-in sheet) so the next failure on a real
 * phone is diagnosable: PostHog `media_upload_failed` and a Sentry event, both carrying only mediaDiagnostic's
 * coarse fields (surface, step, error code, kind, a known MIME type or "other", a known extension or "other", size
 * and duration buckets, platform). Never the file name, its bytes, a URL or a storage key. Never throws.
 */
export function reportMediaUploadFailure(input: {
  surface: "story" | "share-target";
  step: string;
  code: string;
  file?: File | null;
  duration?: number | null;
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
    capturePostHogEvent("media_upload_failed", props);
    void captureError(new Error(`media_upload_failed:${props.surface}:${props.step}:${props.code}`), props);
  } catch {
    // Reporting must never become a new failure.
  }
}
