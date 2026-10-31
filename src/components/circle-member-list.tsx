"use client";

import { UserLink } from "@/components/user-link";
import { useCirclesText } from "@/components/circles-text";
import { CircleMembersLoadMore } from "@/components/circle-members-load-more";
import { useCircleMemberPages } from "@/components/use-circle-member-pages";
import type { CircleMemberPage } from "@/lib/circle-members";

/**
 * Read-only counterpart to CircleMemberManager — every member (not just the
 * owner/co-admins) can see who else belongs to the Circle, they just can't
 * act on anyone here. Rendered instead of the manager for a plain member;
 * an owner/co-admin gets the manager itself, which already lists everyone
 * too, so this never renders alongside it. The first page comes from the
 * server, "Load more" fetches the rest (lib/circle-members.ts).
 */
export function CircleMemberList({ circleId, initialPage }: { circleId: string; initialPage: CircleMemberPage }) {
  const t = useCirclesText().t.members;
  const { members, hasMore, loadMore, loading, failed } = useCircleMemberPages(circleId, initialPage);
  if (members.length === 0) {
    return <p className="text-sm text-foreground-soft">{t.none}</p>;
  }

  return (
    <>
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-1.5 py-2 text-sm">
            <UserLink userId={m.user.id} name={m.user.name} username={m.user.username} avatarUrl={m.user.avatarUrl} />
            {m.role === "OWNER" && <span className="text-xs font-normal text-accent">{t.owner}</span>}
            {m.role === "MODERATOR" && <span className="text-xs font-normal text-accent">{t.coAdmin}</span>}
          </li>
        ))}
      </ul>
      <CircleMembersLoadMore hasMore={hasMore} loading={loading} failed={failed} onLoadMore={loadMore} />
    </>
  );
}
