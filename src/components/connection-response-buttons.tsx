"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToConnection } from "@/app/actions/connections";

export function ConnectionResponseButtons({ connectionId }: { connectionId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const respond = (accept: boolean) =>
    startTransition(async () => {
      const result = await respondToConnection(connectionId, accept);
      if (accept && result.conversationId) {
        router.push(`/messages/${result.conversationId}`);
      } else {
        router.refresh();
      }
    });

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => respond(true)}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
      >
        Accept
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => respond(false)}
        className="rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-50"
      >
        Decline
      </button>
    </div>
  );
}
