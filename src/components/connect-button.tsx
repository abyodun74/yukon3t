"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { requestConnection } from "@/app/actions/connections";
import { intentLabels } from "@/lib/validations";

type ConnectionStatus = "PENDING" | "ACCEPTED" | "DECLINED" | null;

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
    return <p className="text-xs text-foreground-soft">Request sent</p>;
  }

  if (status === "PENDING" && !isRequester) {
    return (
      <Link href="/connections" className="text-xs font-medium text-accent hover:underline">
        Wants to connect — respond in Connections
      </Link>
    );
  }

  if (localStatus === "sent") {
    return <p className="text-xs text-success">Request sent</p>;
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
      {localStatus === "error" && (
        <span className="text-xs text-danger">Failed</span>
      )}
    </div>
  );
}
