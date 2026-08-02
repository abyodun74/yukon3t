import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export type UploadKind = "avatar" | "post-image" | "post-video" | "video-thumb";

const CONTENT_TYPE_ALLOWLIST: Record<UploadKind, Record<string, string>> = {
  avatar: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "post-image": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "video-thumb": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  "post-video": { "video/mp4": "mp4", "video/webm": "webm" },
};

export const MEDIA_LIMITS: Record<UploadKind, number> = {
  avatar: 5 * 1024 * 1024,
  "post-image": 8 * 1024 * 1024,
  "video-thumb": 3 * 1024 * 1024,
  "post-video": 30 * 1024 * 1024,
};

export const MAX_POST_IMAGES = 4;
export const MAX_VIDEO_DURATION_SECONDS = 60;

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

  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
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

/**
 * A presigned PUT URL alone can't cap the uploaded size, so this checks the
 * real object size after the client's direct upload and deletes it if it
 * exceeds the kind's limit — the actual server-side enforcement.
 */
export async function verifyUploadedSize({
  key,
  maxBytes,
}: {
  key: string;
  maxBytes: number;
}) {
  const bucket = process.env.R2_BUCKET_NAME!;
  const c = client();

  const head = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const size = head.ContentLength ?? 0;

  if (size === 0 || size > maxBytes) {
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return false;
  }
  return true;
}

export async function deleteObject(key: string) {
  if (!isStorageConfigured()) return;
  await client().send(
    new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
  );
}

export function keyFromPublicUrl(url: string) {
  const base = process.env.R2_PUBLIC_URL!.replace(/\/$/, "");
  return url.startsWith(base) ? url.slice(base.length + 1) : null;
}
