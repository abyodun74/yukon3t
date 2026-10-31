"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCircleCoAdmin, removeCircleCoAdmin, removeCircleMember } from "@/app/actions/circles";
import { UserLink } from "@/components/user-link";
import { useCirclesText } from "@/components/circles-text";
import { CircleMembersLoadMore } from "@/components/circle-members-load-more";
import { useCircleMemberPages } from "@/components/use-circle-member-pages";
import type { CircleMemberPage } from "@/lib/circle-members";

/**
 * Owner/co-admin only: promote members to co-admin, demote co-admins, or remove members outright. Never lists the
 * Circle's original creator — their membership can't be touched here. The first page comes from the server, "Load
 * more" fetches the rest (lib/circle-members.ts).
 */
export function CircleMemberManager({
  circleId,
  initialPage,
}: {
  circleId: string;
  initialPage: CircleMemberPage;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const t = useCirclesText().t.members;
  const { members, hasMore, loadMore, loading, failed, patch, remove } = useCircleMemberPages(circleId, initialPage);

  const manageable = members.filter((m) => m.role !== "OWNER");
  if (manageable.length === 0 && !hasMore) {
    return <p className="text-sm text-foreground-soft">{t.noOthers}</p>;
  }

  return (
    <>
      <ul className="divide-y divide-line">
        {manageable.map((m) => {
          const isCoAdmin = m.role === "MODERATOR";
          return (
            <li key={m.user.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <UserLink userId={m.user.id} name={m.user.name} username={m.user.username} avatarUrl={m.user.avatarUrl} />
                {isCoAdmin && (
                  <span className="text-xs font-normal text-accent">{t.coAdmin}</span>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = isCoAdmin
                        ? await removeCircleCoAdmin(circleId, m.user.id)
                        : await addCircleCoAdmin(circleId, m.user.id);
                      if (!result.error) patch(m.user.id, { role: isCoAdmin ? "MEMBER" : "MODERATOR" });
                      router.refresh();
                    })
                  }
                  className="rounded-md border border-line px-2 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {isCoAdmin ? t.removeCoAdmin : t.makeCoAdmin}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeCircleMember(circleId, m.user.id);
                      if (!result.error) remove(m.user.id);
                      router.refresh();
                    })
                  }
                  className="rounded-md border border-line px-2 py-1 font-medium text-danger hover:border-danger disabled:opacity-50"
                >
                  {t.remove}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <CircleMembersLoadMore hasMore={hasMore} loading={loading} failed={failed} onLoadMore={loadMore} />
    </>
  );
}
