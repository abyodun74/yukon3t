"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { leaveGroup } from "@/app/actions/messages";

export function LeaveGroupButton({ conversationId }: { conversationId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await leaveGroup(conversationId);
        })
      }
      className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-danger hover:border-danger disabled:opacity-50"
    >
      <LogOut size={13} />
      Leave group
    </button>
  );
}
