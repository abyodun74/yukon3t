"use client";

import { useState, useTransition } from "react";
import { deleteCollabPost } from "@/app/actions/collab";
import { useCollabText } from "@/components/collab-text";

export function DeleteCollabButton({
  collabId,
  isAdminOverride = false,
}: {
  collabId: string;
  isAdminOverride?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const t = useCollabText().t.delete;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-danger hover:border-danger"
      >
        {isAdminOverride ? t.openAdmin : t.open}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground-soft">
        {isAdminOverride ? t.confirmAdmin : t.confirm}
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
        {t.action}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => setConfirming(false)}
        className="rounded-md border border-line px-2.5 py-1 disabled:opacity-50"
      >
        {t.cancel}
      </button>
    </div>
  );
}
