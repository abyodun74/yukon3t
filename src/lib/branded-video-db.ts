import { Readable } from "node:stream";
import { createStreamCopy, deleteStreamVideo, getMp4Download, getStreamStatus, requestMp4Download } from "@/lib/cloudflare-stream";
import { keyFromPublicUrl, uploadStream } from "@/lib/storage";
import { MAX_BRANDED_BYTES, type BrandingDeps } from "@/lib/branded-video";

/** Streams the branded MP4 from Cloudflare into R2 — never buffered in memory. `signal` bounds one attempt to this tick's/request's time budget. */
async function copyDownloadToR2(downloadUrl: string, key: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(downloadUrl, { cache: "no-store", signal });
  if (!res.ok || !res.body) throw new Error(`download_${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BRANDED_BYTES) throw new Error("too_large");
  return uploadStream({
    key,
    body: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    contentType: "video/mp4",
    signal,
  });
}

/** The real dependencies for advanceBranding. `signal` cuts a long copy off when the caller's own time budget runs out. */
export function productionBrandingDeps(signal: AbortSignal, watermarkUid: string): BrandingDeps {
  return {
    createStreamCopy,
    getStreamStatus,
    requestMp4Download,
    getMp4Download,
    deleteStreamVideo,
    keyFromPublicUrl,
    copyToR2: (downloadUrl, key) => copyDownloadToR2(downloadUrl, key, signal),
    watermarkUid,
  };
}
