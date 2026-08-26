"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestConnection, startDirectMessage } from "@/app/actions/connections";
import { intentLabels } from "@/lib/validations";

type ConnectionStatus = "PENDING" | "ACCEPTED" | "DECLINED" | null;

/**
 * Starts (or jumps straight to) a DM with someone the caller isn't
 * connected to yet — a "message request", not a full Connect flow. Shown
 * alongside Connect in every non-accepted state so messaging never has to
 * wait on an accepted connection; the recipient gets the usual "wants to
 * connect" prompt inside the conversation itself (see ChatThread).
 */
function MessageRequestButton({ targetId }: { targetId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(false);
          startTransition(async () => {
            const result = await startDirectMessage(targetId);
            if (result.error || !result.conversationId) {
              setError(true);
              return;
            }
            router.push(`/messages/${result.conversationId}`);
          });
        }}
        className="rounded-md border border-line px-3 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
      >
        Message
      </button>
      {error && <span className="text-xs text-danger">Couldn&apos;t start that chat</span>}
    </div>
  );
}

export function ConnectButton({
  targetId,
  openToIntents,
  status,
  isRequester,
  conversationId,
}: {
  targetId: string;
  openToIntents: string[];
  status?: ConnectionStatus;
  isRequester?: boolean;
  conversationId?: string | null;
}) {
  const [selected, setSelected] = useState(openToIntents[0] ?? "FRIENDSHIP");
  const [localStatus, setLocalStatus] = useState<"idle" | "sent" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  if (status === "ACCEPTED") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-success">Connected</span>
        <Link
          href={conversationId ? `/messages/${conversationId}` : "/messages"}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink"
        >
          Message
        </Link>
      </div>
    );
  }

  if (status === "PENDING" && isRequester) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-foreground-soft">Request sent</p>
        <MessageRequestButton targetId={targetId} />
      </div>
    );
  }

  if (status === "PENDING" && !isRequester) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/connections" className="text-xs font-medium text-accent hover:underline">
          Wants to connect — respond in Connections
        </Link>
        <MessageRequestButton targetId={targetId} />
      </div>
    );
  }

  if (localStatus === "sent") {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-success">Request sent</p>
        <MessageRequestButton targetId={targetId} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-md border border-line bg-surface px-2 py-1 text-xs"
      >
        {openToIntents.map((tag) => (
          <option key={tag} value={tag}>
            {(intentLabels as Record<string, string>)[tag] ?? tag}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          const fd = new FormData();
          fd.set("targetId", targetId);
          fd.set("intentTag", selected);
          startTransition(async () => {
            const result = await requestConnection(fd);
            setLocalStatus(result.error ? "error" : "sent");
          });
        }}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
      >
        Connect
      </button>
      {localStatus === "error" && <span className="text-xs text-danger">Failed</span>}
      <MessageRequestButton targetId={targetId} />
    </div>
  );
}
