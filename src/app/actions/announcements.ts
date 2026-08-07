"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { announcementSchema } from "@/lib/validations";

/** Admin-only: posts a new "what's new" announcement, visible to every user via the WhatsNewBell. */
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
