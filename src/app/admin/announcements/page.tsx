import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { CreateAnnouncementForm } from "@/components/create-announcement-form";
import { DeleteAnnouncementButton } from "@/components/delete-announcement-button";
import { TARGET_LANGUAGE_NAMES } from "@/lib/translation";
import { isAnnouncementTranslationLocale } from "@/lib/announcement-translations";

// Server Actions used on this page ("Draft translations", one language per call) run under the page's function
// limit. Each draft call finishes within ANNOUNCEMENT_DRAFT_BUDGET_MS (22s, src/lib/announcement-translations.ts);
// Netlify cuts functions at about 26-30s whatever this says, Vercel honours it.
export const maxDuration = 30;

export default async function AdminAnnouncementsPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { translations: { select: { locale: true }, orderBy: { locale: "asc" } } },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">What&apos;s new</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Posted here shows up for every user via the megaphone icon in the nav bar. Write it in English; add your own
        version for any other language below (optional). Everyone whose app language has no version gets the
        English, on the What&apos;s new page and in the push. A posted announcement can be edited (text, translations,
        media); editing never sends another push or shows it as new again.
      </p>

      <div className="mt-6">
        <CreateAnnouncementForm />
      </div>

      <div className="mt-8 space-y-3">
        {announcements.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-line p-4">
            <div className="min-w-0">
              <h2 className="break-words font-semibold">{a.title}</h2>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground-soft">{a.body}</p>
              {a.mediaUrl && (
                <div className="mt-2 max-w-xs overflow-hidden rounded-lg bg-black">
                  {a.mediaType === "VIDEO" ? (
                    <video src={a.mediaUrl} poster={a.mediaThumbnailUrl ?? undefined} controls className="w-full" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.mediaUrl} alt="" className="w-full object-contain" />
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-foreground-soft">
                {a.translations.length > 0
                  ? `Also in: ${a.translations
                      .map((t) => (isAnnouncementTranslationLocale(t.locale) ? TARGET_LANGUAGE_NAMES[t.locale] : t.locale))
                      .join(", ")}`
                  : "English only"}
              </p>
              <p className="mt-2 text-xs text-foreground-soft">{a.createdAt.toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Link
                href={`/admin/announcements/${a.id}/edit`}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent"
              >
                Edit
              </Link>
              <DeleteAnnouncementButton id={a.id} />
            </div>
          </div>
        ))}
        {announcements.length === 0 && (
          <p className="text-sm text-foreground-soft">No announcements posted yet.</p>
        )}
      </div>
    </div>
  );
}
