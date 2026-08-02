import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { DeleteCircleButton } from "@/components/delete-circle-button";

/** Groups Circles by normalized name so near-identical duplicates (case/whitespace aside) surface together. */
function groupByNormalizedName<T extends { name: string }>(circles: T[]) {
  const groups = new Map<string, T[]>();
  for (const circle of circles) {
    const key = circle.name.trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.push(circle);
    else groups.set(key, [circle]);
  }
  return [...groups.values()];
}

export default async function AdminCirclesPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const circles = await prisma.circle.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { members: true, posts: true } },
      createdBy: { select: { name: true } },
    },
  });

  const groups = groupByNormalizedName(circles).sort((a, b) => b.length - a.length);
  const duplicateGroups = groups.filter((g) => g.length > 1);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Circles</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {duplicateGroups.length === 0
          ? "No duplicate Circle names found."
          : `${duplicateGroups.length} name${duplicateGroups.length === 1 ? "" : "s"} used by more than one Circle — review and delete the redundant ones.`}
      </p>

      <div className="mt-8 space-y-6">
        {groups.map((group) => (
          <div key={group[0].id} className="space-y-2">
            {group.length > 1 && (
              <p className="text-xs font-medium uppercase tracking-wide text-danger">
                Possible duplicate &mdash; {group.length} Circles named &quot;{group[0].name}&quot;
              </p>
            )}
            {group.map((circle) => (
              <div
                key={circle.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
                  group.length > 1 ? "border-danger/40" : "border-line"
                }`}
              >
                <div className="min-w-0">
                  <Link href={`/circles/${circle.slug}`} className="font-semibold hover:text-accent">
                    {circle.name}
                  </Link>
                  <p className="text-xs text-foreground-soft">
                    {circle.category} &middot; {circle._count.members} member
                    {circle._count.members === 1 ? "" : "s"} &middot; {circle._count.posts} post
                    {circle._count.posts === 1 ? "" : "s"} &middot; created by{" "}
                    {circle.createdBy.name ?? "Unknown"} on {circle.createdAt.toLocaleDateString()}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-foreground-soft">{circle.description}</p>
                </div>
                <DeleteCircleButton circleId={circle.id} isAdminOverride />
              </div>
            ))}
          </div>
        ))}
        {circles.length === 0 && (
          <p className="text-sm text-foreground-soft">No Circles exist yet.</p>
        )}
      </div>
    </div>
  );
}
