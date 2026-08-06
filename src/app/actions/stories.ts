"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { storySchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateMedia } from "@/lib/moderation";
import { MEDIA_LIMITS, STORY_LIFETIME_MS, verifyUploadedSize, deleteObject, keyFromPublicUrl } from "@/lib/storage";

export async function createStory(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("storyCreate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = storySchema.safeParse({
    mediaType: formData.get("mediaType"),
    mediaUrl: formData.get("mediaUrl"),
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
    caption: formData.get("caption") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { mediaType, mediaUrl, mediaThumbnailUrl, caption } = parsed.data;

  const uploadedUrls = [mediaUrl, ...(mediaType === "VIDEO" && mediaThumbnailUrl ? [mediaThumbnailUrl] : [])];
  async function cleanupUploads() {
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
    );
  }

  const key = keyFromPublicUrl(mediaUrl);
  const maxBytes = mediaType === "IMAGE" ? MEDIA_LIMITS["story-image"] : MEDIA_LIMITS["story-video"];
  const sizeOk = key && (await verifyUploadedSize({ key, maxBytes }));
  if (!sizeOk) {
    await cleanupUploads();
    return { error: "too_large" as const };
  }

  const modResult = await moderateMedia({
    text: caption,
    imageUrls: mediaType === "IMAGE" ? [mediaUrl] : [],
    thumbnailUrl: mediaType === "VIDEO" ? mediaThumbnailUrl : undefined,
  });
  if (!modResult.allowed) {
    await cleanupUploads();
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  await prisma.story.create({
    data: {
      authorId: user.id,
      mediaType,
      mediaUrl,
      mediaThumbnailUrl: mediaType === "VIDEO" ? mediaThumbnailUrl : undefined,
      caption: caption || undefined,
      expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
    },
  });

  revalidatePath(`/u/${user.id}`);
  return { error: null };
}

/** Author or admin: removes a story before its natural 24h expiry. */
export async function deleteStory(id: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id } });
  if (!story) {
    return { error: "not_found" as const };
  }
  if (story.authorId !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.story.delete({ where: { id } });
  await Promise.all(
    [story.mediaUrl, story.mediaThumbnailUrl]
      .filter((url): url is string => Boolean(url))
      .map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
  );

  revalidatePath(`/u/${story.authorId}`);
  return { error: null };
}

/**
 * Records that the caller watched a story — a no-op (not an error) for the
 * author's own story, same reasoning a like/RSVP wouldn't count from its
 * own author: "who's viewed my story" should never include yourself.
 */
export async function viewStory(storyId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { authorId: true, expiresAt: true },
  });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const };
  }
  if (story.authorId === user.id) {
    return { error: null };
  }

  await prisma.storyView.upsert({
    where: { storyId_viewerId: { storyId, viewerId: user.id } },
    create: { storyId, viewerId: user.id },
    update: {},
  });

  return { error: null };
}

/** Author-only: who has seen this story so far. */
export async function getStoryViewers(storyId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { authorId: true } });
  if (!story || story.authorId !== user.id) {
    return { viewers: [] };
  }

  const views = await prisma.storyView.findMany({
    where: { storyId },
    orderBy: { viewedAt: "desc" },
    include: { viewer: { select: { id: true, name: true } } },
  });

  return {
    viewers: views.map((v) => ({ id: v.viewer.id, name: v.viewer.name ?? "Unknown", viewedAt: v.viewedAt })),
  };
}
