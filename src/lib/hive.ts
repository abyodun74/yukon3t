// Synchronous video-body moderation via Hive's V3 Visual Moderation API —
// separate from moderateMedia() in moderation.ts, which still checks a
// post's caption and client-captured thumbnail frame synchronously at
// publish time via OpenAI. This scans the actual video file.
//
// Real API shape confirmed directly from Hive's own dashboard docs (not
// guessed, and not the same as the older V2 Task API this file originally
// targeted — that used a different endpoint/host and an async task+webhook
// model that doesn't match the "Service API Keys" V3 credential this app's
// HIVE_API_KEY actually holds):
// - POST https://api.thehive.ai/api/v3/hive/visual-moderation
// - Header: authorization: Bearer <HIVE_API_KEY>
// - Body: { input: [{ media_url }] }
// - Synchronous — full per-frame classification comes back in the same
//   response. No task id, no webhook, no polling. Capped at 60s of video
//   content, which is why MAX_UPLOAD_VIDEO_SECONDS/MAX_RECORD_VIDEO_SECONDS
//   in post-composer.tsx are deliberately set to exactly 60.
// Called from the moderate-videos cron (src/app/api/cron/moderate-videos),
// not from post creation — a video post still publishes immediately and
// gets picked up on the next cron run, matching the "publish immediately,
// flag retroactively if needed" approach already used for text/image.

// Threshold matches the confidence level SECURITY.md's own OpenAI
// moderation test case used as a genuine positive (sexual: 0.78) — a
// starting point, worth revisiting once real report/flag volume shows it's
// too loose or too strict.
const FLAG_THRESHOLD = 0.75;
// "general_nsfw" is Hive's blended sexual-content score, confirmed present
// in their own Video Output example response — aligned with this app's
// zero-tolerance sexual-content policy (see Community Guidelines /
// SECURITY.md). Hive's taxonomy also covers violence/drugs/hate-symbols
// under separate class names not yet confirmed here — add them once
// verified against Hive's own class-description docs rather than guessing
// at names that might not exist and would then silently never match.
const FLAGGED_CLASS = "general_nsfw";

// Field is "class", not "class_name" as Hive's own docs example showed —
// confirmed against a real live response, docs were wrong on this point.
type HiveClassScore = { class: string; value: number };
type HiveVisualModerationResponse = {
  output?: Array<{ classes?: HiveClassScore[] }>;
};

/** True if any frame (video) or the single result (image) crosses the flag
 * threshold on the tracked class. */
export function isFlagged(data: HiveVisualModerationResponse): boolean {
  for (const frame of data.output ?? []) {
    for (const { class: className, value } of frame.classes ?? []) {
      if (className === FLAGGED_CLASS && value >= FLAG_THRESHOLD) return true;
    }
  }
  return false;
}

// Frame-by-frame video scoring can take real wall-clock time — a longer
// budget than the 8s text/image timeout in moderation.ts. This only ever
// runs inside the moderate-videos cron, never in a user-facing request
// path, so a slow call doesn't hold anything open for an end user.
const MODERATION_TIMEOUT_MS = 30_000;

/**
 * Why a scan produced no verdict. "Provider-wide" failures (see isProviderWideFailure) say nothing about the video:
 * the key is missing, refused or out of credit, Hive is rate-limiting or down, or Hive can't be reached at all. Every
 * other video would fail the same way, so the cron stops its run and retries later without counting it against any
 * video. The rest are about this video: Hive rejected the request for it, timed out on it, or answered something
 * this file can't read.
 */
export type HiveFailure =
  | "not_configured"
  | "unauthorized"
  | "out_of_credit"
  | "rate_limited"
  | "provider_error"
  | "unreachable"
  | "rejected_media"
  | "timeout"
  | "bad_response";

export type HiveScan = { ok: true; flagged: boolean } | { ok: false; failure: HiveFailure; detail?: string };

/** What an HTTP error status from Hive means for the scan. */
export function hiveFailureForStatus(status: number): HiveFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "out_of_credit";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  return "rejected_media";
}

export function isProviderWideFailure(failure: HiveFailure): boolean {
  return (
    failure === "not_configured" ||
    failure === "unauthorized" ||
    failure === "out_of_credit" ||
    failure === "rate_limited" ||
    failure === "provider_error" ||
    failure === "unreachable"
  );
}

// Enough of Hive's error body to say why (e.g. {"status_code":401,"message":"Invalid or expired token"}). The body
// never contains the key; the cap keeps a log line short.
const DETAIL_MAX_CHARS = 300;

/**
 * Synchronously scans a video URL. Never "assume clean": anything other than a readable answer comes back as a
 * failure with its reason (and Hive's own error text when it sent one), which the cron logs, reports and acts on.
 */
export async function moderateVideo(videoUrl: string): Promise<HiveScan> {
  const apiKey = process.env.HIVE_API_KEY;
  if (!apiKey) return { ok: false, failure: "not_configured" };

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), MODERATION_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch("https://api.thehive.ai/api/v3/hive/visual-moderation", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: [{ media_url: videoUrl }] }),
        signal: timeoutController.signal,
      });
    } catch {
      return { ok: false, failure: timeoutController.signal.aborted ? "timeout" : "unreachable" };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        failure: hiveFailureForStatus(res.status),
        detail: `HTTP ${res.status}${body ? ` ${body.slice(0, DETAIL_MAX_CHARS)}` : ""}`,
      };
    }
    let data: HiveVisualModerationResponse;
    try {
      data = await res.json();
    } catch {
      return { ok: false, failure: timeoutController.signal.aborted ? "timeout" : "bad_response" };
    }
    if (!data || !Array.isArray(data.output)) return { ok: false, failure: "bad_response" };
    return { ok: true, flagged: isFlagged(data) };
  } finally {
    clearTimeout(timeout);
  }
}
