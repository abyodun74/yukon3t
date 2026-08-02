"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCircle, leaveCircle } from "@/app/actions/circles";

export function CircleMembershipButton({
  circleId,
  isMember,
  isOwner,
}: {
  circleId: string;
  isMember: boolean;
  isOwner: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (isOwner) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        You own this Circle
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          if (isMember) await leaveCircle(circleId);
          else await joinCircle(circleId);
          router.refresh();
        })
      }
      className="rounded-lg border border-line px-4 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {isMember ? "Leave" : "Join"}
    </button>
  );
}
