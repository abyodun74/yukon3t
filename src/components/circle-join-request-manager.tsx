"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToCircleJoinRequest } from "@/app/actions/circles";
import { UserLink } from "@/components/user-link";
import { useCirclesText } from "@/components/circles-text";
import { format } from "@/lib/i18n/locales";

type Request = {
  id: string;
  user: { id: string; name: string | null; username: string | null; avatarUrl: string | null };
};

/** Owner/co-admin only, shown on a PRIVATE Circle: approve or decline pending join requests. */
export function CircleJoinRequestManager({ requests }: { requests: Request[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const t = useCirclesText().t.joinRequests;

  // Whatever the answer — including not_found for a request someone else already answered — the refresh shows the
  // list as it now is; there's nothing more to tell the admin.
  function respond(requestId: string, approve: boolean) {
    startTransition(async () => {
      await respondToCircleJoinRequest(requestId, approve);
      router.refresh();
    });
  }

  if (requests.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        {format(t.heading, { count: requests.length })}
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
                onClick={() => respond(r.id, true)}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
              >
                {t.approve}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => respond(r.id, false)}
                className="rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-50"
              >
                {t.decline}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
