"use client";

import { useState, useTransition } from "react";
import { deletePost } from "@/app/actions/posts";

export function AdminDeletePostButton({ postId }: { postId: string }) {
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  // No router.refresh(): deletePost calls revalidatePath, so its response
  // already carries this page re-rendered (see FlaggedContentActions).
  return (
    <span className="flex items-center gap-2">
      {failed && (
        <span role="alert" className="text-xs text-danger">
          Couldn&apos;t delete — reload and try again.
        </span>
      )}
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            try {
              const result = await deletePost(postId);
              if (result.error) setFailed(true);
            } catch {
              setFailed(true);
            }
          })
        }
        className="rounded-md bg-danger px-2.5 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete duplicate"}
      </button>
    </span>
  );
}
