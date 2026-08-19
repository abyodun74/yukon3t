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
import { notifySubscribers } from "@/lib/notify-subscribers";
import {
  MEDIA_LIMITS,
  verifyUploadedSize,
  deleteObject,
  deleteOwnedObject,
  keyFromPublicUrl,
} from "@/lib/storage";
import { parseVideoEmbedUrl, fetchEmbedTitle, type ParsedEmbed } from "@/lib/video-embed";
import { normalizeLinkUrl } from "@/lib/link-url";
import { track } from "@/lib/analytics";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { canAccessChannel } from "@/lib/channel-permissions";
import { updateCircleEmbedding, updatePostEmbedding } from "@/lib/embeddings";

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
    visibility: formData.get("visibility") || undefined,
  });
  if (!parsed.success) {
    redirect("/circles/new?error=invalid");
  }
  const { name, description, category, visibility } = parsed.data;

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
      visibility,
      slug,
      createdById: user.id,
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
      channels: {
        create: [
          { name: "General", slug: "general", type: "TEXT", position: 0, createdById: user.id },
          { name: "Voice", slug: "voice", type: "VOICE", position: 1, createdById: user.id },
        ],
      },
    },
  });

  await updateCircleEmbedding(circle.id, { name, description, category });
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
  await notifySubscribers(user.id, "SUBSCRIPTION_CIRCLE_CREATED", { circleId: circle.id });

  revalidatePath("/circles");
  redirect(`/circles/${circle.slug}`);
}

export async function joinCircle(circleId: string) {
  const user = await requireVerifiedUser();

  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: {
      visibility: true,
      createdById: true,
      members: { where: { role: "MODERATOR" }, select: { userId: true } },
    },
  });
  if (!circle) {
    return { error: "not_found" as const };
  }

  if (circle.visibility === "PRIVATE") {
    // Instant-join doesn't apply — create/refresh a CircleJoinRequest
    // instead, same upsert-with-status-reset-on-DECLINED shape as
    // requestToJoinGroup for private Conversations.
    const existingRequest = await prisma.circleJoinRequest.findUnique({
      where: { circleId_userId: { circleId, userId: user.id } },
    });
    const alreadyMember = await prisma.circleMembership.findUnique({
      where: { userId_circleId: { userId: user.id, circleId } },
    });
    if (alreadyMember) {
      revalidatePath("/circles");
      return { error: null, requested: false };
    }
    if (!existingRequest) {
      try {
        await prisma.circleJoinRequest.create({ data: { circleId, userId: user.id } });
      } catch (err) {
        // A fast double-click can race past the !existingRequest check above —
        // @@unique([circleId, userId]) then rejects the second create. The
        // request already exists either way, so this is a success, not an error.
        if (!isUniqueConstraintError(err)) throw err;
      }
    } else if (existingRequest.status === "DECLINED") {
      await prisma.circleJoinRequest.update({
        where: { id: existingRequest.id },
        data: { status: "PENDING", respondedAt: null },
      });
    }

    const recipientIds = new Set([circle.createdById, ...circle.members.map((m) => m.userId)]);
    recipientIds.delete(user.id);
    if (recipientIds.size > 0 && !existingRequest) {
      await prisma.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          recipientId,
          actorId: user.id,
          type: "CIRCLE_JOIN_REQUEST" as const,
          circleId,
        })),
      });
    }

    revalidatePath(`/circles`);
    return { error: null, requested: true };
  }

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
    await notifySubscribers(user.id, "SUBSCRIPTION_CIRCLE_JOINED", { circleId });
  }
  revalidatePath("/circles");
  return { error: null, requested: false };
}

/** Owner or co-admin of a PRIVATE Circle: approves or declines a pending join request. */
export async function respondToCircleJoinRequest(requestId: string, approve: boolean) {
  const user = await requireVerifiedUser();

  const request = await prisma.circleJoinRequest.findUnique({
    where: { id: requestId },
    include: { circle: true },
  });
  if (!request) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCircleMembership(request.circleId, user.id);
  if (!isCircleAdmin(request.circle, myMembership, user)) {
    return { error: "forbidden" as const };
  }

  if (approve) {
    await prisma.circleMembership.upsert({
      where: { userId_circleId: { userId: request.userId, circleId: request.circleId } },
      create: { userId: request.userId, circleId: request.circleId },
      update: {},
    });
    await prisma.notification.create({
      data: {
        recipientId: request.userId,
        actorId: user.id,
        type: "CIRCLE_JOIN_APPROVED",
        circleId: request.circleId,
      },
    });
  }

  await prisma.circleJoinRequest.update({
    where: { id: requestId },
    data: { status: approve ? "APPROVED" : "DECLINED", respondedAt: new Date() },
  });

  revalidatePath(`/circles/${request.circle.slug}`);
  return { error: null };
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

  const allowed = await checkRateLimit("circleModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

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

  const allowed = await checkRateLimit("circleModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

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

  const allowed = await checkRateLimit("circleModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

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

  const sizeOk = await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["circle-cover"], ownerId: user.id });
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
  const channelId = formData.get("channelId");
  const mediaUrlsRaw = formData.get("mediaUrls");
  const parsed = postSchema.safeParse({
    circleId: circleId ? String(circleId) : undefined,
    channelId: channelId ? String(channelId) : undefined,
    content: formData.get("content"),
    intentTag: formData.get("intentTag") || undefined,
    feedCategory: formData.get("feedCategory") || undefined,
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
    if (!parsed.data.channelId) {
      return { error: "invalid" };
    }
    const channel = await prisma.channel.findUnique({
      where: { id: parsed.data.channelId },
      include: { circle: true },
    });
    if (!channel || channel.circleId !== parsed.data.circleId || channel.type !== "TEXT") {
      return { error: "invalid" };
    }
    if (!(await canAccessChannel(channel, channel.circle, user))) {
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
    // one at a time. Ownership-checked per key so a foreign URL slipped
    // into mediaUrls/videoUrl can't get deleted via this cleanup path.
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteOwnedObject(key, user.id) : Promise.resolve();
      }),
    );
  }

  if (mediaType === "IMAGE") {
    // Each HEAD check hits R2 independently — running them in sequence was
    // adding one round trip per image to every multi-image post.
    const checks = await Promise.all(
      mediaUrls.map(async (url) => {
        const key = keyFromPublicUrl(url);
        return key && (await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["post-image"], ownerId: user.id }));
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
        return videoKey && (await verifyUploadedSize({ key: videoKey, maxBytes: MEDIA_LIMITS["post-video"], ownerId: user.id }));
      })(),
      (async () => {
        if (!videoThumbnailUrl) return true;
        const thumbKey = keyFromPublicUrl(videoThumbnailUrl);
        return thumbKey && (await verifyUploadedSize({ key: thumbKey, maxBytes: MEDIA_LIMITS["video-thumb"], ownerId: user.id }));
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

  // Any http(s) link that isn't a recognized video provider — stored raw and
  // rendered only as a plain <a href>, never an iframe src, so no allowlist
  // of hosts is needed here.
  let linkUrl: string | null = null;
  if (mediaType === "LINK") {
    linkUrl = parsed.data.embedUrl ? normalizeLinkUrl(parsed.data.embedUrl) : null;
    if (!linkUrl) {
      return { error: "invalid" };
    }
  }

  // Kicked off alongside moderation below rather than awaited here — a
  // sparse video caption ("check this out") gives the smart category filter
  // (src/lib/feed-category.ts) almost no signal on its own, so the actual
  // video title is folded into the embedding text once both calls resolve.
  // Best-effort only: never blocks or fails the post on a slow/broken
  // oEmbed response.
  const embedTitlePromise = mediaType === "EMBED" && embed ? fetchEmbedTitle(embed) : Promise.resolve(null);

  let moderationStatus: "PUBLISHED" | "FLAGGED" = "PUBLISHED";

  if (mediaType === "NONE" || mediaType === "EMBED" || mediaType === "LINK") {
    // Pure text (and embeds/links, which carry no media file of ours to
    // inspect — a linked video is moderated by YouTube/Vimeo, not us, and a
    // plain link is just a URL) keeps the existing soft-flag behavior:
    // stored hidden, reviewable by an admin rather than silently discarded.
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

  const post = await prisma.post.create({
    data: {
      authorId: user.id,
      circleId: parsed.data.circleId,
      channelId: parsed.data.channelId,
      content: parsed.data.content,
      intentTag: parsed.data.intentTag,
      feedCategory: parsed.data.feedCategory,
      mediaType,
      mediaUrls: mediaType === "IMAGE" ? mediaUrls : [],
      videoUrl: mediaType === "VIDEO" ? videoUrl : undefined,
      videoThumbnailUrl: mediaType === "VIDEO" ? videoThumbnailUrl : undefined,
      embedProvider: embed?.provider,
      embedId: embed?.id,
      linkUrl: linkUrl ?? undefined,
      eventAt,
      eventLocation,
      moderationStatus,
    },
  });
  const embedTitle = await embedTitlePromise;
  await updatePostEmbedding(post.id, [parsed.data.content, embedTitle].filter(Boolean).join("\n"));
  await recordActivity(user.id);
  await track("POST_CREATED", user.id, { circleId: parsed.data.circleId ?? null, mediaType });

  // Notify subscribers of new content. Skipped for flagged content —
  // subscribers shouldn't be pointed at a post that isn't publicly visible.
  if (moderationStatus === "PUBLISHED") {
    await notifySubscribers(user.id, "SUBSCRIPTION_POST", { postId: post.id });
  }

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}

/** Circles the caller is a member of — backs the "Share to a Circle" picker. */
export async function getMyCircles() {
  const user = await requireVerifiedUser();

  const memberships = await prisma.circleMembership.findMany({
    where: { userId: user.id },
    include: { circle: { select: { id: true, name: true, slug: true, coverImageUrl: true } } },
    orderBy: { circle: { name: "asc" } },
  });

  return { circles: memberships.map((m) => m.circle) };
}
