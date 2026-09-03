import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
  | "voice-dictation";

const CONTENT_TYPE_ALLOWLIST: Record<UploadKind, Record<string, string>> = {
  avatar: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "post-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "circle-cover": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "video-thumb": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "post-video": { "video/mp4": "mp4", "video/webm": "webm" },
  "message-audio": { "audio/webm": "webm" },
  "voice-dictation": { "audio/webm": "webm" },
  // Recorded voice/video notes are always webm (MediaRecorder's output);
  // mp4 is here too because "attach from device" lets a user pick a video
  // their phone actually recorded, which is virtually always mp4.
  "message-video": { "video/mp4": "mp4", "video/webm": "webm" },
  "message-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "story-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "story-video": { "video/mp4": "mp4", "video/webm": "webm" },
  "ad-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "ad-video": { "video/mp4": "mp4", "video/webm": "webm" },
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
  "story-video": MAX_VIDEO_BYTES,
  "ad-image": 25 * 1024 * 1024,
  "ad-video": MAX_VIDEO_BYTES,
  "collab-material": 25 * 1024 * 1024,
  // Short-lived speech-to-text clips (record -> transcribe -> delete) —
  // smaller than message-audio's 5MB since these never persist past the
  // transcribeAudio action itself.
  "voice-dictation": 3 * 1024 * 1024,
};

const VIDEO_KINDS: ReadonlySet<UploadKind> = new Set([
  "post-video",
  "message-video",
  "story-video",
  "ad-video",
]);

export const MAX_POST_IMAGES = 10;
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
export const MAX_AUDIO_NOTE_SECONDS = 60;
export const MAX_VIDEO_NOTE_SECONDS = 30;
export const MAX_DICTATION_SECONDS = 120;
export const MAX_STORY_VIDEO_SECONDS = 120;
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

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
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
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
export async function verifyUploadedSize({
  key,
  maxBytes,
  ownerId,
}: {
  key: string;
  maxBytes: number;
  ownerId: string;
}) {
  if (!keyBelongsToOwner(key, ownerId)) {
    return false;
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
      return false;
    }
    return true;
  } catch (err) {
    // A transient R2 outage here shouldn't turn into a 500 on an otherwise
    // normal upload confirmation — fail closed (treat as unverifiable, same
    // as "too large") rather than letting the exception propagate.
    console.error(`[storage] failed to verify uploaded size for ${key}`, err);
    return false;
  }
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

export function keyFromPublicUrl(url: string) {
  const base = process.env.R2_PUBLIC_URL!.replace(/\/$/, "");
  return url.startsWith(base) ? url.slice(base.length + 1) : null;
}
