"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToJoinRequest } from "@/app/actions/messages";

export function JoinRequestList({
  requests,
}: {
  requests: { id: string; name: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (requests.length === 0) return null;

  function respond(requestId: string, approve: boolean) {
    startTransition(async () => {
      await respondToJoinRequest(requestId, approve);
      router.refresh();
    });
  }

  return (
    <div className="mb-4 space-y-2 rounded-xl border border-line p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
        Pending join requests
      </p>
      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 break-words">{r.name}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => respond(r.id, true)}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => respond(r.id, false)}
              className="rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
