"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { circleSchema, postSchema, confirmCircleCoverUploadSchema, updateCircleDetailsSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMedia, moderateImage } from "@/lib/moderation";
import { recordActivity } from "@/lib/trust";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { notifyConnections } from "@/lib/notify-connections";
import { isGiphyUrl } from "@/lib/giphy";
import {
  MEDIA_LIMITS,
  HIVE_VIDEO_MODERATION_MAX_SECONDS,
  VIDEO_INSTANT_PUBLISH_MAX_SECONDS,
  verifyUploadedSize,
  deleteObject,
  deleteOwnedObject,
  keyFromPublicUrl,
} from "@/lib/storage";
import { parseVideoEmbedUrl, fetchEmbedTitle, type ParsedEmbed } from "@/lib/video-embed";
import { isStreamConfigured, createStreamCopy } from "@/lib/cloudflare-stream";
import { normalizeLinkUrl } from "@/lib/link-url";
import { track } from "@/lib/analytics";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { canAccessChannel } from "@/lib/channel-permissions";
import { updateCircleEmbedding, toPgVector } from "@/lib/embeddings";
import { classifyPostCategory } from "@/lib/feed-category";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { evaluateDevice, trustDevice, touchKnownDevice } from "@/lib/device-trust";
import { createDeviceChallenge, verifyDeviceChallenge } from "@/lib/device-challenge";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

const CIRCLE_POSTS_PAGE_SIZE = 20;

export async function createCircle(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("circleCreate", user.id);
  if (!allowed) {
    redirect("/circles/new?error=rate_limited");
  }

  const parsed = circleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    category: formData.getAll("category"),
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
 * Owner or co-admin: renames a Circle and/or changes its categories (up to
 * 5, same bounds as creation — see circleSchema). The slug (used in its
 * URL) is deliberately left untouched regardless of a name change —
 * regenerating it on every rename would break existing links/bookmarks/
 * notifications pointing at the old one.
 */
export async function updateCircleDetails(circleId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("circleModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) {
    return { error: "not_found" as const };
  }
  const membership = await getCircleMembership(circleId, user.id);
  if (!isCircleAdmin(circle, membership, user)) {
    return { error: "forbidden" as const };
  }

  const parsed = updateCircleDetailsSchema.safeParse({
    name: formData.get("name"),
    category: formData.getAll("category"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { name, category } = parsed.data;

  const modResult = await moderateText(name);
  if (!modResult.allowed) {
    return { error: "moderation" as const };
  }

  await prisma.circle.update({ where: { id: circleId }, data: { name, category } });
  await updateCircleEmbedding(circleId, { name, description: circle.description, category });

  revalidatePath(`/circles/${circle.slug}`);
  revalidatePath("/circles");
  return { error: null };
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

  // New/unrecognized-device step-up — held before anything else runs (no
  // media has been "claimed"/moderated yet at this point, so a held post
  // doesn't leave partial state to unwind). The composer's own already-
  // uploaded media stays in R2 until either the challenge is confirmed
  // (composer resubmits this exact call, which then proceeds normally
  // below) or it's abandoned — same accepted tradeoff as the "upload size
  // enforced after the fact" gap in SECURITY.md.
  const deviceId = await getDeviceId();
  const deviceEvaluation = await evaluateDevice(user.id, deviceId);
  if (deviceEvaluation.status === "unrecognized" && deviceId) {
    const sendAllowed = await checkRateLimit("deviceChallengeSend", `devchallenge:send:${user.id}`);
    if (!sendAllowed) {
      return { error: "rate_limited" };
    }
    const label = await getDeviceLabel();
    const challenge = await createDeviceChallenge({
      userId: user.id,
      email: user.email,
      purpose: "POST",
      deviceId,
      deviceLabel: label,
    });
    return { error: "device_verification_required", challengeId: challenge.id };
  }
  if (deviceId) {
    if (deviceEvaluation.status === "trusted_first_device") {
      await trustDevice(user.id, deviceId, await getDeviceLabel());
    } else {
      await touchKnownDevice(user.id, deviceId);
    }
  }

  const circleId = formData.get("circleId");
  const channelId = formData.get("channelId");
  const mediaUrlsRaw = formData.get("mediaUrls");
  const parsed = postSchema.safeParse({
    circleId: circleId ? String(circleId) : undefined,
    channelId: channelId ? String(channelId) : undefined,
    content: formData.get("content"),
    intentTag: formData.get("intentTag") || undefined,
    visibility: formData.get("visibility") || undefined,
    // feedCategory is no longer author-supplied — classifyPostCategory
    // below assigns it automatically from the post's own content.
    mediaType: formData.get("mediaType") || "NONE",
    mediaUrls: mediaUrlsRaw ? JSON.parse(String(mediaUrlsRaw)) : [],
    videoUrl: formData.get("videoUrl") || undefined,
    videoThumbnailUrl: formData.get("videoThumbnailUrl") || undefined,
    videoDurationSeconds: formData.get("videoDurationSeconds") || undefined,
    embedUrl: formData.get("embedUrl") || undefined,
    eventAt: formData.get("eventAt") || undefined,
    eventLocation: formData.get("eventLocation") || undefined,
  });
  if (!parsed.success) {
    // Was a bare { error: "invalid" } with nothing else — the client-side
    // message for this ("That link isn't valid...") is written for the
    // embedUrl/LINK case specifically and is actively misleading for every
    // other validation failure, and with no server-side detail either,
    // diagnosing *which* field actually failed meant re-deriving it from
    // scratch each time. Logging the real Zod issues costs nothing and
    // turns the next one of these into a two-minute log check.
    console.error("[createPost] validation failed", parsed.error.flatten());
    return { error: "invalid" };
  }
  const { mediaType, mediaUrls, videoUrl, videoThumbnailUrl, videoDurationSeconds, eventAt, eventLocation } =
    parsed.data;
  // Hive's Visual Moderation API can't scan past 60s of content — a longer
  // video skips the automated moderate-videos cron entirely (it would just
  // fail/waste a call) and instead goes through the slower Cloudflare
  // Stream long-form review pipeline (video-review.ts) in the background.
  const videoNeedsLongReview =
    mediaType === "VIDEO" &&
    videoDurationSeconds !== undefined &&
    videoDurationSeconds > HIVE_VIDEO_MODERATION_MAX_SECONDS;
  // Only videos past VIDEO_INSTANT_PUBLISH_MAX_SECONDS actually stay
  // FLAGGED/hidden while that review runs — anything from 60s up to that
  // ceiling publishes immediately (same "publish now, react if flagged"
  // model as everything else) and just gets removed after the fact if the
  // background review comes back flagged. See storage.ts.
  const videoNeedsHold =
    videoNeedsLongReview && videoDurationSeconds !== undefined && videoDurationSeconds > VIDEO_INSTANT_PUBLISH_MAX_SECONDS;

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

  if (mediaType === "GIF") {
    // Never uploaded to this app's R2 bucket (picked straight from Giphy
    // search) — the Giphy host check is the only gate, same reasoning as
    // sendMessage's GIF branch (src/app/actions/messages.ts).
    if (mediaUrls.length !== 1 || !isGiphyUrl(mediaUrls[0])) {
      return { error: "invalid" };
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

  if (mediaType === "NONE" || mediaType === "EMBED" || mediaType === "LINK" || mediaType === "GIF") {
    // Pure text (and embeds/links, which carry no media file of ours to
    // inspect — a linked video is moderated by YouTube/Vimeo, not us, and a
    // plain link is just a URL) keeps the existing soft-flag behavior:
    // stored hidden, reviewable by an admin rather than silently discarded.
    // A GIF joins this group too — Giphy's catalog is pre-moderated, so
    // only the caption text (if any) needs checking here.
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
    if (videoNeedsHold) {
      moderationStatus = "FLAGGED";
    }
  }

  // Starts the long-video review's own slow part (Cloudflare copying and
  // encoding the video) right now instead of leaving it to whenever the
  // moderate-long-videos cron next discovers this post — that discovery lag
  // used to be the single biggest source of delay between "uploaded" and
  // "verdict" for a long video, bigger than the actual review work itself.
  // Kicked off alongside classifyPostCategory below rather than awaited
  // here, same reasoning as embedTitlePromise. Best-effort: createStreamCopy
  // already fails closed to null on any error, and advanceLongVideoReview
  // (video-review.ts) creates its own copy on the cron's first pass if this
  // one never lands — so a failure here just falls back to the old timing,
  // never blocks or fails the post itself.
  const streamUidPromise =
    videoNeedsLongReview && videoUrl && isStreamConfigured() ? createStreamCopy(videoUrl) : Promise.resolve(null);

  // Feed section is auto-assigned from the post's own content instead of
  // the manual picker post-composer.tsx used to show — classifyPostCategory
  // embeds [content, embed title] once and hands back that same vector, so
  // it's reused for Post.embedding below instead of paying for a second
  // OpenAI call.
  const embedTitle = await embedTitlePromise;
  const { category: feedCategory, embedding } = await classifyPostCategory(
    [parsed.data.content, embedTitle].filter(Boolean).join("\n"),
  );
  const streamUid = await streamUidPromise;

  const post = await prisma.post.create({
    data: {
      authorId: user.id,
      circleId: parsed.data.circleId,
      channelId: parsed.data.channelId,
      content: parsed.data.content,
      intentTag: parsed.data.intentTag,
      // Meaningless inside a Circle (membership is already the access
      // boundary there) — always stored PUBLIC regardless of what the
      // composer sent, rather than trusting a client-chosen value that
      // getVisiblePostsWhere would ignore for circle posts anyway.
      visibility: parsed.data.circleId ? "PUBLIC" : parsed.data.visibility,
      feedCategory,
      mediaType,
      mediaUrls: mediaType === "IMAGE" || mediaType === "GIF" ? mediaUrls : [],
      videoUrl: mediaType === "VIDEO" ? videoUrl : undefined,
      videoThumbnailUrl: mediaType === "VIDEO" ? videoThumbnailUrl : undefined,
      videoDurationSeconds: mediaType === "VIDEO" ? videoDurationSeconds : undefined,
      embedProvider: embed?.provider,
      embedId: embed?.id,
      linkUrl: linkUrl ?? undefined,
      eventAt,
      eventLocation,
      moderationStatus,
      // Long videos never reach the moderate-videos cron (Hive can't scan
      // past 60s anyway) — pre-claiming here keeps its
      // `mediaType VIDEO, videoModeratedAt IS NULL` scan from picking them
      // up and wasting/failing a Hive call on something it was never going
      // to handle.
      videoModeratedAt: videoNeedsLongReview ? new Date() : undefined,
      videoStreamUid: streamUid ?? undefined,
      // Independent of moderationStatus (see schema.prisma) — true for both
      // the FLAGGED-hold tier and the new instant-publish-but-still-review
      // tier, so moderate-long-videos picks either up regardless of whether
      // this post is already visible.
      videoLongReviewNeeded: videoNeedsLongReview,
    },
  });
  if (embedding) {
    await prisma.$executeRaw`UPDATE "Post" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${post.id}`;
  }
  await recordActivity(user.id);
  await track("POST_CREATED", user.id, { circleId: parsed.data.circleId ?? null, mediaType });

  // Video-body scanning (Hive) happens on the moderate-videos cron, not
  // here — a video 60s or under publishes immediately with videoModeratedAt
  // still null, same "publish immediately, flag retroactively if needed"
  // approach as text/image moderation, but Hive's Visual Moderation API is a
  // synchronous call best kept out of this user-facing request path. A video
  // over 60s skips this path entirely (videoNeedsLongReview above already
  // set videoModeratedAt and videoLongReviewNeeded at creation; videoNeedsHold
  // additionally holds it FLAGGED past VIDEO_INSTANT_PUBLISH_MAX_SECONDS).

  // Notify subscribers of new content. Skipped for flagged content, and for
  // anything other than PUBLIC visibility — a subscriber isn't necessarily
  // an accepted connection, so a Friends-only/Private post shouldn't point
  // them at something getVisiblePostsWhere would then just hide from them.
  if (moderationStatus === "PUBLISHED" && post.visibility === "PUBLIC") {
    await notifySubscribers(user.id, "SUBSCRIPTION_POST", { postId: post.id });
    // Tells any open Home feed tab to refetch — both the matching category
    // tab and "All" (PostFeedSection's own category prop), same "thin
    // signal, go refetch through the existing already-authorized query"
    // shape as every other realtime channel in this app. Harmless if a
    // given viewer's getVisiblePostsWhere/buildCategoryFilter ends up
    // returning nothing new for them (e.g. this post isn't actually visible
    // to them) — the refetch just comes back empty.
    await Promise.all([
      publishEvent(REALTIME_CHANNELS.homeFeed("all"), "changed"),
      ...(feedCategory ? [publishEvent(REALTIME_CHANNELS.homeFeed(feedCategory), "changed")] : []),
    ]);
  } else if (moderationStatus === "PUBLISHED" && post.visibility === "CONNECTIONS_ONLY") {
    // The PUBLIC branch above already reaches every accepted connection too
    // (accepting a connection request auto-subscribes both sides — see
    // respondToConnectionRequest in actions/connections.ts), so this is
    // mutually exclusive with it, not additive: a CONNECTIONS_ONLY post is
    // invisible to a subscriber who isn't also a connection, so only actual
    // connections get notified here instead of everyone the author is
    // subscribed by.
    await notifyConnections(user.id, "CONNECTION_POST", { postId: post.id });
  }

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}

/**
 * Confirms the emailed code for a post createPost above paused on
 * (unrecognized device). Only trusts the device and reports back — it
 * deliberately doesn't create the post itself, since re-deriving the full
 * post payload here would duplicate createPost's entire validation/
 * moderation/upload-verification pipeline. The composer instead resubmits
 * the exact same createPost(fd) call once this returns ok:true, and that
 * retry now sails through the device check above.
 */
export async function confirmPostDeviceChallenge(challengeId: string, code: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("deviceChallengeCheck", `devchallenge:${user.id}`);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const result = await verifyDeviceChallenge(challengeId, user.id, code);
  if (!result.ok) {
    return { error: result.error };
  }
  if (result.challenge.purpose !== "POST") {
    return { error: "invalid_code" as const };
  }

  await trustDevice(user.id, result.challenge.deviceId, await getDeviceLabel());
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

/**
 * Auto-load-more for a Circle channel's post feed (/circles/[slug]) — called
 * from the client via useInfiniteScroll (src/lib/use-infinite-scroll.ts).
 * Re-derives the same read-access rule the page itself uses for its
 * `accessibleChannels` filter (src/app/circles/[slug]/page.tsx) — a channel
 * is readable if it's PUBLIC, the caller moderates the Circle, or the
 * caller has an explicit ChannelMembership row. Deliberately not the
 * stricter canAccessChannel (channel-permissions.ts), which additionally
 * requires Circle membership — that's the *posting* rule, not the reading
 * one, and a public Circle's public channels are readable by non-members.
 */
export async function loadMoreCirclePosts(channelId: string, cursor: string) {
  const user = await requireUser();

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { circle: true, members: { select: { userId: true } } },
  });
  if (!channel || channel.type !== "TEXT") {
    return { items: [], hasMore: false };
  }
  const circleMembership = await getCircleMembership(channel.circleId, user.id);
  const canModerate = isCircleAdmin(channel.circle, circleMembership, user);
  // A private Circle hides its channels/posts from non-members entirely,
  // even a channel that's itself marked PUBLIC — matches the page's own
  // `isPrivateNonMember` gate.
  const isPrivateNonMember = channel.circle.visibility === "PRIVATE" && !circleMembership && !canModerate;
  const canRead =
    !isPrivateNonMember &&
    (channel.visibility === "PUBLIC" || canModerate || channel.members.some((m) => m.userId === user.id));
  if (!canRead) {
    return { items: [], hasMore: false };
  }

  const rawPosts = await prisma.post.findMany({
    where: { channelId: channel.id, moderationStatus: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: CIRCLE_POSTS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
    include: postCardInclude,
  });
  const items = await attachViewerState(rawPosts, user.id);
  return { items, hasMore: rawPosts.length === CIRCLE_POSTS_PAGE_SIZE };
}
