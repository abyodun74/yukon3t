import { isOwnPublicMediaUrl, type VideoHeadResult } from "@/lib/video-scan-diagnostics";

/** Cap on the HEAD, so a slow storage answer can't hold up the cron run. */
export const VIDEO_HEAD_TIMEOUT_MS = 3_000;

/**
 * Size and content type of a video Hive couldn't scan, read with one HEAD of its public URL (what Hive itself fetches).
 * Only called on a failed scan, at most once per item per run, by the moderate-videos cron. Never downloads the file
 * (HEAD has no body), never throws, and only ever asks the app's own public media host (R2_PUBLIC_URL): any other URL
 * answers "skipped" without a request.
 */
export async function headVideoForDiagnostics(
  videoUrl: string | null,
  {
    publicBase = process.env.R2_PUBLIC_URL,
    timeoutMs = VIDEO_HEAD_TIMEOUT_MS,
    fetchImpl = fetch,
  }: { publicBase?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<VideoHeadResult> {
  if (!videoUrl || !isOwnPublicMediaUrl(videoUrl, publicBase)) return { ok: false, reason: "skipped" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(videoUrl, {
      method: "HEAD",
      signal: controller.signal,
      // A redirect could point anywhere; the public bucket doesn't redirect, so one is just reported.
      redirect: "manual",
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const length = res.headers.get("content-length");
    const parsedLength = length != null && /^\d+$/.test(length.trim()) ? Number(length.trim()) : null;
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: parsedLength,
    };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}
