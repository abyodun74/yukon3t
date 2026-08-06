"use client";

import { useState, useTransition } from "react";
import { deleteCollabPost } from "@/app/actions/collab";

export function DeleteCollabButton({
  collabId,
  isAdminOverride = false,
}: {
  collabId: string;
  isAdminOverride?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-danger hover:border-danger"
      >
        {isAdminOverride ? "Delete collaboration (admin)" : "Delete collaboration"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground-soft">
        {isAdminOverride
          ? "Delete this collaboration for everyone? Use this for duplicates or policy violations."
          : "Delete this collaboration for everyone?"}
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await deleteCollabPost(collabId);
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
