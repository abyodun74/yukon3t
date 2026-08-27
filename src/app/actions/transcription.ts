"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { transcribeAudioSchema } from "@/lib/validations";
import { MEDIA_LIMITS, verifyUploadedSize, downloadObject, deleteOwnedObject } from "@/lib/storage";

// Same reasoning/pattern as moderation.ts's MODERATION_TIMEOUT_MS — bounds
// how long a stalled/slow Whisper response can hold this action open.
const TRANSCRIBE_TIMEOUT_MS = 10000;

/**
 * Records → transcribes → the caller reviews/edits the returned text in
 * their own composer before it's ever submitted — createPost/sendMessage
 * moderate the final text exactly as they always have, so this deliberately
 * does NOT run moderateText on the draft transcription itself.
 *
 * Unlike moderation.ts's fail-open behavior (no safe fallback text exists
 * here), any failure — missing API key, non-2xx response, timeout, thrown
 * error — fails closed with a real error, never a fabricated transcript.
 */
export async function transcribeAudio(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("transcribeAudio", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = transcribeAudioSchema.safeParse({ key: formData.get("key") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { key } = parsed.data;

  const sizeOk = await verifyUploadedSize({
    key,
    maxBytes: MEDIA_LIMITS["voice-dictation"],
    ownerId: user.id,
  });
  if (!sizeOk) {
    return { error: "too_large" as const };
  }

  try {
    const object = await downloadObject(key);
    if (!object) {
      return { error: "unavailable" as const };
    }

    if (!process.env.OPENAI_API_KEY) {
      return { error: "not_configured" as const };
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), TRANSCRIBE_TIMEOUT_MS);

    try {
      const body = new FormData();
      body.set("model", "whisper-1");
      body.set(
        "file",
        new Blob([new Uint8Array(object.body)], { type: "audio/webm" }),
        "dictation.webm",
      );

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body,
        signal: timeoutController.signal,
      });

      if (!res.ok) {
        return { error: "unavailable" as const };
      }

      const data = await res.json();
      if (typeof data.text !== "string") {
        return { error: "unavailable" as const };
      }

      return { error: null, text: data.text as string };
    } catch {
      // Covers both a real network/API error and the timeout abort above.
      return { error: "unavailable" as const };
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await deleteOwnedObject(key, user.id);
  }
}
