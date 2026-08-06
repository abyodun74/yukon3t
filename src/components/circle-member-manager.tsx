"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCircleCoAdmin, removeCircleCoAdmin, removeCircleMember } from "@/app/actions/circles";
import { UserLink } from "@/components/user-link";

type Member = {
  role: string;
  user: { id: string; name: string | null; username?: string | null; avatarUrl?: string | null };
};

/** Owner/co-admin only: promote members to co-admin, demote co-admins, or remove members outright. Never lists the Circle's original creator — their membership can't be touched here. */
export function CircleMemberManager({
  circleId,
  members,
}: {
  circleId: string;
  members: Member[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const manageable = members.filter((m) => m.role !== "OWNER");
  if (manageable.length === 0) {
    return <p className="text-sm text-foreground-soft">No other members yet.</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {manageable.map((m) => {
        const isCoAdmin = m.role === "MODERATOR";
        return (
          <li key={m.user.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              <UserLink userId={m.user.id} name={m.user.name} username={m.user.username} avatarUrl={m.user.avatarUrl} />
              {isCoAdmin && (
                <span className="text-xs font-normal text-accent">Co-admin</span>
              )}
            </span>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    if (isCoAdmin) await removeCircleCoAdmin(circleId, m.user.id);
                    else await addCircleCoAdmin(circleId, m.user.id);
                    router.refresh();
                  })
                }
                className="rounded-md border border-line px-2 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {isCoAdmin ? "Remove co-admin" : "Make co-admin"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await removeCircleMember(circleId, m.user.id);
                    router.refresh();
                  })
                }
                className="rounded-md border border-line px-2 py-1 font-medium text-danger hover:border-danger disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
