import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { DeleteCircleButton } from "@/components/delete-circle-button";
import { DeleteCollabButton } from "@/components/delete-collab-button";

/** Groups rows by normalized name/title so near-identical duplicates (case/whitespace aside) surface together. */
function groupByNormalizedName<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row).trim().toLowerCase();
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return [...groups.values()];
}

export default async function AdminCirclesPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const [circles, collabs] = await Promise.all([
    prisma.circle.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { members: true, posts: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.collabBoardPost.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { participants: true } },
        author: { select: { name: true } },
      },
    }),
  ]);

  const groups = groupByNormalizedName(circles, (c) => c.name).sort((a, b) => b.length - a.length);
  const duplicateGroups = groups.filter((g) => g.length > 1);

  const collabGroups = groupByNormalizedName(collabs, (c) => c.title).sort((a, b) => b.length - a.length);
  const duplicateCollabGroups = collabGroups.filter((g) => g.length > 1);

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
                  <Link href={`/circles/${circle.slug}`} className="break-words font-semibold hover:text-accent">
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

      <h2 className="mt-12 text-2xl font-semibold">Collaborations</h2>
      <p className="mt-1 text-sm text-foreground-soft">
        {duplicateCollabGroups.length === 0
          ? "No duplicate collaboration titles found."
          : `${duplicateCollabGroups.length} title${duplicateCollabGroups.length === 1 ? "" : "s"} used by more than one collaboration — review and delete the redundant ones.`}
      </p>

      <div className="mt-8 space-y-6">
        {collabGroups.map((group) => (
          <div key={group[0].id} className="space-y-2">
            {group.length > 1 && (
              <p className="text-xs font-medium uppercase tracking-wide text-danger">
                Possible duplicate &mdash; {group.length} collaborations titled &quot;{group[0].title}&quot;
              </p>
            )}
            {group.map((collab) => (
              <div
                key={collab.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
                  group.length > 1 ? "border-danger/40" : "border-line"
                }`}
              >
                <div className="min-w-0">
                  <Link href={`/collab/${collab.id}`} className="break-words font-semibold hover:text-accent">
                    {collab.title}
                  </Link>
                  <p className="text-xs text-foreground-soft">
                    {collab.type} &middot; {collab._count.participants} participant
                    {collab._count.participants === 1 ? "" : "s"} &middot; {collab.status.toLowerCase()}{" "}
                    &middot; posted by {collab.author.name ?? "Unknown"} on{" "}
                    {collab.createdAt.toLocaleDateString()}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-foreground-soft">{collab.description}</p>
                </div>
                <DeleteCollabButton collabId={collab.id} isAdminOverride />
              </div>
            ))}
          </div>
        ))}
        {collabs.length === 0 && (
          <p className="text-sm text-foreground-soft">No collaborations exist yet.</p>
        )}
      </div>
    </div>
  );
}
