"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { channelSchema, updateChannelSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";

/** Owner or co-admin: adds a new labelled TEXT or VOICE channel to a Circle. */
export async function createChannel(circleId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("channelManage", user.id);
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

  const parsed = channelSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    topic: formData.get("topic") || undefined,
    visibility: formData.get("visibility") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { name, type, topic, visibility } = parsed.data;

  const modResult = await moderateText(`${name}\n${topic}`);
  if (!modResult.allowed) {
    return { error: "moderation" as const };
  }

  const baseSlug = slugify(name) || "channel";
  let slug = baseSlug;
  let attempt = 0;
  while (await prisma.channel.findUnique({ where: { circleId_slug: { circleId, slug } } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const maxPosition = await prisma.channel.aggregate({
    where: { circleId },
    _max: { position: true },
  });

  const channel = await prisma.channel.create({
    data: {
      circleId,
      name,
      slug,
      type,
      topic: topic || undefined,
      visibility,
      position: (maxPosition._max.position ?? -1) + 1,
      createdById: user.id,
    },
  });

  revalidatePath(`/circles/${circle.slug}`);
  return { error: null, slug: channel.slug };
}

/** Owner or co-admin: renames a channel, edits its topic label, or flips its visibility. */
export async function updateChannel(channelId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("channelManage", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { circle: true },
  });
  if (!channel) {
    return { error: "not_found" as const };
  }
  const membership = await getCircleMembership(channel.circleId, user.id);
  if (!isCircleAdmin(channel.circle, membership, user)) {
    return { error: "forbidden" as const };
  }

  const parsed = updateChannelSchema.safeParse({
    name: formData.get("name"),
    topic: formData.get("topic") || undefined,
    visibility: formData.get("visibility"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { name, topic, visibility } = parsed.data;

  const modResult = await moderateText(`${name}\n${topic}`);
  if (!modResult.allowed) {
    return { error: "moderation" as const };
  }

  await prisma.channel.update({
    where: { id: channelId },
    data: { name, topic: topic || null, visibility },
  });

  revalidatePath(`/circles/${channel.circle.slug}`);
  return { error: null };
}

/** Owner or co-admin: deletes a channel (and its posts) — refuses to delete a Circle's last remaining channel. */
export async function deleteChannel(channelId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("channelManage", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { circle: true },
  });
  if (!channel) {
    return { error: "not_found" as const };
  }
  const membership = await getCircleMembership(channel.circleId, user.id);
  if (!isCircleAdmin(channel.circle, membership, user)) {
    return { error: "forbidden" as const };
  }

  const remaining = await prisma.channel.count({ where: { circleId: channel.circleId } });
  if (remaining <= 1) {
    return { error: "last_channel" as const };
  }

  await prisma.channel.delete({ where: { id: channelId } });

  revalidatePath(`/circles/${channel.circle.slug}`);
  return { error: null };
}

/** Owner or co-admin: grants a Circle member access to a PRIVATE channel. */
export async function addChannelMember(channelId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("channelManage", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { circle: true },
  });
  if (!channel) {
    return { error: "not_found" as const };
  }
  const membership = await getCircleMembership(channel.circleId, user.id);
  if (!isCircleAdmin(channel.circle, membership, user)) {
    return { error: "forbidden" as const };
  }

  const targetMembership = await getCircleMembership(channel.circleId, targetUserId);
  if (!targetMembership) {
    return { error: "not_a_circle_member" as const };
  }

  await prisma.channelMembership.upsert({
    where: { channelId_userId: { channelId, userId: targetUserId } },
    create: { channelId, userId: targetUserId },
    update: {},
  });

  revalidatePath(`/circles/${channel.circle.slug}`);
  return { error: null };
}

/** Owner or co-admin: revokes a member's access to a PRIVATE channel. */
export async function removeChannelMember(channelId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("channelManage", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { circle: true },
  });
  if (!channel) {
    return { error: "not_found" as const };
  }
  const membership = await getCircleMembership(channel.circleId, user.id);
  if (!isCircleAdmin(channel.circle, membership, user)) {
    return { error: "forbidden" as const };
  }

  await prisma.channelMembership.deleteMany({ where: { channelId, userId: targetUserId } });

  revalidatePath(`/circles/${channel.circle.slug}`);
  return { error: null };
}
