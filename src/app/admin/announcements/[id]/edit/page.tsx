import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { EditAnnouncementForm } from "@/components/create-announcement-form";
import { translationFieldsFromRows } from "@/lib/announcement-translations";

// Same as /admin/announcements: "Draft translations" runs here too (one language per call, each within 22s).
export const maxDuration = 30;

/** Admin-only: edit a posted announcement (updateAnnouncement). Saving sends no push and doesn't mark it new. */
export default async function EditAnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const { id } = await params;
  const announcement = await prisma.announcement.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
      mediaType: true,
      mediaUrl: true,
      mediaThumbnailUrl: true,
      translations: { select: { locale: true, title: true, body: true } },
    },
  });
  if (!announcement) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/announcements" className="text-xs text-foreground-soft hover:text-accent">
        &larr; What&apos;s new
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Edit announcement</h1>
      <p className="mt-1 text-sm text-foreground-soft">Posted {announcement.createdAt.toLocaleString()}.</p>

      <div className="mt-6">
        <EditAnnouncementForm
          announcement={{
            id: announcement.id,
            title: announcement.title,
            body: announcement.body,
            translations: translationFieldsFromRows(announcement.translations),
            media:
              announcement.mediaType && announcement.mediaUrl
                ? {
                    type: announcement.mediaType,
                    url: announcement.mediaUrl,
                    thumbnailUrl: announcement.mediaThumbnailUrl,
                  }
                : null,
          }}
        />
      </div>
    </div>
  );
}
