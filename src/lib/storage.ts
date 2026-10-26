import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

export type UploadKind =
  | "avatar"
  | "post-image"
  | "post-video"
  | "video-thumb"
  | "message-audio"
  | "message-video"
  | "message-image"
  | "circle-cover"
  | "story-image"
  | "story-video"
  | "ad-image"
  | "ad-video"
  | "collab-material"
  | "voice-dictation"
  | "comment-audio"
  | "comment-video"
  | "muse-video"
  | "muse-audio"
  // Ambient presence groundwork (see actions/ambient.ts) — a single photo,
  // same allowlist/size cap as story-image, since it's the same "casual
  // phone photo" use case, not a polished-post-grade upload.
  | "ambient-image"
  // Admin-only "what's new" post media (actions/announcements.ts) — a
  // screenshot or short demo clip attached to an announcement, same
  // allowlist/size caps as the ad-image/ad-video kinds (same "one piece of
  // promotional-ish media" shape), not post-grade's gif/multi-photo needs.
  | "announcement-image"
  | "announcement-video";

const CONTENT_TYPE_ALLOWLIST: Record<UploadKind, Record<string, string>> = {
  avatar: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  // gif here (not on avatar/circle-cover/story-image/ad-image) matches
  // exactly where the client actually offers it: post-composer.tsx and
  // chat-thread.tsx's paste/picker handlers, for a real animated GIF file
  // (as opposed to the separate pendingGif/gifUrl field, a Giphy CDN URL
  // that's never uploaded here at all — see validations.ts's "GIF"
  // mediaType, which is that path, not this one). Rendered the same as any
  // other IMAGE mediaType (a plain <img src>), which animates a GIF natively
  // with no special-case needed there.
  "post-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" },
  "circle-cover": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "video-thumb": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "post-video": { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  "message-audio": { "audio/webm": "webm" },
  "voice-dictation": { "audio/webm": "webm" },
  "comment-audio": { "audio/webm": "webm" },
  "comment-video": { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  // Recorded voice/video notes are always webm (MediaRecorder's output);
  // mp4 is here too because "attach from device" lets a user pick a video
  // their phone actually recorded, which is virtually always mp4 — or, from
  // an iPhone, QuickTime (.mov, "video/quicktime": what iOS hands the file
  // picker). Every video kind below accepts .mov for the same reason.
  "message-video": { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  "message-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" },
  "story-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "ambient-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "story-video": { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  "muse-video": { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  // Broader than message/comment audio's webm-only allowlist (those are
  // always a live MediaRecorder capture) — this is a "pick a sound" file
  // picker, most often an existing music/audio file from the device, so it
  // needs to accept the common formats those actually come in as.
  "muse-audio": { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/webm": "webm" },
  "ad-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "ad-video": { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  "announcement-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "announcement-video": { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  // Material shared into a Collab session's chat — documents in addition to
  // the image types every other image kind already allows, since a shared
  // "material" is as often a PDF/slide deck as it is a photo.
  "collab-material": {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  },
};

// Every video kind shares one byte cap — durations (MAX_*_SECONDS below)
// are what actually keep message/story clips short in practice. 2GB
// comfortably fits large phone-recorded 4K clips well beyond the old 500MB
// cap, which users were bumping into on longer/higher-bitrate footage.
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;

export const MEDIA_LIMITS: Record<UploadKind, number> = {
  avatar: 12 * 1024 * 1024,
  "post-image": 25 * 1024 * 1024,
  "video-thumb": 3 * 1024 * 1024,
  "post-video": MAX_VIDEO_BYTES,
  "message-audio": 5 * 1024 * 1024,
  "message-video": MAX_VIDEO_BYTES,
  "message-image": 25 * 1024 * 1024,
  "circle-cover": 12 * 1024 * 1024,
  "story-image": 25 * 1024 * 1024,
  "ambient-image": 25 * 1024 * 1024,
  "story-video": MAX_VIDEO_BYTES,
  "ad-image": 25 * 1024 * 1024,
  "ad-video": MAX_VIDEO_BYTES,
  "announcement-image": 25 * 1024 * 1024,
  "announcement-video": MAX_VIDEO_BYTES,
  "collab-material": 25 * 1024 * 1024,
  // Short-lived speech-to-text clips (record -> transcribe -> delete) —
  // smaller than message-audio's 5MB since these never persist past the
  // transcribeAudio action itself.
  "voice-dictation": 3 * 1024 * 1024,
  // Same cap as message-audio — same recorder (AudioRecorderModal), same
  // realistic clip length.
  "comment-audio": 5 * 1024 * 1024,
  // Full parity with post-video (same byte cap, same duration ceiling,
  // same moderation pipeline) — a video comment is held to the exact same
  // safety bar as a video post, not a lighter-weight variant.
  "comment-video": MAX_VIDEO_BYTES,
  // Same shared byte cap as every other video kind — MAX_MUSE_VIDEO_DURATION_SECONDS
  // below is what actually keeps a Muse short, not this.
  "muse-video": MAX_VIDEO_BYTES,
  // A 60s clip (the same ceiling a Muse video is held to) comfortably fits
  // even a high-bitrate mp3 well under this — same cap as message-audio/
  // comment-audio, which cover a similar realistic clip length.
  "muse-audio": 5 * 1024 * 1024,
};

const VIDEO_KINDS: ReadonlySet<UploadKind> = new Set([
  "post-video",
  "message-video",
  "story-video",
  "ad-video",
  "comment-video",
  "muse-video",
  "announcement-video",
]);

// Matches post-composer.tsx's MAX_UPLOAD_VIDEO_SECONDS — the ceiling for a
// picked-from-device post video. Recording (MAX_RECORD_VIDEO_SECONDS) stays
// short separately; it's bounded by in-browser MediaRecorder memory, not
// this.
export const MAX_VIDEO_DURATION_SECONDS = 3600;
// Hive's Visual Moderation API (src/lib/hive.ts) only scans up to 60s of
// video content per call — a hard technical ceiling, not a policy choice.
// A post video longer than this can't get the automated body scan, so
// createPost (actions/circles.ts) routes it to moderationStatus FLAGGED for
// manual admin review instead of publishing immediately, and marks it
// videoModeratedAt up front so the moderate-videos cron never picks it up
// and wastes/fails a Hive call on it.
export const HIVE_VIDEO_MODERATION_MAX_SECONDS = 60;
// Post videos from HIVE_VIDEO_MODERATION_MAX_SECONDS up to this ceiling
// publish immediately (moderationStatus PUBLISHED) instead of staying
// FLAGGED/hidden — same "publish now, react if the background check finds
// something" model the sub-60s Hive path already uses, rather than a real
// upfront review gate. createPost still kicks off the same Cloudflare
// Stream long-form review (videoLongReviewNeeded) for anything in this
// range; a violation found after the fact is removed the same way a
// FLAGGED-and-cleared-late video always was. Only videos longer than this
// still publish hidden pending that review, on the theory that something
// long enough to sit unreviewed-but-visible for several minutes warrants
// the more conservative default. A deliberate product choice, not a Hive
// API constraint like the constant above.
export const VIDEO_INSTANT_PUBLISH_MAX_SECONDS = 600;
export const MAX_AUDIO_NOTE_SECONDS = 60;
export const MAX_VIDEO_NOTE_SECONDS = 30;
export const MAX_DICTATION_SECONDS = 120;
export const MAX_STORY_VIDEO_SECONDS = 120;
// A "what's new" demo clip, not a full video post — same ceiling as a Story.
export const MAX_ANNOUNCEMENT_VIDEO_SECONDS = 120;
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
// A Muse can run up to 5 minutes — well past Hive's HIVE_VIDEO_MODERATION_MAX_SECONDS
// scan limit above, so (as of createMuse's videoNeedsManualReview fork) a
// Muse over that cap now goes through the same Cloudflare Stream long-form
// review pipeline (videoStreamUid/videoLongReviewClaimedAt) Post/Comment
// already use, driven by the moderate-long-videos cron — see Muse's own
// schema.prisma doc comment.
export const MAX_MUSE_VIDEO_DURATION_SECONDS = 300;

export function isStorageConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_PUBLIC_URL,
  );
}

// Reused across calls within a warm serverless instance instead of a fresh
// S3Client per call — each one otherwise re-negotiates its own TLS
// connection to R2, which was adding a full extra handshake to every HEAD/
// PUT/DELETE, most noticeably when a request does more than one of these
// back to back (e.g. verifying a video and its thumbnail).
let cachedClient: S3Client | null = null;

function client() {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: "auto",
    // R2_ENDPOINT only exists so tests can point the SDK at a local S3 stand-in; production never sets it.
    endpoint: process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // Cloudflare's documented setting for R2 with AWS SDK v3 >= 3.729: only add request/response checksums when an
    // operation requires one, instead of by default (R2 doesn't implement the SDK's default trailing checksums).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // Path-style (endpoint/bucket/key) instead of the SDK's default
    // virtual-hosted-style (bucket.endpoint/key) — keeps the presigned URL's
    // host exactly matching what the CSP connect-src in src/proxy.ts allows.
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return cachedClient;
}

export function validateContentType(kind: UploadKind, contentType: string) {
  const ext = CONTENT_TYPE_ALLOWLIST[kind][contentType];
  return ext ?? null;
}

export async function createUploadUrl({
  kind,
  contentType,
  userId,
}: {
  kind: UploadKind;
  contentType: string;
  userId: string;
}) {
  if (!isStorageConfigured()) {
    throw new Error("not_configured");
  }
  const ext = validateContentType(kind, contentType);
  if (!ext) {
    throw new Error("invalid_content_type");
  }

  const key = `${kind}/${userId}/${randomUUID()}.${ext}`;
  const bucket = process.env.R2_BUCKET_NAME!;

  // 2GB (MAX_VIDEO_BYTES) over a slow mobile upload can take well past an
  // hour, independent of the 60s content-duration cap — a short clip can
  // still be a large, high-bitrate file. A video kind gets a longer-lived
  // presigned URL so the PUT (plus its retries, see PUT_ATTEMPTS_VIDEO in
  // upload-client.ts, which all reuse this same URL rather than requesting
  // a fresh one) don't start failing partway through on a slow connection.
  // Non-video kinds stay at 5 minutes.
  const expiresIn = VIDEO_KINDS.has(kind) ? 21_600 : 300;
  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  );

  const publicUrl = `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;

  return { uploadUrl, publicUrl, key };
}

/** Server-side direct upload (as opposed to createUploadUrl's client-driven presigned PUT) — used when the bytes originate on the server itself, e.g. an image fetched from a URL the user pasted in. */
export async function uploadBuffer({
  kind,
  contentType,
  userId,
  body,
}: {
  kind: UploadKind;
  contentType: string;
  userId: string;
  body: Uint8Array;
}) {
  if (!isStorageConfigured()) {
    throw new Error("not_configured");
  }
  const ext = validateContentType(kind, contentType);
  if (!ext) {
    throw new Error("invalid_content_type");
  }

  const key = `${kind}/${userId}/${randomUUID()}.${ext}`;
  const bucket = process.env.R2_BUCKET_NAME!;

  await client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, Body: body }),
  );

  const publicUrl = `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
  return { publicUrl, key };
}

// Keys are always minted by createUploadUrl/uploadBuffer as
// `${kind}/${userId}/${uuid}.${ext}` — the second path segment is the owner.
// Every action that accepts a client-supplied key/URL for an upload it's
// about to inspect or delete must check this before touching R2, otherwise
// a user can submit someone else's public media URL through their own
// confirm/cleanup flow and use it to probe or delete a stranger's object.
export function keyBelongsToOwner(key: string, ownerId: string) {
  return key.split("/")[1] === ownerId;
}

/**
 * A presigned PUT URL alone can't cap the uploaded size, so this checks the
 * real object size after the client's direct upload and deletes it if it
 * exceeds the kind's limit — the actual server-side enforcement. Also the
 * one place ownership of a client-supplied key is enforced before any R2
 * call is made for it.
 */
export async function verifyUploadedSize(input: { key: string; maxBytes: number; ownerId: string }) {
  return (await checkUploadedSize(input)) === "ok";
}

/**
 * verifyUploadedSize's answer with the reason kept, for a caller that must not tell someone their file was too large
 * (or broke a rule) when the real cause was on our side:
 *  - "ok": present, non-empty, within the limit.
 *  - "too_large": over the limit, or empty. Deleted, as verifyUploadedSize always did.
 *  - "not_owner": the key isn't the caller's. No R2 call was made.
 *  - "missing": R2 has no such object (the upload never finished, or it was already cleaned up).
 *  - "unavailable": R2 couldn't be asked (outage, timeout, credentials). Nothing was deleted: the file may be fine.
 */
export type UploadedSizeCheck = "ok" | "too_large" | "not_owner" | "missing" | "unavailable";

export async function checkUploadedSize({
  key,
  maxBytes,
  ownerId,
}: {
  key: string;
  maxBytes: number;
  ownerId: string;
}): Promise<UploadedSizeCheck> {
  if (!keyBelongsToOwner(key, ownerId)) {
    return "not_owner";
  }

  const bucket = process.env.R2_BUCKET_NAME!;
  const c = client();

  try {
    const head = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const size = head.ContentLength ?? 0;

    if (size === 0 || size > maxBytes) {
      await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch((err) => {
        console.error(`[storage] failed to delete oversized object ${key}`, err);
      });
      return "too_large";
    }
    return "ok";
  } catch (err) {
    // A transient R2 outage here shouldn't turn into a 500 on an otherwise
    // normal upload confirmation — fail closed (the upload is not accepted)
    // rather than letting the exception propagate.
    const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
    if (status === 404 || (err as { name?: string } | null)?.name === "NotFound") {
      return "missing";
    }
    console.error(`[storage] failed to verify uploaded size for ${key}`, err);
    return "unavailable";
  }
}

/** The worst of several checks of one submission's files: a size problem outranks a missing file, which outranks an R2 failure. */
export function worstUploadedSizeCheck(checks: UploadedSizeCheck[]): UploadedSizeCheck {
  const order: UploadedSizeCheck[] = ["too_large", "not_owner", "missing", "unavailable"];
  return order.find((outcome) => checks.includes(outcome)) ?? "ok";
}

/**
 * Downloads an owned object's bytes for server-side processing (e.g. handing
 * a recorded clip to Whisper) — the caller already has the raw key, so this
 * skips the SSRF-guarded public-URL fetch machinery (fetch-remote-image.ts)
 * that's built for arbitrary user-pasted URLs, not our own bucket. Callers
 * must have already confirmed ownership (e.g. via verifyUploadedSize) before
 * calling this — it does not repeat that check itself.
 */
export async function downloadObject(
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const bucket = process.env.R2_BUCKET_NAME!;

  try {
    const object = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!object.Body) return null;
    const body = await object.Body.transformToByteArray();
    return { body, contentType: object.ContentType ?? "application/octet-stream" };
  } catch (err) {
    console.error(`[storage] failed to download object ${key}`, err);
    return null;
  }
}

/**
 * Best-effort: every call site either runs this as post-mutation storage
 * hygiene (the DB write it's cleaning up after already succeeded) or as
 * cleanup for a rejected upload that was never referenced by any row — in
 * both cases a transient R2 hiccup here should leave a harmlessly orphaned
 * object behind, not turn an otherwise-successful request into a 500.
 */
export async function deleteObject(key: string) {
  if (!isStorageConfigured()) return;
  try {
    await client().send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
    );
  } catch (err) {
    console.error(`[storage] failed to delete object ${key}`, err);
  }
}

/**
 * Same as deleteObject, but only deletes if the key was actually issued to
 * ownerId — used by "cleanup a rejected upload" paths, which otherwise take
 * a batch of client-supplied URLs and delete all of them unconditionally.
 * Without this check, a user could smuggle a stranger's real media URL into
 * their own post/message/story submission (alongside their own, deliberately
 * oversized upload) and have the resulting cleanup delete the stranger's
 * object for them.
 */
export async function deleteOwnedObject(key: string, ownerId: string) {
  if (!keyBelongsToOwner(key, ownerId)) return;
  await deleteObject(key);
}

/** Size of each part of a browser-side multipart video upload. R2 requires every part except the last to be the same size. */
const MULTIPART_PART_BYTES = 16 * 1024 * 1024;
/** Videos smaller than this are still sent as one PUT — the extra round trips only pay off for big files. */
export const MULTIPART_MIN_FILE_BYTES = 32 * 1024 * 1024;

/** Whether `kind` is one of the video upload kinds (the only ones eligible for multipart). */
export function isVideoKind(kind: string): kind is UploadKind {
  return VIDEO_KINDS.has(kind as UploadKind);
}

/** How many parts a file of `sizeBytes` is split into. */
export function multipartPartCount(sizeBytes: number, partBytes = MULTIPART_PART_BYTES) {
  return Math.max(1, Math.ceil(sizeBytes / partBytes));
}

/**
 * Starts a multipart upload the browser fills in directly: returns one presigned PUT URL per part. The browser can
 * send parts in parallel and re-send just a failed part, instead of restarting a whole multi-hundred-MB file after
 * one dropped connection. Ownership and content-type checks are the same as createUploadUrl.
 */
export async function createMultipartUpload({
  kind,
  contentType,
  userId,
  sizeBytes,
}: {
  kind: UploadKind;
  contentType: string;
  userId: string;
  sizeBytes: number;
}) {
  if (!isStorageConfigured()) throw new Error("not_configured");
  const ext = validateContentType(kind, contentType);
  if (!ext || !isVideoKind(kind)) throw new Error("invalid_content_type");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MEDIA_LIMITS[kind]) throw new Error("invalid_size");

  const bucket = process.env.R2_BUCKET_NAME!;
  const key = `${kind}/${userId}/${randomUUID()}.${ext}`;
  const created = await client().send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error("multipart_start_failed");

  const partCount = multipartPartCount(sizeBytes);
  const partUrls = await Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      getSignedUrl(client(), new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: i + 1 }), {
        expiresIn: 21_600,
      }),
    ),
  );
  const publicUrl = `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
  return { key, uploadId, partSize: MULTIPART_PART_BYTES, partUrls, publicUrl };
}

/**
 * Finishes a multipart upload once the browser has sent every part. The part ETags come from R2's own part list
 * (not from the browser), so this needs no CORS change to expose the ETag header. Refuses to assemble anything that
 * is missing a part or that adds up to more than the kind's size cap, and aborts the upload in those cases.
 */
export async function completeMultipartUpload({
  key,
  uploadId,
  partCount,
}: {
  key: string;
  uploadId: string;
  partCount: number;
}) {
  const kind = key.split("/")[0];
  if (!isVideoKind(kind)) throw new Error("invalid_key");
  const bucket = process.env.R2_BUCKET_NAME!;
  const c = client();

  const parts: { PartNumber: number; ETag: string; Size: number }[] = [];
  let marker: string | undefined;
  for (;;) {
    const page = await c.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
    for (const p of page.Parts ?? []) {
      if (p.PartNumber && p.ETag) parts.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size ?? 0 });
    }
    if (!page.IsTruncated) break;
    marker = page.NextPartNumberMarker;
    if (!marker) break;
  }
  parts.sort((a, b) => a.PartNumber - b.PartNumber);

  const total = parts.reduce((sum, p) => sum + p.Size, 0);
  const complete = parts.length === partCount && parts.every((p, i) => p.PartNumber === i + 1);
  if (!complete || total <= 0 || total > MEDIA_LIMITS[kind]) {
    await c.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })).catch(() => {});
    throw new Error(complete ? "invalid_size" : "incomplete_parts");
  }

  await c.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
    }),
  );
}

/** Best-effort: discards a multipart upload the browser gave up on, so its parts don't sit in the bucket. */
export async function abortMultipartUpload({ key, uploadId }: { key: string; uploadId: string }) {
  if (!isStorageConfigured()) return;
  await client()
    .send(new AbortMultipartUploadCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key, UploadId: uploadId }))
    .catch((err) => console.error(`[storage] failed to abort multipart upload for ${key}`, err));
}

/**
 * Streams `body` into R2 under `key` as a multipart upload — for server-side
 * copies of large files (the converted MP4 coming back from Cloudflare Stream,
 * see video-convert.ts) that must not be buffered in memory. Returns the
 * object's public URL. Aborts cleanly (no half-written object) on error or when
 * `signal` fires.
 */
export async function uploadStream({
  key,
  body,
  contentType,
  signal,
}: {
  key: string;
  body: Readable;
  contentType: string;
  signal?: AbortSignal;
}) {
  const upload = new Upload({
    client: client(),
    params: { Bucket: process.env.R2_BUCKET_NAME!, Key: key, Body: body, ContentType: contentType },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });
  signal?.addEventListener("abort", () => void upload.abort(), { once: true });
  await upload.done();
  return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
}

// --- Private bucket ("for your eyes only" view-once media) --------------------
// A second bucket with NO public domain: nothing in it has a URL, and the only way to its bytes is a short-lived
// presigned GET minted here. Same account and credentials as the public bucket. See app/actions/view-once.ts.

export function isViewOnceConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_PRIVATE_BUCKET_NAME,
  );
}

/**
 * The namespaces a browser uploads into. Deliberately not the ones a file is kept in (viewOnceFinalKey, and the
 * avatar bucket's `avatar/…` keys): those are only ever written by a server-side copy. "avatar-upload" lives in the
 * avatar bucket (R2_AVATAR_BUCKET_NAME), the others in the view-once bucket.
 */
export type PrivateObjectPurpose = "view-once" | "view-once-frame" | "avatar-upload";

/** `${purpose}/${uploaderId}/${uuid}.${ext}` — server-generated and unguessable, with the uploader in the path like every public key. */
export function privateObjectKey(purpose: PrivateObjectPurpose, userId: string, ext: string) {
  return `${purpose}/${userId}/${randomUUID()}.${ext}`;
}

/**
 * `view-once-final/${conversationId}/${uuid}.${ext}` — where a view-once file lives once it has been sent. Chosen by
 * the server at send time and never given to a browser, and no upload URL is ever minted for this namespace, so the
 * sender's still-valid presigned PUT (which is for their own `view-once/…` key) cannot overwrite it.
 */
export function viewOnceFinalKey(conversationId: string, ext: string) {
  return `view-once-final/${conversationId}/${randomUUID()}.${ext}`;
}

/**
 * A client-supplied private key must be checked with this before any R2 call is made for it. Only an upload
 * namespace can pass: a `view-once-final/…` key is never accepted from a client.
 */
export function isPrivateKeyOwnedBy(key: string, purpose: PrivateObjectPurpose, ownerId: string) {
  const parts = key.split("/");
  return parts.length === 3 && parts[0] === purpose && parts[1] === ownerId && /^[0-9a-f-]{36}\.[a-z0-9]+$/.test(parts[2]);
}

export async function createPrivateUploadUrl({
  purpose,
  userId,
  contentType,
  ext,
  expiresIn,
}: {
  purpose: PrivateObjectPurpose;
  userId: string;
  contentType: string;
  ext: string;
  expiresIn: number;
}) {
  if (!isViewOnceConfigured()) throw new Error("not_configured");
  const key = privateObjectKey(purpose, userId, ext);
  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: process.env.R2_PRIVATE_BUCKET_NAME!, Key: key, ContentType: contentType }),
    { expiresIn },
  );
  return { uploadUrl, key };
}

/** A GET link to one private object, valid for `ttlSeconds`. Whoever holds it can read the object until then. */
export async function createPrivateDownloadUrl(key: string, ttlSeconds: number) {
  if (!isViewOnceConfigured()) throw new Error("not_configured");
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: process.env.R2_PRIVATE_BUCKET_NAME!,
      Key: key,
      ResponseCacheControl: "no-store",
    }),
    { expiresIn: ttlSeconds },
  );
}

/**
 * Size and content type of a private object. `null` means it does not exist; any other failure throws, so a caller
 * deciding "is the file gone?" never mistakes an R2 outage for a yes.
 */
export async function headPrivateObject(
  key: string,
): Promise<{ size: number; contentType: string; etag: string } | null> {
  if (!isViewOnceConfigured()) throw new Error("not_configured");
  try {
    const head = await client().send(new HeadObjectCommand({ Bucket: process.env.R2_PRIVATE_BUCKET_NAME!, Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? "", etag: head.ETag ?? "" };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}

/** Server-side copy inside the private bucket; the content type comes along with the bytes. Throws on failure. */
export async function copyPrivateObject(sourceKey: string, destinationKey: string) {
  if (!isViewOnceConfigured()) throw new Error("not_configured");
  const bucket = process.env.R2_PRIVATE_BUCKET_NAME!;
  await client().send(
    new CopyObjectCommand({ Bucket: bucket, Key: destinationKey, CopySource: `${bucket}/${sourceKey}` }),
  );
}

/**
 * Deletes a private object and says whether R2 confirmed it (deleting a key that is already gone counts). Unlike
 * deleteObject this reports failure: the caller keeps its record of the key until the delete has really happened,
 * so the sweep can try again.
 */
export async function deletePrivateObject(key: string): Promise<boolean> {
  if (!isViewOnceConfigured()) return false;
  try {
    await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_PRIVATE_BUCKET_NAME!, Key: key }));
    return true;
  } catch (err) {
    console.error(`[storage] failed to delete private object ${key}`, err);
    return false;
  }
}

export function keyFromPublicUrl(url: string) {
  const base = process.env.R2_PUBLIC_URL!.replace(/\/$/, "");
  return url.startsWith(base) ? url.slice(base.length + 1) : null;
}

/** The public URL createUploadUrl hands out for `key` — derived on the server rather than trusted from a client. */
export function publicUrlForKey(key: string) {
  return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
}

// --- Private avatar bucket (AVATAR_PRIVATE, see src/lib/avatar-url.ts and CLAUDE.md "Profile pictures") ----------
// A THIRD bucket, not the view-once one: that bucket's required 15-day lifecycle rule deletes everything in it, which
// would silently wipe every profile picture two weeks after it was set. Same account and credentials, no public
// domain; the only way to its bytes is a presigned GET minted here (by /api/avatar/… for signed-in users).

export function isAvatarBucketConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_AVATAR_BUCKET_NAME,
  );
}

let warnedAvatarFlagWithoutBucket = false;

/**
 * Whether NEW profile pictures go to the private avatar bucket. Off unless AVATAR_PRIVATE=1 AND the bucket is
 * configured; the flag without the bucket is inert (logged once), so a half-configured deploy keeps today's public
 * uploads instead of breaking them. Serving already-private avatars doesn't depend on this, only on the bucket, so
 * turning the flag back off never breaks a picture uploaded while it was on.
 */
export function isAvatarPrivateUploadEnabled() {
  if (process.env.AVATAR_PRIVATE !== "1") return false;
  if (isAvatarBucketConfigured()) return true;
  if (!warnedAvatarFlagWithoutBucket) {
    warnedAvatarFlagWithoutBucket = true;
    console.error("[storage] AVATAR_PRIVATE=1 but R2_AVATAR_BUCKET_NAME is not set; profile pictures stay public");
  }
  return false;
}

function avatarBucket() {
  if (!isAvatarBucketConfigured()) throw new Error("not_configured");
  return process.env.R2_AVATAR_BUCKET_NAME!;
}

/** A presigned PUT for one avatar upload key (`avatar-upload/<userId>/<uuid>.<ext>`), valid 5 minutes like createUploadUrl's. */
export async function createAvatarUploadUrl({ userId, contentType }: { userId: string; contentType: string }) {
  const ext = validateContentType("avatar", contentType);
  if (!ext) throw new Error("invalid_content_type");
  const key = privateObjectKey("avatar-upload", userId, ext);
  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: avatarBucket(), Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );
  return { uploadUrl, key };
}

/**
 * A presigned GET for one avatar object. `signingDate` lets the route sign as of the start of the hour so the URL is
 * the same for the whole hour (avatarPresignSigningDate); `cacheControl` is what R2 answers the image with.
 */
export async function presignAvatarGet(
  key: string,
  { expiresIn, signingDate, cacheControl }: { expiresIn: number; signingDate?: Date; cacheControl: string },
) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: avatarBucket(), Key: key, ResponseCacheControl: cacheControl }),
    { expiresIn, ...(signingDate ? { signingDate } : {}) },
  );
}

/** Size and content type of an avatar-bucket object; null if it does not exist. Any other failure throws. */
export async function headAvatarObject(key: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const head = await client().send(new HeadObjectCommand({ Bucket: avatarBucket(), Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? "" };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}

/** Server-side copy inside the avatar bucket (upload key → served key). Throws on failure. */
export async function copyAvatarObject(sourceKey: string, destinationKey: string) {
  const bucket = avatarBucket();
  await client().send(new CopyObjectCommand({ Bucket: bucket, Key: destinationKey, CopySource: `${bucket}/${sourceKey}` }));
}

/** Writes bytes to an avatar-bucket key (the backfill's copy from the public bucket). Throws on failure. */
export async function putAvatarObject(key: string, body: Uint8Array, contentType: string) {
  await client().send(new PutObjectCommand({ Bucket: avatarBucket(), Key: key, Body: body, ContentType: contentType }));
}

/** Best-effort delete of an avatar-bucket object; says whether R2 confirmed it. Never throws. */
export async function deleteAvatarObject(key: string): Promise<boolean> {
  if (!isAvatarBucketConfigured()) return false;
  try {
    await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_AVATAR_BUCKET_NAME!, Key: key }));
    return true;
  } catch (err) {
    console.error(`[storage] failed to delete avatar object ${key}`, err);
    return false;
  }
}
