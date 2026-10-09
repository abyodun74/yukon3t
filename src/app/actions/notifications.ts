"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { notifyBadgeChange } from "@/lib/realtime-server";
import { notificationHref } from "@/lib/notification-href";
import { notificationIdSchema, notificationIdsSchema, notificationTargetSchema } from "@/lib/validations";

export async function markAsRead(notificationId: string) {
  const user = await requireUser();
  const parsed = notificationIdSchema.safeParse(notificationId);
  if (!parsed.success) return { error: "invalid" };

  const notification = await prisma.notification.findUnique({
    where: { id: parsed.data },
  });
  if (!notification || notification.recipientId !== user.id) {
    return { error: "not_found" };
  }

  await prisma.notification.update({
    where: { id: parsed.data },
    data: { readAt: new Date() },
  });
  await notifyBadgeChange(user.id);

  revalidatePath("/notifications");
  return { error: null };
}

/** Bulk counterpart to markAsRead — used by GroupedNotificationRow, whose one tally row represents several underlying Notification rows at once. */
export async function markManyAsRead(notificationIds: string[]) {
  const user = await requireUser();
  const parsed = notificationIdsSchema.safeParse(notificationIds);
  if (!parsed.success) return { error: "invalid" };

  await prisma.notification.updateMany({
    where: { id: { in: parsed.data }, recipientId: user.id },
    data: { readAt: new Date() },
  });
  await notifyBadgeChange(user.id);

  revalidatePath("/notifications");
  return { error: null };
}

export async function markAllAsRead() {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { recipientId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  await notifyBadgeChange(user.id);

  revalidatePath("/notifications");
  return { error: null };
}

/**
 * Marks read the unread notifications that lead to `url` — what tapping a
 * push notification, or arriving at that page any other way
 * (components/notification-read-on-visit.tsx), means. The push payload only
 * carries its target URL (see sendFcmActivityToUser), and a visit has no
 * notification in hand at all, so this matches on where each notification
 * would open rather than on an id; several notifications about the same
 * post or conversation clear together, which is right: that one thing has
 * now been opened. Everything pointing elsewhere stays unread.
 */
export async function markReadByTarget(url: string) {
  const user = await requireUser();
  const parsed = notificationTargetSchema.safeParse(url);
  if (!parsed.success) return { error: "invalid" };
  const target = parsed.data.split("#")[0];

  const unread = await prisma.notification.findMany({
    where: { recipientId: user.id, readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      actor: { select: { id: true, name: true } },
      circle: { select: { slug: true } },
      collab: { select: { id: true } },
      channel: { select: { slug: true } },
    },
  });
  const ids = unread.filter((n) => notificationHref(n) === target).map((n) => n.id);
  if (ids.length === 0) return { error: null };

  await prisma.notification.updateMany({
    where: { id: { in: ids }, recipientId: user.id },
    data: { readAt: new Date() },
  });
  await notifyBadgeChange(user.id);

  revalidatePath("/notifications");
  return { error: null };
}
