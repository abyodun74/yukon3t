"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/app/actions/messages";

export function MessageForm({ conversationId }: { conversationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className="flex items-end gap-2 border-t border-line p-3"
      action={(fd) => {
        fd.set("conversationId", conversationId);
        startTransition(async () => {
          const result = await sendMessage(fd);
          if (result.error) {
            setError(
              result.error === "rate_limited"
                ? "Slow down a little."
                : "Couldn't send that.",
            );
          } else {
            setError(null);
            formRef.current?.reset();
            router.refresh();
          }
        });
      }}
    >
      <textarea
        name="content"
        required
        maxLength={4000}
        rows={2}
        placeholder="Write a message..."
        className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        Send
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}
