"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { circleSchema, postSchema, confirmCircleCoverUploadSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMedia, moderateImage } from "@/lib/moderation";
import { recordActivity } from "@/lib/trust";
import {
  MEDIA_LIMITS,
  verifyUploadedSize,
  deleteObject,
  keyFromPublicUrl,
} from "@/lib/storage";
import { parseVideoEmbedUrl, type ParsedEmbed } from "@/lib/video-embed";
import { track } from "@/lib/analytics";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";

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

  await track("CIRCLE_CREATED", user.id, { circleId: circle.id });

  // Site admins get a heads-up on every new Circle for oversight — there's
  // no one else to notify at creation time (no members yet besides the
  // creator).
  const admins = await prisma.user.findMany({
    where: { isAdmin: true, id: { not: user.id } },
    select: { id: true },
  });
  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        recipientId: admin.id,
        actorId: user.id,
        type: "CIRCLE_CREATED" as const,
        circleId: circle.id,
      })),
    });
  }

  revalidatePath("/circles");
  redirect(`/circles/${circle.slug}`);
}

export async function joinCircle(circleId: string) {
  const user = await requireVerifiedUser();
  const existing = await prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId: user.id, circleId } },
  });
  await prisma.circleMembership.upsert({
    where: { userId_circleId: { userId: user.id, circleId } },
    create: { userId: user.id, circleId },
    update: {},
  });
  if (!existing) {
    await track("CIRCLE_JOINED", user.id, { circleId });

    // Notify the Circle's creator and any co-admins that someone new joined.
    const circle = await prisma.circle.findUnique({
      where: { id: circleId },
      select: {
        createdById: true,
        members: { where: { role: "MODERATOR" }, select: { userId: true } },
      },
    });
    if (circle) {
      const recipientIds = new Set([circle.createdById, ...circle.members.map((m) => m.userId)]);
      recipientIds.delete(user.id);
      if (recipientIds.size > 0) {
        await prisma.notification.createMany({
          data: [...recipientIds].map((recipientId) => ({
            recipientId,
            actorId: user.id,
            type: "CIRCLE_JOINED" as const,
            circleId,
          })),
        });
      }
    }
  }
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

/** Owner or admin: deletes the Circle outright — cascades its posts and memberships. Admins need this to clear out duplicate/spam Circles that aren't theirs to own. */
export async function deleteCircle(circleId: string) {
  const user = await requireVerifiedUser();

  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) {
    return { error: "not_found" as const };
  }
  if (circle.createdById !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.circle.delete({ where: { id: circleId } });

  revalidatePath("/circles");
  redirect("/circles");
}

/**
 * Co-admins (CircleMembership.role "MODERATOR") get the same day-to-day
 * management powers as the Circle's original creator — editing the cover
 * picture, moderating posts/comments, managing members, promoting further
 * co-admins — except deleting the whole Circle or touching the creator's
 * own membership, which stay owner/site-admin-only (deleteCircle above).
 */
export async function addCircleCoAdmin(circleId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCircleMembership(circleId, user.id);
  if (!isCircleAdmin(circle, myMembership, user)) {
    return { error: "forbidden" as const };
  }
  if (targetUserId === circle.createdById) {
    return { error: "invalid" as const };
  }

  const targetMembership = await getCircleMembership(circleId, targetUserId);
  if (!targetMembership) {
    return { error: "not_a_member" as const };
  }

  await prisma.circleMembership.update({
    where: { userId_circleId: { userId: targetUserId, circleId } },
    data: { role: "MODERATOR" },
  });

  revalidatePath(`/circles/${circle.slug}`);
  return { error: null };
}

export async function removeCircleCoAdmin(circleId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCircleMembership(circleId, user.id);
  if (!isCircleAdmin(circle, myMembership, user)) {
    return { error: "forbidden" as const };
  }
  if (targetUserId === circle.createdById) {
    return { error: "invalid" as const };
  }

  await prisma.circleMembership.updateMany({
    where: { userId: targetUserId, circleId, role: "MODERATOR" },
    data: { role: "MEMBER" },
  });

  revalidatePath(`/circles/${circle.slug}`);
  return { error: null };
}

/** Owner or co-admin: removes a member outright (not just their own leaving). Can't be used on the Circle's original creator. */
export async function removeCircleMember(circleId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCircleMembership(circleId, user.id);
  if (!isCircleAdmin(circle, myMembership, user)) {
    return { error: "forbidden" as const };
  }
  if (targetUserId === circle.createdById) {
    return { error: "invalid" as const };
  }

  await prisma.circleMembership.deleteMany({
    where: { userId: targetUserId, circleId },
  });

  revalidatePath(`/circles/${circle.slug}`);
  return { error: null };
}

/** Owner or co-admin: sets/replaces the Circle's cover picture. */
export async function confirmCircleCoverUpload(formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = confirmCircleCoverUploadSchema.safeParse({
    circleId: formData.get("circleId"),
    key: formData.get("key"),
    publicUrl: formData.get("publicUrl"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { circleId, key, publicUrl } = parsed.data;

  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) {
    return { error: "not_found" as const };
  }
  const membership = await getCircleMembership(circleId, user.id);
  if (!isCircleAdmin(circle, membership, user)) {
    return { error: "forbidden" as const };
  }

  const sizeOk = await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["circle-cover"] });
  if (!sizeOk) {
    return { error: "too_large" as const };
  }

  const modResult = await moderateImage(publicUrl);
  if (!modResult.allowed) {
    await deleteObject(key);
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  const previousKey = circle.coverImageUrl ? keyFromPublicUrl(circle.coverImageUrl) : null;

  await prisma.circle.update({
    where: { id: circleId },
    data: { coverImageUrl: publicUrl },
  });

  if (previousKey) {
    await deleteObject(previousKey);
  }

  revalidatePath(`/circles/${circle.slug}`);
  revalidatePath("/circles");
  return { error: null };
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
    embedUrl: formData.get("embedUrl") || undefined,
    eventAt: formData.get("eventAt") || undefined,
    eventLocation: formData.get("eventLocation") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { mediaType, mediaUrls, videoUrl, videoThumbnailUrl, eventAt, eventLocation } = parsed.data;

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
    // Independent deletes to independent keys — no reason to wait on them
    // one at a time.
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
    );
  }

  if (mediaType === "IMAGE") {
    // Each HEAD check hits R2 independently — running them in sequence was
    // adding one round trip per image to every multi-image post.
    const checks = await Promise.all(
      mediaUrls.map(async (url) => {
        const key = keyFromPublicUrl(url);
        return key && (await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["post-image"] }));
      }),
    );
    if (checks.some((ok) => !ok)) {
      await cleanupUploads();
      return { error: "too_large" };
    }
  }

  if (mediaType === "VIDEO") {
    // The video and its thumbnail are unrelated objects — verifying them
    // one after the other was the single biggest source of "posting a video
    // feels slow" on the server side, adding a whole extra round trip.
    const [videoOk, thumbOk] = await Promise.all([
      (async () => {
        const videoKey = videoUrl ? keyFromPublicUrl(videoUrl) : null;
        return videoKey && (await verifyUploadedSize({ key: videoKey, maxBytes: MEDIA_LIMITS["post-video"] }));
      })(),
      (async () => {
        if (!videoThumbnailUrl) return true;
        const thumbKey = keyFromPublicUrl(videoThumbnailUrl);
        return thumbKey && (await verifyUploadedSize({ key: thumbKey, maxBytes: MEDIA_LIMITS["video-thumb"] }));
      })(),
    ]);
    if (!videoOk || !thumbOk) {
      await cleanupUploads();
      return { error: "too_large" };
    }
  }

  // The client's own parse is only for instant feedback — this is the parse
  // that actually matters. Nothing but the resulting provider+id (never the
  // raw URL) ever reaches the database or an iframe src.
  let embed: ParsedEmbed | null = null;
  if (mediaType === "EMBED") {
    embed = parsed.data.embedUrl ? parseVideoEmbedUrl(parsed.data.embedUrl) : null;
    if (!embed) {
      return { error: "invalid" };
    }
  }

  let moderationStatus: "PUBLISHED" | "FLAGGED" = "PUBLISHED";

  if (mediaType === "NONE" || mediaType === "EMBED") {
    // Pure text (and embeds, which carry no media file of ours to inspect —
    // the linked video is moderated by YouTube/Vimeo, not us) keeps the
    // existing soft-flag behavior: stored hidden, reviewable by an admin
    // rather than silently discarded.
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
      embedProvider: embed?.provider,
      embedId: embed?.id,
      eventAt,
      eventLocation,
      moderationStatus,
    },
  });
  await recordActivity(user.id);
  await track("POST_CREATED", user.id, { circleId: parsed.data.circleId ?? null, mediaType });

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}
