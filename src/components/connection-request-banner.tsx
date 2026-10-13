"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToConnection } from "@/app/actions/connections";
import { useMessagesText } from "@/components/ui-text";
import { format } from "@/lib/i18n/locales";

/**
 * Shown inside a DM that was opened as a message request (see
 * startDirectMessage in actions/connections.ts) rather than an already
 * -accepted connection. The requester sees a quiet "pending" note; the
 * recipient gets the actual prompt to accept or decline, right where
 * they're already reading the message instead of only on /connections.
 */
export function ConnectionRequestBanner({
  connectionId,
  otherName,
  iAmRequester,
}: {
  connectionId: string;
  otherName: string;
  iAmRequester: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [responded, setResponded] = useState<"accepted" | "declined" | null>(null);
  const t = useMessagesText().t.connection;

  if (iAmRequester) {
    return (
      <p className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-foreground-soft">
        {format(t.sent, { name: otherName })}
      </p>
    );
  }

  if (responded === "accepted") {
    return (
      <p className="mb-3 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
        {format(t.accepted, { name: otherName })}
      </p>
    );
  }
  if (responded === "declined") {
    return (
      <p className="mb-3 rounded-lg bg-line px-3 py-2 text-xs text-foreground-soft">
        {t.declined}
      </p>
    );
  }

  function respond(accept: boolean) {
    if (isPending) return;
    startTransition(async () => {
      const result = await respondToConnection(connectionId, accept);
      if (!result.error) {
        setResponded(accept ? "accepted" : "declined");
        router.refresh();
      }
    });
  }

  return (
    <div className="mb-3 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5">
      <p className="text-sm">
        {t.prompt}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond(true)}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {t.accept}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond(false)}
          className="rounded-md border border-line px-3 py-1 text-xs font-medium hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {t.decline}
        </button>
      </div>
    </div>
  );
}
