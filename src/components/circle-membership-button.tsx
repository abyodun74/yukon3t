"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCircle, leaveCircle } from "@/app/actions/circles";
import { useCirclesText } from "@/components/circles-text";

export function CircleMembershipButton({
  circleId,
  isMember,
  isOwner,
  visibility,
  hasPendingRequest,
  hasPendingInvite = false,
}: {
  circleId: string;
  isMember: boolean;
  isOwner: boolean;
  visibility: "PUBLIC" | "PRIVATE";
  hasPendingRequest: boolean;
  /** Invited to this PRIVATE Circle: joinCircle then accepts the invite instead of asking to join. */
  hasPendingInvite?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [justRequested, setJustRequested] = useState(false);
  const router = useRouter();
  const t = useCirclesText().t.membership;

  if (isOwner) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        {t.owner}
      </span>
    );
  }

  if (!isMember && !hasPendingInvite && (hasPendingRequest || justRequested)) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        {t.pending}
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
      {isMember ? t.leave : hasPendingInvite ? t.acceptInvite : visibility === "PRIVATE" ? t.request : t.join}
    </button>
  );
}
