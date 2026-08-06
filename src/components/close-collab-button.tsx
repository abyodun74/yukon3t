"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeCollabPost } from "@/app/actions/collab";

/** Author-only: marks a collaboration CLOSED so it drops off the open /collab board. */
export function CloseCollabButton({ collabId }: { collabId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await closeCollabPost(collabId);
          router.refresh();
        })
      }
      className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft hover:border-danger hover:text-danger disabled:opacity-50"
    >
      Close collaboration
    </button>
  );
}
