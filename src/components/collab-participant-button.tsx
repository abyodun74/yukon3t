"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCollab, leaveCollab } from "@/app/actions/collab";

export function CollabParticipantButton({
  collabId,
  isParticipant,
  isOwner,
  hasPendingRequest,
}: {
  collabId: string;
  isParticipant: boolean;
  isOwner: boolean;
  hasPendingRequest: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justRequested, setJustRequested] = useState(false);
  const router = useRouter();

  if (isOwner) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        You started this collaboration
      </span>
    );
  }

  if (!isParticipant && (hasPendingRequest || justRequested)) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        Request pending
      </span>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = isParticipant ? await leaveCollab(collabId) : await joinCollab(collabId);
            if (result.error) {
              setError(
                result.error === "owner_cannot_leave"
                  ? "Close this collaboration instead of leaving it."
                  : "Couldn't update your participation — try again.",
              );
              return;
            }
            if (!isParticipant && "requested" in result && result.requested) {
              setJustRequested(true);
            }
            router.refresh();
          })
        }
        className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        {isParticipant ? "Leave" : "Request to Join"}
      </button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
