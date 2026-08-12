"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteConversation } from "@/app/actions/messages";

export function AdminDeleteConversationButton({ conversationId }: { conversationId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteConversation(conversationId);
          router.refresh();
        })
      }
      className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
    >
      {isPending ? "Deleting..." : "Delete duplicate"}
    </button>
  );
}
