import { captureError } from "@/lib/error-tracking";

export type ModerationResult = {
  allowed: boolean;
  flaggedCategories: string[];
  // Set when the check itself didn't run. "rejected": OpenAI refused this
  // particular input (HTTP 400), so asking again gives the same answer.
  // "unavailable": outage, rate limit, timeout — worth retrying later.
  apiError?: "rejected" | "unavailable";
};

// A stalled/slow OpenAI response would otherwise hold the calling write
// action (post/comment/message/etc.) open for as long as the API takes —
// under load or an OpenAI-side slowdown, this endpoint becomes the
// throughput ceiling for every content-creation action at once. Bounding it
// caps that worst case; a timeout is treated the same as any other API
// error below (fail open, flag for human review).
const MODERATION_TIMEOUT_MS = 8000;

// Content that fails open here publishes unscanned, so make it visible.
// Fire-and-forget: captureError never throws, and the caller shouldn't wait on it.
function reportModerationFailOpen(reason: string, error?: unknown, detail?: string) {
  console.error(`[moderation] callModerationApi failed open: ${reason}${detail ? ` (${detail})` : ""}`);
  void captureError(error ?? new Error(`Moderation API failed open: ${reason}`), {
    where: "callModerationApi",
    reason,
    detail,
  });
}

// OpenAI's own explanation of a non-2xx response (e.g. which part of the
// input it refused) — without it an "HTTP 400" report can't be acted on.
async function moderationErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json();
    const message = body?.error?.message;
    return typeof message === "string" ? message.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

async function callModerationApi(
  input: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>,
): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { allowed: true, flaggedCategories: [] };
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), MODERATION_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      // Fail closed on API errors for safety-critical paths would block
      // legitimate users during outages; instead flag for human review.
      reportModerationFailOpen(`HTTP ${res.status}`, undefined, await moderationErrorDetail(res));
      return {
        allowed: true,
        flaggedCategories: ["moderation_api_error"],
        apiError: res.status === 400 ? "rejected" : "unavailable",
      };
    }

    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.flagged) {
      return { allowed: true, flaggedCategories: [] };
    }
    const flaggedCategories = Object.entries(result.categories ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key);
    return { allowed: false, flaggedCategories };
  } catch (err) {
    // Covers both a real network/API error and the timeout abort above.
    reportModerationFailOpen(timeoutController.signal.aborted ? "timeout" : "network error", err);
    return { allowed: true, flaggedCategories: ["moderation_api_error"], apiError: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

// Prescreens user-authored text through OpenAI's moderation endpoint before it
// is stored/shown. Fails open (allows content) only when no API key is
// configured, which is expected in local dev — production must set
// OPENAI_API_KEY so this gate is actually enforced.
export async function moderateText(text: string): Promise<ModerationResult> {
  return callModerationApi(text);
}

// Same fail-open-without-key / fail-open-on-error semantics as moderateText,
// applied to an already-uploaded image's public URL. This is the enforcement
// point for the "no sexually explicit content" policy on photos and on the
// client-captured video thumbnail frame that stands in for a video. For an
// animated GIF (storage.ts's post-image/message-image kinds), OpenAI's
// endpoint only ever looks at the first frame — the same "one frame stands
// in for the whole thing" tradeoff this already makes for video via its own
// thumbnail frame, not a new gap this introduces.
export async function moderateImage(url: string): Promise<ModerationResult> {
  return callModerationApi([{ type: "image_url", image_url: { url } }]);
}

/** One labelled check out of moderateMediaChecks: which part of the upload it was ("caption", "photo 2", "video frame"). */
export type MediaModerationCheck = { source: string; result: ModerationResult };

/**
 * The caption and each attached image/video frame checked separately, each result labelled with what it was. Lets a
 * caller tell a flagged caption from a flagged picture and tell an API failure apart from a verdict
 * (decideMediaModeration in src/lib/media-moderation-hold.ts) instead of collapsing everything into one boolean.
 */
export async function moderateMediaChecks({
  text,
  imageUrls = [],
  thumbnailUrl,
}: {
  text: string;
  imageUrls?: string[];
  thumbnailUrl?: string | null;
}): Promise<MediaModerationCheck[]> {
  const labelled: Array<{ source: string; run: () => Promise<ModerationResult> }> = [
    { source: "caption", run: () => moderateText(text) },
    ...imageUrls.map((url, i) => ({
      source: imageUrls.length > 1 ? `photo ${i + 1}` : "photo",
      run: () => moderateImage(url),
    })),
    ...(thumbnailUrl ? [{ source: "video frame", run: () => moderateImage(thumbnailUrl) }] : []),
  ];
  const results = await Promise.all(labelled.map((check) => check.run()));
  return labelled.map((check, i) => ({ source: check.source, result: results[i] }));
}

/** Combines a post's text with any attached images/thumbnail into one verdict. */
export async function moderateMedia(input: {
  text: string;
  imageUrls?: string[];
  thumbnailUrl?: string | null;
}): Promise<ModerationResult> {
  const results = (await moderateMediaChecks(input)).map((check) => check.result);

  const flaggedCategories = results.flatMap((r) => r.flaggedCategories);
  return {
    allowed: results.every((r) => r.allowed),
    flaggedCategories: [...new Set(flaggedCategories)],
  };
}
