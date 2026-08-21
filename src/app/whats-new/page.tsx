import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { WhatsNewSeenMarker } from "@/components/whats-new-seen-marker";

export default async function WhatsNewPage() {
  await getSessionUserOrRedirect();

  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />
      <WhatsNewSeenMarker />

      <h1 className="mt-2 text-2xl font-semibold">What&apos;s new</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Updates and new features on YuKon3t.
      </p>

      <div className="mt-6 space-y-4">
        {announcements.map((a) => (
          <div key={a.id} className="rounded-xl border border-line p-4">
            <h2 className="break-words font-semibold">{a.title}</h2>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground-soft">{a.body}</p>
            <p className="mt-2 text-xs text-foreground-soft">
              {a.createdAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
        ))}
        {announcements.length === 0 && (
          <p className="text-sm text-foreground-soft">Nothing here yet — check back later.</p>
        )}
      </div>
    </div>
  );
}
