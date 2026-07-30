"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllAsRead } from "@/app/actions/notifications";

export function MarkAllReadButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await markAllAsRead();
          router.refresh();
        });
      }}
      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
    >
      Mark all as read
    </button>
  );
}
