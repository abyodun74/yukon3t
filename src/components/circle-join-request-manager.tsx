"use client";

import { useTransition } from "react";
import { respondToCircleJoinRequest } from "@/app/actions/circles";
import { UserLink } from "@/components/user-link";

type Request = {
  id: string;
  user: { id: string; name: string | null; username: string | null; avatarUrl: string | null };
};

/** Owner/co-admin only, shown on a PRIVATE Circle: approve or decline pending join requests. */
export function CircleJoinRequestManager({ requests }: { requests: Request[] }) {
  const [isPending, startTransition] = useTransition();

  if (requests.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        Join requests ({requests.length})
      </h2>
      <div className="mt-3 space-y-2">
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
          >
            <UserLink
              userId={r.user.id}
              name={r.user.name}
              avatarUrl={r.user.avatarUrl}
              avatarSize={28}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => { await respondToCircleJoinRequest(r.id, true); })}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => { await respondToCircleJoinRequest(r.id, false); })}
                className="rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
