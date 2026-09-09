"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

export async function markAsRead(notificationId: string) {
  const user = await requireUser();

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });
  if (!notification || notification.recipientId !== user.id) {
    return { error: "not_found" };
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });

  revalidatePath("/notifications");
  return { error: null };
}

/** Bulk counterpart to markAsRead — used by GroupedNotificationRow, whose one tally row represents several underlying Notification rows at once. */
export async function markManyAsRead(notificationIds: string[]) {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { id: { in: notificationIds }, recipientId: user.id },
    data: { readAt: new Date() },
  });

  revalidatePath("/notifications");
  return { error: null };
}

export async function markAllAsRead() {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { recipientId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/notifications");
  return { error: null };
}
