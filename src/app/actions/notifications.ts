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

  // The link is worked out from several columns and joined rows (notificationHref), so it can't be a WHERE clause:
  // the caller's unread rows are read newest first, one page at a time (keyset on createdAt + id, so marking a page
  // read doesn't shift the next one), up to MARK_BY_TARGET_MAX_PAGES pages. It used to read only the 200 newest, so
  // with a bigger backlog an older row for this very target never cleared.
  let after: { createdAt: Date; id: string } | null = null;
  let marked = 0;
  for (let page = 0; page < MARK_BY_TARGET_MAX_PAGES; page++) {
    const unread = await unreadPage(user.id, after);
    // Compared without the #fragment on both sides: a href may point into the page (e.g. polls' "#polls").
    const ids = unread.filter((n) => notificationHref(n).split("#")[0] === target).map((n) => n.id);
    if (ids.length > 0) {
      const result = await prisma.notification.updateMany({
        where: { id: { in: ids }, recipientId: user.id },
        data: { readAt: new Date() },
      });
      marked += result.count;
    }
    if (unread.length < MARK_BY_TARGET_PAGE_SIZE) break;
    const last = unread[unread.length - 1];
    after = { createdAt: last.createdAt, id: last.id };
  }
  if (marked === 0) return { error: null };

  await notifyBadgeChange(user.id);

  revalidatePath("/notifications");
  return { error: null };
}

/** markReadByTarget's page of unread rows, and how many it reads at most (20 x 500 = 10,000 unread rows). */
const MARK_BY_TARGET_PAGE_SIZE = 500;
const MARK_BY_TARGET_MAX_PAGES = 20;

function unreadPage(recipientId: string, after: { createdAt: Date; id: string } | null) {
  return prisma.notification.findMany({
    where: {
      recipientId,
      readAt: null,
      ...(after
        ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MARK_BY_TARGET_PAGE_SIZE,
    include: {
      actor: { select: { id: true, name: true } },
      circle: { select: { slug: true, visibility: true } },
      collab: { select: { id: true } },
      channel: { select: { slug: true } },
    },
  });
}
