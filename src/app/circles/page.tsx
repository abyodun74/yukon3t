import Link from "next/link";
import { Lock } from "lucide-react";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { visibleCircleWhere } from "@/lib/circle-visibility";
import { CirclesNewFab } from "@/components/circles-new-fab";
import { vocabName } from "@/lib/i18n/language-names";
import { plural } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function CirclesPage() {
  const me = await getOnboardedUserOrRedirect();
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.circles.list;

  const circles = await prisma.circle.findMany({
    // Main Circles only — a sub-circle is listed on its main Circle's page,
    // so it doesn't appear here as a separate top-level entry. A PRIVATE one
    // only for its members: to anyone else it doesn't exist (lib/circle-visibility.ts).
    where: { parentId: null, ...visibleCircleWhere(me.id) },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      _count: { select: { members: true, subCircles: true } },
      members: { where: { userId: me.id }, select: { role: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div id="circles-header" className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="mt-1 text-sm text-foreground-soft">
            {t.intro}
          </p>
        </div>
        <Link
          href="/circles/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          {t.start}
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {circles.map((circle) => {
          const isOwner = circle.createdById === me.id;
          const isCoAdmin = !isOwner && circle.members[0]?.role === "MODERATOR";
          return (
            <Link
              key={circle.id}
              href={`/circles/${circle.slug}`}
              className="min-w-0 rounded-xl border border-line p-4 hover:border-accent"
            >
              <div className="flex items-center gap-3">
                {circle.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={circle.coverImageUrl}
                    alt={circle.name}
                    loading="lazy"
                    decoding="async"
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-teal">
                      {circle.category
                        .map((category) => vocabName(category, dictionary.vocab.circleCategories))
                        .join(dictionary.ui.listSeparator)}
                    </p>
                    {circle.visibility === "PRIVATE" && (
                      <span
                        title={t.privateHint}
                        className="flex items-center text-foreground-soft"
                      >
                        <Lock size={11} />
                      </span>
                    )}
                    {(isOwner || isCoAdmin) && (
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-accent">
                        {isOwner ? t.owner : t.coAdmin}
                      </span>
                    )}
                  </div>
                  <h2 dir="auto" className="mt-1 truncate font-semibold">{circle.name}</h2>
                </div>
              </div>
              <p dir="auto" className="mt-2 line-clamp-2 text-sm text-foreground-soft">
                {circle.description}
              </p>
              <p className="mt-3 text-xs text-foreground-soft">
                {plural(locale, t.members, circle._count.members)}
                {circle._count.subCircles > 0 && ` · ${plural(locale, t.subCircles, circle._count.subCircles)}`}
              </p>
            </Link>
          );
        })}
        {circles.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {t.empty}
          </p>
        )}
      </div>

      <CirclesNewFab />
    </div>
  );
}
