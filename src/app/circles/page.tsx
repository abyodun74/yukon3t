import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";

export default async function CirclesPage() {
  const me = await getOnboardedUserOrRedirect();

  const circles = await prisma.circle.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      _count: { select: { members: true } },
      members: { where: { userId: me.id }, select: { role: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Circles</h1>
          <p className="mt-1 text-sm text-foreground-soft">
            Interest and identity communities. Free to create and join — no
            organizer fees, ever.
          </p>
        </div>
        <Link
          href="/circles/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          Start a Circle
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
              className="rounded-xl border border-line p-4 hover:border-accent"
            >
              <div className="flex items-center gap-3">
                {circle.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={circle.coverImageUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-teal">
                      {circle.category}
                    </p>
                    {(isOwner || isCoAdmin) && (
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        {isOwner ? "Owner" : "Co-admin"}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 truncate font-semibold">{circle.name}</h2>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-foreground-soft">
                {circle.description}
              </p>
              <p className="mt-3 text-xs text-foreground-soft">
                {circle._count.members} member
                {circle._count.members === 1 ? "" : "s"}
              </p>
            </Link>
          );
        })}
        {circles.length === 0 && (
          <p className="text-sm text-foreground-soft">
            No Circles yet — be the first to start one.
          </p>
        )}
      </div>
    </div>
  );
}
