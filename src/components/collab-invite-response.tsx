"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToCollabInvite } from "@/app/actions/collab";

/** Shown to an invitee who hasn't yet responded to a PRIVATE collab's CollabInvite — this is their only way in. */
export function CollabInviteResponse({
  inviteId,
  inviterName,
}: {
  inviteId: string;
  inviterName: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
      <p className="text-sm">
        <span className="font-semibold">{inviterName ?? "Someone"}</span> invited you to
        collaborate — this is a private collaboration, only visible to people invited to it.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await respondToCollabInvite(inviteId, true);
              if (result.error) {
                setError("Couldn't accept — try again.");
                return;
              }
              router.refresh();
            })
          }
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await respondToCollabInvite(inviteId, false);
              if (result.error) {
                setError("Couldn't decline — try again.");
                return;
              }
              router.push("/collab");
            })
          }
          className="rounded-lg border border-line px-4 py-1.5 text-sm disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
