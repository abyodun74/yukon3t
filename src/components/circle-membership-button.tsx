"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCircle, leaveCircle } from "@/app/actions/circles";

export function CircleMembershipButton({
  circleId,
  isMember,
  isOwner,
  visibility,
  hasPendingRequest,
}: {
  circleId: string;
  isMember: boolean;
  isOwner: boolean;
  visibility: "PUBLIC" | "PRIVATE";
  hasPendingRequest: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [justRequested, setJustRequested] = useState(false);
  const router = useRouter();

  if (isOwner) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        You own this Circle
      </span>
    );
  }

  if (!isMember && (hasPendingRequest || justRequested)) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        Request pending
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          if (isMember) {
            await leaveCircle(circleId);
          } else {
            const result = await joinCircle(circleId);
            if (result.requested) setJustRequested(true);
          }
          router.refresh();
        })
      }
      className="rounded-lg border border-line px-4 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {isMember ? "Leave" : visibility === "PRIVATE" ? "Request to Join" : "Join"}
    </button>
  );
}
