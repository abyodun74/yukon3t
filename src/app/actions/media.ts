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
  uploadBuffer,
  keyBelongsToOwner,
  createMultipartUpload,
  completeMultipartUpload as completeMultipart,
  abortMultipartUpload as abortMultipart,
  publicUrlForKey,
  isAvatarPrivateUploadEnabled,
  createAvatarUploadUrl,
  validateContentType,
  isPrivateKeyOwnedBy,
  deleteAvatarObject,
  copyAvatarObject,
  headAvatarObject,
  presignAvatarGet,
} from "@/lib/storage";
import {
  requestUploadSchema,
  requestUploadBatchSchema,
  startMultipartSchema,
  multipartRefSchema,
  completeMultipartSchema,
  confirmAvatarUploadSchema,
  requestPrivateAvatarUploadSchema,
  confirmPrivateAvatarUploadSchema,
  imageFromUrlSchema,
} from "@/lib/validations";
import { randomUUID } from "node:crypto";
import { deleteStoredAvatar } from "@/lib/avatar-storage";
import { AVATAR_EXTENSIONS, AVATAR_THUMB_MAX_BYTES, twoSizeAvatar, type AvatarExtension } from "@/lib/avatar-url";
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
  "announcement-image",
  "announcement-video",
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

/**
 * The public (AVATAR_PRIVATE off) profile-picture path: the image was PUT to the public bucket via requestUploadUrls.
 * The URL saved is derived from the key here, never taken from the client: a client-supplied URL used to be saved as
 * is (any https URL, e.g. a tracking pixel every viewer would load) and, on the next change, turned back into a key
 * and deleted — someone else's media, if the URL was theirs. The key must be the caller's own avatar upload.
 */
export async function confirmAvatarUpload(formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = confirmAvatarUploadSchema.safeParse({
    key: formData.get("key"),
    publicUrl: formData.get("publicUrl"),
  });
  if (!parsed.success || !parsed.data.key.startsWith("avatar/") || !keyBelongsToOwner(parsed.data.key, user.id)) {
    return { error: "invalid" as const };
  }
  const { key } = parsed.data;
  const publicUrl = publicUrlForKey(key);

  const sizeOk = await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS.avatar, ownerId: user.id });
  if (!sizeOk) {
    return { error: "too_large" as const };
  }

  const modResult = await moderateImage(publicUrl);
  if (!modResult.allowed) {
    await deleteObject(key);
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  const previousUrl = user.avatarUrl;

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl: publicUrl },
  });

  // The previous picture may be public or (after AVATAR_PRIVATE was on, or the backfill) private: both are handled.
  await deleteStoredAvatar(previousUrl, user.id);

  await recomputeTrustScore(user.id);
  revalidatePath("/settings");
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}

/** How long the moderation API gets to fetch a private avatar it is checking (same as view-once's). */
const AVATAR_MODERATION_URL_TTL_SECONDS = 300;

/**
 * AVATAR_PRIVATE on: two presigned PUTs into the private avatar bucket, one for the ~320px thumbnail and one for the
 * ~1080px image (upload-client.ts uploadPrivateAvatar). Upload keys only (`avatar-upload/…`): the served `avatar/…`
 * keys are written by confirmPrivateAvatarUpload's server-side copy, so a still-valid PUT URL can't swap the picture
 * after it was moderated.
 */
export async function requestPrivateAvatarUpload(input: { contentType: string }) {
  const user = await requireVerifiedUser();

  if (!isAvatarPrivateUploadEnabled()) {
    return { error: "unavailable" as const };
  }
  for (let i = 0; i < 2; i++) {
    if (!(await checkRateLimit("mediaUpload", user.id))) {
      return { error: "rate_limited" as const };
    }
  }

  const parsed = requestPrivateAvatarUploadSchema.safeParse(input);
  if (!parsed.success || !validateContentType("avatar", parsed.data.contentType)) {
    return { error: "invalid" as const };
  }

  try {
    const [thumb, full] = await Promise.all([
      createAvatarUploadUrl({ userId: user.id, contentType: parsed.data.contentType }),
      createAvatarUploadUrl({ userId: user.id, contentType: parsed.data.contentType }),
    ]);
    return {
      error: null,
      thumbUploadUrl: thumb.uploadUrl,
      thumbKey: thumb.key,
      fullUploadUrl: full.uploadUrl,
      fullKey: full.key,
    };
  } catch {
    return { error: "invalid" as const };
  }
}

/**
 * AVATAR_PRIVATE on: makes the two uploaded images the caller's profile picture. Each upload is copied to a served
 * key the browser was never given a URL for, checked there (real size, real type), then BOTH images are moderated
 * from those copies (a modified client could upload an innocent thumbnail and a different full image, so checking one
 * isn't enough). Anything refused is deleted. Saves the same-origin route form (`/api/avatar/<id>/<uuid>-t.<ext>`)
 * and deletes the previous picture, public or private.
 */
export async function confirmPrivateAvatarUpload(input: { thumbKey: string; fullKey: string }) {
  const user = await requireVerifiedUser();

  if (!isAvatarPrivateUploadEnabled()) {
    return { error: "unavailable" as const };
  }

  const parsed = confirmPrivateAvatarUploadSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.thumbKey === parsed.data.fullKey ||
    !isPrivateKeyOwnedBy(parsed.data.thumbKey, "avatar-upload", user.id) ||
    !isPrivateKeyOwnedBy(parsed.data.fullKey, "avatar-upload", user.id)
  ) {
    return { error: "invalid" as const };
  }
  const { thumbKey: thumbUploadKey, fullKey: fullUploadKey } = parsed.data;
  const ext = thumbUploadKey.split(".").pop();
  if (!ext || ext !== fullUploadKey.split(".").pop() || !(AVATAR_EXTENSIONS as readonly string[]).includes(ext)) {
    await Promise.all([deleteAvatarObject(thumbUploadKey), deleteAvatarObject(fullUploadKey)]);
    return { error: "invalid" as const };
  }

  const served = twoSizeAvatar(user.id, randomUUID(), ext as AvatarExtension);
  const dropUploads = () => Promise.all([deleteAvatarObject(thumbUploadKey), deleteAvatarObject(fullUploadKey)]);
  const dropServed = () => Promise.all([deleteAvatarObject(served.thumbKey), deleteAvatarObject(served.fullKey)]);

  try {
    await Promise.all([
      copyAvatarObject(thumbUploadKey, served.thumbKey),
      copyAvatarObject(fullUploadKey, served.fullKey),
    ]);
  } catch (err) {
    console.error("[confirmPrivateAvatarUpload] copy failed", err);
    await Promise.all([dropUploads(), dropServed()]);
    return { error: "invalid" as const };
  }
  await dropUploads();

  let heads;
  try {
    heads = await Promise.all([headAvatarObject(served.thumbKey), headAvatarObject(served.fullKey)]);
  } catch (err) {
    console.error("[confirmPrivateAvatarUpload] head failed", err);
    await dropServed();
    return { error: "invalid" as const };
  }
  const [thumbHead, fullHead] = heads;
  const typeOk = (h: { contentType: string } | null) => !!h && validateContentType("avatar", h.contentType) === ext;
  if (!typeOk(thumbHead) || !typeOk(fullHead)) {
    await dropServed();
    return { error: "invalid" as const };
  }
  if (
    !thumbHead ||
    !fullHead ||
    thumbHead.size === 0 ||
    fullHead.size === 0 ||
    thumbHead.size > AVATAR_THUMB_MAX_BYTES ||
    fullHead.size > MEDIA_LIMITS.avatar
  ) {
    await dropServed();
    return { error: "too_large" as const };
  }

  const [thumbMod, fullMod] = await Promise.all(
    [served.thumbKey, served.fullKey].map(async (key) =>
      moderateImage(await presignAvatarGet(key, { expiresIn: AVATAR_MODERATION_URL_TTL_SECONDS, cacheControl: "no-store" })),
    ),
  );
  if (!thumbMod.allowed || !fullMod.allowed) {
    await dropServed();
    return {
      error: "moderation" as const,
      categories: [...new Set([...thumbMod.flaggedCategories, ...fullMod.flaggedCategories])],
    };
  }

  const previousUrl = user.avatarUrl;
  await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: served.routeUrl } });
  await deleteStoredAvatar(previousUrl, user.id);

  await recomputeTrustScore(user.id);
  revalidatePath("/settings");
  revalidatePath(`/u/${user.id}`);
  return { error: null, avatarUrl: served.routeUrl };
}
