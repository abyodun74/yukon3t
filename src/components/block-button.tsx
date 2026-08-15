"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockUser, unblockUser } from "@/app/actions/blocks";

/** Toggles block state for a profile — always visible next to Report, unlike Report it needs no reason. */
export function BlockButton({
  targetId,
  targetName,
  initiallyBlocked,
}: {
  targetId: string;
  targetName: string;
  initiallyBlocked: boolean;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (blocked) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await unblockUser(targetId);
            if (!result.error) {
              setBlocked(false);
              router.refresh();
            }
          })
        }
        className="text-xs text-foreground-soft hover:text-accent disabled:opacity-50"
      >
        Unblock {targetName}
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-foreground-soft">Block {targetName}?</span>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await blockUser(targetId);
              if (!result.error) {
                setBlocked(true);
                setConfirming(false);
                router.refresh();
              }
            })
          }
          className="font-medium text-danger disabled:opacity-50"
        >
          Yes, block
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-foreground-soft">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-xs text-foreground-soft hover:text-danger"
    >
      Block
    </button>
  );
}
