"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser, requireVerifiedViewer, requireViewer } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { buildSeriesRule, type EventSeriesRule } from "@/lib/event-recurrence";
import {
  circleSchema,
  eventRepeatSchema,
  postSchema,
  confirmCircleCoverUploadSchema,
  updateCircleDetailsSchema,
  circleInviteSchema,
} from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMediaChecks, moderateImage } from "@/lib/moderation";
import {
  decideMediaModeration,
  mediaHoldAuditReason,
  mediaRejectAuditReason,
  MEDIA_HOLD_PERFORMED_BY,
  MEDIA_REJECT_PERFORMED_BY,
} from "@/lib/media-moderation-hold";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { isGiphyUrl } from "@/lib/giphy";
import {
  MEDIA_LIMITS,
  HIVE_VIDEO_MODERATION_MAX_SECONDS,
  VIDEO_INSTANT_PUBLISH_MAX_SECONDS,
  verifyUploadedSize,
  checkUploadedSize,
  worstUploadedSizeCheck,
  type UploadedSizeCheck,
  deleteObject,
  keyFromPublicUrl,
  publicUrlForKey,
} from "@/lib/storage";
import { deleteOwnedUploads } from "@/lib/owned-uploads";
import { isCircleCoverKey, isOwnedUploadKey } from "@/lib/media-keys";
import { parseVideoEmbedUrl, fetchEmbedTitle, type ParsedEmbed } from "@/lib/video-embed";
import { isStreamConfigured, createStreamCopy } from "@/lib/cloudflare-stream";
import { normalizeLinkUrl } from "@/lib/link-url";
import { track } from "@/lib/analytics";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";
import { checkSubCircleParent, subCircleVisibility } from "@/lib/circle-hierarchy";
import { canSeeCircle, canSeeCircleContent } from "@/lib/circle-visibility";
import { LEAD_POST_ONLY } from "@/lib/post-visibility";
import {
  circleCreateLockKey,
  circleDedupeCutoff,
  isRecentDuplicateCircle,
} from "@/lib/circle-create-dedupe";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { canAccessChannel } from "@/lib/channel-permissions";
import { updateCircleEmbedding } from "@/lib/embeddings";
import { classifyPostCategory } from "@/lib/feed-category";
import { afterPostCreated } from "@/lib/post-created";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { evaluateDevice, trustDevice, touchKnownDevice } from "@/lib/device-trust";
import { createDeviceChallenge, verifyDeviceChallenge } from "@/lib/device-challenge";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { publishEvent, notifyBadgeChange } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { isBlockedWithAny } from "@/lib/blocks";
import { pushActivityNotification } from "@/lib/notify-push";
import {
  canInviteToCircle,
  canInviterStillInvite,
  isStaleCircleInvite,
  planCircleInvites,
  selectCircleInvitees,
} from "@/lib/circle-invite";
import { inviterStandingSelect, loadCircleInviteExclusions } from "@/lib/circle-invite-data";

const CIRCLE_POSTS_PAGE_SIZE = 20;

async function findRecentDuplicate(
  db: Pick<typeof prisma, "circle">,
  userId: string,
  name: string,
  parentId: string | null,
) {
  const now = new Date();
  const found = await db.circle.findFirst({
    where: {
      createdById: userId,
      parentId,
      name: { equals: name.trim(), mode: "insensitive" },
      createdAt: { gte: circleDedupeCutoff(now) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true, parentId: true, createdById: true, createdAt: true },
  });
  return found && isRecentDuplicateCircle(found, { userId, name, parentId }, now) ? found : null;
}

export async function createCircle(formData: FormData) {
  const user = await requireVerifiedUser();

  // Optional: creating a sub-circle under an existing main Circle (see
  // src/lib/circle-hierarchy.ts). Re-validated here in full — the wizard's
  // hidden field is just a hint, never trusted.
  const parentIdInput = String(formData.get("parentId") ?? "").trim();
  const parent = parentIdInput
    ? await prisma.circle.findUnique({
        where: { id: parentIdInput },
        select: { id: true, slug: true, createdById: true, parentId: true, visibility: true },
      })
    : null;
  if (parentIdInput) {
    const parentCheck = checkSubCircleParent(parent, user.id);
    if (parentCheck !== "ok") {
      redirect("/circles/new?error=invalid_parent");
    }
  }
  // Errors go back to the same form (with its parent), not a blank new one.
  const formPath = (error: string) =>
    parent ? `/circles/new?parent=${encodeURIComponent(parent.slug)}&error=${error}` : `/circles/new?error=${error}`;

  const parsed = circleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    category: formData.getAll("category"),
    visibility: formData.get("visibility") || undefined,
  });

  // Where a finished create (or a duplicate of one) lands.
  const finishAt = (target: { slug: string }): never => {
    if (parent) redirect(`/circles/${parent.slug}`);
    redirect(`/circles/${target.slug}`);
  };

  // A double-tap / retry of a submit that already created the Circle resolves
  // to that Circle. This read-only check runs BEFORE the rate limiter and
  // moderation so the retry isn't refused (rate_limited) or re-billed; the
  // first submit was already allowed and moderated. The transaction below
  // re-checks under a lock for the truly concurrent case.
  if (parsed.success) {
    const earlier = await findRecentDuplicate(prisma, user.id, parsed.data.name, parent?.id ?? null);
    if (earlier) finishAt(earlier);
  }

  const allowed = await checkRateLimit(parent ? "subCircleCreate" : "circleCreate", user.id);
  if (!allowed) {
    redirect(formPath("rate_limited"));
  }

  if (!parsed.success) {
    redirect(formPath("invalid"));
  }
  const { name, description, category } = parsed.data;
  const visibility = parent ? subCircleVisibility(parent.visibility, parsed.data.visibility) : parsed.data.visibility;

  const modResult = await moderateText(`${name}\n${description}`);
  if (!modResult.allowed) {
    redirect(formPath("moderation"));
  }

  const baseSlug = slugify(name) || "circle";
  // Serialized per (creator, name, parent): the second of two concurrent
  // submits waits for the first, then finds its Circle and creates nothing.
  // A slug collision (P2002) retries the slug scan once instead of a 500.
  let result: { circle: { id: string; slug: string }; created: boolean } | null = null;
  for (let tries = 0; tries < 2 && !result; tries += 1) {
    try {
      result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${circleCreateLockKey(user.id, name, parent?.id ?? null)}))`;
        const earlier = await findRecentDuplicate(tx, user.id, name, parent?.id ?? null);
        if (earlier) return { circle: earlier, created: false };

        let slug = baseSlug;
        let attempt = 0;
        // Free-form group creation invites slug collisions; resolve deterministically.
        while (await tx.circle.findUnique({ where: { slug }, select: { id: true } })) {
          attempt += 1;
          slug = `${baseSlug}-${attempt}`;
        }
        const created = await tx.circle.create({
          data: {
            name,
            description,
            category,
            visibility,
            slug,
            parentId: parent?.id ?? null,
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
          select: { id: true, slug: true },
        });
        return { circle: created, created: true };
      });
    } catch (err) {
      if (!isUniqueConstraintError(err) || tries === 1) throw err;
    }
  }
  if (!result) throw new Error("createCircle: no result");
  const circle = result.circle;
  // Already created by the other submit, which did the embedding, analytics
  // and notifications: don't repeat them.
  if (!result.created) finishAt(circle);

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
  // A sub-circle isn't announced to the owner's subscribers: someone setting
  // up a main Circle's sub-circles would otherwise send them one "created a
  // Circle" notification per sub-circle. The main Circle's own creation
  // already told them. Nor is a PRIVATE Circle: to anyone but its members it
  // doesn't exist (lib/circle-visibility.ts), and a subscriber isn't one.
  if (!parent && visibility === "PUBLIC") {
    await notifySubscribers(user.id, "SUBSCRIPTION_CIRCLE_CREATED", { circleId: circle.id });
  }

  revalidatePath("/circles");
  if (parent) {
    // Back to the main Circle (where the new sub-circle now appears), so the
    // owner can keep adding more, not off to the one they just made.
    revalidatePath(`/circles/${parent.slug}`);
    redirect(`/circles/${parent.slug}`);
  }
  redirect(`/circles/${circle.slug}`);
}

export async function joinCircle(circleId: string) {
  const user = await requireVerifiedUser();

  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: {
      id: true,
      slug: true,
      visibility: true,
      createdById: true,
      members: { where: { role: "MODERATOR" }, select: { userId: true } },
    },
  });
  if (!circle) {
    return { error: "not_found" as const };
  }

  if (circle.visibility === "PRIVATE") {
    // A PRIVATE Circle is invite-only and doesn't exist for a non-member (lib/circle-visibility.ts): the only way in is
    // a pending invite, which "Accept invite" (this action) accepts. There is no request to join any more: without an
    // invite this answers exactly like a Circle that doesn't exist, and no CircleJoinRequest is created. Requests made
    // before this rule stay in the database and the Circle's admins can still answer them (respondToCircleJoinRequest),
    // but the person who sent one no longer sees the Circle.
    const alreadyMember = await prisma.circleMembership.findUnique({
      where: { userId_circleId: { userId: user.id, circleId } },
    });
    if (alreadyMember) {
      revalidatePath("/circles");
      return { error: null, requested: false };
    }
    // Invited: the button reads "Accept invite", and this accepts it.
    const pendingInvite = await prisma.circleInvite.findFirst({
      where: { circleId, inviteeId: user.id, status: "PENDING" },
      select: { id: true, inviterId: true },
    });
    if (pendingInvite) {
      const accepted = await acceptCircleInvite(user.id, pendingInvite, circle);
      if (!accepted.error) {
        revalidatePath("/circles");
        return { error: null, requested: false };
      }
      // Refused (invite_expired: its inviter can no longer invite, so it was deleted; a block; a race): answered as is.
      return { error: accepted.error, requested: false };
    }
    return { error: "not_found" as const, requested: false };
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

  // Guarded on PENDING, like respondToCircleInvite: a request another admin (or inviteToCircle, or the requester
  // accepting an invite) already answered is left alone — no second CIRCLE_JOIN_APPROVED, no membership work redone.
  const now = new Date();
  const { count } = await prisma.circleJoinRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: approve ? "APPROVED" : "DECLINED", respondedAt: now },
  });
  if (count === 0) {
    revalidatePath(`/circles/${request.circle.slug}`);
    return { error: "not_found" as const };
  }

  if (approve) {
    await prisma.circleMembership.upsert({
      where: { userId_circleId: { userId: request.userId, circleId: request.circleId } },
      create: { userId: request.userId, circleId: request.circleId },
      update: {},
    });
    // Same as inviteToCircle's approval: an older invite of theirs shouldn't keep its old status in the list.
    await prisma.circleInvite.updateMany({
      where: { circleId: request.circleId, inviteeId: request.userId, status: { not: "ACCEPTED" } },
      data: { status: "ACCEPTED", respondedAt: now },
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

  revalidatePath(`/circles/${request.circle.slug}`);
  return { error: null };
}

/**
 * Owner or co-admin of a PRIVATE Circle: invites some of their accepted connections to join (each must accept via
 * respondToCircleInvite). Judged by membership role, not isCircleAdmin — its site-admin shortcut would let a site admin
 * invite people into anyone's private Circle. Who can be invited, the 50-person cap and what a re-invite does are in
 * lib/circle-invite.ts. Someone who already asked to join (a PENDING CircleJoinRequest) is let straight in instead.
 * `invited` counts invites actually sent (new or re-sent), `approved` the join requests approved, `skipped` the people
 * named who can't be invited.
 */
export async function inviteToCircle(circleId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, slug: true, visibility: true, createdById: true },
  });
  if (!circle) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCircleMembership(circleId, user.id);
  if (!canInviteToCircle(circle, myMembership, user.id)) {
    return { error: "forbidden" as const };
  }
  if (circle.visibility !== "PRIVATE") {
    return { error: "not_private" as const };
  }

  const parsed = circleInviteSchema.safeParse({ inviteeIds: formData.getAll("inviteeIds") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  const allowed = await checkRateLimit("circleInvite", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const requestedIds = [...new Set(parsed.data.inviteeIds)];
  const selection = selectCircleInvitees(
    requestedIds,
    await loadCircleInviteExclusions(circle, user.id, requestedIds),
  );
  if (!selection.ok) {
    return { error: selection.error };
  }
  const { inviteeIds, skipped } = selection;
  if (inviteeIds.length === 0) {
    return { error: null, invited: 0, approved: 0, skipped };
  }

  const [existingRows, pendingRequests] = await Promise.all([
    prisma.circleInvite.findMany({
      where: { circleId, inviteeId: { in: inviteeIds } },
      select: { id: true, inviteeId: true, status: true, inviterId: true, inviter: inviterStandingSelect([circleId]) },
    }),
    prisma.circleJoinRequest.findMany({
      where: { circleId, userId: { in: inviteeIds }, status: "PENDING" },
      select: { userId: true },
    }),
  ]);
  // A PENDING invite whose inviter can no longer invite can't be accepted; re-inviting resets it like a DECLINED one.
  const existingInvites = existingRows.map(({ inviter, ...invite }) => ({
    ...invite,
    stale: isStaleCircleInvite(circle, { status: invite.status, inviter }),
  }));
  const plan = planCircleInvites({
    inviteeIds,
    existingInvites: new Map(existingInvites.map((i) => [i.inviteeId, i])),
    // Members were excluded above, so nobody left is one.
    memberIds: [],
    pendingRequestUserIds: pendingRequests.map((r) => r.userId),
  });
  const now = new Date();

  // Already asked to join: approve the request, as respondToCircleJoinRequest would. Guarded on PENDING so a request
  // another admin answered meanwhile isn't approved (or announced) twice.
  const approvedIds =
    plan.approveRequests.length > 0
      ? (
          await prisma.circleJoinRequest.updateManyAndReturn({
            where: { circleId, userId: { in: plan.approveRequests }, status: "PENDING" },
            data: { status: "APPROVED", respondedAt: now },
            select: { userId: true },
          })
        ).map((a) => a.userId)
      : [];
  if (approvedIds.length > 0) {
    await prisma.circleMembership.createMany({
      data: approvedIds.map((userId) => ({ userId, circleId })),
      skipDuplicates: true,
    });
    // An older invite of theirs (declined, or from before they left) shouldn't keep its old status in the list.
    await prisma.circleInvite.updateMany({
      where: { circleId, inviteeId: { in: approvedIds }, status: { not: "ACCEPTED" } },
      data: { status: "ACCEPTED", respondedAt: now },
    });
    await prisma.notification.createMany({
      data: approvedIds.map((recipientId) => ({
        recipientId,
        actorId: user.id,
        type: "CIRCLE_JOIN_APPROVED" as const,
        circleId,
      })),
    });
  }

  // Only rows this request actually created or re-opened are notified: skipDuplicates drops an invite a concurrent
  // request got to first, and each reset is guarded on the status and inviter it was read with (so two admins
  // re-sending the same stale PENDING invite at once reset and notify it only once).
  const createdIds =
    plan.create.length > 0
      ? (
          await prisma.circleInvite.createManyAndReturn({
            data: plan.create.map((inviteeId) => ({ circleId, inviterId: user.id, inviteeId })),
            skipDuplicates: true,
            select: { inviteeId: true },
          })
        ).map((c) => c.inviteeId)
      : [];
  const existingById = new Map(existingInvites.map((i) => [i.id, i]));
  const resetIds = (
    await Promise.all(
      plan.reset.map(async ({ inviteId, inviteeId }) => {
        const existing = existingById.get(inviteId);
        if (!existing) return null;
        const { count } = await prisma.circleInvite.updateMany({
          where: { id: inviteId, status: existing.status, inviterId: existing.inviterId },
          // Whoever asks again becomes the inviter the invitee sees.
          data: { status: "PENDING", inviterId: user.id, createdAt: now, respondedAt: null },
        });
        return count > 0 ? inviteeId : null;
      }),
    )
  ).filter((id): id is string => id !== null);

  const notifiedIds = [...createdIds, ...resetIds];
  if (notifiedIds.length > 0) {
    await prisma.notification.createMany({
      data: notifiedIds.map((recipientId) => ({
        recipientId,
        actorId: user.id,
        type: "CIRCLE_INVITE" as const,
        circleId,
      })),
      skipDuplicates: true,
    });
    // Personally addressed, so it also pushes (unlike the bell-only COLLAB_INVITE).
    await Promise.all(
      notifiedIds.map(async (recipientId) => {
        await pushActivityNotification(recipientId, "CIRCLE_INVITE", user.name, `/circles/${circle.slug}`);
        await notifyBadgeChange(recipientId);
      }),
    );
  }

  revalidatePath(`/circles/${circle.slug}`);
  return { error: null, invited: notifiedIds.length, approved: approvedIds.length, skipped };
}

/**
 * Lets `userId` into the Circle on a PENDING invite of theirs — the shared tail of respondToCircleInvite and of
 * joinCircle (asking to join while invited). Blocks are checked again (with the inviter and the owner), since either
 * side may have blocked the other after the invite went out; the invitee's ACTIVE status is already enforced by
 * requireVerifiedUser. The PENDING → ACCEPTED claim is guarded, so a double tap, or a cancel in between, can't let
 * anyone in twice (or at all, once cancelled). Membership of a private Circle is never announced to subscribers.
 */
async function acceptCircleInvite(
  userId: string,
  invite: { id: string; inviterId: string },
  circle: { id: string; slug: string; createdById: string },
) {
  // The invite only stands while its inviter could still send it: owner or still a co-admin, account still ACTIVE.
  // One that no longer does is deleted (with the invitee's bell entry), like a cancelled one, so it doesn't linger.
  const [inviter, inviterMembership] = await Promise.all([
    prisma.user.findUnique({ where: { id: invite.inviterId }, select: { id: true, status: true } }),
    getCircleMembership(circle.id, invite.inviterId),
  ]);
  // Both writes below are also guarded on the inviter that was checked: an admin may re-send a stale invite (same row,
  // new inviter) in between, and that fresh invite must be neither deleted here nor accepted on the old check.
  if (!canInviterStillInvite(circle, inviter, inviterMembership)) {
    const { count: removed } = await prisma.circleInvite.deleteMany({
      where: { id: invite.id, inviteeId: userId, status: "PENDING", inviterId: invite.inviterId },
    });
    if (removed > 0) {
      await prisma.notification.deleteMany({
        where: { recipientId: userId, circleId: circle.id, type: "CIRCLE_INVITE" },
      });
    }
    revalidatePath(`/circles/${circle.slug}`);
    return { error: "invite_expired" as const };
  }

  if (await isBlockedWithAny(userId, [invite.inviterId, circle.createdById])) {
    return { error: "unavailable" as const };
  }

  const now = new Date();
  const { count } = await prisma.circleInvite.updateMany({
    where: { id: invite.id, inviteeId: userId, status: "PENDING", inviterId: invite.inviterId },
    data: { status: "ACCEPTED", respondedAt: now },
  });
  if (count === 0) {
    return { error: "not_found" as const };
  }

  const existing = await getCircleMembership(circle.id, userId);
  await prisma.circleMembership.upsert({
    where: { userId_circleId: { userId, circleId: circle.id } },
    create: { userId, circleId: circle.id },
    update: {},
  });
  // A request to join they'd also sent is answered by this.
  await prisma.circleJoinRequest.updateMany({
    where: { circleId: circle.id, userId, status: "PENDING" },
    data: { status: "APPROVED", respondedAt: now },
  });

  if (!existing) {
    await track("CIRCLE_JOINED", userId, { circleId: circle.id });
    await prisma.notification.create({
      data: { recipientId: invite.inviterId, actorId: userId, type: "CIRCLE_INVITE_ACCEPTED", circleId: circle.id },
    });
    // The owner and co-admins hear about a new member as they would any other way; the inviter already got the more
    // specific CIRCLE_INVITE_ACCEPTED above.
    const moderators = await prisma.circleMembership.findMany({
      where: { circleId: circle.id, role: "MODERATOR" },
      select: { userId: true },
    });
    const recipientIds = new Set([circle.createdById, ...moderators.map((m) => m.userId)]);
    recipientIds.delete(userId);
    recipientIds.delete(invite.inviterId);
    if (recipientIds.size > 0) {
      await prisma.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          recipientId,
          actorId: userId,
          type: "CIRCLE_JOINED" as const,
          circleId: circle.id,
        })),
      });
    }
  }

  revalidatePath(`/circles/${circle.slug}`);
  return { error: null };
}

/** Invitee only: accepts or declines a pending CircleInvite. Declining tells nobody. */
export async function respondToCircleInvite(inviteId: string, accept: boolean) {
  const user = await requireVerifiedUser();

  const invite = await prisma.circleInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      inviteeId: true,
      inviterId: true,
      circle: { select: { id: true, slug: true, createdById: true } },
    },
  });
  // Someone else's invite answers exactly like a missing one.
  if (!invite || invite.inviteeId !== user.id) {
    return { error: "not_found" as const };
  }

  if (accept) {
    return acceptCircleInvite(user.id, invite, invite.circle);
  }

  const { count } = await prisma.circleInvite.updateMany({
    where: { id: inviteId, inviteeId: user.id, status: "PENDING" },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
  if (count === 0) {
    return { error: "not_found" as const };
  }
  revalidatePath(`/circles/${invite.circle.slug}`);
  return { error: null };
}

/** Owner or co-admin: withdraws a PENDING invite (the row is deleted, with the invitee's bell entry for it). */
export async function cancelCircleInvite(inviteId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("circleModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const invite = await prisma.circleInvite.findUnique({
    where: { id: inviteId },
    select: { inviteeId: true, circle: { select: { id: true, slug: true, createdById: true } } },
  });
  if (!invite) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCircleMembership(invite.circle.id, user.id);
  if (!canInviteToCircle(invite.circle, myMembership, user.id)) {
    return { error: "forbidden" as const };
  }

  const { count } = await prisma.circleInvite.deleteMany({ where: { id: inviteId, status: "PENDING" } });
  if (count === 0) {
    return { error: "not_found" as const };
  }
  await prisma.notification.deleteMany({
    where: { recipientId: invite.inviteeId, circleId: invite.circle.id, type: "CIRCLE_INVITE" },
  });

  revalidatePath(`/circles/${invite.circle.slug}`);
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

  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: { parent: { select: { slug: true } } },
  });
  if (!circle) {
    return { error: "not_found" as const };
  }
  if (circle.createdById !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  // Deleting a main Circle also deletes its sub-circles (the FK cascades) —
  // the delete button warns about that up front.
  await prisma.circle.delete({ where: { id: circleId } });

  revalidatePath("/circles");
  if (circle.parent) {
    // A sub-circle: back to the main Circle it belonged to, not the list.
    revalidatePath(`/circles/${circle.parent.slug}`);
    redirect(`/circles/${circle.parent.slug}`);
  }
  redirect("/circles");
}

/**
 * Owner or co-admin: renames a Circle and/or changes its categories (up to
 * 5, same bounds as creation — see circleSchema), edits its theme (the
 * `description` column — the creation wizard's "Theme" step) and/or its privacy
 * (PUBLIC / PRIVATE). The slug (used in its
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
    description: formData.get("description"),
    category: formData.getAll("category"),
    visibility: formData.get("visibility") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { name, description, category } = parsed.data;

  // Privacy. A sub-circle can never be more open than the main Circle it sits under (same rule as at creation).
  let visibility = parsed.data.visibility ?? circle.visibility;
  if (circle.parentId) {
    const parent = await prisma.circle.findUnique({ where: { id: circle.parentId }, select: { visibility: true } });
    if (parent) visibility = subCircleVisibility(parent.visibility, visibility);
  }
  const visibilityChanged = visibility !== circle.visibility;

  // Same text gate as creation (createCircle): name and theme together, so a
  // Circle can't be created clean and then edited into something that
  // wouldn't have passed.
  const modResult = await moderateText(`${name}\n${description}`);
  if (!modResult.allowed) {
    return { error: "moderation" as const };
  }

  await prisma.circle.update({ where: { id: circleId }, data: { name, description, category, visibility } });
  await updateCircleEmbedding(circleId, { name, description, category });

  if (visibilityChanged && visibility === "PRIVATE") {
    // Going private also takes a main Circle's sub-circles private (a sub-circle can't be more open than its parent),
    // and pulls everything back to members-only: notifications that already told non-members about this Circle's
    // posts / live streams would otherwise keep pointing at content they can no longer open.
    const subs = await prisma.circle.findMany({
      where: { parentId: circleId, visibility: "PUBLIC" },
      select: { id: true, slug: true },
    });
    if (subs.length > 0) {
      await prisma.circle.updateMany({ where: { id: { in: subs.map((s) => s.id) } }, data: { visibility: "PRIVATE" } });
    }
    for (const id of [circleId, ...subs.map((s) => s.id)]) {
      await prisma.notification.deleteMany({
        where: {
          type: { in: ["SUBSCRIPTION_POST", "CONNECTION_POST", "SUBSCRIPTION_LIVE"] },
          OR: [{ post: { circleId: id } }, { liveStream: { circleId: id } }],
          recipient: { circleMemberships: { none: { circleId: id } } },
        },
      });
    }
    for (const s of subs) revalidatePath(`/circles/${s.slug}`);
    await publishEvent(REALTIME_CHANNELS.liveStreams(), "changed");
  } else if (visibilityChanged) {
    // Going public: a pending "request to join" or invite is moot now that anyone can join directly.
    await prisma.circleJoinRequest.deleteMany({ where: { circleId, status: "PENDING" } });
    await prisma.circleInvite.deleteMany({ where: { circleId, status: "PENDING" } });
  }

  revalidatePath(`/circles/${circle.slug}`);
  revalidatePath("/circles");
  revalidatePath("/home");
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

/**
 * Owner or co-admin: sets/replaces the Circle's cover picture. The key must be the caller's own `circle-cover/` upload and the stored URL is derived from it here, never taken from the client (a
 * client-supplied URL used to be stored as is, so a victim's media URL could be set as a cover, then deleted from R2
 * on the next cover change). The previous cover is deleted only if it is a `circle-cover/` object no other Circle uses.
 */
export async function confirmCircleCoverUpload(formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = confirmCircleCoverUploadSchema.safeParse({
    circleId: formData.get("circleId"),
    key: formData.get("key"),
  });
  if (!parsed.success || !isOwnedUploadKey(parsed.data.key, "circle-cover", user.id)) {
    return { error: "invalid" as const };
  }
  const { circleId, key } = parsed.data;
  const publicUrl = publicUrlForKey(key);

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

  const previousUrl = circle.coverImageUrl;

  await prisma.circle.update({
    where: { id: circleId },
    data: { coverImageUrl: publicUrl },
  });

  const previousKey = previousUrl ? keyFromPublicUrl(previousUrl) : null;
  if (previousUrl && previousKey && isCircleCoverKey(previousKey)) {
    const stillUsed = await prisma.circle.count({ where: { coverImageUrl: previousUrl } });
    if (stillUsed === 0) {
      await deleteObject(previousKey);
    }
  }

  revalidatePath(`/circles/${circle.slug}`);
  revalidatePath("/circles");
  return { error: null };
}

export async function createPost(formData: FormData) {
  const user = await requireVerifiedUser();

  // Idempotency: the composer sends one key per submission and retries a failed call with the same FormData
  // (withRetry in post-composer.tsx), which can reach the server after the first attempt already created the post (a
  // dropped response, or a throw after the create). A key that already has a post is that submission's success, not a
  // second post: answered before the rate limiter, like createCircle's double-submit guard.
  const clientRequestId = parseClientRequestId(formData.get("clientRequestId"));
  if (clientRequestId && (await postExistsForRequest(user.id, clientRequestId))) {
    return { error: null };
  }

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
      locale: DEFAULT_LOCALE,
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

  // A repeating Circle event (lib/event-recurrence.ts): only for an event in a Circle. The first occurrence is this
  // post; the event-series cron posts each next one, without notifying anyone.
  let seriesRule: EventSeriesRule | null = null;
  const repeatFrequency = formData.get("eventRepeat");
  if (repeatFrequency && repeatFrequency !== "NONE") {
    if (!eventAt || !parsed.data.circleId) return { error: "repeat_invalid" };
    const repeat = eventRepeatSchema.safeParse({
      frequency: repeatFrequency,
      count: formData.get("eventRepeatCount") || undefined,
      until: formData.get("eventRepeatUntil") || undefined,
    });
    if (!repeat.success) return { error: "repeat_invalid" };
    const built = buildSeriesRule(eventAt, repeat.data);
    if ("error" in built) return { error: built.error };
    seriesRule = built.rule;
  }
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

  // Ownership-checked per key (deleteOwnedUploads) so a foreign URL slipped
  // into mediaUrls/videoUrl can't get deleted via this cleanup path.
  const cleanupUploads = () => deleteOwnedUploads(uploadedUrls, user.id);

  // Size/ownership of every uploaded file. Only a real size problem is
  // reported as "too_large": R2 being unreachable, or the object not being
  // there (an upload that never finished), used to be answered "That file is
  // too large" and deleted the upload, for a file that was fine. Those now get
  // "upload_check_failed" (a try-again message) and nothing is deleted (an
  // upload no post ever references is removed by sweep-abandoned-uploads).
  async function checkOne(url: string | undefined, maxBytes: number): Promise<UploadedSizeCheck> {
    const key = url ? keyFromPublicUrl(url) : null;
    return key ? checkUploadedSize({ key, maxBytes, ownerId: user.id }) : "not_owner";
  }
  let sizeChecks: UploadedSizeCheck[] = [];
  if (mediaType === "IMAGE") {
    // Each HEAD check hits R2 independently — running them in sequence was
    // adding one round trip per image to every multi-image post.
    sizeChecks = await Promise.all(mediaUrls.map((url) => checkOne(url, MEDIA_LIMITS["post-image"])));
  } else if (mediaType === "VIDEO") {
    // The video and its thumbnail are unrelated objects — verifying them
    // one after the other was the single biggest source of "posting a video
    // feels slow" on the server side, adding a whole extra round trip.
    sizeChecks = await Promise.all([
      checkOne(videoUrl, MEDIA_LIMITS["post-video"]),
      videoThumbnailUrl ? checkOne(videoThumbnailUrl, MEDIA_LIMITS["video-thumb"]) : Promise.resolve("ok" as const),
    ]);
  }
  const sizeOutcome = worstUploadedSizeCheck(sizeChecks);
  if (sizeOutcome === "too_large" || sizeOutcome === "not_owner") {
    await cleanupUploads();
    // not_owner: a URL that isn't this person's own upload (a hand-made request); the generic "couldn't post".
    return { error: sizeOutcome === "too_large" ? "too_large" : "other" };
  }
  if (sizeOutcome === "missing" || sizeOutcome === "unavailable") {
    console.error(`[createPost] upload check ${sizeOutcome} for ${mediaType} post by ${user.id}`);
    return { error: "upload_check_failed" };
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
  // Set when the automated screen held this photo/video post for an admin
  // (src/lib/media-moderation-hold.ts): the reasons go into the audit row the
  // admin queue reads.
  let mediaHoldReasons: string[] | null = null;

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
    // Photos and videos: the caption, each photo and the video's still frame
    // are checked separately (decideMediaModeration). Nothing flagged goes
    // public either way, but only a must-delete category (sexual content
    // involving minors) is still rejected and deleted on the spot. Anything
    // else flagged — which used to be rejected and deleted the same way,
    // leaving an admin nothing to review and the poster no recourse when the
    // screen was wrong — is stored hidden and goes to /admin/moderation's
    // flagged queue. An API failure is not a flag (fails open, as before).
    const decision = decideMediaModeration(
      await moderateMediaChecks({
        text: parsed.data.content,
        imageUrls: mediaType === "IMAGE" ? mediaUrls : [],
        thumbnailUrl: mediaType === "VIDEO" ? videoThumbnailUrl : undefined,
      }),
    );
    if (decision.kind === "reject") {
      await cleanupUploads();
      // The record of it, without the media (nothing of it is kept): the
      // admin page lists these under "Rejected automatically".
      await prisma.auditLog.create({
        data: {
          targetId: user.id,
          action: "CONTENT_REMOVED",
          performedBy: MEDIA_REJECT_PERFORMED_BY,
          reason: mediaRejectAuditReason(mediaType, decision.reasons),
        },
      });
      console.warn(`[createPost] ${mediaType} post by ${user.id} rejected: ${decision.reasons.join("; ")}`);
      revalidatePath("/admin/moderation");
      return { error: "moderation" };
    }
    if (decision.kind === "hold") {
      moderationStatus = "FLAGGED";
      mediaHoldReasons = decision.reasons;
      console.warn(`[createPost] ${mediaType} post by ${user.id} held for review: ${decision.reasons.join("; ")}`);
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
  // A post the screen held (mediaHoldReasons) waits for an admin instead: the
  // long-video review's "clean" verdict would publish it on its own.
  const runLongReview = videoNeedsLongReview && !mediaHoldReasons;
  const streamUidPromise =
    runLongReview && videoUrl && isStreamConfigured() ? createStreamCopy(videoUrl) : Promise.resolve(null);

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

  // Fields every sibling in a multi-photo album shares identically with the
  // single-post case below — factored out so the two create paths can't
  // drift apart on anything but content/mediaUrls/albumId/albumIndex.
  const sharedPostData = {
    authorId: user.id,
    circleId: parsed.data.circleId,
    channelId: parsed.data.channelId,
    intentTag: parsed.data.intentTag,
    // Meaningless inside a Circle (membership is already the access
    // boundary there) — always stored PUBLIC regardless of what the
    // composer sent, rather than trusting a client-chosen value that
    // getVisiblePostsWhere would ignore for circle posts anyway.
    visibility: parsed.data.circleId ? "PUBLIC" : parsed.data.visibility,
    feedCategory,
    mediaType,
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
    // A held post (mediaHoldReasons) is stamped too: an admin decides it,
    // and approveFlaggedContent re-stamps this anyway.
    videoModeratedAt: videoNeedsLongReview || (mediaType === "VIDEO" && mediaHoldReasons) ? new Date() : undefined,
    videoStreamUid: streamUid ?? undefined,
    // Independent of moderationStatus (see schema.prisma) — true for both
    // the FLAGGED-hold tier and the new instant-publish-but-still-review
    // tier, so moderate-long-videos picks either up regardless of whether
    // this post is already visible.
    videoLongReviewNeeded: runLongReview,
  };

  let post;
  try {
    if (mediaType === "IMAGE" && mediaUrls.length > 1) {
      // A multi-photo post: instead of one Post row carrying every image, each
      // photo gets its own Post row — its own id, so it's independently
      // likeable/commentable/reshareable/shareable via its own /post/[id],
      // not sharing one engagement total across the whole set. All of them
      // share a fresh albumId (just a grouping key, not a foreign key to
      // another table) and are ordered by albumIndex; only index 0 (the
      // "lead") carries the caption and is what a feed/search/profile listing
      // ever surfaces (see LEAD_POST_ONLY) — the rest are reached from its
      // carousel (PostCard's AlbumCarousel) and by tapping into it. moderateMedia
      // above already checked the whole caption+image set together and would
      // have rejected the post outright on a violation, so there's no
      // per-sibling moderation status to compute here — every sibling is
      // simply PUBLISHED (moderationStatus from sharedPostData, unchanged).
      const albumId = randomUUID();
      const albumPosts = await prisma.$transaction(
        mediaUrls.map((url, i) =>
          prisma.post.create({
            data: {
              ...sharedPostData,
              content: i === 0 ? parsed.data.content : "",
              mediaUrls: [url],
              albumId,
              albumIndex: i,
              clientRequestId: i === 0 ? clientRequestId : null,
            },
          }),
        ),
      );
      post = albumPosts[0];
    } else {
      post = await prisma.post.create({
        data: {
          ...sharedPostData,
          content: parsed.data.content,
          mediaUrls: mediaType === "IMAGE" || mediaType === "GIF" ? mediaUrls : [],
          clientRequestId,
        },
      });
    }
  } catch (err) {
    // A concurrent attempt of the same submission won the (authorId, clientRequestId) unique: that one is the post.
    // Its uploads are this attempt's too, so nothing is cleaned up.
    if (clientRequestId && isUniqueConstraintError(err) && (await postExistsForRequest(user.id, clientRequestId))) {
      return { error: null };
    }
    throw err;
  }
  // The series, linked to this (lead) post as occurrence 0. Only for a post that went live: a held one never repeats.
  // Later occurrences copy the text and location, not the media.
  if (seriesRule && moderationStatus === "PUBLISHED" && parsed.data.circleId && parsed.data.channelId && eventAt) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        eventSeriesIndex: 0,
        eventSeries: {
          create: {
            circleId: parsed.data.circleId,
            channelId: parsed.data.channelId,
            authorId: user.id,
            frequency: seriesRule.frequency,
            anchorAt: seriesRule.anchorAt,
            maxOccurrences: seriesRule.maxOccurrences,
            until: seriesRule.until,
            content: parsed.data.content,
            eventLocation: eventLocation ?? null,
            feedCategory,
            lastIndex: 0,
            lastOccurrenceAt: eventAt,
          },
        },
      },
    });
  }
  // Embedding, activity/analytics, subscriber or connection notifications and the Home feed signal: shared with the
  // Circle event post a schedule poll creates (schedulePollOption), so the two stay identical.
  // Video-body scanning (Hive) happens on the moderate-videos cron, not
  // here — a video 60s or under publishes immediately with videoModeratedAt
  // still null, same "publish immediately, flag retroactively if needed"
  // approach as text/image moderation, but Hive's Visual Moderation API is a
  // synchronous call best kept out of this user-facing request path. A video
  // over 60s skips this path entirely (videoNeedsLongReview above already
  // set videoModeratedAt and videoLongReviewNeeded at creation; videoNeedsHold
  // additionally holds it FLAGGED past VIDEO_INSTANT_PUBLISH_MAX_SECONDS).
  await afterPostCreated({ post, moderationStatus, feedCategory, embedding, mediaType });

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${user.id}`);

  if (mediaHoldReasons) {
    // What /admin/moderation shows next to the held post (reasons, when it
    // was held, when it expires) and what the expiry sweep keys on. Written
    // after the post exists so it can name it; a failure here must not turn
    // a stored post into an error (the composer would offer a retry that the
    // clientRequestId would answer with success anyway), so it is logged.
    try {
      await prisma.auditLog.create({
        data: {
          targetId: user.id,
          action: "CONTENT_FLAGGED_FOR_REVIEW",
          performedBy: MEDIA_HOLD_PERFORMED_BY,
          reason: mediaHoldAuditReason(post.id, mediaType, mediaHoldReasons),
        },
      });
    } catch (err) {
      console.error(`[createPost] couldn't record the review hold for post ${post.id}`, err);
    }
    revalidatePath("/admin/moderation");
    // Not an error: the post exists, hidden, and an admin will look at it.
    return { error: null, held: true as const };
  }
  return { error: null };
}

/** The composer's per-submission key (a UUID or similar), or null when absent or malformed. */
function parseClientRequestId(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}

async function postExistsForRequest(authorId: string, clientRequestId: string) {
  const existing = await prisma.post.findUnique({
    where: { authorId_clientRequestId: { authorId, clientRequestId } },
    select: { id: true },
  });
  return !!existing;
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
  const user = await requireVerifiedViewer();

  const memberships = await prisma.circleMembership.findMany({
    where: { userId: user.id },
    include: {
      circle: {
        select: {
          id: true,
          name: true,
          slug: true,
          coverImageUrl: true,
          // Only a main Circle the caller may see names it: a PRIVATE one they aren't in doesn't exist for them.
          parent: { select: { name: true, visibility: true, members: { where: { userId: user.id }, select: { id: true } } } },
        },
      },
    },
    orderBy: { circle: { name: "asc" } },
  });

  // `parentName` is set only for a sub-circle, so pickers can show
  // "Main › Sub" — two different main Circles can each have a sub-circle
  // called "General", and the bare name alone wouldn't tell them apart.
  return {
    circles: memberships.map(({ circle: { parent, ...circle } }) => ({
      ...circle,
      parentName: parent && canSeeCircle(parent, { isMember: parent.members.length > 0 }) ? parent.name : null,
    })),
  };
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
  const user = await requireViewer();

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { circle: true, members: { select: { userId: true } } },
  });
  if (!channel || channel.type !== "TEXT") {
    return { items: [], hasMore: false };
  }
  const circleMembership = await getCircleMembership(channel.circleId, user.id);
  // A private Circle hides its channels/posts from non-members entirely (site admins included), even a channel that's
  // itself marked PUBLIC — the page's own gate (lib/circle-visibility.ts).
  if (!canSeeCircleContent(channel.circle, !!circleMembership)) {
    return { items: [], hasMore: false };
  }
  const canModerate = isCircleAdmin(channel.circle, circleMembership, user);
  const canRead =
    channel.visibility === "PUBLIC" || canModerate || channel.members.some((m) => m.userId === user.id);
  if (!canRead) {
    return { items: [], hasMore: false };
  }

  const rawPosts = await prisma.post.findMany({
    where: { channelId: channel.id, moderationStatus: "PUBLISHED", ...LEAD_POST_ONLY },
    orderBy: { createdAt: "desc" },
    take: CIRCLE_POSTS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
    include: postCardInclude,
  });
  const items = await attachViewerState(rawPosts, user.id);
  return { items, hasMore: rawPosts.length === CIRCLE_POSTS_PAGE_SIZE };
}
