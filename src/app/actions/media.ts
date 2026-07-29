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
  keyFromPublicUrl,
} from "@/lib/storage";
import { requestUploadSchema, confirmAvatarUploadSchema } from "@/lib/validations";

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
    return { error: null, uploadUrl, publicUrl, key };
  } catch {
    return { error: "invalid" as const };
  }
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

  const sizeOk = await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS.avatar });
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
