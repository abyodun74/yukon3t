"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { ambientMomentSchema } from "@/lib/validations";
import { moderateImage } from "@/lib/moderation";
import { isBlockedEitherWay } from "@/lib/blocks";
import { MEDIA_LIMITS, verifyUploadedSize, deleteOwnedObject, keyFromPublicUrl } from "@/lib/storage";
import { captureError } from "@/lib/error-tracking";

// "A handful" — small and deliberate, not a second feed. Enforced here, not
// just implied by the picker UI, so it stays true even against a scripted
// call.
const MAX_INNER_CIRCLE_SIZE = 8;

// Ambient moments are ephemeral like Stories, not a permanent feed —
// "presence," not an archive. Longer than Story's 24h (see
// STORY_LIFETIME_MS in lib/storage.ts) since this is a much lower-frequency,
// lower-pressure surface by design: one moment doesn't need to disappear as
// urgently as a Story does.
const AMBIENT_MOMENT_LIFETIME_MS = 48 * 60 * 60 * 1000;

function hashAmbientWidgetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Accepted connections not already in the caller's inner circle — the picker's own candidate list. Excludes anyone blocked either way, same as every other "who can I pick" list in this app. */
export async function getInnerCircleCandidates() {
  const user = await requireVerifiedUser();

  const [connections, currentMembers] = await Promise.all([
    prisma.connection.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: user.id }, { targetId: user.id }] },
      select: { requesterId: true, targetId: true },
    }),
    prisma.innerCircleMember.findMany({ where: { ownerId: user.id }, select: { memberId: true } }),
  ]);

  const memberIds = new Set(currentMembers.map((m) => m.memberId));
  const candidateIds = connections
    .map((c) => (c.requesterId === user.id ? c.targetId : c.requesterId))
    .filter((id) => !memberIds.has(id));

  if (candidateIds.length === 0) return [];

  const blockedChecks = await Promise.all(candidateIds.map((id) => isBlockedEitherWay(user.id, id)));
  const allowedIds = candidateIds.filter((_, i) => !blockedChecks[i]);
  if (allowedIds.length === 0) return [];

  return prisma.user.findMany({
    where: { id: { in: allowedIds }, status: "ACTIVE" },
    select: { id: true, name: true, username: true, avatarUrl: true },
    orderBy: { name: "asc" },
  });
}

/** Current inner circle, oldest-added first. */
export async function getInnerCircle() {
  const user = await requireVerifiedUser();
  const members = await prisma.innerCircleMember.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
    include: { member: { select: { id: true, name: true, username: true, avatarUrl: true } } },
  });
  return members.map((m) => m.member);
}

export async function addToInnerCircle(memberId: string) {
  const user = await requireVerifiedUser();
  if (memberId === user.id) return { error: "invalid" as const };

  const allowed = await checkRateLimit("innerCircleManage", user.id);
  if (!allowed) return { error: "rate_limited" as const };

  const [connection, currentCount, blocked] = await Promise.all([
    prisma.connection.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: user.id, targetId: memberId },
          { requesterId: memberId, targetId: user.id },
        ],
      },
      select: { id: true },
    }),
    prisma.innerCircleMember.count({ where: { ownerId: user.id } }),
    isBlockedEitherWay(user.id, memberId),
  ]);

  if (!connection || blocked) return { error: "not_connected" as const };
  if (currentCount >= MAX_INNER_CIRCLE_SIZE) return { error: "limit_reached" as const };

  await prisma.innerCircleMember.upsert({
    where: { ownerId_memberId: { ownerId: user.id, memberId } },
    create: { ownerId: user.id, memberId },
    update: {},
  });

  revalidatePath("/settings/ambient");
  return { error: null };
}

export async function removeFromInnerCircle(memberId: string) {
  const user = await requireVerifiedUser();
  await prisma.innerCircleMember.deleteMany({ where: { ownerId: user.id, memberId } });
  revalidatePath("/settings/ambient");
  return { error: null };
}

/** The in-app preview of what an eventual widget would show: active moments from everyone in the caller's inner circle, newest first. */
export async function getAmbientFeed() {
  const user = await requireVerifiedUser();
  const members = await prisma.innerCircleMember.findMany({ where: { ownerId: user.id }, select: { memberId: true } });
  const memberIds = members.map((m) => m.memberId);
  if (memberIds.length === 0) return [];

  return prisma.ambientMoment.findMany({
    where: { authorId: { in: memberIds }, moderationStatus: "PUBLISHED", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { author: { select: { id: true, name: true, username: true, avatarUrl: true } } },
  });
}

/** This user's own currently-active moments — for the composer's "your moments" list. */
export async function getMyAmbientMoments() {
  const user = await requireVerifiedUser();
  return prisma.ambientMoment.findMany({
    where: { authorId: user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createAmbientMoment(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("ambientMomentCreate", user.id);
  if (!allowed) return { error: "rate_limited" as const };

  const parsed = ambientMomentSchema.safeParse({
    imageUrl: formData.get("imageUrl"),
    caption: formData.get("caption"),
  });
  if (!parsed.success) return { error: "invalid" as const };
  const { imageUrl, caption } = parsed.data;

  const key = keyFromPublicUrl(imageUrl);
  const sizeOk = key && (await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["ambient-image"], ownerId: user.id }));
  if (!sizeOk) {
    if (key) await deleteOwnedObject(key, user.id);
    return { error: "too_large" as const };
  }

  // Same "reject outright, no pending state" treatment every other image
  // upload in this app gets (see CLAUDE.md's moderation gate) — a new,
  // low-stakes-feeling surface is not a reason to skip it.
  const modResult = await moderateImage(imageUrl);
  if (!modResult.allowed) {
    await deleteOwnedObject(key, user.id);
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  let moment;
  try {
    moment = await prisma.ambientMoment.create({
      data: {
        authorId: user.id,
        imageUrl,
        caption: caption || null,
        expiresAt: new Date(Date.now() + AMBIENT_MOMENT_LIFETIME_MS),
      },
    });
  } catch (err) {
    console.error("[createAmbientMoment] failed to create moment row after successful upload", err);
    await captureError(err, { action: "createAmbientMoment", userId: user.id });
    await deleteOwnedObject(key, user.id);
    return { error: "server_error" as const };
  }

  revalidatePath("/settings/ambient");
  return { error: null, moment };
}

export async function deleteAmbientMoment(id: string) {
  const user = await requireVerifiedUser();
  const moment = await prisma.ambientMoment.findUnique({ where: { id }, select: { authorId: true, imageUrl: true } });
  if (!moment || moment.authorId !== user.id) return { error: "not_found" as const };

  await prisma.ambientMoment.delete({ where: { id } });
  const key = keyFromPublicUrl(moment.imageUrl);
  if (key) await deleteOwnedObject(key, user.id);

  revalidatePath("/settings/ambient");
  return { error: null };
}

/**
 * Generates (or rotates) the bearer token a future native widget would
 * store and send to GET /api/ambient/feed — see AmbientWidgetToken's own
 * schema doc comment for why this is a separate credential from the normal
 * session. The raw value is returned exactly once; only its hash is ever
 * stored, so losing it means generating a new one, not recovering the old.
 */
export async function generateAmbientWidgetToken() {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("ambientWidgetToken", user.id);
  if (!allowed) return { error: "rate_limited" as const };

  const rawToken = `ykn3t_amb_${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashAmbientWidgetToken(rawToken);

  // One active widget token per user at a time — generating a new one
  // invalidates the old, same "replacing it revokes the old one" pattern a
  // password reset already uses for sessions (sessionInvalidatedAt).
  await prisma.$transaction([
    prisma.ambientWidgetToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.ambientWidgetToken.create({ data: { userId: user.id, tokenHash } }),
  ]);

  revalidatePath("/settings/ambient");
  return { error: null, token: rawToken };
}

export async function revokeAmbientWidgetToken() {
  const user = await requireVerifiedUser();
  await prisma.ambientWidgetToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings/ambient");
  return { error: null };
}

/** Whether an active widget token currently exists — never returns the token itself (only generateAmbientWidgetToken's own result does, once). */
export async function getAmbientWidgetTokenStatus() {
  const user = await requireVerifiedUser();
  const token = await prisma.ambientWidgetToken.findFirst({
    where: { userId: user.id, revokedAt: null },
    select: { createdAt: true, lastUsedAt: true },
  });
  return token
    ? { active: true as const, createdAt: token.createdAt, lastUsedAt: token.lastUsedAt }
    : { active: false as const };
}
