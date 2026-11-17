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
// The moderate-videos cron passes a shorter one when its run budget has less than this left
// (src/lib/video-scan-budget.ts); a timeout under a shortened cap is the run's budget, not the video's fault.
export const MODERATION_TIMEOUT_MS = 30_000;

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

export type HiveScan =
  | { ok: true; flagged: boolean }
  // retryAfterSeconds: Hive's Retry-After header, when it sent a readable one (a 429 usually).
  | { ok: false; failure: HiveFailure; detail?: string; retryAfterSeconds?: number };

// A Retry-After value longer than this is treated as unreadable (the caller caps its own wait anyway).
const RETRY_AFTER_MAX_SECONDS = 24 * 60 * 60;

/** Retry-After as whole seconds (delta-seconds or an HTTP date), or undefined when absent or unreadable. */
export function parseRetryAfterSeconds(value: string | null | undefined, nowMs: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return undefined;
    seconds = Math.ceil((at - nowMs) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > RETRY_AFTER_MAX_SECONDS) return undefined;
  return seconds;
}

// Statuses that can be about the media itself (a URL Hive couldn't fetch or read, a file too large or of the wrong
// type). Any other client error is about the account or the request, which is the same for every video.
const MEDIA_ERROR_STATUSES = new Set([400, 413, 415, 422]);
// Hive pauses an organization whose balance runs out and answers every request with that, under a status that isn't
// 402 (seen live 2026-10-14: HTTP 405 "Your Organization is currently paused. Please check your account balance…").
const ACCOUNT_PAUSED = /organi[sz]ation is (currently )?paused|account balance|insufficient (funds|credit|balance)|out of credit/i;

/**
 * What an HTTP error from Hive means for the scan. Only a status that can be about the media counts against the video;
 * anything unrecognised is treated as provider-wide, so an account or API problem never hides or reroutes a video.
 */
export function hiveFailureForStatus(status: number, body = ""): HiveFailure {
  if (status === 402 || ACCOUNT_PAUSED.test(body)) return "out_of_credit";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (MEDIA_ERROR_STATUSES.has(status)) return "rejected_media";
  return "provider_error";
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
export async function moderateVideo(videoUrl: string, options: { timeoutMs?: number } = {}): Promise<HiveScan> {
  const apiKey = process.env.HIVE_API_KEY;
  if (!apiKey) return { ok: false, failure: "not_configured" };

  const timeoutMs = Math.max(1, Math.min(MODERATION_TIMEOUT_MS, options.timeoutMs ?? MODERATION_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
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
      const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get("retry-after"), Date.now());
      return {
        ok: false,
        failure: hiveFailureForStatus(res.status, body),
        detail: `HTTP ${res.status}${body ? ` ${body.slice(0, DETAIL_MAX_CHARS)}` : ""}`,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
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
