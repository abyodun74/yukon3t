import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { CreateAnnouncementForm } from "@/components/create-announcement-form";
import { DeleteAnnouncementButton } from "@/components/delete-announcement-button";

export default async function AdminAnnouncementsPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">What&apos;s new</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Posted here shows up for every user via the megaphone icon in the nav bar.
      </p>

      <div className="mt-6">
        <CreateAnnouncementForm />
      </div>

      <div className="mt-8 space-y-3">
        {announcements.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-line p-4">
            <div className="min-w-0">
              <h2 className="font-semibold">{a.title}</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground-soft">{a.body}</p>
              <p className="mt-2 text-xs text-foreground-soft">{a.createdAt.toLocaleString()}</p>
            </div>
            <DeleteAnnouncementButton id={a.id} />
          </div>
        ))}
        {announcements.length === 0 && (
          <p className="text-sm text-foreground-soft">No announcements posted yet.</p>
        )}
      </div>
    </div>
  );
}
