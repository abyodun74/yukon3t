"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { circleSchema, postSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMedia } from "@/lib/moderation";
import {
  MEDIA_LIMITS,
  verifyUploadedSize,
  deleteObject,
  keyFromPublicUrl,
} from "@/lib/storage";

export async function createCircle(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("circleCreate", user.id);
  if (!allowed) {
    redirect("/circles/new?error=rate_limited");
  }

  const parsed = circleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    category: formData.get("category"),
  });
  if (!parsed.success) {
    redirect("/circles/new?error=invalid");
  }
  const { name, description, category } = parsed.data;

  const modResult = await moderateText(`${name}\n${description}`);
  if (!modResult.allowed) {
    redirect("/circles/new?error=moderation");
  }

  const baseSlug = slugify(name) || "circle";
  let slug = baseSlug;
  let attempt = 0;
  // Free-form group creation invites slug collisions; resolve deterministically.
  while (await prisma.circle.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const circle = await prisma.circle.create({
    data: {
      name,
      description,
      category,
      slug,
      createdById: user.id,
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  revalidatePath("/circles");
  redirect(`/circles/${circle.slug}`);
}

export async function joinCircle(circleId: string) {
  const user = await requireVerifiedUser();
  await prisma.circleMembership.upsert({
    where: { userId_circleId: { userId: user.id, circleId } },
    create: { userId: user.id, circleId },
    update: {},
  });
  revalidatePath("/circles");
}

export async function leaveCircle(circleId: string) {
  const user = await requireVerifiedUser();
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (circle?.createdById === user.id) {
    // Owners must delete the Circle explicitly rather than silently orphaning it.
    return;
  }
  await prisma.circleMembership.deleteMany({
    where: { userId: user.id, circleId },
  });
  revalidatePath("/circles");
}

export async function createPost(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("postCreate", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const circleId = formData.get("circleId");
  const mediaUrlsRaw = formData.get("mediaUrls");
  const parsed = postSchema.safeParse({
    circleId: circleId ? String(circleId) : undefined,
    content: formData.get("content"),
    intentTag: formData.get("intentTag") || undefined,
    mediaType: formData.get("mediaType") || "NONE",
    mediaUrls: mediaUrlsRaw ? JSON.parse(String(mediaUrlsRaw)) : [],
    videoUrl: formData.get("videoUrl") || undefined,
    videoThumbnailUrl: formData.get("videoThumbnailUrl") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { mediaType, mediaUrls, videoUrl, videoThumbnailUrl } = parsed.data;

  if (parsed.data.circleId) {
    const membership = await prisma.circleMembership.findUnique({
      where: {
        userId_circleId: { userId: user.id, circleId: parsed.data.circleId },
      },
    });
    if (!membership) {
      return { error: "not_a_member" };
    }
  }

  // Uploaded objects for this attempt — cleaned up on any rejection below so
  // nothing rejected lingers in storage.
  const uploadedUrls = [
    ...(mediaType === "IMAGE" ? mediaUrls : []),
    ...(mediaType === "VIDEO" && videoUrl ? [videoUrl] : []),
    ...(mediaType === "VIDEO" && videoThumbnailUrl ? [videoThumbnailUrl] : []),
  ];

  async function cleanupUploads() {
    for (const url of uploadedUrls) {
      const key = keyFromPublicUrl(url);
      if (key) await deleteObject(key);
    }
  }

  if (mediaType === "IMAGE") {
    for (const url of mediaUrls) {
      const key = keyFromPublicUrl(url);
      const ok = key && (await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["post-image"] }));
      if (!ok) {
        await cleanupUploads();
        return { error: "too_large" };
      }
    }
  }

  if (mediaType === "VIDEO") {
    const videoKey = videoUrl ? keyFromPublicUrl(videoUrl) : null;
    const videoOk =
      videoKey && (await verifyUploadedSize({ key: videoKey, maxBytes: MEDIA_LIMITS["post-video"] }));
    if (!videoOk) {
      await cleanupUploads();
      return { error: "too_large" };
    }
    if (videoThumbnailUrl) {
      const thumbKey = keyFromPublicUrl(videoThumbnailUrl);
      const thumbOk =
        thumbKey && (await verifyUploadedSize({ key: thumbKey, maxBytes: MEDIA_LIMITS["video-thumb"] }));
      if (!thumbOk) {
        await cleanupUploads();
        return { error: "too_large" };
      }
    }
  }

  let moderationStatus: "PUBLISHED" | "FLAGGED" = "PUBLISHED";

  if (mediaType === "NONE") {
    // Pure text keeps the existing soft-flag behavior: stored hidden,
    // reviewable by an admin rather than silently discarded.
    const modResult = await moderateText(parsed.data.content);
    moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";
  } else {
    // Media is held to the strict no-sexual-content policy: any violation
    // rejects the post outright and the uploaded files are deleted, rather
    // than being stored in a hidden, pending state.
    const modResult = await moderateMedia({
      text: parsed.data.content,
      imageUrls: mediaType === "IMAGE" ? mediaUrls : [],
      thumbnailUrl: mediaType === "VIDEO" ? videoThumbnailUrl : undefined,
    });
    if (!modResult.allowed) {
      await cleanupUploads();
      return { error: "moderation", categories: modResult.flaggedCategories };
    }
  }

  await prisma.post.create({
    data: {
      authorId: user.id,
      circleId: parsed.data.circleId,
      content: parsed.data.content,
      intentTag: parsed.data.intentTag,
      mediaType,
      mediaUrls: mediaType === "IMAGE" ? mediaUrls : [],
      videoUrl: mediaType === "VIDEO" ? videoUrl : undefined,
      videoThumbnailUrl: mediaType === "VIDEO" ? videoThumbnailUrl : undefined,
      moderationStatus,
    },
  });

  revalidatePath("/circles", "layout");
  revalidatePath("/discover");
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}
