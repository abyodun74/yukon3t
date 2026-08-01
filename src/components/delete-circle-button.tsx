"use client";

import { useState, useTransition } from "react";
import { deleteCircle } from "@/app/actions/circles";

export function DeleteCircleButton({ circleId }: { circleId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-danger hover:border-danger"
      >
        Delete Circle
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground-soft">Delete this Circle for everyone?</span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await deleteCircle(circleId);
          })
        }
        className="rounded-md bg-danger px-2.5 py-1 font-medium text-white disabled:opacity-50"
      >
        Delete
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => setConfirming(false)}
        className="rounded-md border border-line px-2.5 py-1 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
