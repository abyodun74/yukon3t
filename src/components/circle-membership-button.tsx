"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCircle, leaveCircle } from "@/app/actions/circles";
import { useCirclesText } from "@/components/circles-text";

/**
 * Join / Leave / Accept invite. A PRIVATE Circle is invite-only (lib/circle-visibility.ts): a non-member only ever sees
 * one with a standing invite, and the button then accepts it. There is no "request to join" any more, so a private
 * non-member without an invite gets no button at all (the page itself is a 404 for them), and leaving one goes back
 * to the Circles list.
 */
export function CircleMembershipButton({
  circleId,
  isMember,
  isOwner,
  visibility,
  hasPendingInvite = false,
}: {
  circleId: string;
  isMember: boolean;
  isOwner: boolean;
  visibility: "PUBLIC" | "PRIVATE";
  /** Invited to this PRIVATE Circle: joinCircle then accepts the invite. */
  hasPendingInvite?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const t = useCirclesText().t.membership;

  if (isOwner) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        {t.owner}
      </span>
    );
  }

  if (!isMember && visibility === "PRIVATE" && !hasPendingInvite) return null;

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          if (isMember) {
            await leaveCircle(circleId);
            // A PRIVATE Circle no longer exists for someone who just left it: its page would now be a 404.
            if (visibility === "PRIVATE") {
              router.push("/circles");
              return;
            }
          } else {
            await joinCircle(circleId);
          }
          router.refresh();
        })
      }
      className="rounded-lg border border-line px-4 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {isMember ? t.leave : hasPendingInvite ? t.acceptInvite : t.join}
    </button>
  );
}
