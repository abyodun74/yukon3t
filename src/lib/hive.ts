// Video-body moderation via Hive's Vision Language Model (VLM), Hive's OpenAI-compatible chat completions endpoint.
// Separate from moderateMedia() in moderation.ts, which still checks a post's caption and client-captured thumbnail
// frame synchronously at publish time via OpenAI. This scans the actual video file.
//
// Why the VLM (owner decision 2026-11-18): Hive's Visual Moderation API, used here before, is capped at 100 requests
// a day on this account and has no pay-as-you-go tier, so a busy day left videos unscanned. The VLM is billed per
// token (USD 0.50 per million input tokens, USD 2.50 per million output tokens), showed no daily cap, and defaults to
// 5 requests per second (429 above). The Visual Moderation request and its general_nsfw >= 0.75 threshold are gone.
//
// Request shape, verified with live calls on 2026-11-18:
// - POST https://api.thehive.ai/api/v3/chat/completions, header Authorization: Bearer <HIVE_API_KEY>
// - body: { model: "hive/vision-language-model", messages: [{ role: "user", content: [
//     { type: "media_url", media_url: { url, sampling: { strategy: "fps", fps }, prompt_scope: "once" } },
//     { type: "text", text: <policy prompt> } ] }],
//   response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }, max_tokens, temperature: 0 }
// - synchronous: the verdict is choices[0].message.content (a JSON string), finish_reason "stop".
// - Hive fetches the video itself (mp4/webm/m4v, up to 180s). With this prompt, ~770 input tokens per sampled frame
//   (2026-11-18: 5 frames = 4,273 tokens, 30 frames = 23,548 tokens, both accepted), so frames are capped at
//   VLM_MAX_FRAMES (see vlmSamplingFps): about USD 0.012 per 30-frame video.
// - Measured: a 10s clip at 0.5 fps answered in 1.3-3.7s, 20s in 6.3s, 30s in 11.2s, 30 frames of a small file in
//   3.6s (the file fetch dominates, not the frame count). The JSON came back valid on all 8 live calls.
//
// Called from the moderate-videos cron (src/app/api/cron/moderate-videos), never from post creation: a video post still
// publishes immediately and is picked up on the next cron run ("publish immediately, flag retroactively if needed").
//
// The one rule that matters (vlmVerdictFromContent): only a fully parsed answer with every category false AND unsure
// false is clean. A true category is flagged. unsure is held for an admin. Anything else (cut off, unparsable, a missing
// or mistyped field, extra text around the JSON, an empty answer) is a bad_response failure, which the cron retries and
// after VIDEO_SCAN_MAX_ATTEMPTS holds for an admin. Nothing here ever turns "no clear answer" into clean.

export const HIVE_VLM_ENDPOINT = "https://api.thehive.ai/api/v3/chat/completions";
export const HIVE_VLM_MODEL = "hive/vision-language-model";

/**
 * The policy categories, in the order the schema and the admin reason list them. Exactly these four (owner decision
 * 2026-11-22): explicit sexual content, minors in a sexual context, graphic violence or promotion of violence, and hate.
 * Nothing else (partial nudity, swimwear, self-harm, profanity, ...) is a category. No category may target a group of
 * people: the hate category protects people (sexual orientation and gender identity included), it never flags them.
 */
export const VLM_CATEGORIES = ["sexual_explicit", "minor_sexualized", "violence", "hate"] as const;
export type VlmCategory = (typeof VLM_CATEGORIES)[number];

const VERDICT_KEYS = [...VLM_CATEGORIES, "unsure", "reason"] as const;

/** Strict JSON schema the model must answer in (Hive enforces it with strict: true; vlmVerdictFromContent re-checks). */
export const VLM_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    sexual_explicit: { type: "boolean" },
    minor_sexualized: { type: "boolean" },
    violence: { type: "boolean" },
    hate: { type: "boolean" },
    unsure: { type: "boolean" },
    reason: { type: "string" },
  },
  required: [...VERDICT_KEYS],
  additionalProperties: false,
} as const;

/**
 * The policy prompt. Strict on the four categories and on minors, and nothing beyond them: unsure is for a frame that
 * plausibly shows one of the four but can't be told apart, never for a merely dark, blurry or low-quality video.
 * Kept free of user data (the video URL is the only per-request input, in the media part).
 */
export const VLM_POLICY_PROMPT = [
  "You are a content-safety reviewer for a social app. You are shown frames sampled from one user-uploaded video.",
  "Check every frame and set each field to true only if it clearly appears anywhere in the video:",
  "- sexual_explicit: explicit sexual content or pornography: sexual acts or simulated sexual acts, sexual touching of genitals, or exposed genitals shown in a sexual way. Swimwear, underwear, shirtless people, kissing, dancing, breastfeeding, medical or educational content, and artistic or other non-explicit nudity are NOT this category.",
  "- minor_sexualized: anyone who is or may be under 18 shown in any sexual, nude, partially nude or sexually suggestive context. If a person's age is unclear and the context is sexual or suggestive, set this to true.",
  "- violence: graphic violence (serious injuries, gore, mutilation, dead bodies, torture, people or animals being seriously hurt) or content that promotes or glorifies violence, including explicit threats of violence against people. Sports, news reporting without gore, films or games without graphic gore, and play-fighting are NOT this category.",
  "- hate: content that attacks, dehumanizes or calls for harm against people because of a protected characteristic (race, ethnicity, national origin, religion, caste, disability, sex, sexual orientation or gender identity), or hate symbols and extremist imagery such as swastikas and other Nazi symbols, white-supremacist symbols, or flags, logos or salutes of terrorist or violent extremist groups. People simply being who they are (for example a same-sex couple, a pride flag, religious dress) is never hate; this category protects people, it never targets them.",
  "Set unsure to true only when a frame plausibly shows one of the four categories above but the image quality (dark, blurry, obscured, a brief flash) prevents you from deciding. An ordinary video that is dark, blurry or low quality with no sign of any category is clean, not unsure.",
  "Everything else is clean: set every field to false. That includes everyday content (people talking, sports, cooking, pets, landscapes, cartoons, games), swearing, non-explicit partial nudity of adults, and anything outside the four categories.",
  "reason: one short sentence (at most 20 words) saying what you saw that made a field true, or \"clean\" if every field is false. Do not identify or describe people beyond what the reason needs.",
  "Answer with the JSON object only.",
].join("\n");

/** Most frames one call samples (~23,500 input tokens at the measured ~770 per frame; verified accepted live). */
export const VLM_MAX_FRAMES = 30;
/** Highest sampling rate: a video at the HIVE_VIDEO_MODERATION_MAX_SECONDS (59s) limit gets 30 frames, VLM_MAX_FRAMES. */
export const VLM_MAX_FPS = 0.5;
/**
 * Rate when the duration isn't known (older rows). Stays at or under VLM_MAX_FRAMES up to 120s of video; a longer file
 * with no recorded duration samples more and may be refused by Hive (400 -> rejected_media -> retry -> admin hold).
 */
export const VLM_UNKNOWN_DURATION_FPS = 0.25;
/**
 * Measured input tokens per sampled frame (2026-11-18, with the earlier prompt), plus the prompt itself: the
 * 2026-11-22 four-category prompt is ~2,500 characters, about 150 tokens longer than the one measured, so its share is
 * estimated, not measured.
 */
export const VLM_TOKENS_PER_FRAME = 770;
export const VLM_PROMPT_TOKENS = 650;
/** The most input tokens a call with a known duration can need (30 frames): ~23,750, just over the 23,548 verified live. */
export const VLM_MAX_INPUT_TOKENS = VLM_PROMPT_TOKENS + VLM_MAX_FRAMES * VLM_TOKENS_PER_FRAME;
/** Output cap: the verdict is ~60-90 tokens; a cut-off answer (finish_reason "length") is a bad_response. */
export const VLM_MAX_OUTPUT_TOKENS = 300;
/** The model's reason is shown to admins; longer than this is cut. */
export const VLM_REASON_MAX_CHARS = 200;

/**
 * Sampling rate for a video: min(VLM_MAX_FPS, VLM_MAX_FRAMES / duration), rounded down to 4 decimals so the frame count
 * never goes over the cap. Unknown (null, zero, negative, non-finite) duration: VLM_UNKNOWN_DURATION_FPS.
 */
export function vlmSamplingFps(durationSeconds: number | null | undefined): number {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return VLM_UNKNOWN_DURATION_FPS;
  }
  const fps = Math.min(VLM_MAX_FPS, VLM_MAX_FRAMES / durationSeconds);
  return Math.floor(fps * 10_000) / 10_000;
}

/** Frames a video of this duration is sampled at (estimate; used for logs and the token-limit test). */
export function vlmFrameEstimate(durationSeconds: number | null | undefined): number | null {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.max(1, Math.ceil(durationSeconds * vlmSamplingFps(durationSeconds)));
}

/** The request body for one video. */
export function buildVlmRequestBody(videoUrl: string, durationSeconds: number | null | undefined) {
  return {
    model: HIVE_VLM_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "media_url",
            media_url: {
              url: videoUrl,
              sampling: { strategy: "fps", fps: vlmSamplingFps(durationSeconds) },
              prompt_scope: "once",
            },
          },
          { type: "text", text: VLM_POLICY_PROMPT },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "video_moderation", strict: true, schema: VLM_VERDICT_SCHEMA },
    },
    max_tokens: VLM_MAX_OUTPUT_TOKENS,
    temperature: 0,
  };
}

// The scan budget lives in the cron (src/lib/video-scan-budget.ts), which passes a shorter timeout when its run has
// less left. This only ever runs inside that cron, never in a user-facing request path.
export const MODERATION_TIMEOUT_MS = 30_000;

/**
 * Why a scan produced no verdict. "Provider-wide" failures (see isProviderWideFailure) say nothing about the video:
 * the key is missing, refused or out of credit, Hive is rate-limiting or down, or Hive can't be reached at all. Every
 * other video would fail the same way, so the cron stops its run and retries later without counting it against any
 * video. The rest are about this video: Hive rejected the request for it (a URL its fetcher couldn't pull, a file it
 * can't read, too many tokens), timed out on it, or answered something that isn't a complete verdict.
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

export type VlmUsage = { inputTokens: number | null; outputTokens: number | null };

/** A complete verdict. Exactly one of: clean, flagged (>= 1 category), review (unsure, no category). */
export type HiveVerdict =
  | { ok: true; flagged: false; review: false; categories: []; reason: string; usage?: VlmUsage }
  | { ok: true; flagged: true; review: false; categories: VlmCategory[]; reason: string; usage?: VlmUsage }
  | { ok: true; flagged: false; review: true; categories: []; reason: string; usage?: VlmUsage };

export type HiveScan =
  | HiveVerdict
  // retryAfterSeconds: Hive's Retry-After header, when it sent a readable one (a 429 usually).
  | { ok: false; failure: HiveFailure; detail?: string; retryAfterSeconds?: number };

type VerdictParse = { ok: true; verdict: HiveVerdict } | { ok: false; detail: string };

function cleanReason(value: string): string {
  // Control characters out (the reason ends up in an audit row and on the admin page), whitespace collapsed, capped.
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > VLM_REASON_MAX_CHARS ? `${text.slice(0, VLM_REASON_MAX_CHARS - 1)}…` : text;
}

/**
 * The verdict from the model's message content, or why it isn't one. The content must be exactly one JSON object
 * (surrounding whitespace allowed, nothing else) with every key of VLM_VERDICT_SCHEMA, no other key, booleans where
 * booleans belong and a string reason. Pure; unit-tested with the full matrix in hive.test.ts.
 */
export function vlmVerdictFromContent(content: unknown): VerdictParse {
  if (typeof content !== "string" || content.trim() === "") return { ok: false, detail: "empty verdict" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return { ok: false, detail: "verdict is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, detail: "verdict is not a JSON object" };
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  const extra = keys.filter((k) => !(VERDICT_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) return { ok: false, detail: `verdict has unexpected keys: ${extra.slice(0, 5).join(",")}` };
  for (const key of [...VLM_CATEGORIES, "unsure"] as const) {
    if (typeof record[key] !== "boolean") return { ok: false, detail: `verdict field ${key} is missing or not a boolean` };
  }
  if (typeof record.reason !== "string") return { ok: false, detail: "verdict field reason is missing or not a string" };

  const reason = cleanReason(record.reason);
  const categories = VLM_CATEGORIES.filter((c) => record[c] === true);
  if (categories.length > 0) {
    return { ok: true, verdict: { ok: true, flagged: true, review: false, categories, reason } };
  }
  if (record.unsure === true) {
    return { ok: true, verdict: { ok: true, flagged: false, review: true, categories: [], reason } };
  }
  // The only clean outcome: every category false and unsure false, read from a complete, well-formed object.
  return { ok: true, verdict: { ok: true, flagged: false, review: false, categories: [], reason } };
}

type ChatCompletion = {
  choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The verdict from a whole chat-completions response body, or why it isn't one. A response that stopped for any
 * reason other than "stop" (cut off at max_tokens, content filter, ...) is never read as a verdict.
 */
export function vlmVerdictFromResponse(data: unknown): VerdictParse {
  if (!data || typeof data !== "object") return { ok: false, detail: "response is not a JSON object" };
  const body = data as ChatCompletion;
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  if (!choice || typeof choice !== "object") return { ok: false, detail: "response has no choices" };
  if (choice.finish_reason !== "stop") {
    return { ok: false, detail: `finish_reason ${String(choice.finish_reason ?? "missing").slice(0, 40)}` };
  }
  const result = vlmVerdictFromContent(choice.message?.content);
  if (!result.ok) return result;
  const usage: VlmUsage = {
    inputTokens: tokenCount(body.usage?.prompt_tokens),
    outputTokens: tokenCount(body.usage?.completion_tokens),
  };
  return { ok: true, verdict: { ...result.verdict, usage } };
}

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

// Statuses that can be about the media itself (a URL Hive's fetcher couldn't pull or read, a file too large or of the
// wrong type, a request over the token limit). Any other client error is about the account or the request, which is
// the same for every video.
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
 * Scans a video URL with the VLM. `durationSeconds` (from the row) sets the sampling rate (vlmSamplingFps). Never
 * "assume clean": anything other than a complete verdict comes back as a failure with its reason (and Hive's own error
 * text when it sent one), which the cron logs, reports and acts on.
 */
export async function moderateVideo(
  videoUrl: string,
  options: { timeoutMs?: number; durationSeconds?: number | null } = {},
): Promise<HiveScan> {
  const apiKey = process.env.HIVE_API_KEY;
  if (!apiKey) return { ok: false, failure: "not_configured" };

  const timeoutMs = Math.max(1, Math.min(MODERATION_TIMEOUT_MS, options.timeoutMs ?? MODERATION_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(HIVE_VLM_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildVlmRequestBody(videoUrl, options.durationSeconds)),
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
        detail: `HTTP ${res.status}${body ? ` ${body.split(apiKey).join("[key]").slice(0, DETAIL_MAX_CHARS)}` : ""}`,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return {
        ok: false,
        failure: timeoutController.signal.aborted ? "timeout" : "bad_response",
        ...(timeoutController.signal.aborted ? {} : { detail: "response is not JSON" }),
      };
    }
    const parsed = vlmVerdictFromResponse(data);
    if (!parsed.ok) return { ok: false, failure: "bad_response", detail: parsed.detail };
    return parsed.verdict;
  } finally {
    clearTimeout(timeout);
  }
}
