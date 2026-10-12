"use client";

import { useState, useTransition } from "react";
import { deleteConversation } from "@/app/actions/messages";

export function AdminDeleteConversationButton({ conversationId }: { conversationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  // No router.refresh(): deleteConversation calls revalidatePath, so its
  // response already carries this page re-rendered (see FlaggedContentActions).
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
              const result = await deleteConversation(conversationId);
              if (result.error) setFailed(true);
            } catch {
              setFailed(true);
            }
          })
        }
        className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete duplicate"}
      </button>
    </span>
  );
}
