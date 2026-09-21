"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateImage } from "@/lib/moderation";
import { recomputeTrustScore } from "@/lib/trust";
import {
  createUploadUrl,
  isStorageConfigured,
  MEDIA_LIMITS,
  verifyUploadedSize,
  deleteObject,
  deleteOwnedObject,
  keyFromPublicUrl,
  uploadBuffer,
  keyBelongsToOwner,
  createMultipartUpload,
  completeMultipartUpload as completeMultipart,
  abortMultipartUpload as abortMultipart,
} from "@/lib/storage";
import {
  requestUploadSchema,
  requestUploadBatchSchema,
  startMultipartSchema,
  multipartRefSchema,
  completeMultipartSchema,
  confirmAvatarUploadSchema,
  imageFromUrlSchema,
} from "@/lib/validations";
import { fetchRemoteImage } from "@/lib/fetch-remote-image";
import { recordUploads } from "@/lib/upload-records";

export async function requestUploadUrl(formData: FormData) {
  const user = await requireVerifiedUser();

  if (!isStorageConfigured()) {
    return { error: "not_configured" as const };
  }

  const allowed = await checkRateLimit("mediaUpload", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = requestUploadSchema.safeParse({
    kind: formData.get("kind"),
    contentType: formData.get("contentType"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  try {
    const { uploadUrl, publicUrl, key } = await createUploadUrl({
      kind: parsed.data.kind,
      contentType: parsed.data.contentType,
      userId: user.id,
    });
    await recordUploads([{ key, kind: parsed.data.kind }], user.id);
    return { error: null, uploadUrl, publicUrl, key };
  } catch {
    return { error: "invalid" as const };
  }
}

/**
 * Several presigned URLs in ONE call. Next.js runs a browser's Server Action calls one at a time, so a post with
 * five photos (or a video plus its thumbnail) used to wait through five back-to-back round trips before the last
 * upload could even start; the client now coalesces the requests it makes together into this. Each item still costs
 * one unit of the same per-user upload limit and is validated exactly like requestUploadUrl.
 */
export async function requestUploadUrls(items: { kind: string; contentType: string }[]) {
  const user = await requireVerifiedUser();

  if (!isStorageConfigured()) {
    return { error: "not_configured" as const };
  }

  const parsed = requestUploadBatchSchema.safeParse(items);
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  for (let i = 0; i < parsed.data.length; i++) {
    if (!(await checkRateLimit("mediaUpload", user.id))) {
      return { error: "rate_limited" as const };
    }
  }

  const results = await Promise.all(
    parsed.data.map(async ({ kind, contentType }) => {
      try {
        const { uploadUrl, publicUrl, key } = await createUploadUrl({ kind, contentType, userId: user.id });
        return { error: null, uploadUrl, publicUrl, key };
      } catch {
        return { error: "invalid" as const };
      }
    }),
  );
  await recordUploads(
    results.flatMap((r, i) => (r.error === null && r.key ? [{ key: r.key, kind: parsed.data[i].kind }] : [])),
    user.id,
  );
  return { error: null, items: results };
}

/** Starts a multipart video upload — see createMultipartUpload in storage.ts for why and how. */
export async function startMultipartUpload(formData: FormData) {
  const user = await requireVerifiedUser();

  if (!isStorageConfigured()) {
    return { error: "not_configured" as const };
  }
  if (!(await checkRateLimit("mediaUpload", user.id))) {
    return { error: "rate_limited" as const };
  }

  const parsed = startMultipartSchema.safeParse({
    kind: formData.get("kind"),
    contentType: formData.get("contentType"),
    size: formData.get("size"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  try {
    const started = await createMultipartUpload({
      kind: parsed.data.kind,
      contentType: parsed.data.contentType,
      userId: user.id,
      sizeBytes: parsed.data.size,
    });
    await recordUploads([{ key: started.key, kind: parsed.data.kind }], user.id);
    return { error: null, ...started };
  } catch {
    return { error: "invalid" as const };
  }
}

/** Finishes a multipart upload after every part is in; the key must be the caller's own. */
export async function completeMultipartUpload(formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = completeMultipartSchema.safeParse({
    key: formData.get("key"),
    uploadId: formData.get("uploadId"),
    partCount: formData.get("partCount"),
  });
  if (!parsed.success || !keyBelongsToOwner(parsed.data.key, user.id)) {
    return { error: "invalid" as const };
  }

  try {
    await completeMultipart(parsed.data);
    return { error: null };
  } catch {
    return { error: "upload_failed" as const };
  }
}

/** Best-effort cleanup of a multipart upload the browser gave up on. */
export async function abortMultipartUpload(formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = multipartRefSchema.safeParse({ key: formData.get("key"), uploadId: formData.get("uploadId") });
  if (!parsed.success || !keyBelongsToOwner(parsed.data.key, user.id)) {
    return { error: "invalid" as const };
  }
  await abortMultipart(parsed.data);
  return { error: null };
}

// Kinds a composer may upload ahead of posting and then throw away (see discardUpload in upload-client.ts).
const DISCARDABLE_KINDS = new Set([
  "post-image",
  "post-video",
  "video-thumb",
  "muse-video",
  "message-image",
  "message-video",
  "comment-video",
  "story-image",
  "story-video",
]);

/**
 * Deletes media the caller uploaded ahead of posting and then removed from the composer. Only their own keys, only
 * post-style media kinds — never an avatar, cover or anything else.
 */
export async function discardUploads(keys: string[]) {
  const user = await requireVerifiedUser();
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 12) {
    return { error: "invalid" as const };
  }
  await Promise.all(
    keys
      .filter((k): k is string => typeof k === "string" && k.length < 500 && DISCARDABLE_KINDS.has(k.split("/")[0]))
      .map((k) => deleteOwnedObject(k, user.id)),
  );
  return { error: null };
}

/**
 * Fetches an image from a URL the user pasted in and re-hosts it in our own
 * bucket, so it goes through the exact same downstream path (verifyUploadedSize
 * + moderateMedia in createPost) as a normal local upload — the only new
 * step is the SSRF-guarded fetch itself (see fetchRemoteImage).
 */
export async function addImageFromUrl(formData: FormData) {
  const user = await requireVerifiedUser();

  if (!isStorageConfigured()) {
    return { error: "not_configured" as const };
  }

  const allowed = await checkRateLimit("mediaUpload", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = imageFromUrlSchema.safeParse({ url: formData.get("url") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  const fetched = await fetchRemoteImage(parsed.data.url);
  if (!fetched.ok) {
    return { error: fetched.error };
  }

  const { publicUrl } = await uploadBuffer({
    kind: "post-image",
    contentType: fetched.contentType,
    userId: user.id,
    body: fetched.body,
  });

  return { error: null, publicUrl };
}

export async function confirmAvatarUpload(formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = confirmAvatarUploadSchema.safeParse({
    key: formData.get("key"),
    publicUrl: formData.get("publicUrl"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { key, publicUrl } = parsed.data;

  const sizeOk = await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS.avatar, ownerId: user.id });
  if (!sizeOk) {
    return { error: "too_large" as const };
  }

  const modResult = await moderateImage(publicUrl);
  if (!modResult.allowed) {
    await deleteObject(key);
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  const previousKey = user.avatarUrl ? keyFromPublicUrl(user.avatarUrl) : null;

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl: publicUrl },
  });

  if (previousKey) {
    await deleteObject(previousKey);
  }

  await recomputeTrustScore(user.id);
  revalidatePath("/settings");
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}
