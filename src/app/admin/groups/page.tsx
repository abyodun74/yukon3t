import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { DeleteGroupButton } from "@/components/delete-group-button";

/**
 * Every group chat (Conversation.isGroup), for an admin to delete outright —
 * regardless of who created it. Distinct from the "Duplicates" section on
 * /admin/moderation, which only ever surfaces same-creator/same-name pairs;
 * this is the general-purpose list for anything else (a policy violation, a
 * report that isn't a clean auto-detected duplicate, a group the creator
 * account no longer has access to). Deletion itself (deleteGroupChat in
 * actions/messages.ts) already allows creator-or-admin — this page is just
 * the surface for reaching a group an admin isn't a member of, since
 * /messages/[id] itself is member-gated.
 */
export default async function AdminGroupsPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const groups = await prisma.conversation.findMany({
    where: { isGroup: true },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { members: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Messaging groups</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Every group chat on the platform ({groups.length}). Deleting one removes it for every member —
        for exact-duplicate same-creator groups, the Moderation queue&apos;s Duplicates section does this
        detection for you automatically.
      </p>

      <div className="mt-8 space-y-3">
        {groups.map((group) => {
          const lastActivity = group.messages[0]?.createdAt ?? group.createdAt;
          return (
            <div
              key={group.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
            >
              <div className="min-w-0">
                <Link href={`/messages/${group.id}`} className="break-words font-semibold hover:text-accent">
                  {group.name ?? "(unnamed group)"}
                </Link>
                <p className="text-xs text-foreground-soft">
                  {group._count.members} member{group._count.members === 1 ? "" : "s"} &middot; created by{" "}
                  {group.createdBy?.name ?? "Unknown"} on {group.createdAt.toLocaleDateString()} &middot; last
                  activity {lastActivity.toLocaleDateString()}
                </p>
              </div>
              <DeleteGroupButton conversationId={group.id} isAdminOverride />
            </div>
          );
        })}
        {groups.length === 0 && <p className="text-sm text-foreground-soft">No group chats exist yet.</p>}
      </div>
    </div>
  );
}
