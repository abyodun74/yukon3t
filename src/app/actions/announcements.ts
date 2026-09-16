"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { announcementSchema } from "@/lib/validations";
import { broadcastFcmAnnouncement } from "@/lib/fcm";
import { broadcastPushAnnouncement } from "@/lib/push";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

/**
 * Admin-only: posts a new "what's new" announcement. Visible to every user
 * via the WhatsNewBell the moment it's created (no per-user "send" step —
 * that part was already automatic), and now also actively pushed to every
 * registered device (native FCM + web push), not just left as a passive
 * badge someone has to notice on their own.
 */
export async function createAnnouncement(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  await prisma.announcement.create({
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      createdById: admin.id,
    },
  });

  // Awaited, not fire-and-forget — a serverless function's execution can be
  // frozen the moment a response is sent, same reasoning every other push
  // send in this codebase (e.g. toggleLike's pushActivityNotification) is
  // awaited rather than left running in the background. Both are already
  // internally best-effort/never-throwing (see their own comments), so
  // awaiting them can't make announcement creation itself fail.
  await broadcastFcmAnnouncement({ title: parsed.data.title, body: parsed.data.body });
  await broadcastPushAnnouncement({ title: parsed.data.title, body: parsed.data.body, url: "/whats-new" });
  await publishEvent(REALTIME_CHANNELS.announcements(), "changed");

  revalidatePath("/admin/announcements");
  revalidatePath("/whats-new");
  return { error: null };
}

/** Admin-only: removes an announcement outright (e.g. posted by mistake). */
export async function deleteAnnouncement(id: string) {
  await requireAdmin();

  await prisma.announcement.delete({ where: { id } });

  revalidatePath("/admin/announcements");
  revalidatePath("/whats-new");
  return { error: null };
}

/** Marks every announcement up to now as seen — called when the caller opens /whats-new. */
export async function markAnnouncementsSeen() {
  const user = await requireUser();

  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAnnouncementAt: new Date() },
  });

  return { error: null };
}
