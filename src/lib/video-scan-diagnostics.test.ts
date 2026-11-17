import { describe, expect, it } from "vitest";
import {
  buildVideoScanFailureDiagnostic,
  bytesToMB,
  formatVideoScanFailureLog,
  isOwnPublicMediaUrl,
  mediaUrlParts,
  parseHiveFailureDetail,
  pushFailureSummary,
  scrubDiagnosticText,
  videoScanFailedHoldDetail,
  VIDEO_SCAN_FAILURE_SUMMARY_MAX,
  type VideoScanFailureSummary,
} from "@/lib/video-scan-diagnostics";

const URL_ = "https://media.example.com/post-video/cuser123/0f1e2d3c-aaaa-bbbb.MP4";

describe("parseHiveFailureDetail", () => {
  it("reads status, code and message from a JSON error body", () => {
    expect(
      parseHiveFailureDetail('HTTP 413 {"status_code":413,"code":"FILE_TOO_LARGE","message":"Media exceeds the limit"}'),
    ).toEqual({ status: 413, code: "FILE_TOO_LARGE", message: "Media exceeds the limit" });
  });

  it("reads a nested error object and a numeric code", () => {
    expect(parseHiveFailureDetail('HTTP 422 {"error":{"code":1007,"message":"unsupported codec"}}')).toEqual({
      status: 422,
      code: "1007",
      message: "unsupported codec",
    });
  });

  it("keeps a non-JSON or cut-off body as the message", () => {
    expect(parseHiveFailureDetail('HTTP 400 {"message":"could not decode med')).toEqual({
      status: 400,
      code: null,
      message: '{"message":"could not decode med',
    });
    expect(parseHiveFailureDetail("HTTP 415 Unsupported Media Type")).toEqual({
      status: 415,
      code: null,
      message: "Unsupported Media Type",
    });
  });

  it("handles a status with no body, no detail, and an exception message", () => {
    expect(parseHiveFailureDetail("HTTP 400")).toEqual({ status: 400, code: null, message: null });
    expect(parseHiveFailureDetail(undefined)).toEqual({ status: null, code: null, message: null });
    expect(parseHiveFailureDetail("boom")).toEqual({ status: null, code: null, message: "boom" });
  });

  it("never keeps a URL from Hive's error text", () => {
    const parsed = parseHiveFailureDetail(`HTTP 400 {"message":"Could not fetch ${URL_} (timeout)"}`);
    expect(parsed.message).toBe("Could not fetch <url> (timeout)");
    expect(JSON.stringify(parsed)).not.toContain("media.example.com");
  });
});

describe("scrubDiagnosticText", () => {
  it("removes URLs, collapses whitespace and caps the length", () => {
    expect(scrubDiagnosticText("a\n\n b  http://x.y/z?q=1 www.foo.com/bar")).toBe("a b <url> <url>");
    expect(scrubDiagnosticText("x".repeat(500), 20)).toHaveLength(20);
  });
});

describe("mediaUrlParts", () => {
  it("gives only the lowercase extension and the host", () => {
    expect(mediaUrlParts(URL_)).toEqual({ ext: "mp4", host: "media.example.com" });
  });

  it("copes with no extension, odd extensions, bad and missing URLs", () => {
    expect(mediaUrlParts("https://h.example/a/b")).toEqual({ ext: "none", host: "h.example" });
    expect(mediaUrlParts("https://h.example/a/b.verylongext")).toEqual({ ext: "other", host: "h.example" });
    expect(mediaUrlParts("not a url")).toEqual({ ext: "other", host: null });
    expect(mediaUrlParts(null)).toEqual({ ext: "none", host: null });
  });
});

describe("bytesToMB", () => {
  it("rounds to one decimal MB", () => {
    expect(bytesToMB(85_349_000)).toBe(85.3);
    expect(bytesToMB(0)).toBe(0);
    expect(bytesToMB(null)).toBeNull();
    expect(bytesToMB(-1)).toBeNull();
  });
});

describe("isOwnPublicMediaUrl", () => {
  const base = "https://media.example.com";
  it("accepts only files under the public media base", () => {
    expect(isOwnPublicMediaUrl(URL_, base)).toBe(true);
    expect(isOwnPublicMediaUrl(URL_, `${base}/`)).toBe(true);
    expect(isOwnPublicMediaUrl("https://evil.example/post-video/a.mp4", base)).toBe(false);
    expect(isOwnPublicMediaUrl("https://media.example.com.evil.example/a.mp4", base)).toBe(false);
    expect(isOwnPublicMediaUrl("https://user:pw@media.example.com/a.mp4", base)).toBe(false);
    expect(isOwnPublicMediaUrl("https://media.example.com/", base)).toBe(false);
    expect(isOwnPublicMediaUrl(URL_, undefined)).toBe(false);
    expect(isOwnPublicMediaUrl(null, base)).toBe(false);
  });

  it("respects a base with a path", () => {
    expect(isOwnPublicMediaUrl("https://cdn.example/media/a.mp4", "https://cdn.example/media")).toBe(true);
    expect(isOwnPublicMediaUrl("https://cdn.example/other/a.mp4", "https://cdn.example/media")).toBe(false);
  });
});

function diag(over: Partial<Parameters<typeof buildVideoScanFailureDiagnostic>[0]> = {}) {
  return buildVideoScanFailureDiagnostic({
    kind: "muse",
    id: "cmuse1",
    failuresSoFar: 5,
    maxAttempts: 6,
    failure: "rejected_media",
    detail: 'HTTP 413 {"code":"too_large","message":"file too large; max 50MB"}',
    videoUrl: URL_,
    durationSeconds: 42,
    head: { ok: true, status: 200, contentType: "video/mp4; codecs=avc1", contentLength: 85_349_000 },
    outcome: "hold_for_admin",
    ...over,
  });
}

describe("buildVideoScanFailureDiagnostic / formatVideoScanFailureLog", () => {
  it("carries the attempt, Hive's answer and the file facts, and nothing identifying beyond the id", () => {
    const d = diag();
    expect(d).toEqual({
      kind: "muse",
      id: "cmuse1",
      attempt: 6,
      maxAttempts: 6,
      failure: "rejected_media",
      hiveStatus: 413,
      hiveCode: "too_large",
      hiveMessage: "file too large; max 50MB",
      ext: "mp4",
      host: "media.example.com",
      durationS: 42,
      sizeMB: 85.3,
      contentType: "video/mp4",
      head: "ok",
      outcome: "hold_for_admin",
    });
    const line = formatVideoScanFailureLog(d);
    expect(line).toBe(
      '[moderate-videos] Hive could not scan muse cmuse1 (attempt 6/6; rejected_media, HTTP 413, code too_large, "file too large; max 50MB") file: .mp4, on media.example.com, 85.3 MB, video/mp4, 42s; next: hold_for_admin',
    );
    expect(line).not.toContain("cuser123");
    expect(line).not.toContain("https://");
  });

  it("says what is unknown when the HEAD didn't answer", () => {
    const d = diag({ head: { ok: false, reason: "timeout" }, durationSeconds: null, detail: undefined });
    expect(d.sizeMB).toBeNull();
    expect(d.head).toBe("timeout");
    expect(formatVideoScanFailureLog(d)).toContain("size unknown, type unknown, duration unknown, head timeout");
    expect(diag({ head: { ok: false, reason: "http", status: 404 } }).head).toBe("http_404");
    expect(diag({ head: null }).head).toBe("skipped");
  });
});

describe("videoScanFailedHoldDetail", () => {
  it("is a short admin-facing line with no '; ' inside Hive's own text", () => {
    expect(videoScanFailedHoldDetail(diag())).toBe(
      'Hive rejected_media, HTTP 413, code too_large, "file too large, max 50MB"; failed 6 of 6 attempts; file .mp4, 85.3 MB, video/mp4, 42s',
    );
  });
});

describe("pushFailureSummary", () => {
  it("lists at most VIDEO_SCAN_FAILURE_SUMMARY_MAX failures", () => {
    const list: VideoScanFailureSummary[] = [];
    for (let i = 0; i < VIDEO_SCAN_FAILURE_SUMMARY_MAX + 5; i++) pushFailureSummary(list, diag({ id: `c${i}` }));
    expect(list).toHaveLength(VIDEO_SCAN_FAILURE_SUMMARY_MAX);
    expect(list[0]).toEqual({
      kind: "muse",
      id: "c0",
      status: 413,
      failure: "rejected_media",
      ext: "mp4",
      sizeMB: 85.3,
      durationS: 42,
      attempt: 6,
      outcome: "hold_for_admin",
    });
  });
});
