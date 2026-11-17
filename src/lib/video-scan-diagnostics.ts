// What the moderate-videos cron (src/app/api/cron/moderate-videos/route.ts) logs when Hive can't scan a video. Pure,
// unit-tested (video-scan-diagnostics.test.ts); the one network call (a HEAD for the file's size and type) is in
// video-scan-head.ts.
//
// Before this, a failed scan logged only Hive's failure kind and error text, so a video Hive called "too large /
// unsupported / corrupt" couldn't be told apart from any other: nothing said how big or long the file was or what it
// was. A diagnostic carries exactly what that needs and nothing that identifies a person: the item's kind and id, the
// attempt, Hive's HTTP status, error code and message (URLs scrubbed), the media's extension and host (never its full
// URL or key), duration, size and content type. No captions, names, emails or other ids.

export type VideoScanItemKind = "post" | "comment" | "muse";

/** What a HEAD of the public file answered (video-scan-head.ts). Never the body. */
export type VideoHeadResult =
  | { ok: true; status: number; contentType: string | null; contentLength: number | null }
  | { ok: false; reason: "skipped" | "timeout" | "error" | "http"; status?: number };

/** What happens to the video after this failure (src/lib/video-scan-retry.ts), or "run_stopped" for a provider-wide one. */
export type VideoScanFailureOutcome = "retry" | "hold_for_admin" | "stop" | "run_stopped";

export type VideoScanFailureDiagnostic = {
  kind: VideoScanItemKind;
  id: string;
  /** 1-based number of this attempt (the row's videoScanAttempts + 1). */
  attempt: number;
  maxAttempts: number;
  /** src/lib/hive.ts HiveFailure. */
  failure: string;
  hiveStatus: number | null;
  hiveCode: string | null;
  hiveMessage: string | null;
  ext: string;
  host: string | null;
  durationS: number | null;
  sizeMB: number | null;
  contentType: string | null;
  /** "ok", "skipped", "timeout", "error" or "http_<status>". */
  head: string;
  outcome: VideoScanFailureOutcome;
};

/** One entry of the run's response summary. */
export type VideoScanFailureSummary = {
  kind: VideoScanItemKind;
  id: string;
  status: number | null;
  failure: string;
  ext: string;
  sizeMB: number | null;
  durationS: number | null;
  attempt: number;
  outcome: VideoScanFailureOutcome;
};

/** How many failures one run's response lists (the per-kind counts in videoFailures still count all of them). */
export const VIDEO_SCAN_FAILURE_SUMMARY_MAX = 10;

const MESSAGE_MAX_CHARS = 200;
const CODE_MAX_CHARS = 60;

/** Removes anything URL-like (Hive's error text can echo the media_url), collapses whitespace and caps the length. */
export function scrubDiagnosticText(text: string, max = MESSAGE_MAX_CHARS): string {
  const scrubbed = text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "<url>")
    .replace(/\bwww\.[^\s"'<>]+/gi, "<url>")
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed.length > max ? `${scrubbed.slice(0, max - 1)}…` : scrubbed;
}

function asCode(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return scrubDiagnosticText(value, CODE_MAX_CHARS);
  return null;
}

function asMessage(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? scrubDiagnosticText(value) : null;
}

/**
 * Hive's HTTP status, error code and message out of a HiveScan failure's `detail` ("HTTP 413 {...body...}", see
 * moderateVideo in src/lib/hive.ts; the body is capped there, so it may be cut-off JSON). A detail that isn't an HTTP
 * answer (an exception message) is only a message.
 */
export function parseHiveFailureDetail(detail: string | undefined | null): {
  status: number | null;
  code: string | null;
  message: string | null;
} {
  if (!detail) return { status: null, code: null, message: null };
  const http = /^HTTP (\d{3})(?:\s+([\s\S]*))?$/.exec(detail.trim());
  if (!http) return { status: null, code: null, message: asMessage(detail) };
  const status = Number(http[1]);
  const body = http[2]?.trim() ?? "";
  if (!body) return { status, code: null, message: null };
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const nested = obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
      const code = asCode(obj.code) ?? asCode(obj.error_code) ?? asCode(nested?.code) ?? asCode(obj.type);
      const message =
        asMessage(obj.message) ?? asMessage(obj.error) ?? asMessage(nested?.message) ?? asMessage(obj.detail);
      return { status, code, message: message ?? asMessage(body) };
    }
  } catch {
    // Not JSON (or cut off by the cap): the text itself is the message.
  }
  return { status, code: null, message: asMessage(body) };
}

/** The media file's extension (lowercase, or "none"/"other") and host, never the path or key. */
export function mediaUrlParts(url: string | null | undefined): { ext: string; host: string | null } {
  if (!url) return { ext: "none", host: null };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ext: "other", host: null };
  }
  const last = parsed.pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return { ext: "none", host: parsed.hostname || null };
  const ext = last.slice(dot + 1).toLowerCase();
  return { ext: /^[a-z0-9]{1,5}$/.test(ext) ? ext : "other", host: parsed.hostname || null };
}

/** Bytes as megabytes (1 MB = 1,000,000 bytes) to one decimal, or null. */
export function bytesToMB(bytes: number | null | undefined): number | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  return Math.round(bytes / 100_000) / 10;
}

/**
 * Whether `url` is a file under the app's own public media base (R2_PUBLIC_URL): the only URLs the cron will HEAD,
 * so a stored URL can never make the server call somewhere else. Same origin, and the path inside the base's path.
 */
export function isOwnPublicMediaUrl(url: string | null | undefined, publicBase: string | null | undefined): boolean {
  if (!url || !publicBase) return false;
  try {
    const target = new URL(url);
    const base = new URL(publicBase);
    if (target.protocol !== "https:" && target.protocol !== "http:") return false;
    if (target.origin !== base.origin) return false;
    if (target.username || target.password) return false;
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return target.pathname.startsWith(basePath) && target.pathname.length > basePath.length;
  } catch {
    return false;
  }
}

function headLabel(head: VideoHeadResult | null): string {
  if (!head) return "skipped";
  if (head.ok) return "ok";
  if (head.reason === "http") return `http_${head.status ?? "unknown"}`;
  return head.reason;
}

export function buildVideoScanFailureDiagnostic(input: {
  kind: VideoScanItemKind;
  id: string;
  failuresSoFar: number;
  maxAttempts: number;
  failure: string;
  detail?: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  head: VideoHeadResult | null;
  outcome: VideoScanFailureOutcome;
}): VideoScanFailureDiagnostic {
  const hive = parseHiveFailureDetail(input.detail);
  const { ext, host } = mediaUrlParts(input.videoUrl);
  const head = input.head;
  const contentType =
    head?.ok && head.contentType ? scrubDiagnosticText(head.contentType.split(";")[0].toLowerCase(), 60) : null;
  return {
    kind: input.kind,
    id: input.id,
    attempt: Math.max(0, input.failuresSoFar) + 1,
    maxAttempts: input.maxAttempts,
    failure: input.failure,
    hiveStatus: hive.status,
    hiveCode: hive.code,
    hiveMessage: hive.message,
    ext,
    host,
    durationS: typeof input.durationSeconds === "number" ? input.durationSeconds : null,
    sizeMB: head?.ok ? bytesToMB(head.contentLength) : null,
    contentType,
    head: headLabel(head),
    outcome: input.outcome,
  };
}

/** The console.error line. */
export function formatVideoScanFailureLog(d: VideoScanFailureDiagnostic): string {
  const hive = [
    d.failure,
    d.hiveStatus != null ? `HTTP ${d.hiveStatus}` : null,
    d.hiveCode ? `code ${d.hiveCode}` : null,
    d.hiveMessage ? `"${d.hiveMessage}"` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const file = [
    `.${d.ext}`,
    d.host ? `on ${d.host}` : null,
    d.sizeMB != null ? `${d.sizeMB} MB` : "size unknown",
    d.contentType ?? "type unknown",
    d.durationS != null ? `${d.durationS}s` : "duration unknown",
    d.head !== "ok" ? `head ${d.head}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `[moderate-videos] Hive could not scan ${d.kind} ${d.id} (attempt ${d.attempt}/${d.maxAttempts}; ${hive}) file: ${file}; next: ${d.outcome}`;
}

export function videoScanFailureSummary(d: VideoScanFailureDiagnostic): VideoScanFailureSummary {
  return {
    kind: d.kind,
    id: d.id,
    status: d.hiveStatus,
    failure: d.failure,
    ext: d.ext,
    sizeMB: d.sizeMB,
    durationS: d.durationS,
    attempt: d.attempt,
    outcome: d.outcome,
  };
}

/** Adds to the run's failures list, keeping at most VIDEO_SCAN_FAILURE_SUMMARY_MAX entries. */
export function pushFailureSummary(list: VideoScanFailureSummary[], d: VideoScanFailureDiagnostic): void {
  if (list.length < VIDEO_SCAN_FAILURE_SUMMARY_MAX) list.push(videoScanFailureSummary(d));
}

/**
 * The detail part of the admin hold's audit reason (src/lib/media-moderation-hold.ts videoScanFailedHoldAuditReason):
 * what the admin sees under "why". Uses ", " inside, because the reason's parts are separated by "; ".
 */
export function videoScanFailedHoldDetail(d: VideoScanFailureDiagnostic): string {
  const clean = (s: string) => s.replace(/;/g, ",");
  const hive = [
    `Hive ${d.failure}`,
    d.hiveStatus != null ? `HTTP ${d.hiveStatus}` : null,
    d.hiveCode ? `code ${clean(d.hiveCode)}` : null,
    d.hiveMessage ? `"${clean(d.hiveMessage)}"` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const file = [
    `.${d.ext}`,
    d.sizeMB != null ? `${d.sizeMB} MB` : "size unknown",
    d.contentType ? clean(d.contentType) : "type unknown",
    d.durationS != null ? `${d.durationS}s` : "duration unknown",
  ].join(", ");
  return `${hive}; failed ${d.attempt} of ${d.maxAttempts} attempts; file ${file}`;
}

/** Sentry `extra` for the failure: the same fields, flat. */
export function videoScanFailureContext(d: VideoScanFailureDiagnostic): Record<string, unknown> {
  return { ...d };
}
